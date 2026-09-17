import { beforeEach, describe, expect, it } from "vitest";
import { LIMITS, rateLimit, resetRateLimits } from "@/lib/rate-limit";

describe("rate limiter (§13 limits)", () => {
  beforeEach(() => resetRateLimits());

  it("declares the exact limits from the spec", () => {
    expect(LIMITS.presign).toEqual({ max: 40, windowMs: 3_600_000 });
    expect(LIMITS.submission).toEqual({ max: 10, windowMs: 3_600_000 });
    expect(LIMITS.tokenLookup).toEqual({ max: 30, windowMs: 60_000 });
    expect(LIMITS.login).toEqual({ max: 5, windowMs: 900_000 });
  });

  it("allows up to the max within a window, then blocks with retry-after", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(rateLimit("login", "1.2.3.4:a@b.c", t0 + i).allowed).toBe(true);
    }
    const blocked = rateLimit("login", "1.2.3.4:a@b.c", t0 + 10);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
      expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(900);
    }
  });

  it("window slides: old hits expire and requests are allowed again", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) rateLimit("login", "k", t0 + i);
    expect(rateLimit("login", "k", t0 + 10).allowed).toBe(false);
    expect(rateLimit("login", "k", t0 + LIMITS.login.windowMs + 11).allowed).toBe(
      true,
    );
  });

  it("keys are independent (per IP / per email)", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) rateLimit("login", "ip1:a@b.c", t0);
    expect(rateLimit("login", "ip1:a@b.c", t0).allowed).toBe(false);
    expect(rateLimit("login", "ip2:a@b.c", t0).allowed).toBe(true);
    expect(rateLimit("submission", "ip1:a@b.c", t0).allowed).toBe(true);
  });
});
