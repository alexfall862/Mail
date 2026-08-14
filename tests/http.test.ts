import { afterEach, describe, expect, it } from "vitest";
import { isSameOrigin } from "@/lib/http";

function req(headers: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/test", {
    method: "POST",
    headers,
  });
}

const APP_URL = process.env.APP_URL;
afterEach(() => {
  process.env.APP_URL = APP_URL;
});

describe("same-origin check (§13)", () => {
  it("accepts a missing Origin header (curl, same-origin GET)", () => {
    expect(isSameOrigin(req({ host: "localhost:3000" }))).toBe(true);
  });

  it("accepts an Origin matching APP_URL", () => {
    process.env.APP_URL = "https://mail.kansasdems.org";
    expect(
      isSameOrigin(
        req({ origin: "https://mail.kansasdems.org", host: "internal:8080" }),
      ),
    ).toBe(true);
  });

  it("accepts an Origin matching the request's own Host (127.0.0.1 vs localhost)", () => {
    process.env.APP_URL = "http://localhost:3000";
    expect(
      isSameOrigin(
        req({ origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" }),
      ),
    ).toBe(true);
  });

  it("accepts an Origin matching x-forwarded-host behind a proxy", () => {
    process.env.APP_URL = "http://localhost:3000";
    expect(
      isSameOrigin(
        req({
          origin: "https://mail.kansasdems.org",
          host: "railway-internal:5000",
          "x-forwarded-host": "mail.kansasdems.org",
        }),
      ),
    ).toBe(true);
  });

  it("rejects a foreign Origin", () => {
    process.env.APP_URL = "http://localhost:3000";
    expect(
      isSameOrigin(req({ origin: "https://evil.example", host: "localhost:3000" })),
    ).toBe(false);
  });

  it("rejects a garbage Origin", () => {
    expect(isSameOrigin(req({ origin: "not a url", host: "localhost:3000" }))).toBe(
      false,
    );
  });
});
