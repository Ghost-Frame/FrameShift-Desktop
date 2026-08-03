"use client";

// Presents exact publication evidence and keeps review separate from submission.

import type {
  StudioApprovalState,
} from "@/lib/studio-state";
import type {
  StudioDraftStatus,
  StudioSubmission,
} from "@/lib/tauri";

// Review and quarantine actions controlled by the Studio route.
interface StudioReviewPanelProps {
  approval: StudioApprovalState;
  status: StudioDraftStatus;
  acknowledged: boolean;
  busy: boolean;
  canSubmit: boolean;
  submission: StudioSubmission | null;
  onAcknowledgedChange: (checked: boolean) => void;
  onConfirm: () => Promise<void>;
  onSubmit: () => Promise<void>;
  onRefreshSubmission: () => Promise<void>;
}

// Convert a moderation state into an honest sentence about public visibility.
function submissionStateCopy(state: StudioSubmission["state"]): string {
  switch (state) {
    case "quarantined":
      return "Isolated in quarantine. It is not public and awaits moderation.";
    case "needs_review":
      return "Still non-public. A moderator requested follow-up.";
    case "approved":
      return "Approved, but not public until a separate promotion step completes.";
    case "promoted":
      return "Promoted into the public catalog.";
    case "rejected":
      return "Rejected and retained as non-public audit evidence.";
    case "withdrawn":
      return "Withdrawn from review and still non-public.";
  }
}

// Render the exact-file review, confirmation, and quarantine runway.
export function StudioReviewPanel({
  approval,
  status,
  acknowledged,
  busy,
  canSubmit,
  submission,
  onAcknowledgedChange,
  onConfirm,
  onSubmit,
  onRefreshSubmission,
}: StudioReviewPanelProps) {
  const review = approval.prepared_review;
  if (!review) {
    return (
      <section className="studio-review-empty" aria-labelledby="studio-review-title">
        <span className="studio-kicker">Exact review</span>
        <h2 id="studio-review-title">Nothing is approved by implication</h2>
        <p>
          Prepare review only after scanner and conformance evidence look right. The
          next screen binds every public byte to one publisher and one active key.
        </p>
        {approval.stale ? (
          <div className="studio-stale-callout" role="status">
            The draft changed. Its previous review and retry identifiers were cleared.
          </div>
        ) : null}
      </section>
    );
  }

  const manifest = review.manifest;
  const capability = manifest.capability_manifest;
  const confirmed = Boolean(approval.confirmed_binding && status.review_current);

  return (
    <section className="studio-review" aria-labelledby="studio-review-title">
      <div className="studio-section-heading">
        <div>
          <span className="studio-kicker">Exact review</span>
          <h2 id="studio-review-title">Read the bytes that will be signed</h2>
        </div>
        <span className={`studio-review-state${confirmed ? " is-current" : ""}`}>
          {confirmed ? "Confirmed current" : "Awaiting confirmation"}
        </span>
      </div>

      {!status.review_current && approval.confirmed_binding ? (
        <div className="studio-stale-callout" role="alert">
          This review is stale. Prepare a new exact artifact before submission.
        </div>
      ) : null}

      <div className="studio-review-manifest">
        <div className="studio-review-identity">
          <span>Release identity</span>
          <h3>{manifest.name}</h3>
          <p>
            <strong>{manifest.version}</strong>
            <span>{manifest.license ?? "No license declared"}</span>
            <span>@{manifest.author_handle}</span>
          </p>
        </div>
        <dl className="studio-binding-grid">
          <div>
            <dt>Artifact SHA-256</dt>
            <dd>{review.binding.artifact.archive_hash}</dd>
          </div>
          <div>
            <dt>Manifest SHA-256</dt>
            <dd>{review.binding.artifact.manifest_hash}</dd>
          </div>
          <div>
            <dt>Publisher ID</dt>
            <dd>{review.binding.publisher_id}</dd>
          </div>
          <div>
            <dt>Publisher key ID</dt>
            <dd>{review.binding.publisher_key_id}</dd>
          </div>
          <div>
            <dt>Manifest author key</dt>
            <dd>{manifest.author_pubkey}</dd>
          </div>
        </dl>
      </div>

      <div className="studio-review-grid">
        <div>
          <h3>Public file inventory</h3>
          <div className="studio-file-table" role="table" aria-label="Exact public files">
            <div className="studio-file-row studio-file-row-head" role="row">
              <span role="columnheader">File</span>
              <span role="columnheader">Bytes</span>
              <span role="columnheader">SHA-256</span>
            </div>
            {review.publication.inventory.map((file) => (
              <div className="studio-file-row" role="row" key={file.path}>
                <code role="cell">{file.path}</code>
                <span role="cell">{file.size.toLocaleString()}</span>
                <code role="cell">{file.sha256}</code>
              </div>
            ))}
          </div>
        </div>

        <div className="studio-capability-review">
          <h3>Declared capabilities</h3>
          {capability ? (
            <dl>
              <div>
                <dt>Filesystem</dt>
                <dd>{capability.filesystem_scope}</dd>
              </div>
              <div>
                <dt>Network egress</dt>
                <dd>{capability.network_egress ? "Required" : "Not requested"}</dd>
              </div>
              <div>
                <dt>Tools</dt>
                <dd>{capability.required_tools.join(", ") || "None"}</dd>
              </div>
              <div>
                <dt>Environment variables</dt>
                <dd>{capability.env_vars_read.join(", ") || "None"}</dd>
              </div>
              <div>
                <dt>Memory</dt>
                <dd>{capability.memory_required}</dd>
              </div>
            </dl>
          ) : (
            <p>No capability manifest is declared.</p>
          )}
          <h3>Review warnings</h3>
          {review.publication.findings.length ? (
            <ul className="studio-findings">
              {review.publication.findings.map((finding) => (
                <li data-severity={finding.severity} key={`${finding.code}:${finding.path ?? ""}`}>
                  <strong>{finding.code}</strong>
                  <span>{finding.message}</span>
                  {finding.path ? <code>{finding.path}</code> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="studio-clear-result">No scanner warnings or errors.</p>
          )}
        </div>
      </div>

      <div className="studio-confirmation">
        <label className="studio-check studio-review-check">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => onAcknowledgedChange(event.target.checked)}
            disabled={busy || confirmed}
          />
          <span>
            <strong>I reviewed this exact file list and artifact hash.</strong>
            <small>Any subsequent edit invalidates this confirmation.</small>
          </span>
        </label>
        <button
          className="btn"
          type="button"
          onClick={() => void onConfirm()}
          disabled={busy || !acknowledged || confirmed}
        >
          {confirmed ? "Exact review confirmed" : "Confirm exact review"}
        </button>
      </div>

      <div className="studio-quarantine-action">
        <div>
          <span className="studio-kicker">Separate publish action</span>
          <h3>Send unchanged bytes to quarantine</h3>
          <p>
            Submission does not publish immediately. It creates a non-public moderation
            record using stable retry identifiers.
          </p>
        </div>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => void onSubmit()}
          disabled={busy || !canSubmit}
        >
          Submit unchanged artifact to quarantine
        </button>
      </div>

      {approval.retry_ids ? (
        <dl className="studio-retry-ids" aria-label="Stable submission retry identifiers">
          <div>
            <dt>Intent retry ID</dt>
            <dd>{approval.retry_ids.intent_id}</dd>
          </div>
          <div>
            <dt>Submission retry ID</dt>
            <dd>{approval.retry_ids.submission_id}</dd>
          </div>
        </dl>
      ) : null}

      {submission ? (
        <article className="studio-submission" aria-labelledby="studio-submission-title">
          <div>
            <span className="studio-kicker">Moderation state</span>
            <h3 id="studio-submission-title">{submission.state.replace("_", " ")}</h3>
            <p>{submissionStateCopy(submission.state)}</p>
          </div>
          <dl>
            <div>
              <dt>Submission ID</dt>
              <dd>{submission.id}</dd>
            </div>
            <div>
              <dt>Last checked</dt>
              <dd>{new Date(submission.updated_at).toLocaleString()}</dd>
            </div>
          </dl>
          <button
            className="btn"
            type="button"
            onClick={() => void onRefreshSubmission()}
            disabled={busy}
          >
            Refresh moderation state
          </button>
        </article>
      ) : null}
    </section>
  );
}
