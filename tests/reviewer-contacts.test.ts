import { describe, expect, it } from "vitest";
import { allReviewerContacts } from "@/lib/reviewer-contacts";

describe("allReviewerContacts (union across stages)", () => {
  it("dedupes by email and collects each contact's stages", () => {
    const result = allReviewerContacts({
      content_review: [
        { name: "Blair", email: "blair@compliance.example", note: "Compliance" },
      ],
      legal_review: [
        { name: "Neil", email: "neil@law.example", note: "Legal" },
        // Same person configured on two stages:
        { name: "Blair", email: "Blair@Compliance.example", note: "Compliance" },
        // Hand-edited duplicate row:
        { name: "Neil", email: "neil@law.example", note: "Legal" },
      ],
    });
    expect(result).toHaveLength(2);
    const blair = result.find((c) => c.name === "Blair")!;
    expect(blair.stages.sort()).toEqual(["content_review", "legal_review"]);
    const neil = result.find((c) => c.name === "Neil")!;
    expect(neil.stages).toEqual(["legal_review"]);
  });

  it("returns empty for an empty table", () => {
    expect(allReviewerContacts({})).toEqual([]);
  });
});
