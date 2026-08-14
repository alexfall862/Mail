import { describe, expect, it } from "vitest";
import { aiReviewFlagCount, aiReviewResultSchema } from "@/lib/ai-review";

const sample = {
  disclaimer: {
    found: true,
    text: "Paid for by the Kansas Democratic Party",
    matches_kdp: true,
    concern: null,
  },
  claims: [
    {
      claim: "Voted to cut school funding three times",
      has_citation: true,
      citation: "Topeka Capital-Journal, March 12, 2025",
      note: null,
    },
    {
      claim: "Raised property taxes on working families",
      has_citation: false,
      citation: null,
      note: "No footnote or source line visible.",
    },
  ],
  spelling_grammar: [
    { text: "Kanses families", issue: "Misspelling of Kansas", suggestion: "Kansas families" },
  ],
  overall_notes: null,
};

describe("AI pre-check result schema", () => {
  it("accepts a well-formed result", () => {
    expect(aiReviewResultSchema.safeParse(sample).success).toBe(true);
  });

  it("rejects missing sections and wrong shapes", () => {
    expect(aiReviewResultSchema.safeParse({}).success).toBe(false);
    expect(
      aiReviewResultSchema.safeParse({ ...sample, claims: "none" }).success,
    ).toBe(false);
    expect(
      aiReviewResultSchema.safeParse({
        ...sample,
        disclaimer: { found: "yes" },
      }).success,
    ).toBe(false);
  });

  it("counts flags: disclaimer problems + uncited claims + spelling items", () => {
    expect(aiReviewFlagCount(aiReviewResultSchema.parse(sample))).toBe(2); // 1 uncited + 1 spelling

    const noDisclaimer = aiReviewResultSchema.parse({
      ...sample,
      disclaimer: { found: false, text: null, matches_kdp: false, concern: null },
    });
    expect(aiReviewFlagCount(noDisclaimer)).toBe(3);

    const wrongPayer = aiReviewResultSchema.parse({
      ...sample,
      disclaimer: {
        found: true,
        text: "Paid for by Friends of Someone",
        matches_kdp: false,
        concern: "Different committee named",
      },
      claims: [],
      spelling_grammar: [],
    });
    expect(aiReviewFlagCount(wrongPayer)).toBe(1);
  });
});
