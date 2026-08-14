import { describe, expect, it } from "vitest";
import {
  buildR2Key,
  MAX_ARTWORK_BYTES,
  MAX_INVOICE_BYTES,
  validatePresignRequest,
} from "@/lib/uploads";

describe("R2 key convention (§6)", () => {
  it("builds projects/{id}/v{n}/{kind}.{ext}", () => {
    expect(buildR2Key("abc", 1, "artwork_front", "image/jpeg")).toBe(
      "projects/abc/v1/artwork_front.jpg",
    );
    expect(buildR2Key("abc", 3, "invoice", "application/pdf")).toBe(
      "projects/abc/v3/invoice.pdf",
    );
    expect(buildR2Key("abc", 2, "artwork_combined", "image/jpeg")).toBe(
      "projects/abc/v2/artwork_combined.jpg",
    );
  });
});

describe("presign validation (§6 server side)", () => {
  it("artwork accepts only the processed JPEG output", () => {
    expect(validatePresignRequest("artwork_front", "image/jpeg", 1000).ok).toBe(true);
    for (const bad of ["image/png", "image/webp", "application/pdf", "image/gif", "text/html"]) {
      expect(validatePresignRequest("artwork_front", bad, 1000).ok).toBe(false);
      expect(validatePresignRequest("artwork_combined", bad, 1000).ok).toBe(false);
    }
  });

  it("invoice accepts pdf/jpeg/png only", () => {
    for (const good of ["application/pdf", "image/jpeg", "image/png"]) {
      expect(validatePresignRequest("invoice", good, 1000).ok).toBe(true);
    }
    for (const bad of ["image/webp", "application/zip", "text/html"]) {
      expect(validatePresignRequest("invoice", bad, 1000).ok).toBe(false);
    }
  });

  it("enforces the 8 MB artwork / 10 MB invoice caps", () => {
    expect(
      validatePresignRequest("artwork_back", "image/jpeg", MAX_ARTWORK_BYTES).ok,
    ).toBe(true);
    expect(
      validatePresignRequest("artwork_back", "image/jpeg", MAX_ARTWORK_BYTES + 1).ok,
    ).toBe(false);
    expect(
      validatePresignRequest("invoice", "application/pdf", MAX_INVOICE_BYTES).ok,
    ).toBe(true);
    expect(
      validatePresignRequest("invoice", "application/pdf", MAX_INVOICE_BYTES + 1).ok,
    ).toBe(false);
  });

  it("rejects nonsense sizes", () => {
    expect(validatePresignRequest("invoice", "application/pdf", 0).ok).toBe(false);
    expect(validatePresignRequest("invoice", "application/pdf", -5).ok).toBe(false);
    expect(validatePresignRequest("invoice", "application/pdf", 10.5).ok).toBe(false);
  });
});
