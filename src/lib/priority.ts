/**
 * Dashboard priority (post-spec amendment, 2026-08-17): active tickets are
 * ranked by schedule slack — the days until the mail date minus the time the
 * remaining review stages are expected to take. A piece early in the pipeline
 * with a near mail date outranks a piece late in the pipeline with the same
 * date. Pure date math, no I/O.
 */
import type { ProjectStatus } from "./state-machine";

/** Planning assumption: how long one review stage typically takes. */
export const DAYS_PER_STAGE = 2;

/** §8 rule: a mail date this close always shows red, whatever the stage. */
export const URGENT_DAYS = 10;

/**
 * Review stages left before "approved". changes_requested counts the stage
 * that kicked it back plus one for the vendor's resubmission round-trip
 * (and an artwork change would restart content review anyway — this is a
 * planning heuristic, not the state machine).
 */
export function stagesRemaining(
  status: ProjectStatus,
  changesRequestedFrom: ProjectStatus | null,
): number {
  switch (status) {
    case "submitted":
    case "content_review":
      return 4;
    case "campaign_review":
      return 3;
    case "legal_review":
      return 2;
    case "final_review":
      return 1;
    case "changes_requested":
      return (
        stagesRemaining(changesRequestedFrom ?? "content_review", null) + 1
      );
    case "approved":
    case "denied":
      return 0;
  }
}

/** Whole days from today (local) until a yyyy-mm-dd mail date; negative = past. */
export function daysUntil(mailDate: string, now: Date = new Date()): number {
  const [y, m, d] = mailDate.split("-").map(Number);
  const due = new Date(y!, m! - 1, d!);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Days of breathing room: time until mail minus expected time in review.
 * Negative means the schedule no longer fits the remaining stages.
 */
export function scheduleSlack(
  status: ProjectStatus,
  changesRequestedFrom: ProjectStatus | null,
  mailDate: string,
  now: Date = new Date(),
): number {
  return (
    daysUntil(mailDate, now) -
    DAYS_PER_STAGE * stagesRemaining(status, changesRequestedFrom)
  );
}

export type UrgencyTier = "red" | "amber" | "none";

/** Red: mail date ≤ 10 days out (§8) or the schedule no longer fits.
 * Amber: fits, but with little room to spare. */
export function urgencyTier(daysLeft: number, slack: number): UrgencyTier {
  if (daysLeft <= URGENT_DAYS || slack < 0) return "red";
  if (slack <= 4) return "amber";
  return "none";
}
