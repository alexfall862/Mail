import { describe, expect, it } from "vitest";
import {
  computeArtworkChanged,
  validateVersionFileSet,
} from "@/lib/version-files";

describe("version validity rule (§6)", () => {
  it("accepts front+back+invoice", () => {
    expect(
      validateVersionFileSet(["artwork_front", "artwork_back", "invoice"]).ok,
    ).toBe(true);
  });

  it("accepts combined+invoice", () => {
    expect(validateVersionFileSet(["artwork_combined", "invoice"]).ok).toBe(true);
  });

  it("rejects both sets", () => {
    expect(
      validateVersionFileSet([
        "artwork_front",
        "artwork_back",
        "artwork_combined",
        "invoice",
      ]).ok,
    ).toBe(false);
    expect(
      validateVersionFileSet(["artwork_front", "artwork_combined", "invoice"]).ok,
    ).toBe(false);
  });

  it("rejects a partial separate set", () => {
    expect(validateVersionFileSet(["artwork_front", "invoice"]).ok).toBe(false);
    expect(validateVersionFileSet(["artwork_back", "invoice"]).ok).toBe(false);
  });

  it("rejects missing artwork or missing invoice", () => {
    expect(validateVersionFileSet(["invoice"]).ok).toBe(false);
    expect(validateVersionFileSet(["artwork_front", "artwork_back"]).ok).toBe(false);
    expect(validateVersionFileSet(["artwork_combined"]).ok).toBe(false);
  });

  it("rejects duplicate kinds", () => {
    expect(
      validateVersionFileSet([
        "artwork_combined",
        "artwork_combined",
        "invoice",
      ]).ok,
    ).toBe(false);
  });
});

describe("artwork-changed comparison (§5 routing rule input)", () => {
  const v1Separate = {
    artwork_front: "projects/p/v1/artwork_front.jpg",
    artwork_back: "projects/p/v1/artwork_back.jpg",
    invoice: "projects/p/v1/invoice.pdf",
  } as const;

  it("carry-forward of all artwork → unchanged", () => {
    expect(
      computeArtworkChanged(v1Separate, {
        ...v1Separate,
        invoice: "projects/p/v2/invoice.pdf", // invoice change is NOT artwork
      }),
    ).toBe(false);
  });

  it("replacing one side → changed", () => {
    expect(
      computeArtworkChanged(v1Separate, {
        ...v1Separate,
        artwork_back: "projects/p/v2/artwork_back.jpg",
      }),
    ).toBe(true);
  });

  it("switching separate → combined → changed", () => {
    expect(
      computeArtworkChanged(v1Separate, {
        artwork_combined: "projects/p/v2/artwork_combined.jpg",
        invoice: v1Separate.invoice,
      }),
    ).toBe(true);
  });

  it("switching combined → separate → changed", () => {
    expect(
      computeArtworkChanged(
        { artwork_combined: "projects/p/v1/artwork_combined.jpg" },
        {
          artwork_front: "projects/p/v2/artwork_front.jpg",
          artwork_back: "projects/p/v2/artwork_back.jpg",
        },
      ),
    ).toBe(true);
  });

  it("identical combined key → unchanged", () => {
    const key = { artwork_combined: "projects/p/v1/artwork_combined.jpg" };
    expect(computeArtworkChanged(key, { ...key })).toBe(false);
  });
});
