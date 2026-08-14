/**
 * Known campaign review contacts by race, used to prepopulate the campaign
 * contact card on the admin project page. This is cycle-scoped data KDP
 * edits directly (like the stage checklists) roughly once a year — no
 * migration needed, just update this list and redeploy.
 *
 * Matching: `office` is required; `district` (when present) must match the
 * project's District field case-insensitively — omit it for statewide races
 * or "any district of this office" defaults.
 */
import type { Office } from "./schemas/project";

export type KnownCampaignContact = {
  office: Office;
  /** Optional exact district match (case-insensitive), e.g. "42" or "Sedgwick". */
  district?: string;
  name: string;
  email: string;
  phone?: string;
  /** Shown next to the suggestion, e.g. "Campaign manager, 2026 cycle". */
  note?: string;
};

export const KNOWN_CAMPAIGN_CONTACTS: KnownCampaignContact[] = [
  // 2026 cycle. Examples of the shape — replace with the real roster:
  { office: "us_senate", name: "Jane Smith", email: "jane@example.org", note: "Campaign manager" },
  { office: "attorney_general", name: "Jane Smith", email: "jane@example.org", note: "Campaign manager" },
  { office: "us_senate", name: "Jane Smith", email: "jane@example.org", note: "Campaign manager" },
  { office: "us_senate", name: "Jane Smith", email: "jane@example.org", note: "Campaign manager" },
  { office: "us_senate", name: "Jane Smith", email: "jane@example.org", note: "Campaign manager" },
  { office: "us_senate", name: "Jane Smith", email: "jane@example.org", note: "Campaign manager" },
  { office: "us_senate", name: "Jane Smith", email: "jane@example.org", note: "Campaign manager" },

];

export function suggestedContactsFor(
  office: string,
  districtDetail: string | null,
): KnownCampaignContact[] {
  const district = districtDetail?.trim().toLowerCase() ?? "";
  const matches = KNOWN_CAMPAIGN_CONTACTS.filter((entry) => {
    if (entry.office !== office) return false;
    if (entry.district === undefined) return true;
    return entry.district.trim().toLowerCase() === district;
  });
  // Tolerate duplicate rows in the hand-edited roster.
  const seen = new Set<string>();
  return matches.filter((entry) => {
    const key = `${entry.name}|${entry.email}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
