"use client";

// Desktop Creator Studio orchestration for local drafts and quarantine publication.

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { StudioCreationPanel } from "@/components/studio/StudioCreationPanel";
import { StudioReviewPanel } from "@/components/studio/StudioReviewPanel";
import { toErrorMessage } from "@/lib/errors";
import type { StudioApprovalState } from "@/lib/studio-state";
import {
  beginStudioReview,
  canSubmitStudioReview,
  confirmStudioReviewState,
  createStudioApprovalState,
  invalidateStudioApproval,
  submissionIdsForBinding,
} from "@/lib/studio-state";
import type {
  AccountSession,
  PublisherKeyStatus,
  StudioDraft,
  StudioDraftPreview,
  StudioDraftStatus,
  StudioDraftTemplate,
  StudioDraftValidationReport,
  StudioForkIdentity,
  StudioSubmission,
} from "@/lib/tauri";
import {
  confirmStudioReview,
  createStudioDraft,
  forkStudioDraft,
  getAccountStatus,
  getPublisherKeyStatus,
  getStudioDraftStatus,
  getStudioSubmissionStatus,
  importStudioDraft,
  listStudioDrafts,
  prepareStudioReview,
  previewStudioDraft,
  readStudioFile,
  removeStudioFile,
  submitStudioDraft,
  validateStudioDraft,
  writeStudioFile,
} from "@/lib/tauri";

// Names the asynchronous Creator Studio operation currently in flight.
type StudioOperation =
  | "loading"
  | "create"
  | "file"
  | "preview"
  | "validate"
  | "review"
  | "confirm"
  | "submit"
  | "submission-status"
  | null;

// Render one compact current-state label for the publication runway.
function runwayState(done: boolean, active: boolean): string {
  if (done) return "Complete";
  if (active) return "Current";
  return "Waiting";
}

// Return a bounded display fragment for a long digest or identifier.
function compactValue(value: string): string {
  return value.length > 22 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
}

// Render scanner or conformance findings with severity-independent wording.
function StudioFindingList({
  findings,
}: {
  findings: Array<{
    code: string;
    severity: "warning" | "error";
    message: string;
    location?: string | null;
  }>;
}) {
  if (!findings.length) {
    return <p className="studio-clear-result">No findings.</p>;
  }
  return (
    <ul className="studio-findings">
      {findings.map((finding) => (
        <li
          data-severity={finding.severity}
          key={`${finding.code}:${finding.location ?? ""}:${finding.message}`}
        >
          <strong>{finding.code}</strong>
          <span>{finding.message}</span>
          {finding.location ? <code>{finding.location}</code> : null}
        </li>
      ))}
    </ul>
  );
}

// Provides the full human workflow from local source to non-public quarantine.
export default function StudioPage() {
  const [operation, setOperation] = useState<StudioOperation>("loading");
  const [drafts, setDrafts] = useState<StudioDraft[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<StudioDraftStatus | null>(null);
  const [account, setAccount] = useState<AccountSession | null>(null);
  const [publisherHandle, setPublisherHandle] = useState("");
  const [keyStatus, setKeyStatus] = useState<PublisherKeyStatus | null>(null);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [newFilePending, setNewFilePending] = useState(false);
  const [newFilePath, setNewFilePath] = useState("README.md");
  const [removeArmed, setRemoveArmed] = useState(false);
  const [preview, setPreview] = useState<StudioDraftPreview | null>(null);
  const [previewTarget, setPreviewTarget] = useState("codex");
  const [validation, setValidation] =
    useState<StudioDraftValidationReport | null>(null);
  const [approval, setApproval] = useState<StudioApprovalState>(
    createStudioApprovalState,
  );
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  const [submission, setSubmission] = useState<StudioSubmission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState(
    "Creator Studio is opening.",
  );

  const activeMemberships = useMemo(
    () => account?.memberships.filter((membership) => membership.state === "active") ?? [],
    [account],
  );
  const selectedLocalKey = useMemo(
    () =>
      keyStatus?.local_keys.find(
        (key) => key.selected && key.state === "active",
      ) ?? null,
    [keyStatus],
  );
  const selectedRemoteKeys = useMemo(
    () =>
      selectedLocalKey
        ? keyStatus?.remote_keys.filter(
            (key) =>
              key.state === "active" &&
              key.public_key === selectedLocalKey.public_key,
          ) ?? []
        : [],
    [keyStatus, selectedLocalKey],
  );
  const selectedMembership = useMemo(
    () =>
      activeMemberships.find(
        (membership) => membership.handle === publisherHandle,
      ) ?? null,
    [activeMemberships, publisherHandle],
  );
  const publisherReady = Boolean(
    account?.signed_in &&
      selectedMembership &&
      selectedLocalKey &&
      selectedRemoteKeys.length === 1,
  );
  const editorDirty = newFilePending || editorContent !== savedContent;
  const previewCurrent = Boolean(
    status &&
      preview &&
      preview.revision === status.draft.revision &&
      preview.inventory_hash === status.publication.inventory_hash,
  );
  const validationCurrent = Boolean(
    status &&
      validation?.valid &&
      validation.revision === status.draft.revision &&
      validation.inventory_hash === status.publication.inventory_hash,
  );
  const canSubmit = Boolean(
    canSubmitStudioReview(status, approval) &&
      selectedMembership &&
      approval.confirmed_binding?.publisher_id ===
        selectedMembership.publisher_id &&
      approval.confirmed_binding.publisher_key_id === selectedRemoteKeys[0]?.id,
  );
  const selectedPreview =
    preview?.targets.find((target) => target.target === previewTarget) ??
    preview?.targets[0] ??
    null;
  const busy = operation !== null;

  useEffect(() => {
    let cancelled = false;

    // Load independent local drafts and redacted account state together.
    async function loadStudio() {
      try {
        const [nextDrafts, nextAccount] = await Promise.all([
          listStudioDrafts(),
          getAccountStatus(),
        ]);
        if (cancelled) return;
        setDrafts(nextDrafts);
        setAccount(nextAccount);
        setSelectedId(nextDrafts[0]?.id ?? null);
        setAnnouncement(
          nextDrafts.length
            ? `Loaded ${nextDrafts.length} Creator Studio draft${nextDrafts.length === 1 ? "" : "s"}.`
            : "Creator Studio is ready for a new local draft.",
        );
      } catch (loadError) {
        if (!cancelled) {
          setError(toErrorMessage(loadError, "Creator Studio could not open."));
        }
      } finally {
        if (!cancelled) setOperation(null);
      }
    }

    void loadStudio();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!publisherHandle && activeMemberships[0]?.handle) {
      setPublisherHandle(activeMemberships[0].handle);
    }
  }, [activeMemberships, publisherHandle]);

  useEffect(() => {
    let cancelled = false;
    if (!publisherHandle) {
      setKeyStatus(null);
      return;
    }

    // Load public and redacted local key metadata for the selected membership.
    async function loadKeys() {
      try {
        const nextStatus = await getPublisherKeyStatus(publisherHandle);
        if (!cancelled) setKeyStatus(nextStatus);
      } catch (keyError) {
        if (!cancelled) {
          setKeyStatus(null);
          setError(
            toErrorMessage(keyError, "Publisher key status could not be loaded."),
          );
        }
      }
    }

    void loadKeys();
    return () => {
      cancelled = true;
    };
  }, [publisherHandle]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedId) {
      setStatus(null);
      setActiveFilePath(null);
      setEditorContent("");
      setSavedContent("");
      setNewFilePending(false);
      return;
    }
    const draftId = selectedId;

    // Load fresh status and the first exact public file for a selected draft.
    async function loadSelectedDraft() {
      setOperation("loading");
      try {
        const nextStatus = await getStudioDraftStatus(draftId);
        if (cancelled) return;
        setStatus(nextStatus);
        const firstPath = nextStatus.publication.inventory[0]?.path ?? null;
        setActiveFilePath(firstPath);
        if (firstPath) {
          const file = await readStudioFile(draftId, firstPath);
          if (cancelled) return;
          setEditorContent(file.content);
          setSavedContent(file.content);
        } else {
          setEditorContent("");
          setSavedContent("");
        }
        setNewFilePending(false);
        setError(null);
      } catch (loadError) {
        if (!cancelled) {
          setError(toErrorMessage(loadError, "The selected draft could not be loaded."));
        }
      } finally {
        if (!cancelled) setOperation(null);
      }
    }

    void loadSelectedDraft();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Update local draft lists after any native command returns fresh status.
  function applyStatus(nextStatus: StudioDraftStatus): void {
    setStatus(nextStatus);
    setDrafts((current) => {
      const remaining = current.filter((draft) => draft.id !== nextStatus.draft.id);
      return [...remaining, nextStatus.draft].sort((left, right) =>
        left.id.localeCompare(right.id),
      );
    });
  }

  // Select a different draft without silently discarding unsaved editor text.
  function handleSelectDraft(id: string): void {
    if (busy) return;
    if (editorDirty) {
      setError("Save or discard the current file edit before changing drafts.");
      return;
    }
    setSelectedId(id);
    setPreview(null);
    setValidation(null);
    setApproval(createStudioApprovalState());
    setReviewAcknowledged(false);
    setSubmission(null);
    setError(null);
  }

  // Finish any creation method by selecting its path-free returned status.
  async function finishCreation(nextStatus: StudioDraftStatus): Promise<void> {
    applyStatus(nextStatus);
    setSelectedId(nextStatus.draft.id);
    setPreview(null);
    setValidation(null);
    setApproval(createStudioApprovalState());
    setSubmission(null);
    setAnnouncement(`Created local draft ${nextStatus.draft.title}.`);
  }

  // Create one blank or guided draft through the typed native bridge.
  async function handleCreate(
    id: string,
    title: string,
    template: StudioDraftTemplate,
  ): Promise<void> {
    setOperation("create");
    setError(null);
    try {
      await finishCreation(await createStudioDraft(id, title, template));
    } catch (createError) {
      setError(toErrorMessage(createError, "The draft could not be created."));
    } finally {
      setOperation(null);
    }
  }

  // Import a hardened public pack through a native directory picker.
  async function handleImport(id: string, title: string): Promise<void> {
    setOperation("create");
    setError(null);
    try {
      const imported = await importStudioDraft(id, title);
      if (!imported) {
        setAnnouncement("Import cancelled. No draft was created.");
        return;
      }
      await finishCreation(imported);
    } catch (importError) {
      setError(toErrorMessage(importError, "The selected pack could not be imported."));
    } finally {
      setOperation(null);
    }
  }

  // Fork one verified immutable registry version under a new identity.
  async function handleFork(
    id: string,
    title: string,
    sourceName: string,
    sourceVersion: string,
    identity: StudioForkIdentity,
  ): Promise<void> {
    setOperation("create");
    setError(null);
    try {
      await finishCreation(
        await forkStudioDraft(id, title, sourceName, sourceVersion, identity),
      );
    } catch (forkError) {
      setError(toErrorMessage(forkError, "The registry release could not be forked."));
    } finally {
      setOperation(null);
    }
  }

  // Open one exact UTF-8 public file without losing unsaved editor content.
  async function handleOpenFile(path: string): Promise<void> {
    if (busy || !selectedId || path === activeFilePath) return;
    if (editorDirty) {
      setError("Save or discard the current file edit before opening another file.");
      return;
    }
    setOperation("file");
    setError(null);
    try {
      const file = await readStudioFile(selectedId, path);
      setActiveFilePath(file.path);
      setEditorContent(file.content);
      setSavedContent(file.content);
      setNewFilePending(false);
      setRemoveArmed(false);
      setAnnouncement(`Opened ${file.path}.`);
    } catch (fileError) {
      setError(toErrorMessage(fileError, "That public file could not be opened."));
    } finally {
      setOperation(null);
    }
  }

  // Begin a new public UTF-8 file while protecting any current unsaved edit.
  function handleNewFile(): void {
    if (editorDirty) {
      setError("Save or discard the current file edit before starting another file.");
      return;
    }
    const path = newFilePath.trim();
    if (!path) {
      setError("Enter a public relative file path first.");
      return;
    }
    setActiveFilePath(path);
    setEditorContent("");
    setSavedContent("");
    setNewFilePending(true);
    setRemoveArmed(false);
    setError(null);
    setAnnouncement(`Editing new public file ${path}. Save to add it to the draft.`);
  }

  // Restore the exact native file bytes and discard only unsaved editor text.
  async function handleDiscardEdit(): Promise<void> {
    if (!selectedId || !activeFilePath) return;
    setOperation("file");
    setError(null);
    try {
      if (newFilePending) {
        const fallbackPath = status?.publication.inventory[0]?.path ?? null;
        setActiveFilePath(fallbackPath);
        if (fallbackPath) {
          const fallback = await readStudioFile(selectedId, fallbackPath);
          setEditorContent(fallback.content);
          setSavedContent(fallback.content);
        } else {
          setEditorContent("");
          setSavedContent("");
        }
        setNewFilePending(false);
        setAnnouncement("Discarded the unsaved new file.");
        return;
      }
      const file = await readStudioFile(selectedId, activeFilePath);
      setEditorContent(file.content);
      setSavedContent(file.content);
      setAnnouncement(`Discarded unsaved changes to ${activeFilePath}.`);
    } catch (discardError) {
      setError(toErrorMessage(discardError, "The saved file could not be restored."));
    } finally {
      setOperation(null);
    }
  }

  // Save one exact public file and visibly invalidate downstream evidence.
  async function handleSaveFile(): Promise<void> {
    if (!selectedId || !activeFilePath) return;
    setOperation("file");
    setError(null);
    try {
      const nextStatus = await writeStudioFile(
        selectedId,
        activeFilePath,
        editorContent,
      );
      applyStatus(nextStatus);
      setSavedContent(editorContent);
      setNewFilePending(false);
      setPreview(null);
      setValidation(null);
      setApproval((current) => invalidateStudioApproval(current));
      setReviewAcknowledged(false);
      setAnnouncement(
        `Saved ${activeFilePath}. Preview, validation, and exact review must be refreshed.`,
      );
    } catch (saveError) {
      setError(toErrorMessage(saveError, "The public file could not be saved."));
    } finally {
      setOperation(null);
    }
  }

  // Remove one explicitly armed public file and invalidate downstream evidence.
  async function handleRemoveFile(): Promise<void> {
    if (!selectedId || !activeFilePath || !removeArmed) return;
    setOperation("file");
    setError(null);
    try {
      const removedPath = activeFilePath;
      const nextStatus = await removeStudioFile(selectedId, removedPath);
      applyStatus(nextStatus);
      setPreview(null);
      setValidation(null);
      setApproval((current) => invalidateStudioApproval(current));
      setReviewAcknowledged(false);
      const nextPath = nextStatus.publication.inventory[0]?.path ?? null;
      setActiveFilePath(nextPath);
      setNewFilePending(false);
      if (nextPath) {
        const file = await readStudioFile(selectedId, nextPath);
        setEditorContent(file.content);
        setSavedContent(file.content);
      } else {
        setEditorContent("");
        setSavedContent("");
      }
      setRemoveArmed(false);
      setAnnouncement(
        `Removed ${removedPath}. All artifact-bound evidence is stale.`,
      );
    } catch (removeError) {
      setError(toErrorMessage(removeError, "The public file could not be removed."));
    } finally {
      setOperation(null);
    }
  }

  // Refresh draft state so edits made through the local MCP appear immediately.
  async function handleRefreshDraft(): Promise<void> {
    if (!selectedId || editorDirty) {
      if (editorDirty) setError("Save or discard the current edit before refreshing.");
      return;
    }
    setOperation("loading");
    setError(null);
    try {
      const nextStatus = await getStudioDraftStatus(selectedId);
      applyStatus(nextStatus);
      const stillExists = nextStatus.publication.inventory.some(
        (file) => file.path === activeFilePath,
      );
      const nextPath = stillExists
        ? activeFilePath
        : nextStatus.publication.inventory[0]?.path ?? null;
      setActiveFilePath(nextPath);
      setNewFilePending(false);
      if (nextPath) {
        const file = await readStudioFile(selectedId, nextPath);
        setEditorContent(file.content);
        setSavedContent(file.content);
      } else {
        setEditorContent("");
        setSavedContent("");
      }
      if (!nextStatus.review_current) {
        setApproval((current) => invalidateStudioApproval(current));
      }
      setPreview(null);
      setValidation(null);
      setAnnouncement("Draft refreshed. Re-run preview and validation for changed bytes.");
    } catch (refreshError) {
      setError(toErrorMessage(refreshError, "The draft could not be refreshed."));
    } finally {
      setOperation(null);
    }
  }

  // Render all agent targets from one exact current inventory.
  async function handlePreview(): Promise<void> {
    if (!selectedId || editorDirty) return;
    setOperation("preview");
    setError(null);
    try {
      const nextPreview = await previewStudioDraft(selectedId);
      setPreview(nextPreview);
      setPreviewTarget(
        nextPreview.targets.some((target) => target.target === "codex")
          ? "codex"
          : nextPreview.targets[0]?.target ?? "",
      );
      setAnnouncement(`Rendered ${nextPreview.targets.length} supported agent targets.`);
    } catch (previewError) {
      setError(toErrorMessage(previewError, "Target preview could not be rendered."));
    } finally {
      setOperation(null);
    }
  }

  // Run scanner and path-free conformance checks over current exact bytes.
  async function handleValidate(): Promise<void> {
    if (!selectedId || editorDirty) return;
    setOperation("validate");
    setError(null);
    try {
      const nextValidation = await validateStudioDraft(selectedId);
      setValidation(nextValidation);
      setAnnouncement(
        nextValidation.valid
          ? "Scanner and conformance gates passed for the current inventory."
          : "Validation found blocking issues. Review the evidence below.",
      );
    } catch (validationError) {
      setError(toErrorMessage(validationError, "Validation could not complete."));
    } finally {
      setOperation(null);
    }
  }

  // Prepare a non-mutating exact review bound to the selected publisher and key.
  async function handlePrepareReview(): Promise<void> {
    if (
      !selectedId ||
      !publisherHandle ||
      !selectedLocalKey ||
      !publisherReady ||
      !previewCurrent ||
      !validationCurrent
    ) {
      return;
    }
    setOperation("review");
    setError(null);
    try {
      const review = await prepareStudioReview(
        selectedId,
        publisherHandle,
        selectedLocalKey.id,
      );
      setApproval((current) => beginStudioReview(current, review));
      setReviewAcknowledged(false);
      setSubmission(null);
      setAnnouncement("Exact artifact review prepared. No approval was recorded yet.");
    } catch (reviewError) {
      setError(toErrorMessage(reviewError, "Exact review could not be prepared."));
    } finally {
      setOperation(null);
    }
  }

  // Persist explicit approval for only the exact review currently displayed.
  async function handleConfirmReview(): Promise<void> {
    if (!selectedId || !approval.prepared_review || !reviewAcknowledged) return;
    setOperation("confirm");
    setError(null);
    try {
      const binding = approval.prepared_review.binding;
      const nextStatus = await confirmStudioReview(selectedId, binding);
      applyStatus(nextStatus);
      setApproval((current) => confirmStudioReviewState(current, binding));
      setAnnouncement("Exact review confirmed. Submission remains a separate action.");
    } catch (confirmError) {
      setError(toErrorMessage(confirmError, "Exact review could not be confirmed."));
    } finally {
      setOperation(null);
    }
  }

  // Submit unchanged confirmed bytes with retry IDs allocated before transport.
  async function handleSubmit(): Promise<void> {
    if (
      !selectedId ||
      !publisherHandle ||
      !selectedLocalKey ||
      !approval.prepared_review ||
      !canSubmit
    ) {
      return;
    }
    const binding = approval.prepared_review.binding;
    const retryIds = submissionIdsForBinding(approval.retry_ids, binding);
    setApproval((current) => ({ ...current, retry_ids: retryIds }));
    setOperation("submit");
    setError(null);
    try {
      const nextSubmission = await submitStudioDraft(
        selectedId,
        publisherHandle,
        selectedLocalKey.id,
        binding,
        retryIds.intent_id,
        retryIds.submission_id,
      );
      setSubmission(nextSubmission);
      applyStatus(await getStudioDraftStatus(selectedId));
      setAnnouncement(
        "Artifact admitted to quarantine. It is non-public and awaiting moderation.",
      );
    } catch (submitError) {
      setError(
        toErrorMessage(
          submitError,
          `Submission was not confirmed. Retry with intent ${retryIds.intent_id} and submission ${retryIds.submission_id}.`,
        ),
      );
    } finally {
      setOperation(null);
    }
  }

  // Refresh the honest moderation state for the exact returned submission.
  async function handleRefreshSubmission(): Promise<void> {
    if (!submission) return;
    setOperation("submission-status");
    setError(null);
    try {
      const refreshed = await getStudioSubmissionStatus(submission.id);
      setSubmission(refreshed);
      setAnnouncement(`Submission state is ${refreshed.state.replace("_", " ")}.`);
    } catch (refreshError) {
      setError(
        toErrorMessage(refreshError, "Moderation state could not be refreshed."),
      );
    } finally {
      setOperation(null);
    }
  }

  return (
    <div className="studio-page">
      <header className="page-header studio-page-header">
        <div>
          <div className="page-eyebrow">Creator Studio / Local draft room</div>
          <h1 className="page-title">Make the persona. Inspect the artifact.</h1>
          <p className="page-subtitle">
            Draft locally, render every agent target, verify exact public bytes, then
            choose whether the unchanged artifact enters non-public quarantine.
          </p>
        </div>
        <div className="studio-header-meta">
          <span>{drafts.length} local draft{drafts.length === 1 ? "" : "s"}</span>
          <strong>{publisherReady ? "Publisher ready" : "Local editing ready"}</strong>
        </div>
      </header>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      {error ? (
        <div className="status-panel status-panel-error studio-error" role="alert">
          <strong>Creator Studio stopped this action.</strong>
          <span>{error}</span>
          <button className="btn" type="button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <section className="studio-publisher-strip" aria-label="Publisher readiness">
        <div>
          <span>Account</span>
          <strong>{account?.signed_in ? account.display_name ?? "Signed in" : "Signed out"}</strong>
        </div>
        <label>
          <span>Publisher</span>
          <select
            value={publisherHandle}
            onChange={(event) => setPublisherHandle(event.target.value)}
            disabled={!activeMemberships.length || busy}
          >
            {!activeMemberships.length ? <option value="">No active membership</option> : null}
            {activeMemberships.map((membership) => (
              <option key={membership.publisher_id} value={membership.handle ?? ""}>
                {membership.display_name ?? membership.handle ?? membership.publisher_id}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span>Selected signer</span>
          <strong title={selectedLocalKey?.id}>
            {selectedLocalKey ? compactValue(selectedLocalKey.id) : "No active key"}
          </strong>
        </div>
        <div className={`studio-readiness${publisherReady ? " is-ready" : ""}`}>
          <span aria-hidden="true" />
          <strong>{publisherReady ? "Review path ready" : "Publishing setup needed"}</strong>
        </div>
        {!publisherReady ? (
          <div className="studio-setup-links">
            {!account?.signed_in ? <Link href="/settings">Sign in</Link> : null}
            <Link href="/publisher">Manage publisher keys</Link>
          </div>
        ) : null}
      </section>

      <ol className="studio-runway" aria-label="Publication runway">
        <li data-state={selectedId ? "done" : "active"}>
          <span>01</span>
          <strong>Draft</strong>
          <small>{runwayState(Boolean(selectedId), !selectedId)}</small>
        </li>
        <li data-state={previewCurrent ? "done" : selectedId ? "active" : "waiting"}>
          <span>02</span>
          <strong>Preview</strong>
          <small>{runwayState(previewCurrent, Boolean(selectedId && !previewCurrent))}</small>
        </li>
        <li data-state={validationCurrent ? "done" : previewCurrent ? "active" : "waiting"}>
          <span>03</span>
          <strong>Validate</strong>
          <small>{runwayState(validationCurrent, previewCurrent && !validationCurrent)}</small>
        </li>
        <li data-state={status?.review_current ? "done" : validationCurrent ? "active" : "waiting"}>
          <span>04</span>
          <strong>Review</strong>
          <small>{runwayState(Boolean(status?.review_current), validationCurrent && !status?.review_current)}</small>
        </li>
        <li data-state={submission ? "done" : canSubmit ? "active" : "waiting"}>
          <span>05</span>
          <strong>Quarantine</strong>
          <small>{submission ? submission.state.replace("_", " ") : runwayState(false, canSubmit)}</small>
        </li>
      </ol>

      <div className="studio-layout">
        <aside className="studio-draft-rail" aria-label="Creator Studio drafts">
          <section className="studio-draft-list" aria-labelledby="studio-drafts-title">
            <div className="studio-section-heading">
              <div>
                <span className="studio-kicker">On this device</span>
                <h2 id="studio-drafts-title">Drafts</h2>
              </div>
            </div>
            {drafts.length ? (
              <div className="studio-draft-buttons">
                {drafts.map((draft) => (
                  <button
                    className={`studio-draft-button${draft.id === selectedId ? " is-selected" : ""}`}
                    type="button"
                    key={draft.id}
                    onClick={() => handleSelectDraft(draft.id)}
                    aria-current={draft.id === selectedId ? "true" : undefined}
                    disabled={busy}
                  >
                    <span>{draft.title}</span>
                    <small>
                      {draft.id} · revision {draft.revision}
                    </small>
                  </button>
                ))}
              </div>
            ) : (
              <p className="studio-empty-copy">No local drafts yet. Start with a guided template.</p>
            )}
          </section>

          <StudioCreationPanel
            busy={operation === "create"}
            disabled={busy}
            defaultAuthorHandle={publisherHandle}
            selectedKeyId={selectedLocalKey?.id ?? null}
            onCreate={handleCreate}
            onImport={handleImport}
            onFork={handleFork}
          />
        </aside>

        <div className="studio-workbench">
          {!selectedId || !status ? (
            <section className="studio-workbench-empty" aria-labelledby="studio-empty-title">
              <span className="studio-kicker">Workbench</span>
              <h2 id="studio-empty-title">A draft opens here</h2>
              <p>
                Guided creation produces a valid starting identity. Blank mode keeps
                scanner gaps visible while you shape the public files yourself.
              </p>
            </section>
          ) : (
            <>
              <section className="studio-editor" aria-labelledby="studio-editor-title">
                <div className="studio-section-heading studio-editor-heading">
                  <div>
                    <span className="studio-kicker">Revision {status.draft.revision}</span>
                    <h2 id="studio-editor-title">{status.draft.title}</h2>
                  </div>
                  <div className="studio-editor-heading-actions">
                    <span className={`studio-scan-state${status.publication.valid ? " is-valid" : ""}`}>
                      {status.publication.valid ? "Scanner clear" : "Scanner blocked"}
                    </span>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => void handleRefreshDraft()}
                      disabled={busy || editorDirty}
                    >
                      Refresh agent edits
                    </button>
                  </div>
                </div>

                <div className="studio-editor-grid">
                  <div className="studio-file-browser">
                    <div className="studio-file-browser-heading">
                      <span>Public files</span>
                      <strong>{status.publication.inventory.length}</strong>
                    </div>
                    <div className="studio-file-buttons">
                      {status.publication.inventory.map((file) => (
                        <button
                          type="button"
                          className={file.path === activeFilePath ? "is-selected" : ""}
                          key={file.path}
                          onClick={() => void handleOpenFile(file.path)}
                          aria-current={file.path === activeFilePath ? "true" : undefined}
                          disabled={busy}
                        >
                          <span>{file.path}</span>
                          <small title={file.sha256}>{compactValue(file.sha256)}</small>
                        </button>
                      ))}
                    </div>
                    <label className="studio-field studio-new-file">
                      <span>New public path</span>
                      <input
                        value={newFilePath}
                        onChange={(event) => setNewFilePath(event.target.value)}
                        autoComplete="off"
                      />
                    </label>
                    <button
                      className="btn"
                      type="button"
                      onClick={handleNewFile}
                      disabled={busy || editorDirty || !newFilePath.trim()}
                    >
                      Edit new file
                    </button>
                  </div>

                  <div className="studio-source-editor">
                    <div className="studio-source-toolbar">
                      <div>
                        <span>Raw UTF-8 source</span>
                        <strong>{activeFilePath ?? "Select a file"}</strong>
                      </div>
                      <span className={editorDirty ? "is-dirty" : ""}>
                        {editorDirty ? "Unsaved" : "Saved"}
                      </span>
                    </div>
                    <label htmlFor="studio-source-content" className="sr-only">
                      {activeFilePath ? `Source for ${activeFilePath}` : "Draft source"}
                    </label>
                    <textarea
                      id="studio-source-content"
                      className="studio-source-textarea"
                      value={editorContent}
                      onChange={(event) => setEditorContent(event.target.value)}
                      disabled={!activeFilePath || operation === "file"}
                      spellCheck={false}
                    />
                    <div className="studio-source-actions">
                      <button
                        className="btn btn-primary"
                        type="button"
                        onClick={() => void handleSaveFile()}
                        disabled={busy || !activeFilePath || !editorDirty}
                      >
                        Save exact file
                      </button>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => void handleDiscardEdit()}
                        disabled={busy || !activeFilePath || !editorDirty}
                      >
                        Discard unsaved edit
                      </button>
                      {!removeArmed ? (
                        <button
                          className="btn studio-remove-button"
                          type="button"
                          onClick={() => setRemoveArmed(true)}
                          disabled={busy || !activeFilePath || editorDirty}
                        >
                          Remove file
                        </button>
                      ) : (
                        <div className="studio-remove-confirmation" role="group" aria-label="Confirm file removal">
                          <span>
                            Remove <code>{activeFilePath}</code>?
                          </span>
                          <button
                            className="btn studio-remove-button"
                            type="button"
                            onClick={() => void handleRemoveFile()}
                            disabled={busy}
                          >
                            Confirm removal
                          </button>
                          <button className="btn" type="button" onClick={() => setRemoveArmed(false)}>
                            Keep file
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              {approval.stale ? (
                <div className="studio-stale-banner" role="status">
                  <strong>Artifact review invalidated.</strong>
                  <span>Current bytes need a new preview, validation, and exact review.</span>
                </div>
              ) : null}

              <section className="studio-evidence" aria-labelledby="studio-evidence-title">
                <div className="studio-section-heading">
                  <div>
                    <span className="studio-kicker">Render and prove</span>
                    <h2 id="studio-evidence-title">Evidence desk</h2>
                  </div>
                  <div className="studio-evidence-actions">
                    <button
                      className="btn"
                      type="button"
                      onClick={() => void handlePreview()}
                      disabled={busy || editorDirty}
                    >
                      {operation === "preview" ? "Rendering targets..." : "Preview all targets"}
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => void handleValidate()}
                      disabled={busy || editorDirty}
                    >
                      {operation === "validate" ? "Validating..." : "Run scanner + conformance"}
                    </button>
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={() => void handlePrepareReview()}
                      disabled={busy || !previewCurrent || !validationCurrent || !publisherReady}
                    >
                      {operation === "review" ? "Preparing exact bytes..." : "Prepare exact review"}
                    </button>
                  </div>
                </div>

                <div className="studio-evidence-grid">
                  <article className="studio-preview-panel">
                    <div className="studio-panel-heading">
                      <div>
                        <span>Target preview</span>
                        <strong>{previewCurrent ? `${preview?.targets.length ?? 0} current renders` : "Not current"}</strong>
                      </div>
                      {preview?.targets.length ? (
                        <label>
                          <span className="sr-only">Preview target</span>
                          <select
                            value={selectedPreview?.target ?? ""}
                            onChange={(event) => setPreviewTarget(event.target.value)}
                          >
                            {preview.targets.map((target) => (
                              <option value={target.target} key={target.target}>
                                {target.target} · {target.install_filename}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </div>
                    {selectedPreview ? (
                      <>
                        <code className="studio-preview-hash" title={selectedPreview.sha256}>
                          SHA-256 {selectedPreview.sha256}
                        </code>
                        <pre tabIndex={0}>{selectedPreview.content}</pre>
                      </>
                    ) : (
                      <p>Render previews to inspect every supported agent target here.</p>
                    )}
                  </article>

                  <article className="studio-validation-panel">
                    <div className="studio-panel-heading">
                      <div>
                        <span>Validation</span>
                        <strong>
                          {validationCurrent
                            ? "Current pass"
                            : validation
                              ? "Stale or blocked"
                              : "Not run"}
                        </strong>
                      </div>
                      {validation ? (
                        <span className={`studio-validation-mark${validation.valid ? " is-valid" : ""}`}>
                          {validation.valid ? "Pass" : "Blocked"}
                        </span>
                      ) : null}
                    </div>
                    {validation ? (
                      <>
                        <dl className="studio-validation-summary">
                          <div>
                            <dt>Scanner</dt>
                            <dd>{validation.publication.valid ? "pass" : "blocked"}</dd>
                          </div>
                          <div>
                            <dt>Conformance</dt>
                            <dd>{validation.conformance.status.replace("_", " ")}</dd>
                          </div>
                          <div>
                            <dt>Threshold</dt>
                            <dd>{Math.round(validation.conformance.threshold * 100)}%</dd>
                          </div>
                          <div>
                            <dt>Score</dt>
                            <dd>
                              {validation.conformance.score === null
                                ? "Not applicable"
                                : `${Math.round(validation.conformance.score * 100)}%`}
                            </dd>
                          </div>
                        </dl>
                        <StudioFindingList
                          findings={[
                            ...validation.publication.findings.map((finding) => ({
                              ...finding,
                              location: finding.path,
                            })),
                            ...validation.conformance.findings.map((finding) => ({
                              ...finding,
                              location: finding.test_id,
                            })),
                          ]}
                        />
                      </>
                    ) : (
                      <p>Run scanner and conformance to produce path-free release evidence.</p>
                    )}
                  </article>
                </div>
              </section>

              <StudioReviewPanel
                approval={approval}
                status={status}
                acknowledged={reviewAcknowledged}
                busy={busy}
                canSubmit={canSubmit}
                submission={submission}
                onAcknowledgedChange={setReviewAcknowledged}
                onConfirm={handleConfirmReview}
                onSubmit={handleSubmit}
                onRefreshSubmission={handleRefreshSubmission}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
