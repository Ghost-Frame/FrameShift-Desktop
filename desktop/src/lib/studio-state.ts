// Pure Creator Studio workflow guards keep exact review and retry state honest.

import type {
  StudioDraftReviewReport,
  StudioDraftStatus,
  StudioPublicationReviewBinding,
} from "./tauri";

// Stable caller-generated identifiers retained across ambiguous transport retries.
export type StudioSubmissionRetryIds = {
  binding_key: string;
  intent_id: string;
  submission_id: string;
};

// WebView-only approval state layered over the authoritative native draft status.
export type StudioApprovalState = {
  prepared_review: StudioDraftReviewReport | null;
  confirmed_binding: StudioPublicationReviewBinding | null;
  retry_ids: StudioSubmissionRetryIds | null;
  stale: boolean;
};

// Create the neutral workflow state used before an exact review is prepared.
export function createStudioApprovalState(): StudioApprovalState {
  return {
    prepared_review: null,
    confirmed_binding: null,
    retry_ids: null,
    stale: false,
  };
}

// Serialize the public binding fields that identify one immutable artifact.
export function studioBindingKey(
  binding: StudioPublicationReviewBinding,
): string {
  return [
    binding.artifact.archive_hash,
    binding.artifact.manifest_hash,
    binding.artifact.file_inventory_hash,
    binding.artifact.scan_schema_version,
    binding.publisher_id,
    binding.publisher_key_id,
  ].join(":");
}

// Compare two bindings without relying on object identity.
export function studioBindingsMatch(
  left: StudioPublicationReviewBinding | null,
  right: StudioPublicationReviewBinding | null,
): boolean {
  return Boolean(
    left && right && studioBindingKey(left) === studioBindingKey(right),
  );
}

// Stage a freshly prepared review while requiring a separate confirmation action.
export function beginStudioReview(
  current: StudioApprovalState,
  review: StudioDraftReviewReport,
): StudioApprovalState {
  void current;
  return {
    prepared_review: review,
    confirmed_binding: null,
    retry_ids: null,
    stale: false,
  };
}

// Record that the user confirmed the exact binding currently displayed.
export function confirmStudioReviewState(
  current: StudioApprovalState,
  binding: StudioPublicationReviewBinding,
): StudioApprovalState {
  if (!studioBindingsMatch(current.prepared_review?.binding ?? null, binding)) {
    throw new Error("The confirmation does not match the prepared review.");
  }
  return {
    ...current,
    confirmed_binding: binding,
    retry_ids: null,
    stale: false,
  };
}

// Clear every artifact-bound approval after public draft bytes change.
export function invalidateStudioApproval(
  current: StudioApprovalState,
): StudioApprovalState {
  const hadApproval = Boolean(
    current.prepared_review || current.confirmed_binding || current.retry_ids,
  );
  return {
    prepared_review: null,
    confirmed_binding: null,
    retry_ids: null,
    stale: current.stale || hadApproval,
  };
}

// Require both native freshness and the exact locally confirmed review.
export function canSubmitStudioReview(
  status: StudioDraftStatus | null,
  approval: StudioApprovalState,
): boolean {
  return Boolean(
    status?.review_current &&
      approval.prepared_review &&
      studioBindingsMatch(
        status.draft.review?.binding ?? null,
        approval.confirmed_binding,
      ) &&
      studioBindingsMatch(
        approval.prepared_review.binding,
        approval.confirmed_binding,
      ),
  );
}

// Reuse retry identifiers for the same binding or generate a fresh pair.
export function submissionIdsForBinding(
  current: StudioSubmissionRetryIds | null,
  binding: StudioPublicationReviewBinding,
  createId: () => string = () => crypto.randomUUID(),
): StudioSubmissionRetryIds {
  const bindingKey = studioBindingKey(binding);
  if (current?.binding_key === bindingKey) {
    return current;
  }
  return {
    binding_key: bindingKey,
    intent_id: createId(),
    submission_id: createId(),
  };
}
