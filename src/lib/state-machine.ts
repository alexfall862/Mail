/**
 * Pure state machine for the review pipeline — SPEC.md §5, implemented with
 * no I/O. The server enforces this as a whitelist: callers load the project
 * row (with SELECT … FOR UPDATE), call `transition`, and only persist when
 * the result is ok. The UI merely reflects what this module allows.
 */

export const PROJECT_STATUSES = [
  "submitted",
  "content_review",
  "campaign_review",
  "legal_review",
  "final_review",
  "changes_requested",
  "approved",
  "denied",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const REVIEW_STAGES = [
  "content_review",
  "campaign_review",
  "legal_review",
  "final_review",
] as const;
export type ReviewStage = (typeof REVIEW_STAGES)[number];

export const REVIEW_DECISIONS = [
  "advanced",
  "changes_requested",
  "denied",
] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export function isReviewStage(status: ProjectStatus): status is ReviewStage {
  return (REVIEW_STAGES as readonly ProjectStatus[]).includes(status);
}

/** Human-readable labels, shared by UI and error messages. */
export const STATUS_LABELS: Record<ProjectStatus, string> = {
  submitted: "Received",
  content_review: "Content Review",
  campaign_review: "Campaign Review",
  legal_review: "Legal Review",
  final_review: "Final Review",
  changes_requested: "Changes Requested",
  approved: "Approved",
  denied: "Denied",
};

/** Status a project row is created with (§5 row 1). */
export const CREATED_STATUS: ProjectStatus = "submitted";
/** Row 2: creation auto-advances here in the same transaction. */
export const POST_CREATION_STATUS: ProjectStatus = "content_review";

/** Where an `advanced` decision at each stage leads (§5 rows 3–5, amended
 * 2026-08-14 to insert campaign_review after content_review). */
const ADVANCE_TARGET: Record<ReviewStage, ProjectStatus> = {
  content_review: "campaign_review",
  campaign_review: "legal_review",
  legal_review: "final_review",
  final_review: "approved",
};

/** The slice of a project row the state machine reasons about. */
export type ProjectState = {
  status: ProjectStatus;
  /** Non-null only while status = 'changes_requested'. */
  changesRequestedFrom: ProjectStatus | null;
};

export type TransitionInput =
  /** Row 2 — automatic, same transaction as creation. Actor: system. */
  | { kind: "system_advance_after_creation" }
  /** Rows 3–6, 8 — admin review decision at the project's current stage. */
  | { kind: "review_decision"; stage: ReviewStage; decision: ReviewDecision }
  /** Row 7 — vendor resubmits via magic link; routing rule applies. */
  | { kind: "vendor_resubmit"; artworkChanged: boolean }
  /** Admin override: resume review at the kicking stage without a
   * resubmission (e.g. the "requested change" was a misunderstanding).
   * No emails; same version. */
  | { kind: "admin_resume_review" }
  /** Row 10 — superuser reopen with required reason. */
  | { kind: "superuser_reopen"; actorIsSuperuser: boolean; reason: string };

export type TransitionErrorCode =
  | "invalid_transition" // the whitelist does not allow this move from the current status
  | "invalid_state" // stored state violates an invariant (e.g. changes_requested_from missing)
  | "not_superuser"
  | "reason_required";

export type TransitionResult =
  | { ok: true; state: ProjectState }
  | { ok: false; code: TransitionErrorCode; message: string };

function ok(state: ProjectState): TransitionResult {
  return { ok: true, state };
}

function err(code: TransitionErrorCode, message: string): TransitionResult {
  return { ok: false, code, message };
}

/** The clean loser-of-a-concurrent-click error (§5 guardrails). */
function alreadyMoved(current: ProjectStatus): TransitionResult {
  return err(
    "invalid_transition",
    `This project has already moved to ${STATUS_LABELS[current]}.`,
  );
}

/**
 * Apply one §5 transition to a project state. Pure: returns the next state or
 * a typed error; never mutates its input, never touches the database.
 *
 * The one-decision-per-stage-per-version rule follows from this machine (a
 * decision moves status off the stage, so a second decision at that stage is
 * rejected as "already moved") and is additionally backstopped by the
 * `unique (version_id, stage)` constraint on stage_reviews.
 */
export function transition(
  current: ProjectState,
  input: TransitionInput,
): TransitionResult {
  switch (input.kind) {
    case "system_advance_after_creation": {
      if (current.status !== "submitted") return alreadyMoved(current.status);
      return ok({ status: POST_CREATION_STATUS, changesRequestedFrom: null });
    }

    case "review_decision": {
      // Admin review actions are only valid for the project's current stage.
      if (current.status !== input.stage) return alreadyMoved(current.status);
      switch (input.decision) {
        case "advanced":
          return ok({
            status: ADVANCE_TARGET[input.stage],
            changesRequestedFrom: null,
          });
        case "changes_requested":
          return ok({
            status: "changes_requested",
            changesRequestedFrom: input.stage,
          });
        case "denied":
          return ok({ status: "denied", changesRequestedFrom: null });
      }
      // Exhaustive over ReviewDecision; unreachable.
      return err("invalid_transition", "Unknown review decision.");
    }

    case "vendor_resubmit": {
      // Vendors can only act while status = 'changes_requested'.
      if (current.status !== "changes_requested") {
        return alreadyMoved(current.status);
      }
      const from = current.changesRequestedFrom;
      if (from === null || !isReviewStage(from)) {
        return err(
          "invalid_state",
          "Project is awaiting changes but has no valid originating stage recorded.",
        );
      }
      // Routing rule (§5, transition 7): any artwork change restarts content
      // review (content approval is stale); otherwise return to the stage
      // that requested changes.
      return ok({
        status: input.artworkChanged ? "content_review" : from,
        changesRequestedFrom: null,
      });
    }

    case "admin_resume_review": {
      if (current.status !== "changes_requested") {
        return alreadyMoved(current.status);
      }
      const stage = current.changesRequestedFrom;
      if (stage === null || !isReviewStage(stage)) {
        return err(
          "invalid_state",
          "Project is awaiting changes but has no valid originating stage recorded.",
        );
      }
      return ok({ status: stage, changesRequestedFrom: null });
    }

    case "superuser_reopen": {
      if (!input.actorIsSuperuser) {
        return err("not_superuser", "Only a superuser can reopen a project.");
      }
      if (input.reason.trim() === "") {
        return err("reason_required", "A reason is required to reopen.");
      }
      if (current.status !== "approved" && current.status !== "denied") {
        return err(
          "invalid_transition",
          `Only approved or denied projects can be reopened (this one is ${STATUS_LABELS[current.status]}).`,
        );
      }
      return ok({ status: "final_review", changesRequestedFrom: null });
    }
  }
}
