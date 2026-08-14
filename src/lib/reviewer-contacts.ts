/**
 * Standing reviewer contacts per stage (compliance, legal counsel, etc.),
 * used for the manually-triggered "notify reviewers" email on the admin
 * ticket. Cycle-scoped data KDP edits directly (like the stage checklists
 * and the campaign roster) — no migration, just update and redeploy.
 *
 * Any stage listed here with at least one contact gets the notify button on
 * tickets sitting at that stage.
 */
import type { ReviewStage } from "./state-machine";

export type ReviewerContact = {
  name: string;
  email: string;
  /** Shown next to the contact, e.g. "Compliance" or "Outside counsel". */
  note?: string;
};

export const STAGE_REVIEWER_CONTACTS: Partial<
  Record<ReviewStage, ReviewerContact[]>
> = {
  legal_review: [
    // 2026 cycle. Examples of the shape — replace with the real contacts:
    // { name: "Pat Counsel", email: "pat@lawfirm.example", note: "Outside counsel" },
    // { name: "Riley Rules", email: "riley@kansasdems.org", note: "Compliance" },
  ],
  // Other stages take entries too, e.g.:
  // final_review: [{ name: "...", email: "...", note: "Compliance" }],
};

/** Contacts for a stage, deduplicated (tolerates hand-edited duplicates). */
export function reviewerContactsFor(stage: string): ReviewerContact[] {
  const list = STAGE_REVIEWER_CONTACTS[stage as ReviewStage] ?? [];
  const seen = new Set<string>();
  return list.filter((c) => {
    const key = c.email.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
