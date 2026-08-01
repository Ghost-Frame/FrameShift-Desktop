//! Native desktop account registration, login, status, and logout commands.
//!
//! Account credentials and bearer tokens remain inside native Rust code and
//! `frameshift-client`; Tauri only serializes redacted account state.

use std::io::{Read as _, Write as _};
use std::net::{IpAddr, SocketAddr, TcpListener, TcpStream};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::{error, fmt};

use frameshift_client::account::{
    get_account, get_auth_config, login_local_account, logout_local_account,
    register_local_account, AccountView, LocalAccountSession, NativeAuthClient,
};
use frameshift_client::session::{AuthenticatedSession, SessionClient, SessionClientConfig};
use frameshift_client::session_store::{
    SessionAuthentication, SessionStore, SessionStoreError, SessionStoreMetadata, StoredSession,
};
use frameshift_client::{registry_base_url, Client, ClientError};
use secrecy::{ExposeSecret as _, SecretString};
use serde::Serialize;
use url::{Position, Url};

/// Default public OAuth client identifier for the shipped desktop app.
const DEFAULT_CLIENT_ID: &str = "frameshift-desktop";
/// Default exact loopback callback registered for the desktop public client.
const DEFAULT_REDIRECT_URI: &str = "http://127.0.0.1:8418/callback";
/// Time allowed for a user to complete browser authorization.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(180);
/// Maximum accepted loopback HTTP request bytes.
const MAX_CALLBACK_REQUEST_BYTES: usize = 16 * 1024;
/// Access-token lifetime margin that triggers proactive refresh.
const REFRESH_MARGIN_SECS: u64 = 30;
/// OIDC scopes required by the native account experience.
const ACCOUNT_SCOPES: &[&str] = &["openid", "profile", "email", "offline_access"];

/// Redacted desktop account state returned across the Tauri boundary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AccountSessionView {
    /// Whether a usable local session and registry account were found.
    pub signed_in: bool,
    /// Stable account identifier when authenticated.
    pub account_id: Option<String>,
    /// Mutable account display name when available.
    pub display_name: Option<String>,
    /// Mutable account email when available.
    pub email: Option<String>,
    /// Current account lifecycle state when authenticated.
    pub status: Option<String>,
    /// Publisher memberships visible to the account.
    pub memberships: Vec<AccountMembershipView>,
}

/// Redacted publisher membership returned to the desktop UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AccountMembershipView {
    /// Stable publisher identifier.
    pub publisher_id: String,
    /// Public publisher handle when supplied by the registry.
    pub handle: Option<String>,
    /// Public publisher display name when supplied by the registry.
    pub display_name: Option<String>,
    /// Publisher moderation state when supplied by the registry.
    pub moderation_status: Option<String>,
    /// Publisher authorization role.
    pub role: String,
    /// Membership lifecycle state.
    pub state: String,
}

/// Local logout result, including a sanitized provider warning when applicable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AccountLogoutView {
    /// Whether exact local session state existed and was removed.
    pub removed: bool,
    /// Non-secret provider revocation diagnostic that did not block local erasure.
    pub revocation_warning: Option<String>,
}

/// Accepted callback URL paired with its browser response stream.
struct PendingCallback {
    /// Exact callback URL reconstructed from the registered redirect origin.
    url: Url,
    /// Loopback browser connection awaiting a terminal response.
    stream: TcpStream,
}

/// Native authentication failure that preserves registry status for reconciliation.
#[derive(Debug)]
pub(super) enum AuthenticatedOperationError {
    /// Session loading, discovery, refresh, or persistence failed.
    Session(String),
    /// The bearer-authenticated registry operation failed.
    Client(ClientError),
}

/// Render a sanitized authentication failure without exposing session secrets.
impl fmt::Display for AuthenticatedOperationError {
    /// Format the underlying public diagnostic.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Session(message) => formatter.write_str(message),
            Self::Client(error) => error.fmt(formatter),
        }
    }
}

/// Mark native authentication failures as standard errors.
impl error::Error for AuthenticatedOperationError {}

/// Load the current redacted account state without blocking the Tauri runtime.
#[tauri::command]
pub async fn account_status() -> Result<AccountSessionView, String> {
    tauri::async_runtime::spawn_blocking(account_status_blocking)
        .await
        .map_err(|error| format!("account status task failed: {error}"))?
}

/// Authenticate through the registry's preferred provider without exposing secrets to JavaScript.
#[tauri::command]
pub async fn account_login() -> Result<AccountSessionView, String> {
    tauri::async_runtime::spawn_blocking(account_login_blocking)
        .await
        .map_err(|error| format!("account login task failed: {error}"))?
}

/// Authenticate with first-party credentials collected by native OS dialogs.
#[tauri::command]
pub async fn account_login_first_party() -> Result<AccountSessionView, String> {
    tauri::async_runtime::spawn_blocking(account_login_first_party_blocking)
        .await
        .map_err(|error| format!("first-party account login task failed: {error}"))?
}

/// Redeem a first-party invitation using credentials collected by native OS dialogs.
#[tauri::command]
pub async fn account_register() -> Result<AccountSessionView, String> {
    tauri::async_runtime::spawn_blocking(account_register_blocking)
        .await
        .map_err(|error| format!("account registration task failed: {error}"))?
}

/// Revoke the provider session when possible and always erase exact local state.
#[tauri::command]
pub async fn account_logout() -> Result<AccountLogoutView, String> {
    tauri::async_runtime::spawn_blocking(account_logout_blocking)
        .await
        .map_err(|error| format!("account logout task failed: {error}"))?
}

/// Select the registry's preferred provider and persist its authenticated session.
fn account_login_blocking() -> Result<AccountSessionView, String> {
    let server = registry_base_url();
    let auth_config = get_auth_config(&server).map_err(|error| error.to_string())?;
    if !auth_config.enabled {
        return Err("FrameShift account authentication is not enabled yet".to_string());
    }
    if let Some(issuer) = auth_config.issuer {
        return account_oidc_login(&server, &issuer);
    }
    if auth_config.first_party_enabled {
        return account_first_party_login(&server);
    }
    Err("The registry did not advertise an enabled account provider".to_string())
}

/// Perform OIDC system-browser login and persist its refreshable session.
fn account_oidc_login(server: &str, issuer: &str) -> Result<AccountSessionView, String> {
    let registry_url =
        Url::parse(server).map_err(|error| format!("invalid registry URL: {error}"))?;
    let issuer = Url::parse(issuer).map_err(|error| format!("invalid OIDC issuer: {error}"))?;
    let client_id = configured_client_id()?;
    let redirect_uri = Url::parse(DEFAULT_REDIRECT_URI)
        .map_err(|error| format!("invalid redirect URI: {error}"))?;
    let listener = bind_callback_listener(&redirect_uri)?;
    let scopes = ACCOUNT_SCOPES
        .iter()
        .map(|scope| (*scope).to_string())
        .collect::<Vec<_>>();
    let session_client = SessionClient::discover(SessionClientConfig {
        issuer: issuer.clone(),
        client_id: client_id.clone(),
        redirect_uri: redirect_uri.clone(),
        scopes: scopes.clone(),
    })
    .map_err(|error| error.to_string())?;
    let flow = session_client
        .begin_authorization()
        .map_err(|error| error.to_string())?;
    webbrowser::open(flow.authorization_url.as_str())
        .map_err(|_| "could not open the system browser for FrameShift login".to_string())?;
    let mut callback = wait_for_callback(&listener, &redirect_uri, LOGIN_TIMEOUT)?;
    let session = match session_client.complete_authorization(&flow, &callback.url) {
        Ok(session) => session,
        Err(error) => {
            respond_to_browser(&mut callback.stream, false);
            return Err(error.to_string());
        }
    };
    let view = match get_account(server, session.access_token()) {
        Ok(view) => view,
        Err(error) => {
            respond_to_browser(&mut callback.stream, false);
            return Err(error.to_string());
        }
    };
    let client = Client::with_default_data_root().map_err(|error| error.to_string())?;
    if let Err(error) = SessionStore::new(client.data_root()).save(
        SessionStoreMetadata {
            authentication: SessionAuthentication::Oidc {
                issuer,
                client_id,
                redirect_uri: Box::new(redirect_uri),
                scopes,
            },
            registry_url,
        },
        &session,
    ) {
        respond_to_browser(&mut callback.stream, false);
        return Err(error.to_string());
    }
    respond_to_browser(&mut callback.stream, true);
    account_view(&view)
}

/// Collect first-party login credentials through native dialogs.
fn account_login_first_party_blocking() -> Result<AccountSessionView, String> {
    let server = registry_base_url();
    let auth_config = get_auth_config(&server).map_err(|error| error.to_string())?;
    if !auth_config.enabled || !auth_config.first_party_enabled {
        return Err("This registry does not advertise first-party account login".to_string());
    }
    account_first_party_login(&server)
}

/// Verify native first-party credentials and persist the returned bearer session.
fn account_first_party_login(server: &str) -> Result<AccountSessionView, String> {
    let email = prompt_required_text("Sign in to FrameShift", "Email address", "Email address")?;
    let password = prompt_secret(
        "Sign in to FrameShift",
        "Password\n\nThis secret stays in the native FrameShift process.",
        "Password",
    )?;
    let authenticated = login_local_account(server, &email, &password, NativeAuthClient::Desktop)
        .map_err(|error| error.to_string())?;
    complete_first_party_authentication(server, authenticated)
}

/// Collect invitation registration details through native dialogs.
fn account_register_blocking() -> Result<AccountSessionView, String> {
    let server = registry_base_url();
    let auth_config = get_auth_config(&server).map_err(|error| error.to_string())?;
    if !auth_config.enabled || !auth_config.first_party_enabled {
        return Err(
            "This registry does not advertise first-party account registration".to_string(),
        );
    }
    if auth_config.registration.as_deref() != Some("invite_only") {
        return Err(
            "This registry does not advertise invite-only account registration".to_string(),
        );
    }
    let invite = prompt_secret(
        "Create a FrameShift account",
        "Invitation token\n\nThis secret stays in the native FrameShift process.",
        "Invitation token",
    )?;
    let email = prompt_required_text(
        "Create a FrameShift account",
        "Invitation email address",
        "Email address",
    )?;
    let display_name =
        prompt_optional_text("Create a FrameShift account", "Display name (optional)")?;
    let password = prompt_confirmed_password()?;
    let authenticated = register_local_account(
        &server,
        &invite,
        &email,
        (!display_name.is_empty()).then_some(display_name.as_str()),
        &password,
        NativeAuthClient::Desktop,
    )
    .map_err(|error| error.to_string())?;
    complete_first_party_authentication(&server, authenticated)
}

/// Fetch the complete account view and persist a first-party native session.
fn complete_first_party_authentication(
    server: &str,
    authenticated: LocalAccountSession,
) -> Result<AccountSessionView, String> {
    let view = match get_account(server, authenticated.session.access_token()) {
        Ok(view) => view,
        Err(error) => {
            let _ = logout_local_account(server, authenticated.session.access_token());
            return Err(error.to_string());
        }
    };
    let registry_url =
        Url::parse(server).map_err(|error| format!("invalid registry URL: {error}"))?;
    let client = Client::with_default_data_root().map_err(|error| error.to_string())?;
    if let Err(error) = SessionStore::new(client.data_root()).save(
        SessionStoreMetadata {
            authentication: SessionAuthentication::FirstParty,
            registry_url,
        },
        &authenticated.session,
    ) {
        let _ = logout_local_account(server, authenticated.session.access_token());
        return Err(error.to_string());
    }
    account_view(&view)
}

/// Load, refresh when needed, and fetch the current registry account.
fn account_status_blocking() -> Result<AccountSessionView, String> {
    let client = Client::with_default_data_root().map_err(|error| error.to_string())?;
    let store = SessionStore::new(client.data_root());
    let mut stored = match store.load() {
        Ok(stored) => stored,
        Err(SessionStoreError::NotFound) => return Ok(signed_out_view()),
        Err(error) => return Err(error.to_string()),
    };
    let view = run_authenticated_operation(&client, &store, &mut stored, |_, server, token| {
        get_account(server, token)
    })
    .map_err(|error| error.to_string())?;
    account_view(&view)
}

/// Run one bearer-authenticated native operation with refresh and one 401 retry.
pub(super) fn with_authenticated_client<T>(
    operation: impl FnMut(&Client, &str, &SecretString) -> Result<T, ClientError>,
) -> Result<T, AuthenticatedOperationError> {
    let client = Client::with_default_data_root()
        .map_err(|error| AuthenticatedOperationError::Session(error.to_string()))?;
    let store = SessionStore::new(client.data_root());
    let mut stored = match store.load() {
        Ok(stored) => stored,
        Err(SessionStoreError::NotFound) => {
            return Err(AuthenticatedOperationError::Session(
                "Sign in to FrameShift before managing publisher keys.".to_string(),
            ));
        }
        Err(error) => {
            return Err(AuthenticatedOperationError::Session(error.to_string()));
        }
    };
    run_authenticated_operation(&client, &store, &mut stored, operation)
}

/// Refresh a loaded session as needed and retry one rejected operation once.
fn run_authenticated_operation<T>(
    client: &Client,
    store: &SessionStore,
    stored: &mut StoredSession,
    mut operation: impl FnMut(&Client, &str, &SecretString) -> Result<T, ClientError>,
) -> Result<T, AuthenticatedOperationError> {
    refresh_loaded_session_if_needed(store, stored)
        .map_err(AuthenticatedOperationError::Session)?;
    match operation(
        client,
        stored.metadata.registry_url.as_str(),
        stored.session.access_token(),
    ) {
        Ok(value) => Ok(value),
        Err(ClientError::RegistryRejected { status: 401, .. })
            if stored.session.refresh_token().is_some()
                && matches!(
                    &stored.metadata.authentication,
                    SessionAuthentication::Oidc { .. }
                ) =>
        {
            let session_client =
                session_client_for(stored).map_err(AuthenticatedOperationError::Session)?;
            stored.session = session_client
                .refresh(&stored.session)
                .map_err(|error| AuthenticatedOperationError::Session(error.to_string()))?;
            persist_loaded_session(store, stored).map_err(AuthenticatedOperationError::Session)?;
            operation(
                client,
                stored.metadata.registry_url.as_str(),
                stored.session.access_token(),
            )
            .map_err(AuthenticatedOperationError::Client)
        }
        Err(error) => Err(AuthenticatedOperationError::Client(error)),
    }
}

/// Best-effort revoke the provider session, then remove exact local state.
fn account_logout_blocking() -> Result<AccountLogoutView, String> {
    let client = Client::with_default_data_root().map_err(|error| error.to_string())?;
    let store = SessionStore::new(client.data_root());
    let stored = match store.load() {
        Ok(stored) => Some(stored),
        Err(SessionStoreError::NotFound) => None,
        Err(error) => return Err(error.to_string()),
    };
    let revocation_warning = stored.as_ref().and_then(revocation_warning);
    let removed = store.remove().map_err(|error| error.to_string())?;
    Ok(AccountLogoutView {
        removed,
        revocation_warning,
    })
}

/// Attempt remote revocation and return only a sanitized non-fatal warning.
fn revocation_warning(stored: &StoredSession) -> Option<String> {
    let revocation = match &stored.metadata.authentication {
        SessionAuthentication::Oidc { .. } => session_client_for(stored).and_then(|client| {
            client
                .revoke(&stored.session)
                .map_err(|error| error.to_string())
        }),
        SessionAuthentication::FirstParty => logout_local_account(
            stored.metadata.registry_url.as_str(),
            stored.session.access_token(),
        )
        .map_err(|error| error.to_string()),
    };
    match revocation {
        Ok(()) => None,
        Err(message) if message.contains("does not advertise a revocation endpoint") => None,
        Err(_) => Some(
            "The provider could not confirm remote revocation, but the local session was removed."
                .to_string(),
        ),
    }
}

/// Recreate the provider client for persisted public metadata.
fn session_client_for(stored: &StoredSession) -> Result<SessionClient, String> {
    let SessionAuthentication::Oidc {
        issuer,
        client_id,
        redirect_uri,
        scopes,
    } = &stored.metadata.authentication
    else {
        return Err("first-party sessions do not use OIDC discovery".to_string());
    };
    SessionClient::discover(SessionClientConfig {
        issuer: issuer.clone(),
        client_id: client_id.clone(),
        redirect_uri: redirect_uri.as_ref().clone(),
        scopes: scopes.clone(),
    })
    .map_err(|error| error.to_string())
}

/// Rewrite one refreshed session using its existing public metadata.
fn persist_loaded_session(store: &SessionStore, stored: &StoredSession) -> Result<(), String> {
    store
        .save(
            SessionStoreMetadata {
                authentication: stored.metadata.authentication.clone(),
                registry_url: stored.metadata.registry_url.clone(),
            },
            &stored.session,
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// Refresh one expiring OIDC session while leaving first-party sessions untouched.
fn refresh_loaded_session_if_needed(
    store: &SessionStore,
    stored: &mut StoredSession,
) -> Result<(), String> {
    if matches!(
        &stored.metadata.authentication,
        SessionAuthentication::Oidc { .. }
    ) && session_expires_soon(&stored.session)
        && stored.session.refresh_token().is_some()
    {
        let session_client = session_client_for(stored)?;
        stored.session = session_client
            .refresh(&stored.session)
            .map_err(|error| error.to_string())?;
        persist_loaded_session(store, stored)?;
    }
    Ok(())
}

/// Convert an authenticated core account response into a redacted desktop DTO.
fn account_view(view: &AccountView) -> Result<AccountSessionView, String> {
    if view.publishers.iter().any(|publisher| {
        !view
            .memberships
            .iter()
            .any(|membership| membership.publisher_id == publisher.id)
    }) {
        return Err("account response included an unrelated publisher profile".to_string());
    }
    let memberships = view
        .memberships
        .iter()
        .map(|membership| {
            let publisher = view
                .publishers
                .iter()
                .find(|publisher| publisher.id == membership.publisher_id);
            if !view.publishers.is_empty() && publisher.is_none() {
                return Err(format!(
                    "account response omitted publisher {}",
                    membership.publisher_id
                ));
            }
            Ok(AccountMembershipView {
                publisher_id: membership.publisher_id.to_string(),
                handle: publisher.map(|profile| profile.handle.clone()),
                display_name: publisher.map(|profile| profile.display_name.clone()),
                moderation_status: publisher
                    .map(|profile| serialized_name(&profile.moderation_status))
                    .transpose()?,
                role: serialized_name(&membership.role)?,
                state: serialized_name(&membership.state)?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(AccountSessionView {
        signed_in: true,
        account_id: Some(view.account.id.to_string()),
        display_name: view.account.display_name.clone(),
        email: view.account.email.clone(),
        status: Some(serialized_name(&view.account.status)?),
        memberships,
    })
}

/// Serialize one snake-case enum into its stable public string representation.
fn serialized_name<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_value(value)
        .map_err(|error| format!("serialize account state: {error}"))?
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "account state was not a string".to_string())
}

/// Return the explicit desktop signed-out state.
fn signed_out_view() -> AccountSessionView {
    AccountSessionView {
        signed_in: false,
        account_id: None,
        display_name: None,
        email: None,
        status: None,
        memberships: Vec::new(),
    }
}

/// Read one required visible value through a native OS dialog.
fn prompt_required_text(title: &str, message: &str, label: &str) -> Result<String, String> {
    let value = prompt_optional_text(title, message)?;
    if value.trim().is_empty() {
        return Err(format!("{label} cannot be empty"));
    }
    Ok(value.trim().to_string())
}

/// Read one optional visible value without allowing control characters.
fn prompt_optional_text(title: &str, message: &str) -> Result<String, String> {
    let value = tinyfiledialogs::input_box(title, message, "")
        .ok_or_else(|| "Account operation cancelled".to_string())?;
    if value.chars().any(char::is_control) {
        return Err("Account values must not contain control characters".to_string());
    }
    Ok(value)
}

/// Read one required secret through a native password dialog.
fn prompt_secret(title: &str, message: &str, label: &str) -> Result<SecretString, String> {
    let value = tinyfiledialogs::password_box(title, message)
        .ok_or_else(|| "Account operation cancelled".to_string())?;
    if value.is_empty() {
        return Err(format!("{label} cannot be empty"));
    }
    Ok(SecretString::new(value))
}

/// Read and exactly confirm a new password through native password dialogs.
fn prompt_confirmed_password() -> Result<SecretString, String> {
    let password = prompt_secret(
        "Create a FrameShift account",
        "Password\n\nThis secret stays in the native FrameShift process.",
        "Password",
    )?;
    let confirmation = prompt_secret(
        "Create a FrameShift account",
        "Confirm password\n\nThis secret stays in the native FrameShift process.",
        "Password confirmation",
    )?;
    if password.expose_secret() != confirmation.expose_secret() {
        return Err("Passwords did not match".to_string());
    }
    Ok(password)
}

/// Resolve and validate the configurable desktop public client identifier.
fn configured_client_id() -> Result<String, String> {
    let value = std::env::var("FRAMESHIFT_OIDC_CLIENT_ID")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_CLIENT_ID.to_string());
    if value.trim().is_empty() || value.chars().any(char::is_control) {
        return Err(
            "OIDC client ID must be non-empty and contain no control characters".to_string(),
        );
    }
    Ok(value)
}

/// Bind only the exact IP-loopback callback address and explicit port.
fn bind_callback_listener(redirect_uri: &Url) -> Result<TcpListener, String> {
    if redirect_uri.scheme() != "http"
        || redirect_uri.query().is_some()
        || redirect_uri.fragment().is_some()
        || !redirect_uri.username().is_empty()
        || redirect_uri.password().is_some()
    {
        return Err(
            "desktop redirect URI must be credential-free loopback HTTP without query or fragment"
                .to_string(),
        );
    }
    let ip = redirect_uri
        .host_str()
        .and_then(|host| host.parse::<IpAddr>().ok())
        .filter(IpAddr::is_loopback)
        .ok_or_else(|| "desktop redirect URI host must be an IP loopback address".to_string())?;
    let port = redirect_uri
        .port()
        .filter(|port| *port != 0)
        .ok_or_else(|| "desktop redirect URI needs an explicit port".to_string())?;
    let listener = TcpListener::bind(SocketAddr::new(ip, port))
        .map_err(|error| format!("bind desktop login callback: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("configure desktop login callback: {error}"))?;
    Ok(listener)
}

/// Accept one bounded loopback callback before the deadline.
fn wait_for_callback(
    listener: &TcpListener,
    redirect_uri: &Url,
    timeout: Duration,
) -> Result<PendingCallback, String> {
    let deadline = Instant::now() + timeout;
    loop {
        match listener.accept() {
            Ok((mut stream, peer)) => {
                if !peer.ip().is_loopback() {
                    continue;
                }
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .map_err(|error| format!("configure browser callback: {error}"))?;
                let url = read_callback_url(&mut stream, redirect_uri)?;
                return Ok(PendingCallback { url, stream });
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err("timed out waiting for browser authorization".to_string());
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(error) => return Err(format!("accept browser callback: {error}")),
        }
    }
}

/// Read one bounded origin-form HTTP callback request.
fn read_callback_url(stream: &mut TcpStream, redirect_uri: &Url) -> Result<Url, String> {
    let mut request = Vec::new();
    let mut chunk = [0_u8; 1024];
    while !request.windows(4).any(|window| window == b"\r\n\r\n") {
        let count = stream
            .read(&mut chunk)
            .map_err(|error| format!("read browser callback: {error}"))?;
        if count == 0 {
            break;
        }
        request.extend_from_slice(&chunk[..count]);
        if request.len() > MAX_CALLBACK_REQUEST_BYTES {
            return Err("browser callback request exceeded the size limit".to_string());
        }
    }
    parse_callback_request(&request, redirect_uri)
}

/// Parse bounded HTTP bytes into the registered callback origin.
fn parse_callback_request(request: &[u8], redirect_uri: &Url) -> Result<Url, String> {
    let first_line = request
        .split(|byte| *byte == b'\n')
        .next()
        .and_then(|line| std::str::from_utf8(line).ok())
        .map(str::trim_end)
        .ok_or_else(|| "browser callback was not valid HTTP".to_string())?;
    let mut parts = first_line.split_ascii_whitespace();
    let method = parts.next();
    let target = parts.next();
    let version = parts.next();
    if method != Some("GET")
        || version.is_none_or(|value| !value.starts_with("HTTP/1."))
        || parts.next().is_some()
    {
        return Err("browser callback must be one HTTP GET request".to_string());
    }
    let target = target.filter(|value| value.starts_with('/') && !value.starts_with("//"));
    let target = target.ok_or_else(|| "browser callback target is invalid".to_string())?;
    let callback = Url::parse(&format!(
        "{}{}",
        &redirect_uri[..Position::BeforePath],
        target
    ))
    .map_err(|error| format!("browser callback URL is invalid: {error}"))?;
    if callback.path() != redirect_uri.path() || callback.fragment().is_some() {
        return Err("browser callback did not match the registered path".to_string());
    }
    Ok(callback)
}

/// Send a secret-free browser completion response.
fn respond_to_browser(stream: &mut TcpStream, success: bool) {
    let (status, message) = if success {
        (
            "200 OK",
            "FrameShift login complete. You may close this window and return to the app.",
        )
    } else {
        (
            "400 Bad Request",
            "FrameShift rejected this login callback. Return to the app and try again.",
        )
    };
    let body =
        format!("<!doctype html><meta charset=utf-8><title>FrameShift</title><p>{message}</p>");
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

/// Return whether an access token is expired or inside the refresh margin.
fn session_expires_soon(session: &AuthenticatedSession) -> bool {
    session
        .summary()
        .expires_at
        .is_some_and(|expiry| expiry <= unix_now().saturating_add(REFRESH_MARGIN_SECS))
}

/// Return the current Unix timestamp.
fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
/// Native account command regression tests.
mod tests {
    use super::*;

    /// Parse one deterministic account response with aligned publisher metadata.
    fn account_response(publishers: serde_json::Value) -> AccountView {
        serde_json::from_value(serde_json::json!({
            "account": {
                "id": "00000000-0000-0000-0000-000000000001",
                "issuer": "https://issuer.example",
                "subject": "subject-1",
                "email": "creator@example.invalid",
                "display_name": "Creator",
                "status": "active",
                "created_at": "2026-07-25T00:00:00Z",
                "updated_at": "2026-07-25T00:00:00Z"
            },
            "memberships": [{
                "publisher_id": "00000000-0000-0000-0000-000000000002",
                "account_id": "00000000-0000-0000-0000-000000000001",
                "role": "owner",
                "state": "active",
                "created_at": "2026-07-25T00:00:00Z",
                "updated_at": "2026-07-25T00:00:00Z"
            }],
            "publishers": publishers
        }))
        .expect("account response")
    }

    /// Parse a valid origin-form callback without trusting a Host header.
    #[test]
    fn parses_exact_loopback_callback_origin() {
        let redirect = Url::parse(DEFAULT_REDIRECT_URI).expect("redirect URL");
        let request = b"GET /callback?code=abc&state=xyz HTTP/1.1\r\nHost: evil.example\r\n\r\n";
        let parsed = parse_callback_request(request, &redirect).expect("callback");
        assert_eq!(
            parsed.as_str(),
            "http://127.0.0.1:8418/callback?code=abc&state=xyz"
        );
    }

    /// Reject absolute-form and non-GET callback requests.
    #[test]
    fn rejects_untrusted_callback_request_targets() {
        let redirect = Url::parse(DEFAULT_REDIRECT_URI).expect("redirect URL");
        assert!(parse_callback_request(
            b"GET http://evil.example/callback?code=x HTTP/1.1\r\n\r\n",
            &redirect
        )
        .is_err());
        assert!(parse_callback_request(b"POST /callback HTTP/1.1\r\n\r\n", &redirect).is_err());
        assert!(parse_callback_request(b"GET /other?code=x HTTP/1.1\r\n\r\n", &redirect).is_err());
    }

    /// Signed-out state contains no stale account or membership values.
    #[test]
    fn signed_out_state_is_empty() {
        let view = signed_out_view();
        assert!(!view.signed_in);
        assert!(view.account_id.is_none());
        assert!(view.memberships.is_empty());
    }

    /// Account conversion associates each membership with its server-trusted handle.
    #[test]
    fn maps_aligned_publisher_profiles() {
        let source = account_response(serde_json::json!([{
            "id": "00000000-0000-0000-0000-000000000002",
            "handle": "preview-creator",
            "display_name": "Preview Studio",
            "bio": null,
            "moderation_status": "approved",
            "created_at": "2026-07-25T00:00:00Z",
            "updated_at": "2026-07-25T00:00:00Z"
        }]));
        let view = account_view(&source).expect("desktop account view");
        assert_eq!(
            view.memberships[0].handle.as_deref(),
            Some("preview-creator")
        );
        assert_eq!(
            view.memberships[0].moderation_status.as_deref(),
            Some("approved")
        );
    }

    /// Account conversion fails closed when a non-empty profile list is incomplete.
    #[test]
    fn rejects_partial_publisher_profile_mapping() {
        let source = account_response(serde_json::json!([{
            "id": "00000000-0000-0000-0000-000000000003",
            "handle": "unrelated",
            "display_name": "Unrelated",
            "bio": null,
            "moderation_status": "approved",
            "created_at": "2026-07-25T00:00:00Z",
            "updated_at": "2026-07-25T00:00:00Z"
        }]));
        assert!(account_view(&source).is_err());
    }
}
