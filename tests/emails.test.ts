import { beforeAll, describe, expect, it } from "vitest";
import {
  adminNewSubmission,
  adminReopened,
  adminResubmission,
  campaignReviewRequest,
  vendorApproved,
  vendorChangesRequested,
  vendorConfirmation,
  vendorDenied,
  vendorLinkRegenerated,
  vendorStagePassed,
  type EmailContent,
  type ProjectSummary,
} from "@/lib/email/templates";
import { decryptVendorToken, encryptVendorToken } from "@/lib/token-crypto";

beforeAll(() => {
  process.env.R2_SECRET_ACCESS_KEY ??= "test-r2-secret";
  process.env.TURNSTILE_SECRET_KEY ??= "test-turnstile-secret";
});

const summary: ProjectSummary = {
  candidateSupported: "Jane Doe",
  officeLabel: "State House",
  mailDateFormatted: "Oct 12, 2026",
};
const MAGIC = "https://mail.example/p/tok123";
const ADMIN_URL = "https://mail.example/admin/projects/abc";

function vendorTemplates(): EmailContent[] {
  return [
    vendorConfirmation(summary, MAGIC),
    vendorStagePassed(summary, "Content Review", "Legal Review", MAGIC),
    vendorChangesRequested(summary, "Legal Review", "Fix the notes", MAGIC),
    vendorApproved(summary, MAGIC),
    vendorDenied(summary, "Because reasons", MAGIC),
    vendorLinkRegenerated(summary, MAGIC),
    campaignReviewRequest(summary, ["Print Co", "Mail Co"], MAGIC),
  ];
}

function adminTemplates(): EmailContent[] {
  return [
    adminNewSubmission(summary, ADMIN_URL),
    adminResubmission(summary, 2, "Changed the back", ADMIN_URL),
    adminReopened(summary, "Costs changed", "Alex", ADMIN_URL),
  ];
}

describe("email templates (§12)", () => {
  it("all 8 spec templates exist with subject, html, and text parts", () => {
    const all = [...vendorTemplates(), ...adminTemplates()];
    const names = all.map((t) => t.template);
    for (const required of [
      "vendor_confirmation",
      "admin_new_submission",
      "vendor_stage_passed",
      "vendor_changes_requested",
      "vendor_approved",
      "vendor_denied",
      "admin_resubmission",
      "vendor_link_regenerated",
    ]) {
      expect(names).toContain(required);
    }
    for (const t of all) {
      expect(t.subject.length).toBeGreaterThan(5);
      expect(t.html).toContain("<html>");
      expect(t.text.length).toBeGreaterThan(20);
    }
  });

  it("every subject starts with the [KDP Mail] filter prefix", () => {
    for (const t of [...vendorTemplates(), ...adminTemplates()]) {
      expect(t.subject.startsWith("[KDP Mail] "), t.template).toBe(true);
    }
  });

  it("every vendor email carries the magic link in html and text", () => {
    for (const t of vendorTemplates()) {
      expect(t.html, t.template).toContain(MAGIC);
      expect(t.text, t.template).toContain(MAGIC);
    }
  });

  it("admin emails NEVER contain the magic link", () => {
    for (const t of adminTemplates()) {
      expect(t.html, t.template).not.toContain(MAGIC);
      expect(t.text, t.template).not.toContain(MAGIC);
      expect(t.html, t.template).not.toContain("/p/");
    }
  });

  it("review notes appear verbatim in kickback and denial emails", () => {
    const notes = 'Line one\nLine "two" & <three>';
    const kick = vendorChangesRequested(summary, "Legal Review", notes, MAGIC);
    expect(kick.text).toContain(notes);
    expect(kick.html).toContain("Line one\nLine &quot;two&quot; &amp; &lt;three&gt;");
    const denial = vendorDenied(summary, notes, MAGIC);
    expect(denial.text).toContain(notes);
  });

  it("campaign review request names the mail date and primary vendors", () => {
    const t = campaignReviewRequest(summary, ["Print Co", "Mail Co"], MAGIC);
    expect(t.text).toContain("has decided to invest in your race");
    expect(t.text).toContain("scheduled to be sent on Oct 12, 2026");
    expect(t.text).toContain("working with Print Co and Mail Co");
    const noPartners = campaignReviewRequest(summary, [], MAGIC);
    expect(noPartners.text).toContain("working with our mail vendors");
  });

  it("html-escapes user-controlled fields", () => {
    const evil = { ...summary, candidateSupported: '<script>alert("x")</script>' };
    const t = vendorConfirmation(evil, MAGIC);
    expect(t.html).not.toContain("<script>");
    expect(t.html).toContain("&lt;script&gt;");
  });
});

describe("vendor token encryption (DECISIONS: §12 link availability)", () => {
  it("round-trips", () => {
    const enc = encryptVendorToken("raw-token-abc");
    expect(decryptVendorToken(enc)).toBe("raw-token-abc");
  });

  it("produces distinct ciphertexts (random IV) that both decrypt", () => {
    const a = encryptVendorToken("same");
    const b = encryptVendorToken("same");
    expect(a).not.toBe(b);
    expect(decryptVendorToken(a)).toBe("same");
    expect(decryptVendorToken(b)).toBe("same");
  });

  it("returns null for tampered or invalid values", () => {
    const enc = encryptVendorToken("raw");
    expect(decryptVendorToken(enc.slice(0, -3) + "abc")).toBeNull();
    expect(decryptVendorToken("garbage")).toBeNull();
    expect(decryptVendorToken(null)).toBeNull();
  });
});
