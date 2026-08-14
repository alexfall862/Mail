/**
 * Stage review checklists (SPEC §8). Checkboxes are advisory — not required
 * to advance — but are stored with each decision. Keys live here, in one
 * config file, so KDP can adjust them between cycles without a migration.
 */
import type { ReviewStage } from "./state-machine";

export const STAGE_CHECKLISTS: Record<
  ReviewStage,
  Array<{ key: string; label: string }>
> = {
  content_review: [
    { key: "disclaimer_present", label: '"Paid for by" disclaimer correct' },
    { key: "union_bug", label: "Union bug present" },
    { key: "candidate_info_accurate", label: "Candidate information accurate" },
    { key: "imagery_appropriate", label: "Imagery appropriate" },
  ],
  campaign_review: [
    { key: "campaign_signoff", label: "Campaign has signed off on the piece" },
    { key: "contact_confirmed", label: "Campaign contact reached and confirmed" },
    { key: "messaging_accurate", label: "Messaging matches campaign guidance" },
  ],
  legal_review: [
    { key: "disclaimer_compliant", label: "Disclaimer legally compliant" },
    { key: "permit_indicia_correct", label: "Permit / indicia correct" },
    { key: "funding_source_ok", label: "Funding source OK" },
  ],
  final_review: [
    { key: "mail_date_feasible", label: "Mail date feasible" },
    { key: "costs_match_invoice", label: "Costs match invoice" },
    { key: "final_artwork_confirmed", label: "Final artwork confirmed" },
  ],
};
