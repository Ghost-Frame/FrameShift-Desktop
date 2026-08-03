// Tauri invoke wrappers with graceful browser fallback.
// When window.__TAURI__ is undefined (plain browser dev), mock data is returned.

import type { PersonaSummary, GrowthReport } from "./mock-data";
import {
  MOCK_PERSONAS,
  MOCK_ACTIVE_PERSONA,
  mockGrowthReport,
} from "./mock-data";
import { isTauri } from "./is-tauri";

// Settings payload loaded from the selected desktop project.
export type DesktopSettings = {
  telemetry_opt_in: boolean;
  data_dir: string;
};

// Shared per-project automate state used by every FrameShift host surface.
export type AutomateSettings = {
  enabled: boolean;
  sensitivity: number;
  locked: boolean;
};

// Selected project payload returned by the desktop runtime.
export type DesktopProject = {
  path: string | null;
  name: string | null;
};

// Bundled CLI and MCP installation state reported by the native runtime.
export type AgentToolsStatus = {
  version: string | null;
  revision: string | null;
  bundled: boolean;
  installed: boolean;
  install_dir: string | null;
  mcp_path: string | null;
};

// Successful host registration returned by the native runtime.
export type AgentConnection = {
  target: string;
  message: string;
  mcp_path: string;
};

// Redacted authenticated publisher membership returned by the native runtime.
export type AccountMembership = {
  publisher_id: string;
  handle: string | null;
  display_name: string | null;
  moderation_status: string | null;
  role: string;
  state: string;
};

// Redacted desktop account state; bearer secrets never cross the Tauri boundary.
export type AccountSession = {
  signed_in: boolean;
  account_id: string | null;
  display_name: string | null;
  email: string | null;
  status: string | null;
  memberships: AccountMembership[];
};

// Local logout outcome plus an optional non-secret provider warning.
export type AccountLogout = {
  removed: boolean;
  revocation_warning: string | null;
};

// Redacted local publisher-key metadata returned by the native runtime.
export type LocalPublisherKey = {
  id: string;
  label: string;
  public_key: string;
  state: "active" | "revocation_pending" | "revoked";
  secret_backend: "keychain" | "age_file";
  created_at: number;
  selected: boolean;
};

// Public server-side publisher-key metadata returned by the registry.
export type RemotePublisherKey = {
  id: string;
  publisher_id: string;
  public_key: string;
  label: string;
  state: "active" | "revoked";
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
};

// Combined local and remote key inventory for one publisher.
export type PublisherKeyStatus = {
  initialized: boolean;
  selected_key_id: string | null;
  local_keys: LocalPublisherKey[];
  remote_keys: RemotePublisherKey[];
  remote_error: string | null;
};

// Result of a key recovery or replacement-first rotation.
export type PublisherKeyMutation = {
  local_key: LocalPublisherKey;
  remote_key: RemotePublisherKey;
  message: string;
};

// Native encrypted recovery-package export result.
export type PublisherKeyExport = {
  saved: boolean;
};

// One exact public file included in a draft publication inventory.
export type StudioInventoryEntry = {
  path: string;
  size: number;
  sha256: string;
};

// One stable scanner finding over public draft content.
export type StudioPublicationFinding = {
  code: string;
  severity: "warning" | "error";
  path: string | null;
  message: string;
};

// Deterministic scanner report shared by status, preview, validation, and review.
export type StudioPublicationReport = {
  schema_version: number;
  valid: boolean;
  inventory_hash: string;
  inventory: StudioInventoryEntry[];
  findings: StudioPublicationFinding[];
};

// Public hashes identifying one exact prepared signed archive.
export type StudioPublicationBinding = {
  archive_hash: string;
  manifest_hash: string;
  file_inventory_hash: string;
  scan_schema_version: number;
};

// Exact artifact plus account-owned publisher identity shown for review.
export type StudioPublicationReviewBinding = {
  artifact: StudioPublicationBinding;
  publisher_id: string;
  publisher_key_id: string;
};

// Persisted approval or submission intent bound to one draft revision.
export type StudioDraftApproval = {
  revision: number;
  inventory_hash: string;
  binding: StudioPublicationReviewBinding | null;
};

// Path-free local Creator Studio draft metadata.
export type StudioDraft = {
  schema_version: number;
  id: string;
  title: string;
  revision: number;
  review: StudioDraftApproval | null;
  submission_intent: StudioDraftApproval | null;
};

// Current draft metadata paired with a fresh publication scan.
export type StudioDraftStatus = {
  draft: StudioDraft;
  publication: StudioPublicationReport;
  review_current: boolean;
  submission_intent_current: boolean;
};

// One deterministic render for a supported agent host.
export type StudioTargetPreview = {
  target: string;
  install_filename: string;
  content: string;
  sha256: string;
};

// All supported target renders bound to one current draft inventory.
export type StudioDraftPreview = {
  revision: number;
  inventory_hash: string;
  publication: StudioPublicationReport;
  targets: StudioTargetPreview[];
};

// One path-free conformance test score.
export type StudioConformanceTest = {
  id: string;
  scorer: "substring" | "regex" | "exact_json" | "caller";
  score: number;
};

// One stable path-free conformance finding.
export type StudioConformanceFinding = {
  code: string;
  severity: "warning" | "error";
  test_id: string | null;
  message: string;
};

// Conformance lifecycle result that never contains prompts or raw responses.
export type StudioConformanceReport = {
  status: "not_provided" | "completed" | "blocked";
  valid: boolean;
  bundle_hash: string | null;
  score: number | null;
  threshold: number;
  tests: StudioConformanceTest[];
  findings: StudioConformanceFinding[];
};

// Scanner and conformance evidence for one exact draft revision.
export type StudioDraftValidationReport = {
  schema_version: number;
  revision: number;
  inventory_hash: string;
  publication: StudioPublicationReport;
  valid: boolean;
  conformance: StudioConformanceReport;
};

// Runtime capabilities declared by a reviewed public manifest.
export type StudioCapabilityManifest = {
  required_tools: string[];
  network_egress: boolean;
  env_vars_read: string[];
  filesystem_scope: "none" | "project-only" | "home" | "system";
  memory_required: "none" | "soft" | "hard";
  memory_required_ops: string[];
};

// Runtime and render target requirements declared by a reviewed manifest.
export type StudioManifestRequires = {
  template_min_version: string | null;
  targets: string[];
};

// One public token declaration retained in an exact reviewed manifest.
export type StudioTokenSpec = {
  type: string;
  prompt: string;
  optional: boolean;
};

// Immutable source attribution attached to an explicitly permitted fork.
export type StudioForkOrigin = {
  name: string;
  version: string;
  content_hash: string;
};

// Public manifest fields rendered in the exact-file review step.
export type StudioPackManifest = {
  schema_version: number;
  name: string;
  author_handle: string;
  author_pubkey: string;
  version: string;
  parent_hash: string | null;
  license: string | null;
  forkable: boolean;
  forked_from: StudioForkOrigin | null;
  capability_manifest: StudioCapabilityManifest | null;
  requires: StudioManifestRequires | null;
  tokens_required: Record<string, StudioTokenSpec> | null;
  extends: string | null;
  mixin: string[];
  conformance_baseline: { score: number; bundle_hash: string } | null;
  description: string | null;
  tags: string[];
};

// Final path-free review report for one exact prepared artifact.
export type StudioDraftReviewReport = {
  revision: number;
  publication: StudioPublicationReport;
  manifest: StudioPackManifest;
  binding: StudioPublicationReviewBinding;
};

// Blank or guided draft creation input accepted by the native Studio bridge.
export type StudioDraftTemplate =
  | { mode: "blank" }
  | {
      mode: "guided";
      name: string;
      version: string;
      author_handle: string;
      key_id: string;
      description: string;
      voice_tone: string;
      license: string | null;
      forkable: boolean;
    };

// Public identity assigned to an explicitly permitted registry fork.
export type StudioForkIdentity = {
  name: string;
  version: string;
  author_handle: string;
  key_id: string;
  forkable: boolean;
};

// UTF-8 draft file returned without a local filesystem path.
export type StudioFile = {
  path: string;
  content: string;
};

// Non-public quarantine submission state returned to Creator Studio.
export type StudioSubmission = {
  id: string;
  intent_id: string;
  publisher_id: string;
  publisher_key_id: string;
  archive_hash: string;
  manifest_hash: string;
  file_inventory_hash: string;
  scan_schema_version: number;
  state:
    | "quarantined"
    | "needs_review"
    | "approved"
    | "rejected"
    | "promoted"
    | "withdrawn";
  created_at: string;
  updated_at: string;
};

// Browser-preview account state retained across client-side navigation.
let browserAccount: AccountSession = {
  signed_in: false,
  account_id: null,
  display_name: null,
  email: null,
  status: null,
  memberships: [],
};

// Browser-preview local key inventory used by interaction tests.
let browserLocalKeys: LocalPublisherKey[] = [];

// Browser-preview remote key inventory used by interaction tests.
let browserRemoteKeys: RemotePublisherKey[] = [];

// Monotonic browser-preview key sequence that keeps identifiers deterministic.
let browserKeySequence = 0;

// Browser-preview draft data retained for one in-memory application session.
type BrowserStudioDraft = {
  draft: StudioDraft;
  files: Map<string, string>;
  manifest: StudioPackManifest;
};

// Browser-preview Studio drafts keyed by their public draft identifiers.
const browserStudioDrafts = new Map<string, BrowserStudioDraft>();

// Browser-preview quarantine records keyed by stable submission identifiers.
const browserStudioSubmissions = new Map<string, StudioSubmission>();

// Return an isolated copy of browser-preview account state.
function browserAccountView(): AccountSession {
  return {
    ...browserAccount,
    memberships: browserAccount.memberships.map((membership) => ({
      ...membership,
    })),
  };
}

// Create the deterministic signed-in account used by browser-preview interactions.
function browserSignedInAccount(): AccountSession {
  browserAccount = {
    signed_in: true,
    account_id: "browser-preview-account",
    display_name: "Preview Creator",
    email: "creator@example.invalid",
    status: "active",
    memberships: [
      {
        publisher_id: "browser-preview-publisher",
        handle: "preview-creator",
        display_name: "Preview Studio",
        moderation_status: "approved",
        role: "owner",
        state: "active",
      },
    ],
  };
  return browserAccountView();
}

// Return an isolated copy of browser-preview key state.
function browserKeyStatus(): PublisherKeyStatus {
  return {
    initialized: browserLocalKeys.length > 0,
    selected_key_id:
      browserLocalKeys.find((key) => key.selected)?.id ?? null,
    local_keys: browserLocalKeys.map((key) => ({ ...key })),
    remote_keys: browserRemoteKeys.map((key) => ({ ...key })),
    remote_error: null,
  };
}

// Create deterministic public browser-preview key metadata without secret material.
function createBrowserLocalKey(label: string): LocalPublisherKey {
  browserKeySequence += 1;
  const suffix = browserKeySequence.toString().padStart(4, "0");
  return {
    id: `preview-local-key-${suffix}`,
    label: label.trim() || `Device ${suffix}`,
    public_key: `cHJldmlldy1wdWJsaWMta2V5LTAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw${suffix}`,
    state: "active",
    secret_backend: "keychain",
    created_at: 1_785_000_000 + browserKeySequence,
    selected: false,
  };
}

// Resolve one exact active browser-preview local key.
function requireBrowserLocalKey(keyId: string): LocalPublisherKey {
  const key = browserLocalKeys.find((candidate) => candidate.id === keyId);
  if (!key) {
    throw new Error(`Local publisher key ${keyId} was not found.`);
  }
  return key;
}

// Require an exact destructive confirmation in browser-preview flows.
function requireBrowserConfirmation(expected: string, actual: string): void {
  if (actual !== expected) {
    throw new Error(`Confirmation must exactly match key identifier ${expected}.`);
  }
}

// Enroll one browser-preview local key as public registry metadata.
function enrollBrowserKey(key: LocalPublisherKey): RemotePublisherKey {
  const existing = browserRemoteKeys.find(
    (candidate) =>
      candidate.public_key === key.public_key && candidate.state === "active",
  );
  if (existing) {
    return existing;
  }
  const remote: RemotePublisherKey = {
    id: `preview-remote-${key.id}`,
    publisher_id: "browser-preview-publisher",
    public_key: key.public_key,
    label: key.label,
    state: "active",
    created_at: "2026-07-25T20:00:00Z",
    revoked_at: null,
    last_used_at: null,
  };
  browserRemoteKeys = [...browserRemoteKeys, remote];
  return remote;
}

// Clone one serializable browser fixture so callers cannot mutate shared state.
function cloneBrowserFixture<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// Produce a deterministic lowercase 64-character digest for browser fixtures.
function browserStudioDigest(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  const block = `${first.toString(16).padStart(8, "0")}${second
    .toString(16)
    .padStart(8, "0")}`;
  return block.repeat(4);
}

// Resolve one exact browser-preview draft or fail with a bounded message.
function requireBrowserStudioDraft(id: string): BrowserStudioDraft {
  const draft = browserStudioDrafts.get(id);
  if (!draft) {
    throw new Error(`Creator Studio draft ${id} was not found.`);
  }
  return draft;
}

// Return the public inventory and policy findings for a browser draft.
function browserStudioPublication(
  draft: BrowserStudioDraft,
): StudioPublicationReport {
  const inventory = [...draft.files.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) => ({
      path,
      size: new TextEncoder().encode(content).byteLength,
      sha256: browserStudioDigest(content),
    }));
  const findings: StudioPublicationFinding[] = [];
  for (const required of ["pack.toml", "persona.toml"]) {
    if (!draft.files.has(required)) {
      findings.push({
        code: "content.required_missing",
        severity: "error",
        path: required,
        message: `${required} is required before review.`,
      });
    }
  }
  if (draft.manifest.author_pubkey === "local-unsigned") {
    findings.push({
      code: "manifest.author_pubkey",
      severity: "error",
      path: "pack.toml",
      message: "Choose an enrolled publisher key before publication review.",
    });
  }
  return {
    schema_version: 1,
    valid: !findings.some((finding) => finding.severity === "error"),
    inventory_hash: browserStudioDigest(
      inventory
        .map((entry) => `${entry.path}:${entry.size}:${entry.sha256}`)
        .join("\n"),
    ),
    inventory,
    findings,
  };
}

// Verify every exact artifact and enrolled-authority field in a browser binding.
function browserStudioBindingMatches(
  draft: BrowserStudioDraft,
  binding: StudioPublicationReviewBinding,
): boolean {
  const publication = browserStudioPublication(draft);
  const remoteKey = browserRemoteKeys.find(
    (candidate) =>
      candidate.id === binding.publisher_key_id &&
      candidate.publisher_id === binding.publisher_id &&
      candidate.state === "active",
  );
  const manifestHash =
    publication.inventory.find((entry) => entry.path === "pack.toml")?.sha256 ??
    null;
  return Boolean(
    remoteKey &&
      binding.artifact.archive_hash ===
        browserStudioDigest(
          `archive:${publication.inventory_hash}:${remoteKey.id}`,
        ) &&
      binding.artifact.manifest_hash === manifestHash &&
      binding.artifact.file_inventory_hash === publication.inventory_hash &&
      binding.artifact.scan_schema_version === publication.schema_version,
  );
}

// Return a fresh status snapshot and compute exact approval freshness.
function browserStudioStatus(id: string): StudioDraftStatus {
  const draft = requireBrowserStudioDraft(id);
  const publication = browserStudioPublication(draft);
  const review = draft.draft.review;
  const intent = draft.draft.submission_intent;
  const reviewCurrent = Boolean(
    review &&
      review.revision === draft.draft.revision &&
      review.inventory_hash === publication.inventory_hash &&
      review.binding &&
      browserStudioBindingMatches(draft, review.binding),
  );
  const intentCurrent = Boolean(
    reviewCurrent &&
      intent &&
      intent.revision === draft.draft.revision &&
      intent.inventory_hash === publication.inventory_hash &&
      JSON.stringify(intent.binding) === JSON.stringify(review?.binding),
  );
  return cloneBrowserFixture({
    draft: draft.draft,
    publication,
    review_current: reviewCurrent,
    submission_intent_current: intentCurrent,
  });
}

// Invalidate exact approvals before applying a browser-preview content mutation.
function invalidateBrowserStudioDraft(draft: BrowserStudioDraft): void {
  draft.draft.revision += 1;
  draft.draft.review = null;
  draft.draft.submission_intent = null;
}

// Build a complete public manifest for one deterministic browser fixture.
function browserStudioManifest(
  name: string,
  authorHandle: string,
  authorPubkey: string,
  version: string,
  license: string | null,
  forkable: boolean,
  description: string,
  forkedFrom: StudioForkOrigin | null = null,
): StudioPackManifest {
  return {
    schema_version: 1,
    name,
    author_handle: authorHandle,
    author_pubkey: authorPubkey,
    version,
    parent_hash: null,
    license,
    forkable,
    forked_from: forkedFrom,
    capability_manifest: {
      required_tools: ["rg"],
      network_egress: false,
      env_vars_read: [],
      filesystem_scope: "project-only",
      memory_required: "soft",
      memory_required_ops: ["search", "store"],
    },
    requires: {
      template_min_version: "0.10.0",
      targets: ["claude", "codex", "gemini", "generic"],
    },
    tokens_required: null,
    extends: null,
    mixin: [],
    conformance_baseline: null,
    description,
    tags: ["creator-studio"],
  };
}

// Serialize the public manifest fields needed by browser-preview editing.
function browserStudioManifestText(manifest: StudioPackManifest): string {
  return [
    `schema_version = ${manifest.schema_version}`,
    `name = "${manifest.name}"`,
    `author_handle = "${manifest.author_handle}"`,
    `author_pubkey = "${manifest.author_pubkey}"`,
    `version = "${manifest.version}"`,
    manifest.license ? `license = "${manifest.license}"` : "",
    `forkable = ${manifest.forkable}`,
    `description = "${manifest.description ?? ""}"`,
  ]
    .filter(Boolean)
    .join("\n");
}

// Create one browser-preview draft with deterministic public source files.
function createBrowserStudioDraft(
  id: string,
  title: string,
  manifest: StudioPackManifest,
  voiceTone: string,
): StudioDraftStatus {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new Error("Draft ID must use 1 to 64 letters, numbers, hyphens, or underscores.");
  }
  if (!title.trim()) {
    throw new Error("Draft title is required.");
  }
  if (browserStudioDrafts.has(id)) {
    throw new Error(`Creator Studio draft ${id} already exists.`);
  }
  const files = new Map<string, string>([
    ["pack.toml", browserStudioManifestText(manifest)],
    [
      "persona.toml",
      [
        `name = "${manifest.name}"`,
        `version = "${manifest.version}"`,
        `description = "${manifest.description ?? ""}"`,
        "",
        "[voice]",
        `tone = "${voiceTone}"`,
      ].join("\n"),
    ],
  ]);
  browserStudioDrafts.set(id, {
    draft: {
      schema_version: 1,
      id,
      title: title.trim(),
      revision: 0,
      review: null,
      submission_intent: null,
    },
    files,
    manifest,
  });
  return browserStudioStatus(id);
}

// Require an account-owned active publisher and uniquely enrolled local key.
function requireBrowserStudioPublisher(
  publisherHandle: string,
  keyId: string,
): { membership: AccountMembership; remoteKey: RemotePublisherKey } {
  if (!browserAccount.signed_in) {
    throw new Error("Sign in before preparing a publication review.");
  }
  const membership = browserAccount.memberships.find(
    (candidate) =>
      candidate.handle === publisherHandle && candidate.state === "active",
  );
  if (!membership) {
    throw new Error("The selected publisher is not an active account membership.");
  }
  const localKey = requireBrowserLocalKey(keyId);
  if (localKey.state !== "active" || !localKey.selected) {
    throw new Error("Choose an active local publisher key before review.");
  }
  const matches = browserRemoteKeys.filter(
    (candidate) =>
      candidate.publisher_id === membership.publisher_id &&
      candidate.public_key === localKey.public_key &&
      candidate.state === "active",
  );
  if (matches.length !== 1) {
    throw new Error("The selected local key must have one active registry enrollment.");
  }
  return { membership, remoteKey: matches[0] };
}

// Build one exact browser-preview review after rechecking publisher ownership.
function browserStudioReview(
  id: string,
  publisherHandle: string,
  keyId: string,
): StudioDraftReviewReport {
  const draft = requireBrowserStudioDraft(id);
  const status = browserStudioStatus(id);
  if (!status.publication.valid) {
    throw new Error("Resolve blocking scanner findings before preparing review.");
  }
  const { membership, remoteKey } = requireBrowserStudioPublisher(
    publisherHandle,
    keyId,
  );
  return cloneBrowserFixture({
    revision: status.draft.revision,
    publication: status.publication,
    manifest: draft.manifest,
    binding: {
      artifact: {
        archive_hash: browserStudioDigest(
          `archive:${status.publication.inventory_hash}:${remoteKey.id}`,
        ),
        manifest_hash:
          status.publication.inventory.find((entry) => entry.path === "pack.toml")
            ?.sha256 ?? browserStudioDigest("missing-manifest"),
        file_inventory_hash: status.publication.inventory_hash,
        scan_schema_version: status.publication.schema_version,
      },
      publisher_id: membership.publisher_id,
      publisher_key_id: remoteKey.id,
    },
  });
}

// Invokes a Tauri command when the native shell is present.
async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke<T>(command, args);
  }
  throw new Error(`Not in Tauri context, command: ${command}`);
}

// -- Project selection --

// Returns the persisted project choice, with a browser-preview fallback.
export async function getProject(): Promise<DesktopProject> {
  if (!isTauri()) {
    return { path: "/workspace/project", name: "project" };
  }
  return invoke<DesktopProject>("get_project");
}

// Opens the operating system's directory picker for a project choice.
export async function chooseProjectDirectory(): Promise<string | null> {
  if (!isTauri()) {
    return "/workspace/project";
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

// Validates and persists the selected project in the native runtime.
export async function setProjectRoot(path: string): Promise<DesktopProject> {
  if (!isTauri()) {
    const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
    return { path, name };
  }
  return invoke<DesktopProject>("set_project_root", { path });
}

// -- Personas --

// Returns the installed persona list, falling back to mock data in browser dev.
export async function listPersonas(): Promise<PersonaSummary[]> {
  if (!isTauri()) {
    return MOCK_PERSONAS;
  }
  return invoke<PersonaSummary[]>("list_personas");
}

// Returns the active persona name, or null in browser dev mode.
export async function activePersona(): Promise<string | null> {
  if (!isTauri()) {
    return MOCK_ACTIVE_PERSONA;
  }
  return invoke<string | null>("active_persona");
}

// Activates a persona in the selected desktop project.
export async function activatePersona(name: string): Promise<void> {
  if (!isTauri()) {
    // In browser dev mode, just log -- state is not persisted
    console.info(`[mock] activate_persona: ${name}`);
    return;
  }
  return invoke<void>("activate_persona", { name });
}

// Installs a persona version from the registry into the selected project.
export async function installPersona(
  name: string,
  version: string,
): Promise<void> {
  if (!isTauri()) {
    console.info(`[mock] install_persona: ${name}@${version}`);
    return;
  }
  return invoke<void>("install_persona", { name, version });
}

// -- Growth --

// Loads the growth report for a persona, parsing the JSON payload from Rust.
export async function getGrowth(name: string): Promise<GrowthReport> {
  if (!isTauri()) {
    return mockGrowthReport(name);
  }
  const raw = await invoke<string>("get_growth", { name });
  return JSON.parse(raw) as GrowthReport;
}

// -- Settings --

// Loads desktop workspace settings, with browser-dev defaults.
export async function getSettings(): Promise<DesktopSettings> {
  if (!isTauri()) {
    return {
      telemetry_opt_in: false,
      data_dir: "~/.local/share/frameshift",
    };
  }
  return invoke<DesktopSettings>("get_settings");
}

// Persists the telemetry sharing preference for the selected project.
export async function setTelemetryOptIn(enabled: boolean): Promise<void> {
  if (!isTauri()) {
    console.info(`[mock] set_telemetry_opt_in: ${enabled}`);
    return;
  }
  return invoke<void>("set_telemetry_opt_in", { enabled });
}

// Loads the selected project's shared automate mode and lock state.
export async function getAutomateSettings(): Promise<AutomateSettings> {
  if (!isTauri()) {
    return { enabled: false, sensitivity: 0.5, locked: false };
  }
  return invoke<AutomateSettings>("get_automate_settings");
}

// Persists mode and sensitivity in the CLI/MCP/daemon-compatible state file.
export async function setAutomateSettings(
  enabled: boolean,
  sensitivity: number,
): Promise<AutomateSettings> {
  if (!isTauri()) {
    console.info(`[mock] set_automate_settings: ${enabled} at ${sensitivity}`);
    return { enabled, sensitivity, locked: false };
  }
  return invoke<AutomateSettings>("set_automate_settings", {
    enabled,
    sensitivity,
  });
}

// Loads the bundled CLI/MCP installation state.
export async function getAgentToolsStatus(): Promise<AgentToolsStatus> {
  if (!isTauri()) {
    return {
      version: "0.10.0-dev",
      revision: "0000000000000000000000000000000000000000",
      bundled: true,
      installed: false,
      install_dir: "/workspace/frameshift-tools",
      mcp_path: null,
    };
  }
  return invoke<AgentToolsStatus>("get_agent_tools_status");
}

// Copies the bundled CLI and MCP executables into stable app storage.
export async function installAgentTools(): Promise<AgentToolsStatus> {
  if (!isTauri()) {
    return {
      version: "0.10.0-dev",
      revision: "0000000000000000000000000000000000000000",
      bundled: true,
      installed: true,
      install_dir: "/workspace/frameshift-tools",
      mcp_path: "/workspace/frameshift-tools/frameshift-mcp",
    };
  }
  return invoke<AgentToolsStatus>("install_agent_tools");
}

// Installs the tools and registers FrameShift with one supported agent host.
export async function connectAgent(target: string): Promise<AgentConnection> {
  if (!isTauri()) {
    return {
      target,
      message: `FrameShift is connected to ${target} for /workspace/project.`,
      mcp_path: "/workspace/frameshift-tools/frameshift-mcp",
    };
  }
  return invoke<AgentConnection>("connect_agent", { target });
}

// -- Account session --

// Loads the current redacted account state.
export async function getAccountStatus(): Promise<AccountSession> {
  if (!isTauri()) {
    return browserAccountView();
  }
  return invoke<AccountSession>("account_status");
}

// Uses the registry's preferred native provider and returns the authenticated account.
export async function loginAccount(): Promise<AccountSession> {
  if (!isTauri()) {
    return browserSignedInAccount();
  }
  return invoke<AccountSession>("account_login");
}

// Uses the browser-owned first-party portal and returns redacted account state.
export async function loginFirstPartyAccount(): Promise<AccountSession> {
  if (!isTauri()) {
    return browserSignedInAccount();
  }
  return invoke<AccountSession>("account_login_first_party");
}

// Redeems an invitation in the browser-owned portal and returns redacted account state.
export async function registerAccount(): Promise<AccountSession> {
  if (!isTauri()) {
    return browserSignedInAccount();
  }
  return invoke<AccountSession>("account_register");
}

// Revokes the provider session when possible and erases exact local state.
export async function logoutAccount(): Promise<AccountLogout> {
  if (!isTauri()) {
    browserAccount = {
      signed_in: false,
      account_id: null,
      display_name: null,
      email: null,
      status: null,
      memberships: [],
    };
    return { removed: true, revocation_warning: null };
  }
  return invoke<AccountLogout>("account_logout");
}

// Load redacted local and registry key metadata for one publisher.
export async function getPublisherKeyStatus(
  publisherHandle: string,
): Promise<PublisherKeyStatus> {
  if (!isTauri()) {
    return browserKeyStatus();
  }
  return invoke<PublisherKeyStatus>("publisher_keys_status", {
    publisherHandle,
  });
}

// Initialize native publisher-key storage using the operating-system keychain.
export async function initializePublisherKeys(): Promise<LocalPublisherKey[]> {
  if (!isTauri()) {
    if (browserLocalKeys.length === 0) {
      const initial = createBrowserLocalKey("Primary device");
      initial.selected = true;
      browserLocalKeys = [initial];
    }
    return browserKeyStatus().local_keys;
  }
  return invoke<LocalPublisherKey[]>("publisher_keys_initialize");
}

// Create one native publisher key without exposing private material.
export async function createPublisherKey(
  label: string,
): Promise<LocalPublisherKey> {
  if (!isTauri()) {
    const key = createBrowserLocalKey(label);
    browserLocalKeys = [...browserLocalKeys, key];
    return { ...key };
  }
  return invoke<LocalPublisherKey>("publisher_key_create", { label });
}

// Replace one local publisher-key label.
export async function labelPublisherKey(
  keyId: string,
  label: string,
): Promise<LocalPublisherKey> {
  if (!isTauri()) {
    const key = requireBrowserLocalKey(keyId);
    key.label = label.trim();
    return { ...key };
  }
  return invoke<LocalPublisherKey>("publisher_key_label", { keyId, label });
}

// Select one active local publisher key for future signatures.
export async function selectPublisherKey(
  keyId: string,
): Promise<LocalPublisherKey> {
  if (!isTauri()) {
    const key = requireBrowserLocalKey(keyId);
    browserLocalKeys.forEach((candidate) => {
      candidate.selected = candidate.id === key.id;
    });
    return { ...key, selected: true };
  }
  return invoke<LocalPublisherKey>("publisher_key_select", { keyId });
}

// Enroll one exact local key through the native account session.
export async function enrollPublisherKey(
  publisherHandle: string,
  keyId: string,
): Promise<RemotePublisherKey> {
  if (!isTauri()) {
    void publisherHandle;
    return { ...enrollBrowserKey(requireBrowserLocalKey(keyId)) };
  }
  return invoke<RemotePublisherKey>("publisher_key_enroll", {
    publisherHandle,
    keyId,
  });
}

// Create, enroll, and select a recovery key on the current device.
export async function recoverPublisherKey(
  publisherHandle: string,
  label: string,
): Promise<PublisherKeyMutation> {
  if (!isTauri()) {
    void publisherHandle;
    const local = createBrowserLocalKey(label);
    browserLocalKeys.forEach((candidate) => {
      candidate.selected = false;
    });
    local.selected = true;
    browserLocalKeys = [...browserLocalKeys, local];
    const remote = enrollBrowserKey(local);
    return {
      local_key: { ...local },
      remote_key: { ...remote },
      message: `Recovery key ${local.id} is enrolled and selected.`,
    };
  }
  return invoke<PublisherKeyMutation>("publisher_key_recover", {
    publisherHandle,
    label,
  });
}

// Rotate safely by enrolling and selecting a replacement before revoking the old key.
export async function rotatePublisherKey(
  publisherHandle: string,
  label: string,
  confirmation: string,
): Promise<PublisherKeyMutation> {
  if (!isTauri()) {
    void publisherHandle;
    const old = browserLocalKeys.find((candidate) => candidate.selected);
    if (!old) {
      throw new Error("No active local publisher key is selected.");
    }
    requireBrowserConfirmation(old.id, confirmation);
    const oldRemote = browserRemoteKeys.find(
      (candidate) =>
        candidate.public_key === old.public_key && candidate.state === "active",
    );
    if (!oldRemote) {
      throw new Error("No active remote key matches the selected local key.");
    }
    const replacement = createBrowserLocalKey(label);
    browserLocalKeys.forEach((candidate) => {
      candidate.selected = false;
    });
    replacement.selected = true;
    browserLocalKeys = [...browserLocalKeys, replacement];
    const enrolled = enrollBrowserKey(replacement);
    old.state = "revoked";
    oldRemote.state = "revoked";
    oldRemote.revoked_at = "2026-07-25T20:05:00Z";
    return {
      local_key: { ...replacement },
      remote_key: { ...enrolled },
      message: `Rotated from local key ${old.id} to ${replacement.id}.`,
    };
  }
  return invoke<PublisherKeyMutation>("publisher_key_rotate", {
    publisherHandle,
    label,
    confirmation,
  });
}

// Revoke one exact enrolled local publisher key.
export async function revokePublisherKey(
  publisherHandle: string,
  keyId: string,
  confirmation: string,
): Promise<RemotePublisherKey> {
  if (!isTauri()) {
    void publisherHandle;
    requireBrowserConfirmation(keyId, confirmation);
    const local = requireBrowserLocalKey(keyId);
    local.state = "revoked";
    local.selected = false;
    const remote = browserRemoteKeys.find(
      (candidate) => candidate.public_key === local.public_key,
    );
    if (!remote) {
      throw new Error("No remote key matches the requested local key.");
    }
    remote.state = "revoked";
    remote.revoked_at = "2026-07-25T20:10:00Z";
    return { ...remote };
  }
  return invoke<RemotePublisherKey>("publisher_key_revoke", {
    publisherHandle,
    keyId,
    confirmation,
  });
}

// Revoke one exact lost-device remote key without local metadata.
export async function revokeRemotePublisherKey(
  publisherHandle: string,
  remoteKeyId: string,
  confirmation: string,
): Promise<RemotePublisherKey> {
  if (!isTauri()) {
    void publisherHandle;
    requireBrowserConfirmation(remoteKeyId, confirmation);
    const remote = browserRemoteKeys.find(
      (candidate) => candidate.id === remoteKeyId,
    );
    if (!remote) {
      throw new Error(`Remote publisher key ${remoteKeyId} was not found.`);
    }
    remote.state = "revoked";
    remote.revoked_at = "2026-07-25T20:15:00Z";
    return { ...remote };
  }
  return invoke<RemotePublisherKey>("publisher_key_remote_revoke", {
    publisherHandle,
    remoteKeyId,
    confirmation,
  });
}

// Open native dialogs and export one encrypted recovery package.
export async function exportPublisherKey(
  keyId: string,
): Promise<PublisherKeyExport> {
  if (!isTauri()) {
    requireBrowserLocalKey(keyId);
    return { saved: true };
  }
  return invoke<PublisherKeyExport>("publisher_key_export", { keyId });
}

// Open native dialogs and import one encrypted recovery package.
export async function importPublisherKey(
  label?: string,
): Promise<LocalPublisherKey> {
  if (!isTauri()) {
    const key = createBrowserLocalKey(label || "Imported recovery key");
    browserLocalKeys.forEach((candidate) => {
      candidate.selected = false;
    });
    key.selected = true;
    browserLocalKeys = [...browserLocalKeys, key];
    return { ...key };
  }
  return invoke<LocalPublisherKey>("publisher_key_import", {
    label: label || null,
  });
}

// -- Creator Studio --

// List path-free Creator Studio draft metadata in stable identifier order.
export async function listStudioDrafts(): Promise<StudioDraft[]> {
  if (!isTauri()) {
    return [...browserStudioDrafts.values()]
      .map((entry) => cloneBrowserFixture(entry.draft))
      .sort((left, right) => left.id.localeCompare(right.id));
  }
  return invoke<StudioDraft[]>("studio_list");
}

// Create one blank or guided draft through the bounded native template contract.
export async function createStudioDraft(
  id: string,
  title: string,
  template: StudioDraftTemplate,
): Promise<StudioDraftStatus> {
  if (!isTauri()) {
    if (template.mode === "blank") {
      return createBrowserStudioDraft(
        id,
        title,
        browserStudioManifest(
          id,
          "local",
          "local-unsigned",
          "0.1.0",
          null,
          false,
          "Describe what this persona is for.",
        ),
        "Direct and useful",
      );
    }
    const key = requireBrowserLocalKey(template.key_id);
    if (key.state !== "active") {
      throw new Error("The guided draft key must be active.");
    }
    return createBrowserStudioDraft(
      id,
      title,
      browserStudioManifest(
        template.name,
        template.author_handle,
        browserStudioDigest(key.public_key),
        template.version,
        template.license,
        template.forkable,
        template.description,
      ),
      template.voice_tone,
    );
  }
  return invoke<StudioDraftStatus>("studio_create", { id, title, template });
}

// Open a native directory picker and import only hardened public pack content.
export async function importStudioDraft(
  id: string,
  title: string,
): Promise<StudioDraftStatus | null> {
  if (!isTauri()) {
    return createBrowserStudioDraft(
      id,
      title,
      browserStudioManifest(
        id,
        "imported-author",
        browserStudioDigest(`import:${id}`),
        "1.0.0",
        "MIT",
        true,
        "Imported browser-preview persona.",
      ),
      "Measured and practical",
    );
  }
  return invoke<StudioDraftStatus | null>("studio_import", { id, title });
}

// Fork one verified immutable registry version under a distinct public identity.
export async function forkStudioDraft(
  id: string,
  title: string,
  sourceName: string,
  sourceVersion: string,
  identity: StudioForkIdentity,
): Promise<StudioDraftStatus> {
  if (!isTauri()) {
    const key = requireBrowserLocalKey(identity.key_id);
    if (key.state !== "active") {
      throw new Error("The fork identity key must be active.");
    }
    return createBrowserStudioDraft(
      id,
      title,
      browserStudioManifest(
        identity.name,
        identity.author_handle,
        browserStudioDigest(key.public_key),
        identity.version,
        "MIT",
        identity.forkable,
        `A verified fork of ${sourceName} ${sourceVersion}.`,
        {
          name: sourceName,
          version: sourceVersion,
          content_hash: browserStudioDigest(
            `registry:${sourceName}:${sourceVersion}`,
          ),
        },
      ),
      "Respectful of the source with a distinct point of view",
    );
  }
  return invoke<StudioDraftStatus>("studio_fork", {
    id,
    title,
    sourceName,
    sourceVersion,
    identity,
  });
}

// Read one bounded UTF-8 public draft file without returning an absolute path.
export async function readStudioFile(
  id: string,
  path: string,
): Promise<StudioFile> {
  if (!isTauri()) {
    const content = requireBrowserStudioDraft(id).files.get(path);
    if (content === undefined) {
      throw new Error(`Public draft file ${path} was not found.`);
    }
    return { path, content };
  }
  return invoke<StudioFile>("studio_read_file", { id, path });
}

// Atomically write one bounded UTF-8 public file and invalidate exact approval.
export async function writeStudioFile(
  id: string,
  path: string,
  content: string,
): Promise<StudioDraftStatus> {
  if (!isTauri()) {
    if (
      !path ||
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").some((segment) => !segment || segment === "..")
    ) {
      throw new Error("Choose a normalized relative public file path.");
    }
    const draft = requireBrowserStudioDraft(id);
    invalidateBrowserStudioDraft(draft);
    draft.files.set(path, content);
    return browserStudioStatus(id);
  }
  return invoke<StudioDraftStatus>("studio_write_file", {
    id,
    path,
    content,
  });
}

// Remove one exact public draft file and invalidate prior approval.
export async function removeStudioFile(
  id: string,
  path: string,
): Promise<StudioDraftStatus> {
  if (!isTauri()) {
    const draft = requireBrowserStudioDraft(id);
    if (!draft.files.has(path)) {
      throw new Error(`Public draft file ${path} was not found.`);
    }
    invalidateBrowserStudioDraft(draft);
    draft.files.delete(path);
    return browserStudioStatus(id);
  }
  return invoke<StudioDraftStatus>("studio_remove_file", { id, path });
}

// Load fresh scanner and exact-approval status for one draft.
export async function getStudioDraftStatus(
  id: string,
): Promise<StudioDraftStatus> {
  if (!isTauri()) {
    return browserStudioStatus(id);
  }
  return invoke<StudioDraftStatus>("studio_status", { id });
}

// Render every supported agent target from the exact current inventory.
export async function previewStudioDraft(
  id: string,
): Promise<StudioDraftPreview> {
  if (!isTauri()) {
    const status = browserStudioStatus(id);
    if (!status.publication.inventory.some((entry) => entry.path === "persona.toml")) {
      throw new Error("persona.toml is required before preview.");
    }
    const source = requireBrowserStudioDraft(id).files.get("persona.toml") ?? "";
    const targets = [
      ["claude", "CLAUDE.md"],
      ["codex", "AGENTS.md"],
      ["gemini", "GEMINI.md"],
      ["generic", "AGENTS.md"],
    ].map(([target, installFilename]) => {
      const content = `# ${status.draft.title}\n\nTarget: ${target}\n\n${source}`;
      return {
        target,
        install_filename: installFilename,
        content,
        sha256: browserStudioDigest(content),
      };
    });
    return {
      revision: status.draft.revision,
      inventory_hash: status.publication.inventory_hash,
      publication: status.publication,
      targets,
    };
  }
  return invoke<StudioDraftPreview>("studio_preview", { id });
}

// Run the shared scanner and path-free conformance checks for one exact draft.
export async function validateStudioDraft(
  id: string,
): Promise<StudioDraftValidationReport> {
  if (!isTauri()) {
    const status = browserStudioStatus(id);
    return {
      schema_version: 1,
      revision: status.draft.revision,
      inventory_hash: status.publication.inventory_hash,
      publication: status.publication,
      valid: status.publication.valid,
      conformance: {
        status: status.publication.valid ? "not_provided" : "blocked",
        valid: status.publication.valid,
        bundle_hash: null,
        score: null,
        threshold: 0.8,
        tests: [],
        findings: [
          {
            code: status.publication.valid
              ? "conformance.not_provided"
              : "publication.invalid",
            severity: status.publication.valid ? "warning" : "error",
            test_id: null,
            message: status.publication.valid
              ? "No conformance bundle was provided; scanner checks passed."
              : "Publication policy must pass before conformance can run.",
          },
        ],
      },
    };
  }
  return invoke<StudioDraftValidationReport>("studio_validate", { id });
}

// Prepare a path-free exact-file review without recording human approval.
export async function prepareStudioReview(
  id: string,
  publisherHandle: string,
  keyId: string,
): Promise<StudioDraftReviewReport> {
  if (!isTauri()) {
    return browserStudioReview(id, publisherHandle, keyId);
  }
  return invoke<StudioDraftReviewReport>("studio_prepare_review", {
    id,
    publisherHandle,
    keyId,
  });
}

// Record explicit human approval for only the exact displayed review binding.
export async function confirmStudioReview(
  id: string,
  binding: StudioPublicationReviewBinding,
): Promise<StudioDraftStatus> {
  if (!isTauri()) {
    const draft = requireBrowserStudioDraft(id);
    const prepared = browserStudioPublication(draft);
    if (
      !prepared.valid ||
      prepared.inventory_hash !== binding.artifact.file_inventory_hash ||
      !browserStudioBindingMatches(draft, binding)
    ) {
      throw new Error("The draft changed after review was prepared.");
    }
    draft.draft.review = {
      revision: draft.draft.revision,
      inventory_hash: prepared.inventory_hash,
      binding: cloneBrowserFixture(binding),
    };
    draft.draft.submission_intent = null;
    return browserStudioStatus(id);
  }
  return invoke<StudioDraftStatus>("studio_confirm_review", { id, binding });
}

// Submit unchanged confirmed bytes to quarantine while preserving caller retry IDs.
export async function submitStudioDraft(
  id: string,
  publisherHandle: string,
  keyId: string,
  binding: StudioPublicationReviewBinding,
  intentId: string | null,
  submissionId: string | null,
): Promise<StudioSubmission> {
  if (!isTauri()) {
    const draft = requireBrowserStudioDraft(id);
    const status = browserStudioStatus(id);
    const { membership, remoteKey } = requireBrowserStudioPublisher(
      publisherHandle,
      keyId,
    );
    if (
      !status.review_current ||
      JSON.stringify(status.draft.review?.binding) !== JSON.stringify(binding) ||
      binding.publisher_id !== membership.publisher_id ||
      binding.publisher_key_id !== remoteKey.id
    ) {
      throw new Error("The exact review is no longer current for submission.");
    }
    const stableIntentId = intentId ?? crypto.randomUUID();
    const stableSubmissionId = submissionId ?? crypto.randomUUID();
    draft.draft.submission_intent = {
      revision: draft.draft.revision,
      inventory_hash: status.publication.inventory_hash,
      binding: cloneBrowserFixture(binding),
    };
    const existing = browserStudioSubmissions.get(stableSubmissionId);
    if (existing) {
      if (existing.intent_id !== stableIntentId) {
        throw new Error("Submission retry identifiers do not match the prior request.");
      }
      return cloneBrowserFixture(existing);
    }
    const now = new Date().toISOString();
    const submission: StudioSubmission = {
      id: stableSubmissionId,
      intent_id: stableIntentId,
      publisher_id: binding.publisher_id,
      publisher_key_id: binding.publisher_key_id,
      archive_hash: binding.artifact.archive_hash,
      manifest_hash: binding.artifact.manifest_hash,
      file_inventory_hash: binding.artifact.file_inventory_hash,
      scan_schema_version: binding.artifact.scan_schema_version,
      state: "quarantined",
      created_at: now,
      updated_at: now,
    };
    browserStudioSubmissions.set(stableSubmissionId, submission);
    return cloneBrowserFixture(submission);
  }
  return invoke<StudioSubmission>("studio_submit", {
    id,
    publisherHandle,
    keyId,
    binding,
    intentId,
    submissionId,
  });
}

// Refresh one account-owned submission's honest non-public moderation state.
export async function getStudioSubmissionStatus(
  submissionId: string,
): Promise<StudioSubmission> {
  if (!isTauri()) {
    const submission = browserStudioSubmissions.get(submissionId);
    if (!submission) {
      throw new Error(`Quarantine submission ${submissionId} was not found.`);
    }
    return cloneBrowserFixture(submission);
  }
  return invoke<StudioSubmission>("studio_submission_status", {
    submissionId,
  });
}

// Returns the running app's semantic version from the Tauri runtime, falling
// back to a dev placeholder in browser dev mode where no bundle exists.
export async function getAppVersion(): Promise<string> {
  if (!isTauri()) {
    return "0.0.0-dev";
  }
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}
