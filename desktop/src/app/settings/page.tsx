"use client";

import { useEffect, useState } from "react";

import {
  connectAgent,
  getAccountStatus,
  getAppVersion,
  getAgentToolsStatus,
  getAutomateSettings,
  getProject,
  getSettings,
  installAgentTools,
  loginAccount,
  logoutAccount,
  setAutomateSettings,
  setTelemetryOptIn,
} from "@/lib/tauri";
import type {
  AccountSession,
  AgentToolsStatus,
  AutomateSettings,
} from "@/lib/tauri";
import { checkForUpdate, installUpdateAndRelaunch } from "@/lib/updates";

const API_URL = "https://frameshift-api.syntheos.dev/v1";

// Human-readable sensitivity presets that keep first-time setup understandable.
const SENSITIVITY_OPTIONS = [
  { value: 0.2, label: "Stable", detail: "switch less often" },
  { value: 0.5, label: "Balanced", detail: "recommended" },
  { value: 0.8, label: "Responsive", detail: "switch more readily" },
];

// Agent hosts with documented FrameShift MCP registration commands.
type AgentTarget = "codex" | "claude" | "gemini";

// Builds the documented MCP registration command for one agent host.
function connectionCommand(
  target: AgentTarget,
  projectPath: string,
  mcpPath = "frameshift-mcp",
): string {
  const executable = JSON.stringify(mcpPath);
  if (target === "claude") {
    return `claude mcp add --scope local --transport stdio --env FRAMESHIFT_TARGET=claude --env FRAMESHIFT_PROJECT_ROOT=${JSON.stringify(projectPath)} frameshift -- ${executable}`;
  }
  if (target === "gemini") {
    return `gemini mcp add --scope project --env FRAMESHIFT_TARGET=gemini --env FRAMESHIFT_PROJECT_ROOT=${JSON.stringify(projectPath)} frameshift ${executable}`;
  }
  return `codex mcp add frameshift --env FRAMESHIFT_TARGET=codex --env FRAMESHIFT_PROJECT_ROOT=${JSON.stringify(projectPath)} -- ${executable}`;
}

// Update-check lifecycle state surfaced in the Settings "Updates" row.
type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; version: string; notes?: string }
  | { kind: "installing" }
  | { kind: "error"; message: string };

// Native account command currently in progress.
type AccountOperation = "loading" | "login" | "logout" | null;

// Renders project settings, updater controls, and persistence status.
export default function SettingsPage() {
  const [account, setAccount] = useState<AccountSession | null>(null);
  const [accountOperation, setAccountOperation] =
    useState<AccountOperation>("loading");
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const [telemetryOptIn, setTelemetryOptInState] = useState(false);
  const [automate, setAutomate] = useState<AutomateSettings>({
    enabled: false,
    sensitivity: 0.5,
    locked: false,
  });
  const [dataDir, setDataDir] = useState("~/.local/share/frameshift");
  const [projectPath, setProjectPath] = useState("");
  const [agentTarget, setAgentTarget] = useState<AgentTarget>("codex");
  const [connectionCopied, setConnectionCopied] = useState(false);
  const [agentTools, setAgentTools] = useState<AgentToolsStatus>({
    version: null,
    bundled: false,
    installed: false,
    install_dir: null,
    mcp_path: null,
  });
  const [isConnectingAgent, setIsConnectingAgent] = useState(false);
  const [agentConnectionMessage, setAgentConnectionMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingAutomate, setIsSavingAutomate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ kind: "idle" });
  const [appVersion, setAppVersion] = useState("");

  // Loads the redacted native account state independently from project settings.
  useEffect(() => {
    let cancelled = false;

    getAccountStatus()
      .then((status) => {
        if (!cancelled) {
          setAccount(status);
          setAccountError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setAccountError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load account status",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAccountOperation(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Completes native system-browser login and replaces the redacted account view.
  async function handleAccountLogin() {
    setAccountOperation("login");
    setAccountError(null);
    setAccountNotice(null);
    try {
      setAccount(await loginAccount());
      setAccountNotice("Signed in. This device can now use your publisher account.");
    } catch (loginError) {
      setAccountError(
        loginError instanceof Error ? loginError.message : "FrameShift login failed",
      );
    } finally {
      setAccountOperation(null);
    }
  }

  // Erases the native session and reports any non-fatal provider warning.
  async function handleAccountLogout() {
    setAccountOperation("logout");
    setAccountError(null);
    setAccountNotice(null);
    try {
      const result = await logoutAccount();
      setAccount({
        signed_in: false,
        account_id: null,
        display_name: null,
        email: null,
        status: null,
        memberships: [],
      });
      setAccountNotice(
        result.revocation_warning ??
          (result.removed
            ? "Signed out and removed this device's local session."
            : "No local account session was stored."),
      );
    } catch (logoutError) {
      setAccountError(
        logoutError instanceof Error
          ? logoutError.message
          : "FrameShift logout failed",
      );
    } finally {
      setAccountOperation(null);
    }
  }

  // Checks the release endpoint for a newer signed build.
  async function handleCheckForUpdate() {
    setUpdate({ kind: "checking" });
    try {
      const found = await checkForUpdate();
      setUpdate(
        found
          ? { kind: "available", version: found.version, notes: found.notes }
          : { kind: "current" },
      );
    } catch (checkError) {
      setUpdate({
        kind: "error",
        message: checkError instanceof Error ? checkError.message : "Update check failed",
      });
    }
  }

  // Downloads, installs, and relaunches into the available update.
  async function handleInstallUpdate() {
    setUpdate({ kind: "installing" });
    try {
      await installUpdateAndRelaunch();
    } catch (installError) {
      setUpdate({
        kind: "error",
        message: installError instanceof Error ? installError.message : "Update install failed",
      });
    }
  }

  useEffect(() => {
    let cancelled = false;

    // Loads settings and app version without updating an unmounted page.
    async function load() {
      try {
        const [settings, automateSettings, project, version, tools] = await Promise.all([
          getSettings(),
          getAutomateSettings(),
          getProject(),
          getAppVersion(),
          getAgentToolsStatus(),
        ]);
        if (cancelled) {
          return;
        }
        setTelemetryOptInState(settings.telemetry_opt_in);
        setAutomate(automateSettings);
        setDataDir(settings.data_dir);
        setProjectPath(project.path ?? "");
        setAppVersion(version);
        setAgentTools(tools);
        setError(null);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Failed to load settings");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  // Optimistically saves telemetry consent and rolls back on failure.
  async function handleTelemetryToggle() {
    const nextValue = !telemetryOptIn;
    setTelemetryOptInState(nextValue);
    setIsSaving(true);
    setError(null);

    try {
      await setTelemetryOptIn(nextValue);
    } catch (saveError) {
      setTelemetryOptInState(!nextValue);
      setError(saveError instanceof Error ? saveError.message : "Failed to save setting");
    } finally {
      setIsSaving(false);
    }
  }

  // Saves a complete automate state update and restores the prior state on failure.
  async function persistAutomate(next: AutomateSettings) {
    const previous = automate;
    setAutomate(next);
    setIsSavingAutomate(true);
    setError(null);

    try {
      setAutomate(
        await setAutomateSettings(next.enabled, next.sensitivity),
      );
    } catch (saveError) {
      setAutomate(previous);
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save Automate settings",
      );
    } finally {
      setIsSavingAutomate(false);
    }
  }

  // Toggles host-driven automatic selection while preserving sensitivity.
  async function handleAutomateToggle() {
    await persistAutomate({ ...automate, enabled: !automate.enabled });
  }

  // Saves the selected switching-sensitivity preset.
  async function handleSensitivityChange(value: number) {
    await persistAutomate({ ...automate, sensitivity: value });
  }

  // Copies the selected host's setup command for pasting into a terminal.
  async function handleCopyConnectionCommand() {
    try {
      await navigator.clipboard.writeText(
        connectionCommand(agentTarget, projectPath),
      );
      setConnectionCopied(true);
      setError(null);
    } catch (copyError) {
      setConnectionCopied(false);
      setError(
        copyError instanceof Error
          ? copyError.message
          : "Could not copy the setup command",
      );
    }
  }

  // Installs the bundled tools without modifying an agent host configuration.
  async function handleInstallAgentTools() {
    setIsConnectingAgent(true);
    setAgentConnectionMessage(null);
    setError(null);
    try {
      const status = await installAgentTools();
      setAgentTools(status);
      setAgentConnectionMessage(
        `FrameShift ${status.version ?? "tools"} installed. Choose an agent and connect it.`,
      );
    } catch (installError) {
      setError(
        installError instanceof Error
          ? installError.message
          : "Could not install the FrameShift agent tools",
      );
    } finally {
      setIsConnectingAgent(false);
    }
  }

  // Installs the bundled tools and configures the selected agent host.
  async function handleConnectAgent() {
    setIsConnectingAgent(true);
    setAgentConnectionMessage(null);
    setError(null);
    try {
      const connection = await connectAgent(agentTarget);
      setAgentTools(await getAgentToolsStatus());
      setAgentConnectionMessage(connection.message);
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Could not connect FrameShift to the selected agent",
      );
    } finally {
      setIsConnectingAgent(false);
    }
  }

  const selectedSensitivityIsPreset = SENSITIVITY_OPTIONS.some(
    (option) => option.value === automate.sensitivity,
  );

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <div className="page-subtitle">Configure FrameShift runtime preferences</div>
      </div>

      {error ? (
        <div className="status-panel status-panel-error page-status" role="alert">
          {error}
        </div>
      ) : null}

      <div className="settings-section">
        <div className="settings-section-title">Account</div>

        <div
          className={`card account-card${account?.signed_in ? " is-signed-in" : ""}`}
          aria-busy={accountOperation !== null}
        >
          <div className="account-card-heading">
            <div>
              <div className="settings-label">
                {account?.signed_in
                  ? account.display_name || account.email || "FrameShift account"
                  : "Creator account"}
              </div>
              <div className="settings-description">
                {accountOperation === "loading"
                  ? "Checking this device for a secure account session..."
                  : account?.signed_in
                    ? `${account.memberships.length} publisher membership${account.memberships.length === 1 ? "" : "s"} available on this device.`
                    : "Sign in through your system browser. Tokens stay in the native credential store."}
              </div>
            </div>
            <span className={`badge${account?.signed_in ? " badge-success" : ""}`}>
              {accountOperation === "loading"
                ? "Checking"
                : account?.signed_in
                  ? account.status || "Signed in"
                  : "Signed out"}
            </span>
          </div>

          {account?.signed_in ? (
            <dl className="account-details">
              <div>
                <dt>Account</dt>
                <dd className="mono">{account.account_id}</dd>
              </div>
              {account.email ? (
                <div>
                  <dt>Email</dt>
                  <dd>{account.email}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          <div className="account-actions">
            <div
              className={`account-message${accountError ? " is-error" : ""}`}
              role={accountError ? "alert" : "status"}
              aria-live="polite"
            >
              {accountError || accountNotice || (
                account?.signed_in
                  ? "Session refresh and account requests happen inside the native runtime."
                  : "No bearer token copying or password is required."
              )}
            </div>
            {account?.signed_in ? (
              <button
                type="button"
                className="btn"
                onClick={() => void handleAccountLogout()}
                disabled={accountOperation !== null}
              >
                {accountOperation === "logout" ? "Signing out..." : "Sign out"}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleAccountLogin()}
                disabled={accountOperation !== null}
              >
                {accountOperation === "login" ? "Waiting for browser..." : "Sign in"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Connect an Agent</div>

        <div className="card agent-setup-card">
          <div className="agent-setup-summary">
            <div>
              <div className="settings-label">Agent tools</div>
              <div className="settings-description">
                This app includes the FrameShift CLI and MCP server. Install once,
                then connect each agent you use.
              </div>
            </div>
            <span className={`badge${agentTools.installed ? " badge-success" : ""}`}>
              {!agentTools.bundled
                ? "Not bundled in this build"
                : agentTools.installed
                  ? `Installed ${agentTools.version ?? ""}`
                  : `Ready ${agentTools.version ?? ""}`}
            </span>
          </div>
          <div className="settings-row agent-setup-controls">
            <label className="settings-label" htmlFor="agent-target">
              Agent
            </label>
            <select
              id="agent-target"
              className="settings-select"
              value={agentTarget}
              onChange={(event) => {
                setAgentTarget(event.target.value as AgentTarget);
                setConnectionCopied(false);
              }}
            >
              <option value="codex">Codex</option>
              <option value="claude">Claude Code</option>
              <option value="gemini">Gemini CLI</option>
            </select>
            <div className="agent-setup-actions">
              {!agentTools.installed ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => void handleInstallAgentTools()}
                  disabled={!agentTools.bundled || isConnectingAgent || !projectPath}
                >
                  {isConnectingAgent ? "Installing..." : "Install tools"}
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleConnectAgent()}
                disabled={!agentTools.bundled || isConnectingAgent || !projectPath}
              >
                {isConnectingAgent ? "Connecting..." : `Connect ${agentTarget === "claude" ? "Claude Code" : agentTarget === "gemini" ? "Gemini CLI" : "Codex"}`}
              </button>
            </div>
          </div>
          {agentConnectionMessage ? (
            <div className="status-panel agent-setup-status" role="status">
              {agentConnectionMessage}
            </div>
          ) : null}
          <div className="settings-description">
            The selected agent CLI must already be installed. FrameShift stores
            this connection only for <span className="mono">{projectPath}</span>.
          </div>
          <details className="agent-setup-advanced">
            <summary>Manual setup</summary>
            <p>
              Use this if the automatic connection reports an agent CLI error.
              The MCP path shown after tool installation is absolute, so no PATH
              changes are required.
            </p>
            <div className="agent-setup-command">
              <code>
                {connectionCommand(
                  agentTarget,
                  projectPath,
                  agentTools.mcp_path ?? "frameshift-mcp",
                )}
              </code>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void handleCopyConnectionCommand()}
                disabled={!projectPath}
              >
                {connectionCopied ? "Copied" : "Copy command"}
              </button>
            </div>
            {agentTools.mcp_path ? (
              <div className="settings-description">
                Installed MCP path: <span className="mono">{agentTools.mcp_path}</span>
              </div>
            ) : null}
          </details>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Persona Selection</div>

        <div className="card">
          <div className="settings-row">
            <div>
              <div className="settings-label">Automate Mode</div>
              <div className="settings-description">
                Allow an MCP host integration or running FrameShift daemon to
                choose the best installed persona for each task.
              </div>
            </div>
            <button
              className={`toggle${automate.enabled ? " on" : ""}`}
              onClick={() => void handleAutomateToggle()}
              aria-label="Toggle Automate mode"
              aria-pressed={automate.enabled}
              disabled={isLoading || isSavingAutomate}
            />
          </div>
          <div className="settings-row">
            <div>
              <label className="settings-label" htmlFor="automate-sensitivity">
                Switching Sensitivity
              </label>
              <div className="settings-description">
                Stable holds personas longer. Responsive reacts to task changes
                sooner.
              </div>
            </div>
            <select
              id="automate-sensitivity"
              className="settings-select"
              value={automate.sensitivity}
              onChange={(event) =>
                void handleSensitivityChange(Number(event.target.value))
              }
              disabled={isLoading || isSavingAutomate}
            >
              {!selectedSensitivityIsPreset ? (
                <option value={automate.sensitivity}>
                  Custom ({automate.sensitivity.toFixed(1)})
                </option>
              ) : null}
              {SENSITIVITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.detail})
                </option>
              ))}
            </select>
          </div>
          <div className="automate-notice" role="note">
            <strong>Agent connection required.</strong>
            <span>
              This switch stores the project policy. It does not change personas
              by itself. A connected agent must invoke FrameShift&apos;s Automate
              tool for the task, or the FrameShift daemon must be running.
            </span>
            {automate.locked ? (
              <span className="badge">Current persona locked</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Telemetry</div>

        <div className="card">
          <div className="settings-row">
            <div>
              <div className="settings-label">Share Marketplace Telemetry</div>
              <div className="settings-description">
                Send anonymized persona selection counts from this desktop workspace
              </div>
            </div>
            <button
              className={`toggle${telemetryOptIn ? " on" : ""}`}
              onClick={() => void handleTelemetryToggle()}
              aria-label="Toggle marketplace telemetry"
              aria-pressed={telemetryOptIn}
              disabled={isLoading || isSaving}
            />
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Data</div>

        <div className="card">
          <div className="settings-row">
            <div>
              <div className="settings-label">Data Directory</div>
              <div className="settings-description">
                Where personas, growth logs, and workspace config are stored
              </div>
            </div>
            <span className="settings-value mono">{dataDir}</span>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">API</div>

        <div className="card">
          <div className="settings-row">
            <div>
              <div className="settings-label">Registry Endpoint</div>
              <div className="settings-description">
                Catalog, install, and telemetry traffic targets this service
              </div>
            </div>
            <span className="settings-value mono">{API_URL}</span>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Updates</div>

        <div className="card">
          <div className="settings-row">
            <div>
              <div className="settings-label">Application Updates</div>
              <div className="settings-description">
                {update.kind === "checking" && "Checking for updates..."}
                {update.kind === "current" && "FrameShift is up to date."}
                {update.kind === "available" &&
                  `Version ${update.version} is available.`}
                {update.kind === "installing" &&
                  "Downloading and installing -- the app will restart."}
                {update.kind === "error" && update.message}
                {update.kind === "idle" &&
                  "Check for a newer signed release and install it in place."}
              </div>
            </div>
            {update.kind === "available" ? (
              <button
                className="btn btn-primary"
                onClick={() => void handleInstallUpdate()}
              >
                Install &amp; Restart
              </button>
            ) : (
              <button
                className="btn"
                onClick={() => void handleCheckForUpdate()}
                disabled={update.kind === "checking" || update.kind === "installing"}
              >
                {update.kind === "checking" ? "Checking..." : "Check for Updates"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">About</div>

        <div className="card">
          <div className="settings-row">
            <div className="settings-label">Version</div>
            <span className="settings-value">{appVersion || "..."}</span>
          </div>
          <div className="settings-row">
            <div className="settings-label">Identifier</div>
            <span className="settings-value mono">io.ghostframe.frameshift</span>
          </div>
          <div className="settings-row">
            <div className="settings-label">Runtime</div>
            <span className="settings-value">Tauri 2 / Next.js 15</span>
          </div>
        </div>
      </div>
    </div>
  );
}
