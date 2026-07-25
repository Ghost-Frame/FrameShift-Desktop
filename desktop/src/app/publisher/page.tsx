"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createPublisherKey,
  enrollPublisherKey,
  exportPublisherKey,
  getAccountStatus,
  getPublisherKeyStatus,
  importPublisherKey,
  initializePublisherKeys,
  recoverPublisherKey,
  revokePublisherKey,
  revokeRemotePublisherKey,
  rotatePublisherKey,
  selectPublisherKey,
  AccountMembership,
  AccountSession,
  LocalPublisherKey,
  PublisherKeyStatus,
  RemotePublisherKey,
} from "@/lib/tauri";

// Names one publisher-key operation currently running.
type PublisherOperation =
  | "loading"
  | "initialize"
  | "create"
  | "enroll"
  | "select"
  | "rotate"
  | "revoke"
  | "remote-revoke"
  | "export"
  | "import"
  | "recover"
  | null;

// Return a compact public-key preview while preserving the full value in a title.
function compactPublicKey(value: string): string {
  if (value.length <= 24) {
    return value;
  }
  return `${value.slice(0, 12)}…${value.slice(-10)}`;
}

// Return whether one local key has a matching active registry enrollment.
function isEnrolled(
  local: LocalPublisherKey,
  remoteKeys: RemotePublisherKey[],
): boolean {
  return remoteKeys.some(
    (remote) =>
      remote.public_key === local.public_key && remote.state === "active",
  );
}

// Render publisher identity and native key lifecycle controls.
export default function PublisherPage() {
  const [account, setAccount] = useState<AccountSession | null>(null);
  const [publisherHandle, setPublisherHandle] = useState("");
  const [status, setStatus] = useState<PublisherKeyStatus | null>(null);
  const [operation, setOperation] = useState<PublisherOperation>("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("Publishing device");
  const [recoveryLabel, setRecoveryLabel] = useState("Recovered device");
  const [rotationLabel, setRotationLabel] = useState("Replacement device");
  const [rotationConfirmation, setRotationConfirmation] = useState("");
  const [confirmations, setConfirmations] = useState<Record<string, string>>({});

  // Return active publisher memberships with usable server-provided handles.
  const publishers = useMemo(
    () =>
      (account?.memberships ?? []).filter(
        (membership) =>
          membership.state === "active" && membership.handle !== null,
      ),
    [account],
  );

  // Return the selected active local key when one is available.
  const selectedKey = useMemo(
    () => status?.local_keys.find((key) => key.selected) ?? null,
    [status],
  );

  // Reload one publisher's local and registry metadata.
  const refreshStatus = useCallback(async (handle: string) => {
    const next = await getPublisherKeyStatus(handle);
    setStatus(next);
  }, []);

  // Load the redacted account and the first available publisher on entry.
  useEffect(() => {
    let cancelled = false;

    // Perform the initial account and publisher status request.
    async function loadPublisher(): Promise<void> {
      setOperation("loading");
      setError(null);
      try {
        const nextAccount = await getAccountStatus();
        if (cancelled) {
          return;
        }
        setAccount(nextAccount);
        const first = nextAccount.memberships.find(
          (membership) =>
            membership.state === "active" && membership.handle !== null,
        );
        if (first?.handle) {
          setPublisherHandle(first.handle);
          const nextStatus = await getPublisherKeyStatus(first.handle);
          if (!cancelled) {
            setStatus(nextStatus);
          }
        }
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Failed to load publisher security.",
          );
        }
      } finally {
        if (!cancelled) {
          setOperation(null);
        }
      }
    }

    void loadPublisher();
    return () => {
      cancelled = true;
    };
  }, []);

  // Run one native mutation, refresh metadata, and announce its outcome.
  const runMutation = useCallback(
    async (
      name: Exclude<PublisherOperation, "loading" | null>,
      action: () => Promise<string>,
    ): Promise<void> => {
      setOperation(name);
      setError(null);
      setNotice(null);
      try {
        const message = await action();
        try {
          await refreshStatus(publisherHandle);
        } catch (refreshCause) {
          const refreshMessage =
            refreshCause instanceof Error
              ? refreshCause.message
              : "Publisher status refresh failed.";
          setNotice(`${message} Refresh warning: ${refreshMessage}`);
          return;
        }
        setNotice(message);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Publisher key operation failed.",
        );
      } finally {
        setOperation(null);
      }
    },
    [publisherHandle, refreshStatus],
  );

  // Switch to another active account-owned publisher.
  async function handlePublisherChange(handle: string): Promise<void> {
    setPublisherHandle(handle);
    setOperation("loading");
    setError(null);
    setNotice(null);
    try {
      await refreshStatus(handle);
    } catch (cause) {
      setStatus(null);
      setError(
        cause instanceof Error
          ? cause.message
          : "Failed to load publisher keys.",
      );
    } finally {
      setOperation(null);
    }
  }

  // Initialize native key storage and its first selected device key.
  function handleInitialize(): void {
    void runMutation("initialize", async () => {
      await initializePublisherKeys();
      return "Native publisher-key storage is initialized.";
    });
  }

  // Create one additional local key without enrolling it automatically.
  function handleCreate(): void {
    void runMutation("create", async () => {
      const key = await createPublisherKey(newLabel);
      return `Created local key ${key.id}. Enroll it before publishing.`;
    });
  }

  // Enroll one local key through the native authenticated client.
  function handleEnroll(key: LocalPublisherKey): void {
    void runMutation("enroll", async () => {
      const remote = await enrollPublisherKey(publisherHandle, key.id);
      return `Enrolled ${key.id} as registry key ${remote.id}.`;
    });
  }

  // Select one active local key for future signatures.
  function handleSelect(key: LocalPublisherKey): void {
    void runMutation("select", async () => {
      await selectPublisherKey(key.id);
      return `Selected ${key.id} for future signatures.`;
    });
  }

  // Export one encrypted recovery package through native dialogs.
  function handleExport(key: LocalPublisherKey): void {
    void runMutation("export", async () => {
      await exportPublisherKey(key.id);
      return "Encrypted recovery package saved.";
    });
  }

  // Import and select an encrypted recovery package through native dialogs.
  function handleImport(): void {
    void runMutation("import", async () => {
      const key = await importPublisherKey(recoveryLabel);
      return `Imported and selected local key ${key.id}.`;
    });
  }

  // Create, enroll, and select a replacement on a recovered device.
  function handleRecover(): void {
    void runMutation("recover", async () => {
      const result = await recoverPublisherKey(
        publisherHandle,
        recoveryLabel,
      );
      return result.message;
    });
  }

  // Rotate replacement-first after exact confirmation of the selected key.
  function handleRotate(): void {
    void runMutation("rotate", async () => {
      const result = await rotatePublisherKey(
        publisherHandle,
        rotationLabel,
        rotationConfirmation,
      );
      setRotationConfirmation("");
      return result.message;
    });
  }

  // Revoke one enrolled local key after exact identifier confirmation.
  function handleRevoke(key: LocalPublisherKey): void {
    void runMutation("revoke", async () => {
      await revokePublisherKey(
        publisherHandle,
        key.id,
        confirmations[key.id] ?? "",
      );
      setConfirmations((current) => ({ ...current, [key.id]: "" }));
      return `Revoked local and registry key ${key.id}.`;
    });
  }

  // Revoke one remote lost-device key after exact identifier confirmation.
  function handleRemoteRevoke(key: RemotePublisherKey): void {
    void runMutation("remote-revoke", async () => {
      await revokeRemotePublisherKey(
        publisherHandle,
        key.id,
        confirmations[key.id] ?? "",
      );
      setConfirmations((current) => ({ ...current, [key.id]: "" }));
      return `Revoked registry key ${key.id}.`;
    });
  }

  // Render the initial account-checking state.
  if (operation === "loading" && account === null) {
    return (
      <div className="publisher-page">
        <div className="page-header">
          <h1 className="page-title">Publisher security</h1>
          <div className="page-subtitle">
            Loading native account and key metadata…
          </div>
        </div>
        <div className="card publisher-empty" aria-busy="true">
          Checking this device
        </div>
      </div>
    );
  }

  // Render a clear route to native sign-in without accepting tokens here.
  if (!account?.signed_in) {
    return (
      <div className="publisher-page">
        <div className="page-header">
          <h1 className="page-title">Publisher security</h1>
          <div className="page-subtitle">
            Manage the device keys authorized to publish your personas
          </div>
        </div>
        <div className="card publisher-empty">
          <span className="publisher-empty-kicker">Account required</span>
          <h2>Sign in before managing publisher keys</h2>
          <p>
            Authentication opens in your system browser. Tokens remain in the
            native credential store and never enter this page.
          </p>
          <Link className="btn btn-primary" href="/settings">
            Open account settings
          </Link>
        </div>
      </div>
    );
  }

  // Render an explicit compatibility failure for older account responses.
  if (publishers.length === 0) {
    return (
      <div className="publisher-page">
        <div className="page-header">
          <h1 className="page-title">Publisher security</h1>
          <div className="page-subtitle">
            Manage the device keys authorized to publish your personas
          </div>
        </div>
        <div className="card publisher-empty" role="alert">
          <span className="publisher-empty-kicker">No publisher available</span>
          <h2>This account has no active publisher profile</h2>
          <p>
            Publisher membership handles are required for key enrollment. Ask
            an account administrator to restore the membership or update the
            registry server if this account should already own a publisher.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="publisher-page">
      <div className="page-header publisher-header">
        <div>
          <h1 className="page-title">Publisher security</h1>
          <div className="page-subtitle">
            Device keys, recovery, rotation, and revocation
          </div>
        </div>
        <label className="publisher-selector">
          <span>Publisher</span>
          <select
            value={publisherHandle}
            onChange={(event) => void handlePublisherChange(event.target.value)}
            disabled={operation !== null}
          >
            {publishers.map((membership: AccountMembership) => (
              <option
                key={membership.publisher_id}
                value={membership.handle ?? ""}
              >
                {membership.display_name || membership.handle}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div
        className={`publisher-message${error ? " is-error" : ""}`}
        role={error ? "alert" : "status"}
        aria-live="polite"
      >
        {error ||
          notice ||
          "Private key material stays in native credential storage. This page receives metadata only."}
      </div>

      <section className="publisher-summary" aria-label="Publisher key summary">
        <div className="card publisher-summary-card">
          <span>Local keys</span>
          <strong>{status?.local_keys.length ?? 0}</strong>
          <small>{status?.initialized ? "Native store ready" : "Not initialized"}</small>
        </div>
        <div className="card publisher-summary-card">
          <span>Registry keys</span>
          <strong>{status?.remote_keys.length ?? 0}</strong>
          <small>{status?.remote_error ? "Status unavailable" : "Registry synced"}</small>
        </div>
        <div className="card publisher-summary-card">
          <span>Selected signer</span>
          <strong>{selectedKey ? "Ready" : "None"}</strong>
          <small className="mono">
            {selectedKey?.id ?? "No active selection"}
          </small>
        </div>
      </section>

      {status?.remote_error ? (
        <div className="status-panel status-panel-error" role="alert">
          Local metadata is available, but registry status failed:{" "}
          {status.remote_error}
        </div>
      ) : null}

      {!status?.initialized ? (
        <section className="card publisher-empty publisher-initialize">
          <span className="publisher-empty-kicker">First device</span>
          <h2>Initialize publisher-key storage</h2>
          <p>
            FrameShift will create a signing key in the operating system
            keychain. If secure native storage is unavailable, the desktop will
            stop and direct you to the CLI fallback.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleInitialize}
            disabled={operation !== null}
          >
            {operation === "initialize" ? "Initializing…" : "Initialize keys"}
          </button>
        </section>
      ) : (
        <>
          <section className="publisher-section">
            <div className="publisher-section-heading">
              <div>
                <span className="publisher-section-kicker">This device</span>
                <h2>Local signing keys</h2>
              </div>
              <div className="publisher-create">
                <label htmlFor="publisher-new-label">New key label</label>
                <input
                  id="publisher-new-label"
                  value={newLabel}
                  onChange={(event) => setNewLabel(event.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={handleCreate}
                  disabled={operation !== null || newLabel.trim() === ""}
                >
                  {operation === "create" ? "Creating…" : "Create local key"}
                </button>
              </div>
            </div>

            <div className="publisher-key-list">
              {status.local_keys.map((key) => {
                const enrolled = isEnrolled(key, status.remote_keys);
                return (
                  <article
                    className={`card publisher-key${key.selected ? " is-selected" : ""}`}
                    key={key.id}
                  >
                    <div className="publisher-key-heading">
                      <div>
                        <h3>{key.label}</h3>
                        <code title={key.id}>{key.id}</code>
                      </div>
                      <div className="publisher-key-badges">
                        {key.selected ? (
                          <span className="badge badge-success">Selected</span>
                        ) : null}
                        <span className={`badge${key.state === "active" ? "" : " badge-warning"}`}>
                          {key.state.replace("_", " ")}
                        </span>
                      </div>
                    </div>
                    <dl className="publisher-key-details">
                      <div>
                        <dt>Public key</dt>
                        <dd title={key.public_key}>
                          {compactPublicKey(key.public_key)}
                        </dd>
                      </div>
                      <div>
                        <dt>Storage</dt>
                        <dd>{key.secret_backend}</dd>
                      </div>
                      <div>
                        <dt>Registry</dt>
                        <dd>{enrolled ? "enrolled" : "not enrolled"}</dd>
                      </div>
                    </dl>
                    <div className="publisher-key-actions">
                      {!enrolled && key.state === "active" ? (
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => handleEnroll(key)}
                          disabled={operation !== null}
                        >
                          Enroll
                        </button>
                      ) : null}
                      {!key.selected && key.state === "active" ? (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => handleSelect(key)}
                          disabled={operation !== null}
                        >
                          Select
                        </button>
                      ) : null}
                      {key.state !== "revoked" ? (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => handleExport(key)}
                          disabled={operation !== null}
                        >
                          Export recovery
                        </button>
                      ) : null}
                    </div>
                    {enrolled && key.state !== "revoked" ? (
                      <div className="publisher-danger">
                        <label htmlFor={`revoke-${key.id}`}>
                          Type <code>{key.id}</code> to revoke
                        </label>
                        <div>
                          <input
                            id={`revoke-${key.id}`}
                            value={confirmations[key.id] ?? ""}
                            onChange={(event) =>
                              setConfirmations((current) => ({
                                ...current,
                                [key.id]: event.target.value,
                              }))
                            }
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            className="btn publisher-danger-button"
                            onClick={() => handleRevoke(key)}
                            disabled={
                              operation !== null ||
                              confirmations[key.id] !== key.id
                            }
                          >
                            Revoke key
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="publisher-section publisher-two-column">
            <div className="card publisher-operation-card">
              <span className="publisher-section-kicker">Replacement first</span>
              <h2>Rotate selected key</h2>
              <p>
                A replacement is created, enrolled, and selected before the old
                key is revoked. Ambiguous network failures remain pending for
                reconciliation.
              </p>
              <label htmlFor="rotation-label">Replacement label</label>
              <input
                id="rotation-label"
                value={rotationLabel}
                onChange={(event) => setRotationLabel(event.target.value)}
              />
              <label htmlFor="rotation-confirmation">
                Type <code>{selectedKey?.id ?? "selected key ID"}</code>
              </label>
              <input
                id="rotation-confirmation"
                value={rotationConfirmation}
                onChange={(event) =>
                  setRotationConfirmation(event.target.value)
                }
                autoComplete="off"
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleRotate}
                disabled={
                  operation !== null ||
                  !selectedKey ||
                  !isEnrolled(selectedKey, status.remote_keys) ||
                  rotationConfirmation !== selectedKey.id ||
                  rotationLabel.trim() === ""
                }
              >
                {operation === "rotate" ? "Rotating…" : "Rotate selected key"}
              </button>
            </div>

            <div className="card publisher-operation-card">
              <span className="publisher-section-kicker">Recovery</span>
              <h2>Restore publishing access</h2>
              <p>
                Import an encrypted package, or create and enroll a fresh key
                after account recovery. Passphrases are requested by native
                dialogs, never this page.
              </p>
              <label htmlFor="recovery-label">Recovered device label</label>
              <input
                id="recovery-label"
                value={recoveryLabel}
                onChange={(event) => setRecoveryLabel(event.target.value)}
              />
              <div className="publisher-operation-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={handleImport}
                  disabled={operation !== null}
                >
                  {operation === "import" ? "Importing…" : "Import package"}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={handleRecover}
                  disabled={operation !== null || recoveryLabel.trim() === ""}
                >
                  {operation === "recover"
                    ? "Recovering…"
                    : "Create recovery key"}
                </button>
              </div>
            </div>
          </section>

          <section className="publisher-section">
            <div className="publisher-section-heading">
              <div>
                <span className="publisher-section-kicker">Registry</span>
                <h2>Enrolled devices</h2>
              </div>
            </div>
            <div className="publisher-key-list publisher-remote-list">
              {status.remote_keys.length === 0 ? (
                <div className="card publisher-empty compact">
                  No registry keys are enrolled for this publisher.
                </div>
              ) : (
                status.remote_keys.map((key) => (
                  <article className="card publisher-key" key={key.id}>
                    <div className="publisher-key-heading">
                      <div>
                        <h3>{key.label}</h3>
                        <code title={key.id}>{key.id}</code>
                      </div>
                      <span className={`badge${key.state === "active" ? " badge-success" : ""}`}>
                        {key.state}
                      </span>
                    </div>
                    <dl className="publisher-key-details">
                      <div>
                        <dt>Public key</dt>
                        <dd title={key.public_key}>
                          {compactPublicKey(key.public_key)}
                        </dd>
                      </div>
                      <div>
                        <dt>Last used</dt>
                        <dd>{key.last_used_at ?? "Not yet"}</dd>
                      </div>
                    </dl>
                    {key.state === "active" ? (
                      <div className="publisher-danger">
                        <label htmlFor={`remote-revoke-${key.id}`}>
                          Lost device? Type <code>{key.id}</code>
                        </label>
                        <div>
                          <input
                            id={`remote-revoke-${key.id}`}
                            value={confirmations[key.id] ?? ""}
                            onChange={(event) =>
                              setConfirmations((current) => ({
                                ...current,
                                [key.id]: event.target.value,
                              }))
                            }
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            className="btn publisher-danger-button"
                            onClick={() => handleRemoteRevoke(key)}
                            disabled={
                              operation !== null ||
                              confirmations[key.id] !== key.id
                            }
                          >
                            Revoke lost device
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
