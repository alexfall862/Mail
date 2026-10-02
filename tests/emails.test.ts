import { beforeAll, describe, expect, it } from "vitest";
import {
  adminCampaignApproved,
  adminNewSubmission,
  adminReopened,
  adminResubmission,
  campaignReviewRequest,
  reviewerNotice,
  reviewReminder,
  reviewReminderGrouped,
  vendorApproved,
  vendorChangesRequested,
  vendorConfirmation,
  vendorDenied,
  vendorLinkRegenerated,
  vendorStagePassed,
  type EmailContent,
  type ProjectSummary,
} from "@/lib/email/templates";
import { threadHeaders } from "@/lib/email/threading";
import { projectRef } from "@/lib/format";
import { decryptVendorToken, encryptVendorToken } from "@/lib/token-crypto";

beforeAll(() => {
  process.env.R2_SECRET_ACCESS_KEY ??= "test-r2-secret";
  process.env.TURNSTILE_SECRET_KEY ??= "test-turnstile-secret";
});

const summary: ProjectSummary = {
  ref: "A1B2C3",
  candidateSupported: "Jane Doe",
  officeLabel: "State House",
  mailDateFormatted: "Oct 12, 2026",
};
const MAGIC = "https://mail.example/p/tok123";
const ADMIN_URL = "https://mail.example/admin/projects/abc";

function vendorTemplates(p: ProjectSummary = summary): EmailContent[] {
  return [
    vendorConfirmation(p, MAGIC),
    vendorStagePassed(p, "Content Review", "Legal Review", MAGIC),
    vendorChangesRequested(p, "Legal Review", "Fix the notes", MAGIC),
    vendorApproved(p, MAGIC),
    vendorDenied(p, "Because reasons", MAGIC),
    vendorLinkRegenerated(p, MAGIC),
    campaignReviewRequest(p, ["Print Co", "Mail Co"], MAGIC),
    reviewerNotice(p, "Legal Review", MAGIC),
    reviewReminder(p, "Legal Review", MAGIC, { campaignContact: false, sameLink: true }),
  ];
}

function adminTemplates(p: ProjectSummary = summary): EmailContent[] {
  return [
    adminNewSubmission(p, ADMIN_URL),
    adminResubmission(p, 2, "Changed the back", ADMIN_URL),
    adminReopened(p, "Costs changed", "Alex", ADMIN_URL),
    adminCampaignApproved(p, "Sam Candidate", "sam@example.org", ADMIN_URL),
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

  it("every subject opens with the [KDP Mail #REF] prefix", () => {
    for (const t of [...vendorTemplates(), ...adminTemplates()]) {
      expect(t.subject.startsWith("[KDP Mail #A1B2C3] "), t.template).toBe(true);
    }
  });

  // Production bug: three pieces for one candidate collapsed into a single
  // mail chain, because every template produced a byte-identical subject and
  // clients thread on the normalized subject. The ref makes them distinct.
  it("two projects for the same candidate never share a subject", () => {
    const other = { ...summary, ref: "D4E5F6" };
    const mine = [...vendorTemplates(), ...adminTemplates()];
    const theirs = [...vendorTemplates(other), ...adminTemplates(other)];
    for (const [i, t] of mine.entries()) {
      expect(theirs[i]!.subject, t.template).not.toBe(t.subject);
    }
    expect(new Set(theirs.map((t) => t.subject)).size).toBe(theirs.length);
  });

  it("every email carries its project ref in both body parts", () => {
    for (const t of [...vendorTemplates(), ...adminTemplates()]) {
      expect(t.text, t.template).toContain("Project ref #A1B2C3");
      expect(t.html, t.template).toContain("Project ref #A1B2C3");
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

  it("reviewer notice names the stage, race, and mail date", () => {
    const t = reviewerNotice(summary, "Legal Review", MAGIC);
    expect(t.subject).toContain("Legal Review needed");
    expect(t.text).toContain("awaiting legal review");
    expect(t.text).toContain("Jane Doe");
    expect(t.text).toContain("Oct 12, 2026");
  });

  it("review reminder carries the link and says whether it's the same one", () => {
    const same = reviewReminder(summary, "Legal Review", MAGIC, {
      campaignContact: false,
      sameLink: true,
    });
    expect(same.subject).toContain("Reminder: legal review needed");
    expect(same.text).toContain(`Open your review page: ${MAGIC}`);
    expect(same.text).toContain("same private link we sent earlier");
    const fresh = reviewReminder(summary, "Campaign Review", MAGIC, {
      campaignContact: true,
      sameLink: false,
    });
    expect(fresh.text).toContain("replaces the one we sent earlier");
    expect(fresh.text).toContain("moves straight to the next step");
  });

  it("grouped reminder lists every piece with its own link", () => {
    const other: ProjectSummary = { ...summary, ref: "B2C3D4", candidateSupported: "Sam Roe" };
    const t = reviewReminderGrouped("Blair", [
      { p: summary, stageLabel: "Legal Review", reviewLink: `${MAGIC}-1`, campaignContact: false, sameLink: true },
      { p: other, stageLabel: "Campaign Review", reviewLink: `${MAGIC}-2`, campaignContact: true, sameLink: false },
    ]);
    expect(t.subject).toBe("[KDP Mail] Reminder: 2 mail pieces awaiting your review");
    for (const part of [t.text, t.html]) {
      expect(part).toContain("Hi Blair,");
      expect(part).toContain(`${MAGIC}-1`);
      expect(part).toContain(`${MAGIC}-2`);
      expect(part).toContain("Sam Roe");
      expect(part).toContain("#B2C3D4");
    }
    expect(t.text).toContain("campaign sign-off · new link, replaces the earlier one");
  });

  it("campaign sign-off notice names the contact and says the vendor wasn't emailed", () => {
    const t = adminCampaignApproved(summary, "Sam Candidate", "sam@example.org", ADMIN_URL);
    expect(t.subject).toContain("Campaign signed off");
    expect(t.text).toContain("Sam Candidate (sam@example.org)");
    expect(t.text).toContain("campaign review to legal review");
    expect(t.text).toContain("vendor was not emailed");
  });

  it("html-escapes user-controlled fields", () => {
    const evil = { ...summary, candidateSupported: '<script>alert("x")</script>' };
    const t = vendorConfirmation(evil, MAGIC);
    expect(t.html).not.toContain("<script>");
    expect(t.html).toContain("&lt;script&gt;");
  });
});

describe("project ref (one thread per project)", () => {
  it("is a stable six-character handle derived from the project id", () => {
    const id = "a1b2c3d4-0000-4000-8000-000000000000";
    expect(projectRef(id)).toBe("A1B2C3");
    expect(projectRef(id)).toBe(projectRef(id));
  });

  it("differs for two projects of the same candidate", () => {
    expect(projectRef("11111111-0000-4000-8000-000000000000")).not.toBe(
      projectRef("22222222-0000-4000-8000-000000000000"),
    );
  });
});

describe("thread headers (one thread per project)", () => {
  const A = "11111111-0000-4000-8000-000000000000";
  const B = "22222222-0000-4000-8000-000000000000";

  it("anchors every email for a project to the same parent id", () => {
    const h = threadHeaders(A)!;
    expect(h["References"]).toBe(h["In-Reply-To"]);
    expect(h["References"]).toBe(threadHeaders(A)!["References"]);
    expect(h["References"]).toMatch(/^<project-[0-9a-f-]+@[^>]+>$/);
  });

  it("gives two projects different anchors", () => {
    expect(threadHeaders(A)!["References"]).not.toBe(
      threadHeaders(B)!["References"],
    );
  });

  it("sends no threading headers when there is no project", () => {
    expect(threadHeaders(null)).toBeUndefined();
  });

  it("takes the id domain from EMAIL_FROM", () => {
    const prev = process.env.EMAIL_FROM;
    process.env.EMAIL_FROM = "KDP Mail Program <mail@kdp.example.org>";
    expect(threadHeaders(A)!["References"]).toBe(
      `<project-${A}@kdp.example.org>`,
    );
    process.env.EMAIL_FROM = prev;
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
