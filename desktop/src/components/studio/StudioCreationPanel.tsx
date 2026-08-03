"use client";

// Collects bounded draft creation inputs without accepting filesystem paths.

import { useEffect, useState, type FormEvent } from "react";

import type { StudioDraftTemplate, StudioForkIdentity } from "@/lib/tauri";

// Creation methods supported by the desktop Creator Studio bridge.
type StudioCreationMode = "guided" | "blank" | "import" | "fork";

// Bounded creation callbacks supplied by the Studio route orchestrator.
interface StudioCreationPanelProps {
  busy: boolean;
  disabled: boolean;
  defaultAuthorHandle: string;
  selectedKeyId: string | null;
  onCreate: (
    id: string,
    title: string,
    template: StudioDraftTemplate,
  ) => Promise<void>;
  onImport: (id: string, title: string) => Promise<void>;
  onFork: (
    id: string,
    title: string,
    sourceName: string,
    sourceVersion: string,
    identity: StudioForkIdentity,
  ) => Promise<void>;
}

// Labels and concise safety descriptions for each creation method.
const CREATION_MODES: Array<{
  value: StudioCreationMode;
  label: string;
  detail: string;
}> = [
  {
    value: "guided",
    label: "Guided",
    detail: "Start valid",
  },
  {
    value: "blank",
    label: "Blank",
    detail: "Build by hand",
  },
  {
    value: "import",
    label: "Import",
    detail: "Native picker",
  },
  {
    value: "fork",
    label: "Fork",
    detail: "Verified release",
  },
];

// Return the action label for the currently selected creation method.
function creationActionLabel(mode: StudioCreationMode, busy: boolean): string {
  if (busy) {
    return mode === "import" ? "Opening picker..." : "Creating draft...";
  }
  if (mode === "import") return "Choose pack folder";
  if (mode === "fork") return "Verify and fork";
  return mode === "guided" ? "Create guided draft" : "Create blank draft";
}

// Renders progressive creation choices while keeping key identity read-only.
export function StudioCreationPanel({
  busy,
  disabled,
  defaultAuthorHandle,
  selectedKeyId,
  onCreate,
  onImport,
  onFork,
}: StudioCreationPanelProps) {
  const [mode, setMode] = useState<StudioCreationMode>("guided");
  const [id, setId] = useState("my-persona");
  const [title, setTitle] = useState("My persona");
  const [name, setName] = useState("my-persona");
  const [version, setVersion] = useState("0.1.0");
  const [authorHandle, setAuthorHandle] = useState(defaultAuthorHandle);
  const [description, setDescription] = useState(
    "A focused persona built for one clear job.",
  );
  const [voiceTone, setVoiceTone] = useState("Direct, calm, and specific");
  const [license, setLicense] = useState("MIT");
  const [forkable, setForkable] = useState(false);
  const [sourceName, setSourceName] = useState("orchestrator");
  const [sourceVersion, setSourceVersion] = useState("0.1.0");

  useEffect(() => {
    if (!authorHandle && defaultAuthorHandle) {
      setAuthorHandle(defaultAuthorHandle);
    }
  }, [authorHandle, defaultAuthorHandle]);

  // Dispatch the selected bounded creation flow without accepting a local path.
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "import") {
      await onImport(id.trim(), title.trim());
      return;
    }
    if (mode === "fork") {
      if (!selectedKeyId) {
        return;
      }
      await onFork(id.trim(), title.trim(), sourceName.trim(), sourceVersion.trim(), {
        name: name.trim(),
        version: version.trim(),
        author_handle: authorHandle.trim(),
        key_id: selectedKeyId,
        forkable,
      });
      return;
    }
    if (mode === "blank") {
      await onCreate(id.trim(), title.trim(), { mode: "blank" });
      return;
    }
    if (!selectedKeyId) {
      return;
    }
    await onCreate(id.trim(), title.trim(), {
      mode: "guided",
      name: name.trim(),
      version: version.trim(),
      author_handle: authorHandle.trim(),
      key_id: selectedKeyId,
      description: description.trim(),
      voice_tone: voiceTone.trim(),
      license: license.trim() || null,
      forkable,
    });
  }

  const needsPublisherIdentity = mode === "guided" || mode === "fork";
  const submitDisabled =
    disabled ||
    !id.trim() ||
    !title.trim() ||
    (needsPublisherIdentity &&
      (!selectedKeyId || !name.trim() || !version.trim() || !authorHandle.trim())) ||
    (mode === "guided" && (!description.trim() || !voiceTone.trim())) ||
    (mode === "fork" && (!sourceName.trim() || !sourceVersion.trim()));

  return (
    <section className="studio-create" aria-labelledby="studio-create-title">
      <div className="studio-section-heading">
        <div>
          <span className="studio-kicker">New work</span>
          <h2 id="studio-create-title">Start a draft</h2>
        </div>
        <span className="studio-local-mark">Local only</span>
      </div>

      <form className="studio-create-form" onSubmit={handleSubmit}>
        <fieldset className="studio-mode-fieldset">
          <legend>Creation method</legend>
          <div className="studio-mode-grid">
            {CREATION_MODES.map((option) => (
              <label
                className={`studio-mode${mode === option.value ? " is-selected" : ""}`}
                key={option.value}
              >
                <input
                  type="radio"
                  name="studio-creation-mode"
                  value={option.value}
                  checked={mode === option.value}
                  onChange={() => setMode(option.value)}
                  disabled={disabled}
                />
                <strong>{option.label}</strong>
                <span>{option.detail}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="studio-form-grid">
          <label className="studio-field">
            <span>Draft ID</span>
            <input
              value={id}
              onChange={(event) => setId(event.target.value)}
              disabled={disabled}
              pattern="[A-Za-z0-9_-]{1,64}"
              maxLength={64}
              autoComplete="off"
              required
            />
            <small>Letters, numbers, hyphens, or underscores.</small>
          </label>
          <label className="studio-field">
            <span>Workspace title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={disabled}
              maxLength={200}
              autoComplete="off"
              required
            />
            <small>Private label for this device.</small>
          </label>
        </div>

        {mode === "blank" ? (
          <div className="studio-method-note">
            Blank creates editable <code>pack.toml</code> and <code>persona.toml</code>
            skeletons. Scanner errors remain visible until the public identity is complete.
          </div>
        ) : null}

        {mode === "import" ? (
          <div className="studio-method-note">
            FrameShift opens a native folder picker. No path enters this page, and unsafe
            links or non-public files are rejected before copying.
          </div>
        ) : null}

        {mode === "fork" ? (
          <div className="studio-form-grid studio-form-grid-source">
            <label className="studio-field">
              <span>Registry source</span>
              <input
                value={sourceName}
                onChange={(event) => setSourceName(event.target.value)}
                disabled={disabled}
                autoComplete="off"
                required
              />
            </label>
            <label className="studio-field">
              <span>Exact source version</span>
              <input
                value={sourceVersion}
                onChange={(event) => setSourceVersion(event.target.value)}
                disabled={disabled}
                autoComplete="off"
                required
              />
            </label>
          </div>
        ) : null}

        {needsPublisherIdentity ? (
          <div className="studio-identity-fields">
            <div className="studio-form-grid">
              <label className="studio-field">
                <span>Public pack name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={disabled}
                  autoComplete="off"
                  required
                />
              </label>
              <label className="studio-field">
                <span>Version</span>
                <input
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  disabled={disabled}
                  autoComplete="off"
                  required
                />
              </label>
              <label className="studio-field">
                <span>Publisher handle</span>
                <input
                  value={authorHandle}
                  onChange={(event) => setAuthorHandle(event.target.value)}
                  disabled={disabled}
                  autoComplete="off"
                  required
                />
              </label>
              <div className="studio-field studio-key-proof">
                <span>Identity key</span>
                <strong title={selectedKeyId ?? undefined}>
                  {selectedKeyId ?? "No active key selected"}
                </strong>
                <small>Public metadata only. Signing stays native.</small>
              </div>
            </div>

            {mode === "guided" ? (
              <>
                <label className="studio-field">
                  <span>Purpose</span>
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    disabled={disabled}
                    rows={3}
                    maxLength={500}
                    required
                  />
                </label>
                <div className="studio-form-grid">
                  <label className="studio-field">
                    <span>Voice direction</span>
                    <input
                      value={voiceTone}
                      onChange={(event) => setVoiceTone(event.target.value)}
                      disabled={disabled}
                      autoComplete="off"
                      required
                    />
                  </label>
                  <label className="studio-field">
                    <span>SPDX license (optional)</span>
                    <input
                      value={license}
                      onChange={(event) => setLicense(event.target.value)}
                      disabled={disabled}
                      autoComplete="off"
                    />
                  </label>
                </div>
              </>
            ) : null}

            <label className="studio-check">
              <input
                type="checkbox"
                checked={forkable}
                onChange={(event) => setForkable(event.target.checked)}
                disabled={disabled}
              />
              <span>
                <strong>Permit verified forks</strong>
                <small>This permission ships in the public manifest.</small>
              </span>
            </label>
          </div>
        ) : null}

        {needsPublisherIdentity && !selectedKeyId ? (
          <p className="studio-inline-warning" role="status">
            Initialize, enroll, and select a publisher key before using this method.
          </p>
        ) : null}

        <button
          className="btn btn-primary studio-create-action"
          type="submit"
          disabled={submitDisabled}
        >
          {creationActionLabel(mode, busy)}
        </button>
      </form>
    </section>
  );
}
