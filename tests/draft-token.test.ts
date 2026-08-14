import { beforeAll, describe, expect, it } from "vitest";
import {
  DRAFT_TOKEN_TTL_MS,
  issueDraftToken,
  verifyDraftToken,
} from "@/lib/draft-token";

beforeAll(() => {
  process.env.R2_SECRET_ACCESS_KEY = "test-r2-secret";
  process.env.TURNSTILE_SECRET_KEY = "test-turnstile-secret";
});

describe("draft project id token (§6)", () => {
  const pid = "5d3ce679-31a3-4930-8f4f-8a2cf158b6f4";

  it("round-trips a project id", () => {
    const token = issueDraftToken(pid);
    expect(verifyDraftToken(token)).toBe(pid);
  });

  it("rejects a tampered payload (project id swap)", () => {
    const token = issueDraftToken(pid);
    const sig = token.slice(token.lastIndexOf(".") + 1);
    const forgedPayload = Buffer.from(
      JSON.stringify({ pid: "00000000-0000-4000-8000-000000000000", iat: Date.now() }),
    ).toString("base64url");
    expect(verifyDraftToken(`${forgedPayload}.${sig}`)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const token = issueDraftToken(pid);
    expect(verifyDraftToken(token.slice(0, -2) + "xx")).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyDraftToken("")).toBeNull();
    expect(verifyDraftToken("not-a-token")).toBeNull();
    expect(verifyDraftToken("a.b.c")).toBeNull();
  });

  it("expires after the TTL", () => {
    const issued = Date.now();
    const token = issueDraftToken(pid, issued);
    expect(verifyDraftToken(token, issued + DRAFT_TOKEN_TTL_MS - 1000)).toBe(pid);
    expect(verifyDraftToken(token, issued + DRAFT_TOKEN_TTL_MS + 1000)).toBeNull();
  });
});
