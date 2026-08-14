import { describe, expect, it } from "vitest";
import { districtOptionsFor, KANSAS_COUNTIES } from "@/lib/district-options";
import { minMailDate } from "@/lib/schemas/project";

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
