// Verifies Creator Studio approval invalidation and idempotent retry identifiers.

import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  StudioDraftReviewReport,
  StudioDraftStatus,
  StudioPublicationReviewBinding,
} from "./tauri";
import {
  beginStudioReview,
  canSubmitStudioReview,
  confirmStudioReviewState,
  createStudioApprovalState,
  invalidateStudioApproval,
  submissionIdsForBinding,
} from "./studio-state";

// Creates one exact publication binding for workflow unit tests.
function binding(archiveHash = "a".repeat(64)): StudioPublicationReviewBinding {
  return {
    artifact: {
      archive_hash: archiveHash,
      manifest_hash: "b".repeat(64),
      file_inventory_hash: "c".repeat(64),
      scan_schema_version: 1,
    },
    publisher_id: "00000000-0000-4000-8000-000000000001",
    publisher_key_id: "00000000-0000-4000-8000-000000000002",
  };
}

// Creates the smallest complete exact review used by workflow tests.
function review(
  exactBinding: StudioPublicationReviewBinding,
): StudioDraftReviewReport {
  return {
    revision: 3,
    publication: {
      schema_version: 1,
      valid: true,
      inventory_hash: exactBinding.artifact.file_inventory_hash,
      inventory: [],
      findings: [],
    },
    manifest: {
      schema_version: 1,
      name: "studio-fixture",
      author_handle: "preview-creator",
      author_pubkey: "d".repeat(64),
      version: "1.0.0",
      parent_hash: null,
      license: "MIT",
      forkable: true,
      forked_from: null,
      capability_manifest: null,
      requires: null,
      tokens_required: null,
      extends: null,
      mixin: [],
      conformance_baseline: null,
      description: "A deterministic Studio fixture.",
      tags: [],
    },
    binding: exactBinding,
  };
}

// Creates a current or stale draft status around one exact binding.
function status(
  exactBinding: StudioPublicationReviewBinding,
  reviewCurrent: boolean,
): StudioDraftStatus {
  return {
    draft: {
      schema_version: 1,
      id: "studio-fixture",
      title: "Studio fixture",
      revision: 3,
      review: reviewCurrent
        ? {
            revision: 3,
            inventory_hash: exactBinding.artifact.file_inventory_hash,
            binding: exactBinding,
          }
        : null,
      submission_intent: null,
    },
    publication: {
      schema_version: 1,
      valid: true,
      inventory_hash: exactBinding.artifact.file_inventory_hash,
      inventory: [],
      findings: [],
    },
    review_current: reviewCurrent,
    submission_intent_current: false,
  };
}

// A content mutation clears every exact approval and blocks submission.
test("invalidates review confirmation and retry IDs after a mutation", () => {
  const exactBinding = binding();
  const prepared = review(exactBinding);
  const staged = beginStudioReview(createStudioApprovalState(), prepared);
  const confirmed = confirmStudioReviewState(staged, exactBinding);
  const withRetry = {
    ...confirmed,
    retry_ids: submissionIdsForBinding(null, exactBinding, () =>
      "00000000-0000-4000-8000-000000000010",
    ),
  };

  assert.equal(canSubmitStudioReview(status(exactBinding, true), withRetry), true);
  const invalidated = invalidateStudioApproval(withRetry);
  assert.equal(invalidated.prepared_review, null);
  assert.equal(invalidated.confirmed_binding, null);
  assert.equal(invalidated.retry_ids, null);
  assert.equal(invalidated.stale, true);
  assert.equal(canSubmitStudioReview(status(exactBinding, false), invalidated), false);
});

// Retries reuse both caller-generated IDs until the exact binding changes.
test("retains retry IDs for one binding and rotates them for new bytes", () => {
  let sequence = 0;
  const createId = () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
  };
  const firstBinding = binding();
  const first = submissionIdsForBinding(null, firstBinding, createId);
  const retry = submissionIdsForBinding(first, firstBinding, createId);

  assert.deepEqual(retry, first);
  assert.equal(sequence, 2);

  const changed = submissionIdsForBinding(
    first,
    binding("e".repeat(64)),
    createId,
  );
  assert.notEqual(changed.intent_id, first.intent_id);
  assert.notEqual(changed.submission_id, first.submission_id);
  assert.equal(sequence, 4);
});

// A different native current review cannot authorize a stale local confirmation.
test("requires the authoritative native review to match local confirmation", () => {
  const localBinding = binding();
  const nativeBinding = binding("e".repeat(64));
  const confirmed = confirmStudioReviewState(
    beginStudioReview(createStudioApprovalState(), review(localBinding)),
    localBinding,
  );
  const nativeStatus = status(nativeBinding, true);

  assert.equal(canSubmitStudioReview(nativeStatus, confirmed), false);
});
