/** Dashboard priority math (post-spec amendment 2026-08-17). */
import { describe, expect, it } from "vitest";
import {
  DAYS_PER_STAGE,
  daysUntil,
  scheduleSlack,
  stagesRemaining,
  urgencyTier,
} from "@/lib/priority";
import { PROJECT_STATUSES, REVIEW_STAGES } from "@/lib/state-machine";

const NOW = new Date(2026, 7, 17); // Aug 17, 2026 (local)

describe("stagesRemaining", () => {
  it("counts down through the pipeline", () => {
    expect(stagesRemaining("submitted", null)).toBe(4);
    expect(stagesRemaining("content_review", null)).toBe(4);
    expect(stagesRemaining("campaign_review", null)).toBe(3);
    expect(stagesRemaining("legal_review", null)).toBe(2);
    expect(stagesRemaining("final_review", null)).toBe(1);
    expect(stagesRemaining("approved", null)).toBe(0);
    expect(stagesRemaining("denied", null)).toBe(0);
  });

  it("changes_requested adds one round-trip to the kicking stage's count", () => {
    for (const from of REVIEW_STAGES) {
      expect(stagesRemaining("changes_requested", from)).toBe(
        stagesRemaining(from, null) + 1,
      );
    }
    // Legacy/invalid rows without an origin fall back to the worst case.
    expect(stagesRemaining("changes_requested", null)).toBe(5);
  });

  it("is defined for every status", () => {
    for (const s of PROJECT_STATUSES) {
      expect(Number.isInteger(stagesRemaining(s, null))).toBe(true);
    }
  });
});

describe("daysUntil", () => {
  it("counts whole local days, negative when past", () => {
    expect(daysUntil("2026-08-17", NOW)).toBe(0);
    expect(daysUntil("2026-08-27", NOW)).toBe(10);
    expect(daysUntil("2026-08-15", NOW)).toBe(-2);
    expect(daysUntil("2026-09-01", NOW)).toBe(15);
  });

  it("ignores the time of day", () => {
    const evening = new Date(2026, 7, 17, 23, 45);
    expect(daysUntil("2026-08-18", evening)).toBe(1);
  });
});

describe("scheduleSlack", () => {
  it("subtracts expected review time from the days remaining", () => {
    // 15 days out, 4 stages left → 15 - 8 = 7.
    expect(scheduleSlack("content_review", null, "2026-09-01", NOW)).toBe(
      15 - 4 * DAYS_PER_STAGE,
    );
    // Same date, 1 stage left → far more slack.
    expect(scheduleSlack("final_review", null, "2026-09-01", NOW)).toBe(
      15 - 1 * DAYS_PER_STAGE,
    );
  });

  it("ranks an early-stage ticket above a late-stage one with the same date", () => {
    const early = scheduleSlack("submitted", null, "2026-08-29", NOW);
    const late = scheduleSlack("final_review", null, "2026-08-29", NOW);
    expect(early).toBeLessThan(late);
  });
});

describe("urgencyTier", () => {
  it("red at ≤10 days out regardless of slack (§8)", () => {
    expect(urgencyTier(10, 8)).toBe("red");
    expect(urgencyTier(-1, -9)).toBe("red");
  });

  it("red when the schedule no longer fits, amber when tight, none otherwise", () => {
    expect(urgencyTier(12, -1)).toBe("red");
    expect(urgencyTier(12, 4)).toBe("amber");
    expect(urgencyTier(30, 22)).toBe("none");
  });
});
