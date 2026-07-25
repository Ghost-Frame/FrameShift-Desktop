//! Native publisher-key lifecycle commands for the desktop creator experience.
//!
//! Tauri receives and returns metadata only. OAuth tokens and Ed25519 private
//! seeds remain inside `frameshift-client`, while recovery passphrases are
//! collected by native password dialogs and never enter WebView JavaScript.

use std::path::PathBuf;

use frameshift_client::{
    Client, ClientError, EnrolledPublisherKey, EnrolledPublisherKeyState, LocalPublisherKeyState,
    PublisherKeyInventory, PublisherKeyMetadata, PublisherSecretBackend,
};
use secrecy::{ExposeSecret as _, SecretString};
use serde::Serialize;

use super::account::{with_authenticated_client, AuthenticatedOperationError};

/// Redacted local publisher-key metadata returned to the WebView.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LocalPublisherKeyView {
    /// Stable identifier derived from the public key.
    pub id: String,
    /// User-visible device or purpose label.
    pub label: String,
    /// Base64url-no-pad public key.
    pub public_key: String,
    /// Local lifecycle state.
    pub state: String,
    /// Secret storage backend name without a backend locator or secret.
    pub secret_backend: String,
    /// Unix timestamp when this local record was created.
    pub created_at: u64,
    /// Whether this key is selected for new signatures.
    pub selected: bool,
}

/// Redacted server-side publisher-key record returned to the WebView.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RemotePublisherKeyView {
    /// Server-assigned key identifier.
    pub id: String,
    /// Server-assigned publisher identifier.
    pub publisher_id: String,
    /// Base64url-no-pad public key.
    pub public_key: String,
    /// User-visible device or purpose label.
    pub label: String,
    /// Remote lifecycle state.
    pub state: String,
    /// RFC 3339 creation timestamp.
    pub created_at: String,
    /// RFC 3339 revocation timestamp when revoked.
    pub revoked_at: Option<String>,
    /// RFC 3339 most-recent-use timestamp when known.
    pub last_used_at: Option<String>,
}

/// Combined local and remote key status for one publisher.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PublisherKeyStatusView {
    /// Whether a local versioned inventory exists.
    pub initialized: bool,
    /// Stable selected local key identifier when one remains active.
    pub selected_key_id: Option<String>,
    /// Metadata-only local key inventory.
    pub local_keys: Vec<LocalPublisherKeyView>,
    /// Public enrolled key records returned by the registry.
    pub remote_keys: Vec<RemotePublisherKeyView>,
    /// Sanitized remote status error when local metadata could still be loaded.
    pub remote_error: Option<String>,
}

/// Result of a multi-step key mutation that creates a replacement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PublisherKeyMutationView {
    /// Newly created local key metadata.
    pub local_key: LocalPublisherKeyView,
    /// Newly enrolled remote key metadata.
    pub remote_key: RemotePublisherKeyView,
    /// Secret-free reconciliation summary.
    pub message: String,
}

/// Successful encrypted recovery-package export result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PublisherKeyExportView {
    /// Whether the native export completed at the user-selected path.
    pub saved: bool,
}

/// Load metadata-only local and remote key status for one publisher.
#[tauri::command]
pub async fn publisher_keys_status(
    publisher_handle: String,
) -> Result<PublisherKeyStatusView, String> {
    tauri::async_runtime::spawn_blocking(move || publisher_keys_status_blocking(&publisher_handle))
        .await
        .map_err(|error| format!("publisher key status task failed: {error}"))?
}

/// Initialize native publisher-key storage without accepting a WebView passphrase.
#[tauri::command]
pub async fn publisher_keys_initialize() -> Result<Vec<LocalPublisherKeyView>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let client = desktop_client()?;
        let initialization = client
            .publisher_key_store()
            .initialize(None)
            .map_err(desktop_key_error)?;
        Ok(local_inventory_views(&initialization.inventory))
    })
    .await
    .map_err(|error| format!("publisher key initialization task failed: {error}"))?
}

/// Create one local key in native credential storage.
#[tauri::command]
pub async fn publisher_key_create(label: String) -> Result<LocalPublisherKeyView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = desktop_client()?;
        let metadata = client
            .publisher_key_store()
            .create_key(&label, None)
            .map_err(desktop_key_error)?;
        Ok(local_key_view(&metadata, false))
    })
    .await
    .map_err(|error| format!("publisher key creation task failed: {error}"))?
}

/// Replace one local key label without opening its private material.
#[tauri::command]
pub async fn publisher_key_label(
    key_id: String,
    label: String,
) -> Result<LocalPublisherKeyView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = desktop_client()?;
        let store = client.publisher_key_store();
        let metadata = store
            .label_key(&key_id, &label)
            .map_err(desktop_key_error)?;
        let selected = store
            .load_inventory()
            .map_err(desktop_key_error)?
            .and_then(|inventory| inventory.active_key_id)
            .as_deref()
            == Some(metadata.id.as_str());
        Ok(local_key_view(&metadata, selected))
    })
    .await
    .map_err(|error| format!("publisher key labeling task failed: {error}"))?
}

/// Select one active local key for future publisher signatures.
#[tauri::command]
pub async fn publisher_key_select(key_id: String) -> Result<LocalPublisherKeyView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = desktop_client()?;
        let metadata = client
            .publisher_key_store()
            .select_key(&key_id)
            .map_err(desktop_key_error)?;
        Ok(local_key_view(&metadata, true))
    })
    .await
    .map_err(|error| format!("publisher key selection task failed: {error}"))?
}

/// Enroll one explicit local key using the native account session.
#[tauri::command]
pub async fn publisher_key_enroll(
    publisher_handle: String,
    key_id: String,
) -> Result<RemotePublisherKeyView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_identifier(&publisher_handle, "publisher handle")?;
        validate_identifier(&key_id, "publisher key identifier")?;
        let enrolled = with_authenticated_client(|client, server, token| {
            client.enroll_publisher_key(server, &publisher_handle, &key_id, token, None)
        })
        .map_err(authenticated_key_error)?;
        Ok(remote_key_view(&enrolled))
    })
    .await
    .map_err(|error| format!("publisher key enrollment task failed: {error}"))?
}

/// Create and enroll a replacement after account recovery on a new device.
#[tauri::command]
pub async fn publisher_key_recover(
    publisher_handle: String,
    label: String,
) -> Result<PublisherKeyMutationView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_identifier(&publisher_handle, "publisher handle")?;
        let client = desktop_client()?;
        let store = client.publisher_key_store();
        let replacement = store.create_key(&label, None).map_err(desktop_key_error)?;
        let enrolled = with_authenticated_client(|client, server, token| {
            client.enroll_publisher_key(server, &publisher_handle, &replacement.id, token, None)
        })
        .map_err(|error| {
            format!(
                "local recovery key {} was created, but enrollment failed: {}",
                replacement.id,
                authenticated_key_error(error)
            )
        })?;
        store
            .select_key(&replacement.id)
            .map_err(desktop_key_error)?;
        Ok(PublisherKeyMutationView {
            local_key: local_key_view(&replacement, true),
            remote_key: remote_key_view(&enrolled),
            message: format!("Recovery key {} is enrolled and selected.", replacement.id),
        })
    })
    .await
    .map_err(|error| format!("publisher key recovery task failed: {error}"))?
}

/// Rotate from the selected enrolled key to a newly enrolled replacement.
#[tauri::command]
pub async fn publisher_key_rotate(
    publisher_handle: String,
    label: String,
    confirmation: String,
) -> Result<PublisherKeyMutationView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        rotate_key_blocking(&publisher_handle, &label, &confirmation)
    })
    .await
    .map_err(|error| format!("publisher key rotation task failed: {error}"))?
}

/// Revoke one enrolled local key with crash-safe local reconciliation.
#[tauri::command]
pub async fn publisher_key_revoke(
    publisher_handle: String,
    key_id: String,
    confirmation: String,
) -> Result<RemotePublisherKeyView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        revoke_local_key_blocking(&publisher_handle, &key_id, &confirmation)
    })
    .await
    .map_err(|error| format!("publisher key revocation task failed: {error}"))?
}

/// Revoke an exact lost-device remote key without requiring local metadata.
#[tauri::command]
pub async fn publisher_key_remote_revoke(
    publisher_handle: String,
    remote_key_id: String,
    confirmation: String,
) -> Result<RemotePublisherKeyView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_identifier(&publisher_handle, "publisher handle")?;
        require_confirmation(&remote_key_id, &confirmation)?;
        let revoked = with_authenticated_client(|client, server, token| {
            client.revoke_publisher_key(server, &publisher_handle, &remote_key_id, token)
        })
        .map_err(authenticated_key_error)?;
        Ok(remote_key_view(&revoked))
    })
    .await
    .map_err(|error| format!("remote publisher key revocation task failed: {error}"))?
}

/// Export one key to a new encrypted package using native file and password dialogs.
#[tauri::command]
pub async fn publisher_key_export(key_id: String) -> Result<PublisherKeyExportView, String> {
    tauri::async_runtime::spawn_blocking(move || export_key_blocking(&key_id))
        .await
        .map_err(|error| format!("publisher key export task failed: {error}"))?
}

/// Import and select an encrypted package using native file and password dialogs.
#[tauri::command]
pub async fn publisher_key_import(label: Option<String>) -> Result<LocalPublisherKeyView, String> {
    tauri::async_runtime::spawn_blocking(move || import_key_blocking(label.as_deref()))
        .await
        .map_err(|error| format!("publisher key import task failed: {error}"))?
}

/// Build the combined key status while preserving local visibility on network errors.
fn publisher_keys_status_blocking(
    publisher_handle: &str,
) -> Result<PublisherKeyStatusView, String> {
    validate_identifier(publisher_handle, "publisher handle")?;
    let client = desktop_client()?;
    let inventory = client
        .publisher_key_store()
        .load_inventory()
        .map_err(desktop_key_error)?;
    let (remote_keys, remote_error) = match with_authenticated_client(|client, server, token| {
        client.list_publisher_keys(server, publisher_handle, token)
    }) {
        Ok(keys) => (keys.iter().map(remote_key_view).collect(), None),
        Err(error) => (Vec::new(), Some(authenticated_key_error(error))),
    };
    let selected_key_id = inventory
        .as_ref()
        .and_then(|inventory| inventory.active_key_id.clone());
    let local_keys = inventory
        .as_ref()
        .map(local_inventory_views)
        .unwrap_or_default();
    Ok(PublisherKeyStatusView {
        initialized: inventory.is_some(),
        selected_key_id,
        local_keys,
        remote_keys,
        remote_error,
    })
}

/// Execute the safe replacement-first publisher-key rotation sequence.
fn rotate_key_blocking(
    publisher_handle: &str,
    label: &str,
    confirmation: &str,
) -> Result<PublisherKeyMutationView, String> {
    validate_identifier(publisher_handle, "publisher handle")?;
    let client = desktop_client()?;
    let store = client.publisher_key_store();
    let inventory = require_inventory(&client)?;
    let old = selected_local_key(&inventory)?;
    require_confirmation(&old.id, confirmation)?;
    let remote_keys = with_authenticated_client(|client, server, token| {
        client.list_publisher_keys(server, publisher_handle, token)
    })
    .map_err(authenticated_key_error)?;
    let old_remote = active_remote_key(&remote_keys, &old.public_key)?.clone();
    let replacement = store.create_key(label, None).map_err(desktop_key_error)?;
    let enrolled = with_authenticated_client(|client, server, token| {
        client.enroll_publisher_key(server, publisher_handle, &replacement.id, token, None)
    })
    .map_err(|error| {
        format!(
            "replacement key {} was created locally, but enrollment failed: {}",
            replacement.id,
            authenticated_key_error(error)
        )
    })?;
    store
        .select_key(&replacement.id)
        .map_err(desktop_key_error)?;
    store
        .mark_revocation_pending(&old.id)
        .map_err(desktop_key_error)?;
    if let Err(error) = with_authenticated_client(|client, server, token| {
        client.revoke_publisher_key(server, publisher_handle, &old_remote.id, token)
    }) {
        if is_definitive_revoke_rejection(&error) {
            let local_state = match store.cancel_revocation(&old.id) {
                Ok(_) => format!("local key {} was restored as active", old.id),
                Err(cancel_error) => format!(
                    "local key {} remains revocation_pending because restoration failed: {}",
                    old.id,
                    desktop_key_error(cancel_error)
                ),
            };
            return Err(format!(
                "Replacement key {} remains enrolled and selected, but the registry rejected revocation of remote key {}: {}; {}.",
                replacement.id,
                old_remote.id,
                authenticated_key_error(error),
                local_state
            ));
        }
        return Err(format!(
            "Replacement key {} remains enrolled and selected, but revocation of remote key {} is unconfirmed: {}. Local key {} remains revocation_pending; retry its revocation to reconcile.",
            replacement.id,
            old_remote.id,
            authenticated_key_error(error),
            old.id
        ));
    }
    store.mark_revoked(&old.id).map_err(|error| {
        format!(
            "Remote key {} was revoked, but local key {} remains revocation_pending: {}",
            old_remote.id,
            old.id,
            desktop_key_error(error)
        )
    })?;
    Ok(PublisherKeyMutationView {
        local_key: local_key_view(&replacement, true),
        remote_key: remote_key_view(&enrolled),
        message: format!("Rotated from local key {} to {}.", old.id, replacement.id),
    })
}

/// Revoke one local and remote key while preserving ambiguous failure state.
fn revoke_local_key_blocking(
    publisher_handle: &str,
    key_id: &str,
    confirmation: &str,
) -> Result<RemotePublisherKeyView, String> {
    validate_identifier(publisher_handle, "publisher handle")?;
    require_confirmation(key_id, confirmation)?;
    let client = desktop_client()?;
    let store = client.publisher_key_store();
    let inventory = require_inventory(&client)?;
    let local = local_key(&inventory, key_id)?;
    if local.state == LocalPublisherKeyState::Revoked {
        return Err(format!("Local publisher key {key_id} is already revoked."));
    }
    let remote_keys = with_authenticated_client(|client, server, token| {
        client.list_publisher_keys(server, publisher_handle, token)
    })
    .map_err(authenticated_key_error)?;
    let remote = remote_key_for_public_key(&remote_keys, &local.public_key)?.clone();
    if remote.state == EnrolledPublisherKeyState::Revoked {
        store.mark_revoked(key_id).map_err(desktop_key_error)?;
        return Ok(remote_key_view(&remote));
    }
    store
        .mark_revocation_pending(key_id)
        .map_err(desktop_key_error)?;
    let revoked = match with_authenticated_client(|client, server, token| {
        client.revoke_publisher_key(server, publisher_handle, &remote.id, token)
    }) {
        Ok(revoked) => revoked,
        Err(error) if is_definitive_revoke_rejection(&error) => {
            let local_state = match store.cancel_revocation(key_id) {
                Ok(_) => "the local key was restored as active".to_string(),
                Err(cancel_error) => format!(
                    "the local key remains revocation_pending because restoration failed: {}",
                    desktop_key_error(cancel_error)
                ),
            };
            return Err(format!(
                "The registry rejected revocation of remote key {}: {}; {}.",
                remote.id,
                authenticated_key_error(error),
                local_state
            ));
        }
        Err(error) => {
            return Err(format!(
                "Remote revocation is unconfirmed: {}. Local key {key_id} remains revocation_pending and cannot sign; retry this revocation to reconcile.",
                authenticated_key_error(error)
            ));
        }
    };
    store.mark_revoked(key_id).map_err(|error| {
        format!(
            "Remote key {} was revoked, but local key {key_id} remains revocation_pending: {}",
            remote.id,
            desktop_key_error(error)
        )
    })?;
    Ok(remote_key_view(&revoked))
}

/// Export one encrypted recovery package without overwriting an existing path.
fn export_key_blocking(key_id: &str) -> Result<PublisherKeyExportView, String> {
    validate_identifier(key_id, "publisher key identifier")?;
    let default_name = format!("frameshift-publisher-key-{key_id}.age");
    let selected = tinyfiledialogs::save_file_dialog_with_filter(
        "Export encrypted FrameShift recovery package",
        &default_name,
        &["*.age"],
        "Age encrypted package",
    )
    .ok_or_else(|| "Recovery package export was cancelled.".to_string())?;
    let passphrase = prompt_new_recovery_passphrase()?;
    let client = desktop_client()?;
    client
        .publisher_key_store()
        .export_recovery(key_id, &PathBuf::from(&selected), None, &passphrase)
        .map_err(desktop_key_error)?;
    Ok(PublisherKeyExportView { saved: true })
}

/// Import one encrypted recovery package and select its validated key.
fn import_key_blocking(label: Option<&str>) -> Result<LocalPublisherKeyView, String> {
    let selected = tinyfiledialogs::open_file_dialog(
        "Import encrypted FrameShift recovery package",
        "",
        Some((&["*.age"], "Age encrypted package")),
    )
    .ok_or_else(|| "Recovery package import was cancelled.".to_string())?;
    let passphrase = prompt_recovery_passphrase("Unlock recovery package")?;
    let client = desktop_client()?;
    let metadata = client
        .publisher_key_store()
        .import_recovery(
            &PathBuf::from(selected),
            &passphrase,
            None,
            label.filter(|value| !value.trim().is_empty()),
        )
        .map_err(desktop_key_error)?;
    Ok(local_key_view(&metadata, true))
}

/// Prompt for and confirm a new recovery passphrase outside the WebView.
fn prompt_new_recovery_passphrase() -> Result<SecretString, String> {
    let first = prompt_recovery_passphrase("Create recovery passphrase")?;
    let second = prompt_recovery_passphrase("Confirm recovery passphrase")?;
    if first.expose_secret() != second.expose_secret() {
        return Err("Recovery passphrases did not match.".to_string());
    }
    Ok(first)
}

/// Read one non-empty recovery passphrase through a native password dialog.
fn prompt_recovery_passphrase(title: &str) -> Result<SecretString, String> {
    let value =
        tinyfiledialogs::password_box(title, "This secret stays in the native FrameShift process.")
            .ok_or_else(|| "Recovery passphrase entry was cancelled.".to_string())?;
    if value.is_empty() {
        return Err("Recovery passphrase cannot be empty.".to_string());
    }
    Ok(SecretString::new(value))
}

/// Construct the default desktop client over the shared FrameShift data root.
fn desktop_client() -> Result<Client, String> {
    Client::with_default_data_root().map_err(|error| error.to_string())
}

/// Require a local inventory before an operation that references an existing key.
fn require_inventory(client: &Client) -> Result<PublisherKeyInventory, String> {
    client
        .publisher_key_store()
        .load_inventory()
        .map_err(desktop_key_error)?
        .ok_or_else(|| "Publisher key storage is not initialized.".to_string())
}

/// Resolve the selected active local key.
fn selected_local_key(inventory: &PublisherKeyInventory) -> Result<PublisherKeyMetadata, String> {
    let key_id = inventory
        .active_key_id
        .as_deref()
        .ok_or_else(|| "No active local publisher key is selected.".to_string())?;
    inventory
        .keys
        .iter()
        .find(|key| key.id == key_id && key.state == LocalPublisherKeyState::Active)
        .cloned()
        .ok_or_else(|| "Selected publisher key metadata is invalid.".to_string())
}

/// Resolve one local metadata record by its stable identifier.
fn local_key(
    inventory: &PublisherKeyInventory,
    key_id: &str,
) -> Result<PublisherKeyMetadata, String> {
    inventory
        .keys
        .iter()
        .find(|key| key.id == key_id)
        .cloned()
        .ok_or_else(|| format!("Local publisher key {key_id} was not found."))
}

/// Resolve the unique active remote record matching one public key.
fn active_remote_key<'a>(
    keys: &'a [EnrolledPublisherKey],
    public_key: &str,
) -> Result<&'a EnrolledPublisherKey, String> {
    let mut matches = keys.iter().filter(|key| {
        key.public_key == public_key && key.state == EnrolledPublisherKeyState::Active
    });
    let found = matches
        .next()
        .ok_or_else(|| "No active remote key matches the selected local key.".to_string())?;
    if matches.next().is_some() {
        return Err("Multiple active remote keys share the selected public key.".to_string());
    }
    Ok(found)
}

/// Resolve the unique remote record matching one local public key.
fn remote_key_for_public_key<'a>(
    keys: &'a [EnrolledPublisherKey],
    public_key: &str,
) -> Result<&'a EnrolledPublisherKey, String> {
    let mut matches = keys.iter().filter(|key| key.public_key == public_key);
    let found = matches
        .next()
        .ok_or_else(|| "No remote key matches the requested local key.".to_string())?;
    if matches.next().is_some() {
        return Err("Multiple remote keys share the requested public key.".to_string());
    }
    Ok(found)
}

/// Return whether the registry definitively rejected a remote revocation.
fn is_definitive_revoke_rejection(error: &AuthenticatedOperationError) -> bool {
    matches!(
        error,
        AuthenticatedOperationError::Client(ClientError::RegistryRejected {
            status: 400..=499,
            ..
        })
    )
}

/// Require the caller to repeat the exact destructive key identifier.
fn require_confirmation(expected: &str, confirmation: &str) -> Result<(), String> {
    validate_identifier(expected, "publisher key identifier")?;
    if confirmation != expected {
        return Err(format!(
            "Confirmation must exactly match key identifier {expected}."
        ));
    }
    Ok(())
}

/// Reject empty or control-character-bearing identifiers at the native boundary.
fn validate_identifier(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.chars().any(char::is_control) {
        return Err(format!("{label} is invalid."));
    }
    Ok(())
}

/// Convert a complete inventory to metadata-only desktop views.
fn local_inventory_views(inventory: &PublisherKeyInventory) -> Vec<LocalPublisherKeyView> {
    inventory
        .keys
        .iter()
        .map(|key| {
            local_key_view(
                key,
                inventory.active_key_id.as_deref() == Some(key.id.as_str()),
            )
        })
        .collect()
}

/// Convert one local metadata record without accessing private material.
fn local_key_view(key: &PublisherKeyMetadata, selected: bool) -> LocalPublisherKeyView {
    LocalPublisherKeyView {
        id: key.id.clone(),
        label: key.label.clone(),
        public_key: key.public_key.clone(),
        state: local_state_name(key.state).to_string(),
        secret_backend: secret_backend_name(key.secret_backend).to_string(),
        created_at: key.created_at,
        selected,
    }
}

/// Convert one server key record into a redacted desktop view.
fn remote_key_view(key: &EnrolledPublisherKey) -> RemotePublisherKeyView {
    RemotePublisherKeyView {
        id: key.id.clone(),
        publisher_id: key.publisher_id.clone(),
        public_key: key.public_key.clone(),
        label: key.label.clone(),
        state: remote_state_name(key.state).to_string(),
        created_at: key.created_at.clone(),
        revoked_at: key.revoked_at.clone(),
        last_used_at: key.last_used_at.clone(),
    }
}

/// Return the stable public name of one local key state.
fn local_state_name(state: LocalPublisherKeyState) -> &'static str {
    match state {
        LocalPublisherKeyState::Active => "active",
        LocalPublisherKeyState::RevocationPending => "revocation_pending",
        LocalPublisherKeyState::Revoked => "revoked",
    }
}

/// Return the stable public name of one secret backend.
fn secret_backend_name(backend: PublisherSecretBackend) -> &'static str {
    match backend {
        PublisherSecretBackend::Keychain => "keychain",
        PublisherSecretBackend::AgeFile => "age_file",
    }
}

/// Return the stable public name of one remote key state.
fn remote_state_name(state: EnrolledPublisherKeyState) -> &'static str {
    match state {
        EnrolledPublisherKeyState::Active => "active",
        EnrolledPublisherKeyState::Revoked => "revoked",
    }
}

/// Add desktop-specific fallback guidance to sanitized core key errors.
fn desktop_key_error(error: ClientError) -> String {
    let needs_cli_guidance = matches!(
        &error,
        ClientError::PublisherKeychainUnavailable { .. }
            | ClientError::PublisherKeyPassphraseRequired { .. }
    );
    let message = error.to_string();
    if needs_cli_guidance {
        format!(
            "{message}. This desktop build does not accept storage passphrases through the WebView; use the FrameShift CLI to manage encrypted fallback storage."
        )
    } else {
        message
    }
}

/// Add native-storage guidance while preserving registry status internally.
fn authenticated_key_error(error: AuthenticatedOperationError) -> String {
    match error {
        AuthenticatedOperationError::Client(error) => desktop_key_error(error),
        AuthenticatedOperationError::Session(message) => message,
    }
}

#[cfg(test)]
/// Publisher-key command mapping and reconciliation regression tests.
mod tests {
    use super::*;

    /// Construct one deterministic local metadata record.
    fn local_metadata(state: LocalPublisherKeyState) -> PublisherKeyMetadata {
        PublisherKeyMetadata {
            id: "local-key".to_string(),
            label: "Laptop".to_string(),
            public_key: "public-key".to_string(),
            state,
            secret_backend: PublisherSecretBackend::Keychain,
            created_at: 42,
        }
    }

    /// Construct one deterministic remote key record.
    fn remote_metadata(state: EnrolledPublisherKeyState) -> EnrolledPublisherKey {
        EnrolledPublisherKey {
            id: "remote-key".to_string(),
            publisher_id: "publisher-id".to_string(),
            public_key: "public-key".to_string(),
            label: "Laptop".to_string(),
            state,
            created_at: "2026-07-25T00:00:00Z".to_string(),
            revoked_at: None,
            last_used_at: None,
        }
    }

    /// Local DTO conversion exposes metadata and selection state only.
    #[test]
    fn maps_local_metadata_without_secret_material() {
        let view = local_key_view(&local_metadata(LocalPublisherKeyState::Active), true);
        assert_eq!(view.id, "local-key");
        assert_eq!(view.secret_backend, "keychain");
        assert_eq!(view.state, "active");
        assert!(view.selected);
    }

    /// Remote DTO conversion preserves public lifecycle evidence.
    #[test]
    fn maps_remote_metadata_without_bearer_material() {
        let view = remote_key_view(&remote_metadata(EnrolledPublisherKeyState::Revoked));
        assert_eq!(view.id, "remote-key");
        assert_eq!(view.state, "revoked");
        assert_eq!(view.public_key, "public-key");
    }

    /// Destructive commands reject every confirmation except the exact key ID.
    #[test]
    fn requires_exact_key_confirmation() {
        assert!(require_confirmation("remote-key", "remote-key").is_ok());
        assert!(require_confirmation("remote-key", "REMOTE-KEY").is_err());
        assert!(require_confirmation("remote-key", " remote-key").is_err());
    }

    /// Remote matching distinguishes active rotation targets from revoked history.
    #[test]
    fn resolves_unique_active_remote_key() {
        let keys = vec![
            remote_metadata(EnrolledPublisherKeyState::Revoked),
            remote_metadata(EnrolledPublisherKeyState::Active),
        ];
        let found = active_remote_key(&keys, "public-key").expect("active key");
        assert_eq!(found.state, EnrolledPublisherKeyState::Active);
    }

    /// Definitive four-hundred responses are safe to reconcile by cancelling pending state.
    #[test]
    fn classifies_definitive_revocation_rejection() {
        let error = AuthenticatedOperationError::Client(ClientError::RegistryRejected {
            url: "https://registry.example/v1/publishers/p/keys/k".to_string(),
            status: 409,
            message: "last active key".to_string(),
        });
        assert!(is_definitive_revoke_rejection(&error));
        assert!(!is_definitive_revoke_rejection(
            &AuthenticatedOperationError::Session("network state unknown".to_string())
        ));
    }
}
