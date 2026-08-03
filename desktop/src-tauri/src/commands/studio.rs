//! Native Creator Studio draft, review, and quarantine-submission commands.
//!
//! Local paths, account bearer tokens, signing keys, immutable snapshots, and
//! raw registry responses remain inside Rust. The WebView receives only public
//! draft content, path-free reports, exact public bindings, and redacted
//! submission state.

use async_trait::async_trait;
use ed25519_dalek::SigningKey;
use frameshift_catalog::{
    MembershipState, PublicationSubmissionRecord, PublicationSubmissionState, PublisherRole,
};
use frameshift_client::account::{get_account, AccountView};
use frameshift_client::identity::public_key_hex;
use frameshift_client::publication::{
    create_publication_intent, get_publication_submission, prepare_publication, submit_publication,
};
use frameshift_client::{
    Client, ClientError, EnrolledPublisherKey, EnrolledPublisherKeyState, PersonaSpec,
    PublisherKeyMetadata,
};
use frameshift_conformance::{CliRunner, ConformanceError, Runner};
use frameshift_studio::{
    Draft, DraftPreview, DraftReviewReport, DraftStatus, DraftTemplate, DraftValidationReport,
    ForkIdentityInput, GuidedTemplateInput, PublicationReviewBinding, Studio, StudioError,
    MIN_PUBLICATION_CONFORMANCE_THRESHOLD,
};
use secrecy::SecretString;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::account::{with_authenticated_client, AuthenticatedOperationError};

/// Subscription-backed model used by the isolated local conformance runner.
const DESKTOP_CONFORMANCE_MODEL: &str = "Gemini 3.1 Pro (High)";
/// Maximum accepted publisher-handle or local-key identifier characters.
const MAX_AUTHORITY_IDENTIFIER_CHARS: usize = 256;

/// Blank or guided draft creation input accepted from the WebView.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum StudioTemplateInput {
    /// Create an editable local-only skeleton.
    Blank,
    /// Create a valid typed skeleton using a native-resolved signing key.
    Guided(StudioGuidedTemplateInput),
}

/// Guided fields whose author key is resolved exclusively in native code.
#[derive(Debug, Clone, Deserialize)]
pub struct StudioGuidedTemplateInput {
    /// Stable public pack and persona name.
    pub name: String,
    /// Initial semantic version.
    pub version: String,
    /// Public author or publisher handle.
    pub author_handle: String,
    /// Exact active local key identifier, never private key material.
    pub key_id: String,
    /// Short public purpose statement.
    pub description: String,
    /// Short deterministic voice direction.
    pub voice_tone: String,
    /// Optional SPDX license identifier.
    pub license: Option<String>,
    /// Whether published bytes explicitly permit forking.
    #[serde(default)]
    pub forkable: bool,
}

/// Public identity assigned to a verified registry fork.
#[derive(Debug, Clone, Deserialize)]
pub struct StudioForkIdentityInput {
    /// Stable public name for the distinct derived pack.
    pub name: String,
    /// Initial semantic version for the derived pack.
    pub version: String,
    /// Public account-owned publisher handle.
    pub author_handle: String,
    /// Exact active local key identifier, never private key material.
    pub key_id: String,
    /// Whether the derived release permits another Creator Studio fork.
    #[serde(default)]
    pub forkable: bool,
}

/// One bounded UTF-8 public draft file returned to the editor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StudioFileView {
    /// Normalized public relative path supplied by the caller.
    pub path: String,
    /// Exact UTF-8 file content.
    pub content: String,
}

/// Redacted non-public submission state returned across the Tauri boundary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StudioSubmissionView {
    /// Stable caller-generated submission identifier.
    pub id: String,
    /// Stable caller-generated publication-intent identifier.
    pub intent_id: String,
    /// Account-owned publisher identifier.
    pub publisher_id: String,
    /// Active enrolled publisher-key identifier.
    pub publisher_key_id: String,
    /// SHA-256 digest of the exact quarantined archive bytes.
    pub archive_hash: String,
    /// SHA-256 digest of the canonical manifest bytes.
    pub manifest_hash: String,
    /// SHA-256 digest of the normalized public inventory.
    pub file_inventory_hash: String,
    /// Scanner contract version used by the server report.
    pub scan_schema_version: u32,
    /// Current non-public moderation lifecycle state.
    pub state: String,
    /// RFC 3339 creation timestamp.
    pub created_at: String,
    /// RFC 3339 most-recent lifecycle update timestamp.
    pub updated_at: String,
}

/// One freshly resolved artifact, signing key, and publisher authority.
struct ResolvedPublication {
    /// Exact active local key used to prepare and later sign the artifact.
    signing_key: SigningKey,
    /// Path-free review report bound to fresh account and remote-key state.
    review: DraftReviewReport,
}

/// Runtime selected for one honest desktop conformance execution.
enum DesktopConformanceRunner {
    /// Isolated subscription-backed Gemini CLI runner.
    Available(CliRunner),
    /// Explicit failure runner used when isolated setup cannot be established.
    Unavailable,
}

/// Execute conformance prompts through the isolated runner or fail closed.
#[async_trait]
impl Runner for DesktopConformanceRunner {
    /// Return one scoreable response or an intentionally path-free runner failure.
    async fn run(&self, prompt: &str) -> Result<String, ConformanceError> {
        match self {
            Self::Available(runner) => runner.run(prompt).await,
            Self::Unavailable => Err(ConformanceError::Runner(
                "desktop conformance runner unavailable".to_string(),
            )),
        }
    }
}

/// List local Creator Studio draft metadata in stable identifier order.
#[tauri::command]
pub async fn studio_list() -> Result<Vec<Draft>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let client = desktop_client()?;
        open_studio(&client)?.list().map_err(studio_error)
    })
    .await
    .map_err(|_| task_error("draft listing"))?
}

/// Create one blank or guided draft without accepting author key bytes from JavaScript.
#[tauri::command]
pub async fn studio_create(
    id: String,
    title: String,
    template: StudioTemplateInput,
) -> Result<DraftStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = desktop_client()?;
        let studio = open_studio(&client)?;
        let template = native_template(&client, template)?;
        studio
            .create_template(&id, &title, template)
            .map_err(studio_error)
    })
    .await
    .map_err(|_| task_error("draft creation"))?
}

/// Import one user-selected native directory without accepting its path from the WebView.
#[tauri::command]
pub async fn studio_import(id: String, title: String) -> Result<Option<DraftStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(source) =
            tinyfiledialogs::select_folder_dialog("Import a FrameShift persona folder", "")
        else {
            return Ok(None);
        };
        let client = desktop_client()?;
        let status = open_studio(&client)?
            .import(&id, &title, source)
            .map_err(studio_error)?;
        Ok(Some(status))
    })
    .await
    .map_err(|_| task_error("draft import"))?
}

/// Fork one exact cryptographically verified and explicitly forkable registry version.
#[tauri::command]
pub async fn studio_fork(
    id: String,
    title: String,
    source_name: String,
    source_version: String,
    identity: StudioForkIdentityInput,
) -> Result<DraftStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = desktop_client()?;
        let studio = open_studio(&client)?;
        let identity = native_fork_identity(&client, identity)?;
        client
            .fork_registry_draft(
                &studio,
                &id,
                &title,
                &PersonaSpec {
                    name: source_name,
                    version: source_version,
                },
                identity,
            )
            .map_err(|error| safe_client_error("verified registry fork", error))
    })
    .await
    .map_err(|_| task_error("registry fork"))?
}

/// Read one bounded public draft file and reject non-UTF-8 content.
#[tauri::command]
pub async fn studio_read_file(id: String, path: String) -> Result<StudioFileView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = desktop_client()?;
        let bytes = open_studio(&client)?
            .read_file(&id, &path)
            .map_err(studio_error)?;
        let content = String::from_utf8(bytes)
            .map_err(|_| "Creator Studio only opens UTF-8 text files.".to_string())?;
        Ok(StudioFileView { path, content })
    })
    .await
    .map_err(|_| task_error("draft file read"))?
}

/// Atomically replace one UTF-8 public draft file and invalidate prior approvals.
#[tauri::command]
pub async fn studio_write_file(
    id: String,
    path: String,
    content: String,
) -> Result<DraftStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = desktop_client()?;
        open_studio(&client)?
            .write_file(&id, &path, content.as_bytes())
            .map_err(studio_error)
    })
    .await
    .map_err(|_| task_error("draft file write"))?
}

/// Remove one exact public draft file and invalidate prior approvals.
#[tauri::command]
pub async fn studio_remove_file(id: String, path: String) -> Result<DraftStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = desktop_client()?;
        open_studio(&client)?
            .remove_file(&id, &path)
            .map_err(studio_error)
    })
    .await
    .map_err(|_| task_error("draft file removal"))?
}

/// Return fresh scanner and approval state for one exact draft inventory.
#[tauri::command]
pub async fn studio_status(id: String) -> Result<DraftStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = desktop_client()?;
        open_studio(&client)?.status(&id).map_err(studio_error)
    })
    .await
    .map_err(|_| task_error("draft status"))?
}

/// Render every supported agent target from one exact current draft inventory.
#[tauri::command]
pub async fn studio_preview(id: String) -> Result<DraftPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = desktop_client()?;
        open_studio(&client)?.preview(&id).map_err(studio_error)
    })
    .await
    .map_err(|_| task_error("draft preview"))?
}

/// Run publication policy and applicable conformance tests without returning raw model output.
#[tauri::command]
pub async fn studio_validate(id: String) -> Result<DraftValidationReport, String> {
    let setup_id = id.clone();
    let (studio, runner) = tauri::async_runtime::spawn_blocking(move || {
        let client = desktop_client()?;
        let studio = open_studio(&client)?;
        let runner = desktop_conformance_runner(&studio, &setup_id);
        Ok::<_, String>((studio, runner))
    })
    .await
    .map_err(|_| task_error("draft validation setup"))??;

    studio
        .validate_draft(&id, MIN_PUBLICATION_CONFORMANCE_THRESHOLD, &runner)
        .await
        .map_err(studio_error)
}

/// Prepare a path-free exact-file review after re-resolving account and key authority.
#[tauri::command]
pub async fn studio_prepare_review(
    id: String,
    publisher_handle: String,
    key_id: String,
) -> Result<DraftReviewReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = desktop_client()?;
        let studio = open_studio(&client)?;
        resolve_publication(&client, &studio, &id, &publisher_handle, &key_id)
            .map(|resolved| resolved.review)
    })
    .await
    .map_err(|_| task_error("publication review"))?
}

/// Persist explicit confirmation of one exact current review binding.
#[tauri::command]
pub async fn studio_confirm_review(
    id: String,
    binding: PublicationReviewBinding,
) -> Result<DraftStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = desktop_client()?;
        open_studio(&client)?
            .confirm_review(&id, binding)
            .map_err(studio_error)
    })
    .await
    .map_err(|_| task_error("review confirmation"))?
}

/// Re-prepare, intent-bind, sign, and upload exact reviewed bytes only to quarantine.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn studio_submit(
    id: String,
    publisher_handle: String,
    key_id: String,
    binding: PublicationReviewBinding,
    intent_id: Option<String>,
    submission_id: Option<String>,
) -> Result<StudioSubmissionView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let intent_id = optional_uuid(intent_id.as_deref(), "publication intent")?;
        let submission_id = optional_uuid(submission_id.as_deref(), "publication submission")?;
        submit_blocking(
            &id,
            &publisher_handle,
            &key_id,
            binding,
            intent_id,
            submission_id,
        )
    })
    .await
    .map_err(|_| task_error("publication submission"))?
}

/// Retrieve current account-owned moderation state for one quarantined submission.
#[tauri::command]
pub async fn studio_submission_status(
    submission_id: String,
) -> Result<StudioSubmissionView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let submission_id = parse_uuid(&submission_id, "publication submission")?;
        let record = with_authenticated_client(|_, server, token| {
            get_publication_submission(server, token, submission_id)
        })
        .map_err(|error| authenticated_error("submission status", error))?;
        Ok(submission_view(&record))
    })
    .await
    .map_err(|_| task_error("submission status"))?
}

/// Convert a WebView template into the core type after resolving its exact active key.
fn native_template(client: &Client, input: StudioTemplateInput) -> Result<DraftTemplate, String> {
    match input {
        StudioTemplateInput::Blank => Ok(DraftTemplate::Blank),
        StudioTemplateInput::Guided(input) => {
            let (_, signing_key) = load_requested_signing_key(client, &input.key_id)?;
            Ok(DraftTemplate::Guided(GuidedTemplateInput {
                name: input.name,
                version: input.version,
                author_handle: input.author_handle,
                author_pubkey: public_key_hex(&signing_key),
                description: input.description,
                voice_tone: input.voice_tone,
                license: input.license,
                forkable: input.forkable,
            }))
        }
    }
}

/// Convert a WebView fork identity after resolving its exact active local key.
fn native_fork_identity(
    client: &Client,
    input: StudioForkIdentityInput,
) -> Result<ForkIdentityInput, String> {
    let (_, signing_key) = load_requested_signing_key(client, &input.key_id)?;
    Ok(ForkIdentityInput {
        name: input.name,
        version: input.version,
        author_handle: input.author_handle,
        author_pubkey: public_key_hex(&signing_key),
        forkable: input.forkable,
    })
}

/// Construct the canonical Creator Studio store below managed FrameShift data.
fn open_studio(client: &Client) -> Result<Studio, String> {
    Studio::open(client.data_root().join("studio").join("drafts")).map_err(studio_error)
}

/// Construct the default desktop client without exposing its managed data root on failure.
fn desktop_client() -> Result<Client, String> {
    Client::with_default_data_root()
        .map_err(|_| "FrameShift could not open its managed native data store.".to_string())
}

/// Load one requested active key, prompting natively only for encrypted fallback storage.
fn load_requested_signing_key(
    client: &Client,
    key_id: &str,
) -> Result<(PublisherKeyMetadata, SigningKey), String> {
    validate_authority_identifier(key_id, "publisher key identifier")?;
    let store = client.publisher_key_store();
    match store.load_active_key(key_id, None) {
        Ok(loaded) => Ok(loaded),
        Err(ClientError::PublisherKeyPassphraseRequired { .. }) => {
            let passphrase = tinyfiledialogs::password_box(
                "Unlock publisher key",
                "Encrypted fallback passphrase\n\nThis secret stays in the native FrameShift process.",
            )
            .ok_or_else(|| "Publisher key unlock was cancelled.".to_string())?;
            if passphrase.is_empty() {
                return Err("Publisher key passphrase cannot be empty.".to_string());
            }
            let passphrase = SecretString::new(passphrase);
            store
                .load_active_key(key_id, Some(&passphrase))
                .map_err(safe_key_error)
        }
        Err(error) => Err(safe_key_error(error)),
    }
}

/// Build an isolated CLI runner from the Gemini preview or an explicit blocked runner.
fn desktop_conformance_runner(studio: &Studio, id: &str) -> DesktopConformanceRunner {
    let persona = studio.preview(id).ok().and_then(|preview| {
        preview
            .targets
            .into_iter()
            .find(|target| target.target == "gemini")
            .map(|target| target.content)
    });
    match persona.and_then(|content| CliRunner::new(&content, DESKTOP_CONFORMANCE_MODEL).ok()) {
        Some(runner) => DesktopConformanceRunner::Available(runner),
        None => DesktopConformanceRunner::Unavailable,
    }
}

/// Recompute one exact artifact and resolve fresh owner and remote-key authority.
fn resolve_publication(
    client: &Client,
    studio: &Studio,
    id: &str,
    publisher_handle: &str,
    key_id: &str,
) -> Result<ResolvedPublication, String> {
    validate_authority_identifier(publisher_handle, "publisher handle")?;
    validate_authority_identifier(key_id, "publisher key identifier")?;
    let status = studio.status(id).map_err(studio_error)?;
    let snapshot = studio
        .snapshot_for_review(id, &status.publication.inventory_hash)
        .map_err(studio_error)?;
    let (metadata, signing_key) = load_requested_signing_key(client, key_id)?;
    let prepared = prepare_publication(&snapshot, &signing_key)
        .map_err(|error| safe_client_error("publication preparation", error))?;

    let (account, remote_keys) = with_authenticated_client(|client, server, token| {
        let account = get_account(server, token)?;
        let keys = client.list_publisher_keys(server, publisher_handle, token)?;
        Ok((account, keys))
    })
    .map_err(|error| authenticated_error("publication authority check", error))?;
    let publisher_id = resolve_owned_publisher(&account, publisher_handle)?;
    let publisher_key_id =
        resolve_active_remote_key(&remote_keys, &metadata.public_key, publisher_id)?;
    let binding = PublicationReviewBinding {
        artifact: prepared.binding(),
        publisher_id,
        publisher_key_id,
    };
    let review = studio.review_report(id, binding).map_err(studio_error)?;
    require_manifest_publisher(&review.manifest.author_handle, publisher_handle)?;
    Ok(ResolvedPublication {
        signing_key,
        review,
    })
}

/// Execute the exact reviewed submission sequence with stable retry identifiers.
fn submit_blocking(
    id: &str,
    publisher_handle: &str,
    key_id: &str,
    binding: PublicationReviewBinding,
    intent_id: Uuid,
    submission_id: Uuid,
) -> Result<StudioSubmissionView, String> {
    let client = desktop_client()?;
    let studio = open_studio(&client)?;
    let resolved = resolve_publication(&client, &studio, id, publisher_handle, key_id)?;
    require_matching_binding(resolved.review.binding, binding)?;

    let status = studio.status(id).map_err(studio_error)?;
    if !status.review_current
        || status
            .draft
            .review
            .as_ref()
            .and_then(|review| review.binding)
            != Some(binding)
    {
        return Err(
            "Confirm the current exact-file review before submitting this draft.".to_string(),
        );
    }
    studio
        .confirm_submission_intent(id, binding)
        .map_err(studio_error)?;
    let snapshot = studio
        .snapshot_for_submission(id, binding)
        .map_err(studio_error)?;
    let prepared = prepare_publication(&snapshot, &resolved.signing_key)
        .map_err(|error| safe_client_error("publication re-preparation", error))?;
    if prepared.binding() != binding.artifact {
        return Err("The draft changed after its exact-file confirmation.".to_string());
    }

    let result = with_authenticated_client(|_, server, token| {
        create_publication_intent(server, token, intent_id, binding, &prepared)?;
        submit_publication(
            server,
            token,
            &resolved.signing_key,
            submission_id,
            intent_id,
            &prepared,
        )
    })
    .map_err(|error| {
        retryable_authenticated_error("publication submission", error, intent_id, submission_id)
    })?;
    Ok(submission_view(&result))
}

/// Resolve one exact active owner membership and its aligned publisher profile.
fn resolve_owned_publisher(view: &AccountView, handle: &str) -> Result<Uuid, String> {
    let mut profiles = view
        .publishers
        .iter()
        .filter(|profile| profile.handle == handle);
    let profile = profiles
        .next()
        .ok_or_else(|| "The account does not own the selected publisher.".to_string())?;
    if profiles.next().is_some() {
        return Err("The registry returned an ambiguous publisher profile.".to_string());
    }
    let owns_profile = view.memberships.iter().any(|membership| {
        membership.publisher_id == profile.id
            && membership.role == PublisherRole::Owner
            && membership.state == MembershipState::Active
    });
    if !owns_profile {
        return Err("The account does not actively own the selected publisher.".to_string());
    }
    Ok(profile.id)
}

/// Resolve the unique active enrollment matching the local public key and publisher.
fn resolve_active_remote_key(
    keys: &[EnrolledPublisherKey],
    public_key: &str,
    publisher_id: Uuid,
) -> Result<Uuid, String> {
    let mut found = None;
    for key in keys.iter().filter(|key| {
        key.public_key == public_key && key.state == EnrolledPublisherKeyState::Active
    }) {
        let remote_publisher_id = Uuid::parse_str(&key.publisher_id).map_err(|_| {
            "The registry returned an invalid publisher-key owner identifier.".to_string()
        })?;
        if remote_publisher_id != publisher_id {
            return Err(
                "The registry returned the selected key under another publisher.".to_string(),
            );
        }
        let remote_key_id = Uuid::parse_str(&key.id).map_err(|_| {
            "The registry returned an invalid publisher-key identifier.".to_string()
        })?;
        if found.replace(remote_key_id).is_some() {
            return Err("Multiple active registry keys match the selected local key.".to_string());
        }
    }
    found.ok_or_else(|| "No active registry enrollment matches the selected local key.".to_string())
}

/// Require the reviewed manifest attribution to match the selected publisher exactly.
fn require_manifest_publisher(author_handle: &str, publisher_handle: &str) -> Result<(), String> {
    if author_handle == publisher_handle {
        Ok(())
    } else {
        Err("The draft author does not match the selected publisher.".to_string())
    }
}

/// Require every exact binding field to match a freshly prepared review.
fn require_matching_binding(
    fresh: PublicationReviewBinding,
    confirmed: PublicationReviewBinding,
) -> Result<(), String> {
    if fresh == confirmed {
        Ok(())
    } else {
        Err("The confirmed review no longer matches the current artifact or authority.".to_string())
    }
}

/// Parse an optional caller UUID or generate the stable identifier before transport.
fn optional_uuid(value: Option<&str>, label: &str) -> Result<Uuid, String> {
    value.map_or_else(|| Ok(Uuid::new_v4()), |value| parse_uuid(value, label))
}

/// Parse one exact UUID using a bounded path-free error.
fn parse_uuid(value: &str, label: &str) -> Result<Uuid, String> {
    Uuid::parse_str(value).map_err(|_| format!("The {label} identifier is not a valid UUID."))
}

/// Reject empty, oversized, or control-bearing authority identifiers.
fn validate_authority_identifier(value: &str, label: &str) -> Result<(), String> {
    let chars = value.chars().count();
    if chars == 0 || chars > MAX_AUTHORITY_IDENTIFIER_CHARS || value.chars().any(char::is_control) {
        return Err(format!("The {label} is invalid."));
    }
    Ok(())
}

/// Convert a server submission record without account IDs or duplicate scan reports.
fn submission_view(record: &PublicationSubmissionRecord) -> StudioSubmissionView {
    StudioSubmissionView {
        id: record.id.to_string(),
        intent_id: record.intent_id.to_string(),
        publisher_id: record.publisher_id.to_string(),
        publisher_key_id: record.publisher_key_id.to_string(),
        archive_hash: record.archive_hash.to_string(),
        manifest_hash: record.manifest_hash.to_string(),
        file_inventory_hash: record.file_inventory_hash.to_string(),
        scan_schema_version: record.scan_schema_version,
        state: submission_state_name(record.state).to_string(),
        created_at: record.created_at.to_rfc3339(),
        updated_at: record.updated_at.to_rfc3339(),
    }
}

/// Return the stable public snake-case name for one submission state.
fn submission_state_name(state: PublicationSubmissionState) -> &'static str {
    match state {
        PublicationSubmissionState::Quarantined => "quarantined",
        PublicationSubmissionState::NeedsReview => "needs_review",
        PublicationSubmissionState::Approved => "approved",
        PublicationSubmissionState::Rejected => "rejected",
        PublicationSubmissionState::Promoted => "promoted",
        PublicationSubmissionState::Withdrawn => "withdrawn",
        _ => "unknown",
    }
}

/// Sanitize one Creator Studio failure without exposing a managed filesystem path.
fn studio_error(error: StudioError) -> String {
    match error {
        StudioError::InvalidRoot => "The Creator Studio data store is unavailable.".to_string(),
        StudioError::InvalidDraftId => "The draft identifier is invalid.".to_string(),
        StudioError::InvalidTitle => "The draft title is invalid.".to_string(),
        StudioError::AlreadyExists => "A draft with that identifier already exists.".to_string(),
        StudioError::NotFound => "The requested draft or file was not found.".to_string(),
        StudioError::InvalidMetadata(_) => "The draft metadata is invalid.".to_string(),
        StudioError::InvalidContentPath => "The public draft file path is invalid.".to_string(),
        StudioError::ContentTooLarge => "The draft file exceeds the public size limit.".to_string(),
        StudioError::UnsafeImport(reason) => {
            format!("The selected folder is unsafe to import: {reason}.")
        }
        StudioError::InvalidForReview => {
            "Resolve blocking validation findings before preparing review.".to_string()
        }
        StudioError::ValidationNotCurrent => {
            "Run current scanner and conformance validation before preparing review.".to_string()
        }
        StudioError::ReviewHashMismatch => {
            "The reviewed inventory no longer matches the draft.".to_string()
        }
        StudioError::ReviewBindingMismatch => {
            "The publication binding no longer matches the draft.".to_string()
        }
        StudioError::ReviewNotCurrent => {
            "Confirm the current exact-file review before submitting.".to_string()
        }
        StudioError::SubmissionIntentNotCurrent => {
            "The publication intent no longer matches the reviewed draft.".to_string()
        }
        StudioError::SnapshotChanged => {
            "The draft changed while exact bytes were being prepared.".to_string()
        }
        StudioError::InvalidConformanceThreshold => {
            "The conformance threshold is invalid.".to_string()
        }
        StudioError::InvalidPreviewSource => {
            "The draft does not contain a valid typed persona source.".to_string()
        }
        StudioError::InvalidTemplateField(field) => {
            format!("The guided template field {field} is invalid.")
        }
        StudioError::TemplateSerialization(_) => {
            "The guided template could not be rendered safely.".to_string()
        }
        StudioError::InvalidGeneratedTemplate => {
            "The generated template did not pass shared validation.".to_string()
        }
        StudioError::SourceNotForkable => {
            "The verified registry source does not permit forking.".to_string()
        }
        StudioError::ForkSourceMismatch => {
            "The verified fork source does not match its signed identity.".to_string()
        }
        StudioError::InvalidGeneratedFork => {
            "The generated fork did not pass shared validation.".to_string()
        }
        StudioError::ForkSourceToml(_) => {
            "The verified fork source contains invalid typed TOML.".to_string()
        }
        StudioError::Validation(_) => {
            "The draft could not be inspected by shared validation.".to_string()
        }
        StudioError::Io(_) => "The native draft operation failed.".to_string(),
        StudioError::Serialize(_) => "The draft metadata could not be saved.".to_string(),
    }
}

/// Sanitize one local publisher-key failure without exposing storage locators or secrets.
fn safe_key_error(error: ClientError) -> String {
    match error {
        ClientError::PublisherKeyNotFound { .. } => {
            "The selected local publisher key was not found.".to_string()
        }
        ClientError::PublisherKeyPassphraseRequired { .. } => {
            "The selected publisher key requires its encrypted fallback passphrase.".to_string()
        }
        ClientError::PublisherKeySecret { .. } => {
            "The selected local publisher key is inactive or unavailable.".to_string()
        }
        ClientError::InvalidPublisherKeyInventory { .. } => {
            "The local publisher-key inventory is invalid.".to_string()
        }
        ClientError::PublisherKeychainUnavailable { .. } => {
            "Native publisher-key storage is unavailable.".to_string()
        }
        _ => "The selected local publisher key could not be loaded.".to_string(),
    }
}

/// Sanitize one client failure without serializing URLs, paths, or raw responses.
fn safe_client_error(stage: &str, error: ClientError) -> String {
    match error {
        ClientError::RegistryRejected { status, .. } => {
            format!("The registry rejected {stage} with HTTP {status}.")
        }
        ClientError::RegistryHttp { .. } => format!("{stage} could not reach the registry."),
        ClientError::ContentHashMismatch { .. }
        | ClientError::RegistrySignatureMissing { .. }
        | ClientError::RegistryAuthorKeyChanged { .. }
        | ClientError::RegistryPublisherChanged { .. }
        | ClientError::RegistryOwnershipInvalid { .. }
        | ClientError::RegistryCacheTampered { .. }
        | ClientError::SignatureVerification => {
            format!("{stage} failed registry integrity verification.")
        }
        ClientError::PublisherKeyNotFound { .. }
        | ClientError::PublisherKeySecret { .. }
        | ClientError::PublisherKeychainUnavailable { .. }
        | ClientError::PublisherKeyPassphraseRequired { .. }
        | ClientError::InvalidPublisherKeyInventory { .. } => safe_key_error(error),
        ClientError::PublicationSignerMismatch => {
            "The draft author key does not match the selected publisher key.".to_string()
        }
        ClientError::PublicationReviewBindingMismatch => {
            "The prepared publication does not match the reviewed binding.".to_string()
        }
        ClientError::Studio(error) => studio_error(error),
        _ => format!("{stage} failed without exposing private diagnostic data."),
    }
}

/// Sanitize authentication and registry failures at the native account boundary.
fn authenticated_error(stage: &str, error: AuthenticatedOperationError) -> String {
    match error {
        AuthenticatedOperationError::Session(message)
            if message == "Sign in to FrameShift before using authenticated creator features." =>
        {
            message
        }
        AuthenticatedOperationError::Session(_) => {
            format!("{stage} could not access the native account session.")
        }
        AuthenticatedOperationError::Client(error) => safe_client_error(stage, error),
    }
}

/// Preserve stable retry UUIDs while still sanitizing an ambiguous transport failure.
fn retryable_authenticated_error(
    stage: &str,
    error: AuthenticatedOperationError,
    intent_id: Uuid,
    submission_id: Uuid,
) -> String {
    let message = authenticated_error(stage, error);
    format!("{message} Retry with intent ID {intent_id} and submission ID {submission_id}.")
}

/// Return one bounded failure for a panicked or cancelled native blocking task.
fn task_error(stage: &str) -> String {
    format!("The native {stage} task could not complete.")
}

#[cfg(test)]
/// Creator Studio native boundary and authority regression tests.
mod tests {
    use super::*;
    use frameshift_catalog::ObjectHash;
    use frameshift_studio::PublicationBinding;

    /// Build one authenticated owner view from its public wire representation.
    fn owner_view() -> AccountView {
        serde_json::from_value(serde_json::json!({
            "account": {
                "id": "00000000-0000-0000-0000-000000000001",
                "issuer": "https://issuer.example",
                "subject": "subject-1",
                "email": null,
                "display_name": "Alice",
                "status": "active",
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z"
            },
            "memberships": [{
                "account_id": "00000000-0000-0000-0000-000000000001",
                "publisher_id": "00000000-0000-0000-0000-000000000002",
                "role": "owner",
                "state": "active",
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z"
            }],
            "publishers": [{
                "id": "00000000-0000-0000-0000-000000000002",
                "handle": "alice",
                "display_name": "Alice",
                "biography": null,
                "moderation_status": "pending",
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z"
            }]
        }))
        .expect("valid account fixture")
    }

    /// Build one exact review binding with stable test identifiers.
    fn review_binding() -> PublicationReviewBinding {
        PublicationReviewBinding {
            artifact: PublicationBinding {
                archive_hash: ObjectHash::from_bytes([1_u8; 32]),
                manifest_hash: ObjectHash::from_bytes([2_u8; 32]),
                file_inventory_hash: ObjectHash::from_bytes([3_u8; 32]),
                scan_schema_version: 1,
            },
            publisher_id: Uuid::from_u128(2),
            publisher_key_id: Uuid::from_u128(3),
        }
    }

    /// Build one active remote enrollment for authority tests.
    fn remote_key(id: &str, publisher_id: &str) -> EnrolledPublisherKey {
        EnrolledPublisherKey {
            id: id.to_string(),
            publisher_id: publisher_id.to_string(),
            public_key: "public-key".to_string(),
            label: "Laptop".to_string(),
            state: EnrolledPublisherKeyState::Active,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            revoked_at: None,
            last_used_at: None,
        }
    }

    /// Publisher resolution requires an exact handle and active owner membership.
    #[test]
    fn resolves_only_exact_active_owner() {
        let view = owner_view();
        assert_eq!(
            resolve_owned_publisher(&view, "alice"),
            Ok(Uuid::from_u128(2))
        );
        assert!(resolve_owned_publisher(&view, "Alice").is_err());

        let mut revoked = view;
        revoked.memberships[0].state = MembershipState::Revoked;
        assert!(resolve_owned_publisher(&revoked, "alice").is_err());
    }

    /// Remote-key resolution rejects wrong owners and duplicate active enrollments.
    #[test]
    fn resolves_one_active_remote_key_for_exact_publisher() {
        let publisher_id = Uuid::from_u128(2);
        let key_id = Uuid::from_u128(3);
        let exact = remote_key(&key_id.to_string(), &publisher_id.to_string());
        assert_eq!(
            resolve_active_remote_key(std::slice::from_ref(&exact), "public-key", publisher_id),
            Ok(key_id)
        );
        assert!(
            resolve_active_remote_key(&[exact.clone(), exact], "public-key", publisher_id).is_err()
        );
        assert!(resolve_active_remote_key(
            &[remote_key(
                &key_id.to_string(),
                &Uuid::from_u128(4).to_string()
            )],
            "public-key",
            publisher_id
        )
        .is_err());
    }

    /// Every review-binding field participates in submission confirmation.
    #[test]
    fn requires_the_complete_fresh_review_binding() {
        let expected = review_binding();
        assert!(require_matching_binding(expected, expected).is_ok());
        let mut changed = expected;
        changed.publisher_key_id = Uuid::from_u128(9);
        assert!(require_matching_binding(expected, changed).is_err());
    }

    /// Generated UUIDs are valid while malformed caller identifiers fail closed.
    #[test]
    fn validates_or_generates_retry_identifiers() {
        assert!(optional_uuid(None, "publication intent").is_ok());
        assert_eq!(
            optional_uuid(
                Some("00000000-0000-0000-0000-000000000010"),
                "publication intent"
            ),
            Ok(Uuid::from_u128(16))
        );
        assert!(optional_uuid(Some("not-a-uuid"), "publication intent").is_err());
    }

    /// Client error rendering omits raw response bodies and registry URLs.
    #[test]
    fn sanitizes_registry_errors_at_the_webview_boundary() {
        let message = safe_client_error(
            "publication submission",
            ClientError::RegistryRejected {
                url: "https://registry.example/private/path".to_string(),
                status: 503,
                message: "raw-secret-response-body".to_string(),
            },
        );
        assert!(message.contains("HTTP 503"));
        assert!(!message.contains("private/path"));
        assert!(!message.contains("raw-secret-response-body"));
    }

    /// Template deserialization accepts key identifiers but no author public key field.
    #[test]
    fn guided_template_contract_accepts_only_native_key_selection() {
        let input: StudioTemplateInput = serde_json::from_value(serde_json::json!({
            "mode": "guided",
            "name": "guide",
            "version": "1.0.0",
            "author_handle": "alice",
            "key_id": "local-key",
            "description": "Guide",
            "voice_tone": "Precise",
            "license": "MIT",
            "forkable": true
        }))
        .expect("guided input");
        assert!(matches!(
            input,
            StudioTemplateInput::Guided(StudioGuidedTemplateInput { key_id, .. })
                if key_id == "local-key"
        ));
    }
}
