import { describe, expect, it } from "vitest";
import { districtOptionsFor, KANSAS_COUNTIES } from "@/lib/district-options";
import { minMailDate, resubmitMailDateFloor } from "@/lib/schemas/project";

describe("mail date: two full business days ahead", () => {
  // August 2026: the 10th is a Monday, the 14th a Friday.
  it("Monday → Wednesday", () => {
    expect(minMailDate("2026-08-10")).toBe("2026-08-12");
  });
  it("Thursday → Monday (skips the weekend)", () => {
    expect(minMailDate("2026-08-13")).toBe("2026-08-17");
  });
  it("Friday → Tuesday", () => {
    expect(minMailDate("2026-08-14")).toBe("2026-08-18");
  });
  it("Saturday and Sunday → Tuesday", () => {
    expect(minMailDate("2026-08-15")).toBe("2026-08-18");
    expect(minMailDate("2026-08-16")).toBe("2026-08-18");
  });
  it("crosses month boundaries", () => {
    // 2026-08-31 is a Monday.
    expect(minMailDate("2026-08-31")).toBe("2026-09-02");
  });
});

describe("resubmission mail date floor", () => {
  // 2026-08-10 is a Monday, so the standard floor from the 12th is the 14th.
  it("keeps the original date when it's now inside the lead time", () => {
    // Submitted the 10th for the 13th; edits come back on the 12th.
    const floor = resubmitMailDateFloor("2026-08-13", "2026-08-12");
    expect(floor.min).toBe("2026-08-13");
    expect(floor.grandfathered).toBe(true);
  });

  it("still refuses a date earlier than the original", () => {
    const floor = resubmitMailDateFloor("2026-08-13", "2026-08-12");
    expect("2026-08-12" < floor.min).toBe(true);
  });

  it("applies the standard lead time when the original is comfortably ahead", () => {
    const floor = resubmitMailDateFloor("2026-08-31", "2026-08-12");
    expect(floor.min).toBe(minMailDate("2026-08-12"));
    expect(floor.grandfathered).toBe(false);
  });

  it("applies the standard lead time once the original date has passed", () => {
    const floor = resubmitMailDateFloor("2026-08-10", "2026-08-12");
    expect(floor.min).toBe(minMailDate("2026-08-12"));
    expect(floor.grandfathered).toBe(false);
  });

  it("allows a same-day original date that was locked in earlier", () => {
    const floor = resubmitMailDateFloor("2026-08-12", "2026-08-12");
    expect(floor.min).toBe("2026-08-12");
    expect(floor.grandfathered).toBe(true);
  });
});

describe("district suggestions per office", () => {
  it("statewide offices prefill 'Statewide'", () => {
    for (const office of [
      "us_senate",
      "governor",
      "secretary_of_state",
      "attorney_general",
      "state_treasurer",
      "insurance_commissioner",
    ] as const) {
      expect(districtOptionsFor(office)).toEqual({
        prefill: "Statewide",
        options: ["Statewide"],
      });
    }
  });

  it("numbered districts match each chamber", () => {
    expect(districtOptionsFor("us_house").options).toEqual(["1", "2", "3", "4"]);
    expect(districtOptionsFor("state_board_of_education").options).toHaveLength(10);
    expect(districtOptionsFor("state_senate").options).toHaveLength(40);
    expect(districtOptionsFor("state_house").options).toHaveLength(125);
    expect(districtOptionsFor("state_house").options[0]).toBe("1");
    expect(districtOptionsFor("state_house").options[124]).toBe("125");
  });

  it("county party offers all 105 Kansas counties", () => {
    expect(KANSAS_COUNTIES).toHaveLength(105);
    expect(districtOptionsFor("county_party").options).toHaveLength(105);
    expect(districtOptionsFor("county_party").options).toContain("Sedgwick");
    expect(districtOptionsFor("county_party").options).toContain("Wyandotte");
  });

  it("municipal/other and no office are free text with no prefill", () => {
    expect(districtOptionsFor("municipal_county_office")).toEqual({
      prefill: null,
      options: [],
    });
    expect(districtOptionsFor("other")).toEqual({ prefill: null, options: [] });
    expect(districtOptionsFor("")).toEqual({ prefill: null, options: [] });
  });
});
