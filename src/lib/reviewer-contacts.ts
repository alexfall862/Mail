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
     { name: "Neil Reiff ", email: "reiff@sandlerreiff.com", note: "Legal" },
    // { name: "Riley Rules", email: "riley@kansasdems.org", note: "Compliance" },
  ],
  content_review: [
    // 2026 cycle. Examples of the shape — replace with the real contacts:
    { name: "Blair Schuman", email: "blair@rogerthatcompliance.com", note: "Compliance" },
    { name: "Chair Jeanna Repass", email: "jeanna@kansasdems.org", note: "Party" },
    { name: "Matthew Brown", email: "matthew@kansasdems.org", note: "Compliance" },
    { name: "Alex Fall", email: "alex@kansasdems.org", note: "Compliance" },
  ]
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

export type ReviewerContactWithStages = ReviewerContact & {
  stages: ReviewStage[];
};

/**
 * Every configured reviewer across all stages, deduplicated by email, with
 * the stages each is configured for. The notice tool offers all of them at
 * any stage, nobody pre-checked (the stages render as badges).
 */
export function allReviewerContacts(
  table: Partial<Record<ReviewStage, ReviewerContact[]>> = STAGE_REVIEWER_CONTACTS,
): ReviewerContactWithStages[] {
  const byEmail = new Map<string, ReviewerContactWithStages>();
  for (const [stage, list] of Object.entries(table) as Array<
    [ReviewStage, ReviewerContact[] | undefined]
  >) {
    for (const contact of list ?? []) {
      const key = contact.email.trim().toLowerCase();
      const existing = byEmail.get(key);
      if (existing) {
        if (!existing.stages.includes(stage)) existing.stages.push(stage);
      } else {
        byEmail.set(key, { ...contact, stages: [stage] });
      }
    }
  }
  return [...byEmail.values()];
}
