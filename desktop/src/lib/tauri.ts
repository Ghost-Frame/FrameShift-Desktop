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

// Uses native OS dialogs for first-party credentials and returns redacted account state.
export async function loginFirstPartyAccount(): Promise<AccountSession> {
  if (!isTauri()) {
    return browserSignedInAccount();
  }
  return invoke<AccountSession>("account_login_first_party");
}

// Redeems an invitation through native OS dialogs and returns redacted account state.
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

// Returns the running app's semantic version from the Tauri runtime, falling
// back to a dev placeholder in browser dev mode where no bundle exists.
export async function getAppVersion(): Promise<string> {
  if (!isTauri()) {
    return "0.0.0-dev";
  }
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}
