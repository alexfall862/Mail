/**
 * DB-backed integration tests (require the docker-compose Postgres from
 * README to be running). R2 is mocked — object storage interactions are
 * covered by the live smoke test in SETUP_CHECKLIST §5.
 *
 * Covers: atomic creation with auto-advance, the full review lifecycle, both
 * routing-rule branches with carry-forward, one-decision-per-stage, the
 * concurrent-click row-lock case, reopen + re-decide, tombstoned deletion,
 * and CSV building.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/r2", () => {
  const store = new Map<string, { sizeBytes: number; contentType: string }>();
  return {
    PRESIGN_EXPIRY_SECONDS: 600,
    __store: store,
    presignPut: vi.fn(async () => "https://r2.test/put"),
    presignGet: vi.fn(async () => "https://r2.test/get"),
    headObject: vi.fn(async (key: string) => {
      const obj = store.get(key);
      return obj
        ? { exists: true, sizeBytes: obj.sizeBytes, contentType: obj.contentType }
        : { exists: false };
    }),
    deleteProjectPrefix: vi.fn(async (projectId: string) => {
      let deleted = 0;
      for (const key of [...store.keys()]) {
        if (key.startsWith(`projects/${projectId}/`)) {
          store.delete(key);
          deleted++;
        }
      }
      return { deleted, verifiedEmpty: true };
    }),
  };
});

import { db } from "@/db";
import {
  admins,
  contacts,
  deletedProjects,
  events,
  files,
  projects,
  stageReviews,
  submissionVersions,
} from "@/db/schema";
import {
  decideReview,
  deleteProject,
  getDashboardRows,
  overrideWait,
  regenerateLink,
  reopenProject,
  setCampaignContact,
  setContactPaid,
} from "@/lib/admin-ops";
import { createProject, resubmitProject } from "@/lib/projects";
import * as r2 from "@/lib/r2";
import {
  createReviewInvites,
  getReviewInviteView,
  listReviewFeedback,
  submitReviewResponse,
} from "@/lib/review-invites";
import type { FileClaim, SubmitRequest } from "@/lib/schemas/project";
import { hashVendorToken } from "@/lib/tokens";

const r2store = (r2 as unknown as { __store: Map<string, { sizeBytes: number; contentType: string }> }).__store;

let adminId: string;
let superuserId: string;
const createdProjectIds: string[] = [];

function seedR2Object(key: string, sizeBytes: number, contentType: string) {
  r2store.set(key, { sizeBytes, contentType });
}

function claim(
  projectId: string,
  version: number,
  kind: FileClaim["kind"],
  contentType = "image/jpeg",
): FileClaim {
  const ext = contentType === "application/pdf" ? "pdf" : "jpg";
  const key = `projects/${projectId}/v${version}/${kind}.${ext}`;
  seedR2Object(key, 1234, contentType);
  return {
    kind,
    r2Key: key,
    originalFilename: `${kind}.${ext}`,
    contentType,
    sizeBytes: 1234,
    widthPx: kind === "invoice" ? undefined : 2500,
    heightPx: kind === "invoice" ? undefined : 1600,
  };
}

function baseSubmit(projectId: string): SubmitRequest {
  return {
    draftToken: "unused-in-direct-call",
    project: {
      candidateSupported: "Test Candidate",
      description: "A test mail piece",
      office: "state_house",
      districtDetail: "District 42",
      pieceCount: 5000,
      totalCostCents: 123456,
      postOfficeLocation: "Topeka, KS",
      permitNumber: "PERMIT-1",
      mailDate: "2030-01-15",
    },
    contacts: [
      {
        role: "print_shop",
        orgName: "Print Co",
        contactName: "Pat Printer",
        email: "pat@print.example",
        paidByKdp: true,
        isPrimary: true,
      },
      {
        role: "mail_house",
        orgName: "Mail Co",
        contactName: "Morgan Mailer",
        email: "morgan@mail.example",
        paidByKdp: false,
        isPrimary: false,
      },
    ],
    files: [
      claim(projectId, 1, "artwork_front"),
      claim(projectId, 1, "artwork_back"),
      claim(projectId, 1, "invoice", "application/pdf"),
    ],
  };
}

async function makeProject(): Promise<{ projectId: string; rawToken: string }> {
  const projectId = randomUUID();
  const result = await createProject(baseSubmit(projectId), projectId);
  if (!result.ok) throw new Error(`createProject failed: ${result.message}`);
  createdProjectIds.push(projectId);
  return { projectId, rawToken: result.value.rawVendorToken };
}

function resubmitPayload(
  rawToken: string,
  projectId: string,
  version: number,
  opts: {
    uploads?: FileClaim[];
    carry?: FileClaim["kind"][];
    note?: string;
    pieceCount?: number;
  } = {},
) {
  const base = baseSubmit(projectId);
  return {
    vendorToken: rawToken,
    project: { ...base.project, pieceCount: opts.pieceCount ?? base.project.pieceCount },
    contacts: base.contacts,
    uploads: opts.uploads ?? [],
    carryForwardKinds: opts.carry ?? [],
    vendorNote: opts.note,
  };
}

beforeAll(async () => {
  const [a] = await db
    .insert(admins)
    .values({
      email: `test-admin-${randomUUID()}@test.example`,
      name: "Test Admin",
      passwordHash: "x",
      isSuperuser: false,
      mustChangePassword: false,
    })
    .returning({ id: admins.id });
  const [s] = await db
    .insert(admins)
    .values({
      email: `test-super-${randomUUID()}@test.example`,
      name: "Test Superuser",
      passwordHash: "x",
      isSuperuser: true,
      mustChangePassword: false,
    })
    .returning({ id: admins.id });
  adminId = a!.id;
  superuserId = s!.id;
});

afterAll(async () => {
  for (const id of createdProjectIds) {
    await db.delete(projects).where(eq(projects.id, id));
    await db.delete(deletedProjects).where(eq(deletedProjects.id, id));
  }
  await db.delete(events).where(eq(events.actorId, adminId));
  await db.delete(events).where(eq(events.actorId, superuserId));
  await db.delete(admins).where(eq(admins.id, adminId));
  await db.delete(admins).where(eq(admins.id, superuserId));
  const { pool } = (await import("@/db")) as unknown as { pool?: { end: () => Promise<void> } };
  await pool?.end?.();
});

describe("creation (§5 rows 1–2)", () => {
  it("creates project + v1 + files atomically and auto-advances to content_review", async () => {
    const { projectId } = await makeProject();
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project!.status).toBe("content_review");
    expect(project!.currentVersionId).not.toBeNull();

    const versions = await db
      .select()
      .from(submissionVersions)
      .where(eq(submissionVersions.projectId, projectId));
    expect(versions).toHaveLength(1);
    const fileRows = await db.select().from(files).where(eq(files.projectId, projectId));
    expect(fileRows.map((f) => f.kind).sort()).toEqual([
      "artwork_back",
      "artwork_front",
      "invoice",
    ]);

    const eventRows = await db.select().from(events).where(eq(events.projectId, projectId));
    const types = eventRows.map((e) => e.eventType);
    expect(types).toContain("project.created");
    expect(types).toContain("version.submitted");
    expect(types).toContain("status.changed");
    expect(types.filter((t) => t === "file.uploaded")).toHaveLength(3);
  });

  it("rejects a v1 with an invalid file set (partial separate)", async () => {
    const projectId = randomUUID();
    const input = baseSubmit(projectId);
    input.files = [claim(projectId, 1, "artwork_front"), claim(projectId, 1, "invoice", "application/pdf")];
    const result = await createProject(input, projectId);
    expect(result.ok).toBe(false);
  });

  it("rejects when a claimed file is missing from R2", async () => {
    const projectId = randomUUID();
    const input = baseSubmit(projectId);
    r2store.delete(input.files[0]!.r2Key);
    const result = await createProject(input, projectId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/could not be found/);
  });
});

describe("review lifecycle (§5 rows 3–5, 8)", () => {
  it("advances content → campaign → legal → final → approved with stage_reviews rows", async () => {
    const { projectId } = await makeProject();
    for (const stage of [
      "content_review",
      "campaign_review",
      "legal_review",
      "final_review",
    ] as const) {
      const result = await decideReview({
        projectId,
        stage,
        decision: "advanced",
        checklist: { checked: true },
        notes: null,
        adminId,
      });
      expect(result.ok, `${stage} should advance`).toBe(true);
    }
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project!.status).toBe("approved");
    const reviews = await db
      .select()
      .from(stageReviews)
      .where(eq(stageReviews.projectId, projectId));
    expect(reviews).toHaveLength(4);
  });

  it("denies with notes at any stage (terminal)", async () => {
    const { projectId } = await makeProject();
    const result = await decideReview({
      projectId,
      stage: "content_review",
      decision: "denied",
      checklist: {},
      notes: "Disclaimer missing entirely.",
      adminId,
    });
    expect(result.ok).toBe(true);
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project!.status).toBe("denied");
  });

  it("rejects a decision for a stage the project is not at (stale click)", async () => {
    const { projectId } = await makeProject();
    const result = await decideReview({
      projectId,
      stage: "legal_review",
      decision: "advanced",
      checklist: {},
      notes: null,
      adminId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/already moved/);
  });

  it("CONCURRENT CLICKS: exactly one of two simultaneous decisions wins", async () => {
    const { projectId } = await makeProject();
    const decide = () =>
      decideReview({
        projectId,
        stage: "content_review",
        decision: "advanced",
        checklist: {},
        notes: null,
        adminId,
      });
    const [a, b] = await Promise.all([decide(), decide()]);
    const oks = [a.ok, b.ok].filter(Boolean);
    expect(oks).toHaveLength(1);
    const loser = a.ok ? b : a;
    if (!loser.ok) expect(loser.message).toMatch(/already moved to Campaign Review/);

    // No double transition: status advanced exactly one step, one review row.
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project!.status).toBe("campaign_review");
    const reviews = await db
      .select()
      .from(stageReviews)
      .where(eq(stageReviews.projectId, projectId));
    expect(reviews).toHaveLength(1);
  });
});

describe("resubmission routing rule (§5 row 7)", () => {
  async function bounceAt(
    stage: "content_review" | "campaign_review" | "legal_review" | "final_review",
  ) {
    const { projectId, rawToken } = await makeProject();
    const advanceOrder = [
      "content_review",
      "campaign_review",
      "legal_review",
      "final_review",
    ] as const;
    for (const s of advanceOrder) {
      if (s === stage) break;
      const r = await decideReview({
        projectId,
        stage: s,
        decision: "advanced",
        checklist: {},
        notes: null,
        adminId,
      });
      if (!r.ok) throw new Error(r.message);
    }
    const bounce = await decideReview({
      projectId,
      stage,
      decision: "changes_requested",
      checklist: {},
      notes: "Please fix.",
      adminId,
    });
    if (!bounce.ok) throw new Error(bounce.message);
    return { projectId, rawToken };
  }

  it("artwork change from a legal_review kickback routes to content_review", async () => {
    const { projectId, rawToken } = await bounceAt("legal_review");
    const result = await resubmitProject(
      resubmitPayload(rawToken, projectId, 2, {
        uploads: [claim(projectId, 2, "artwork_front"), claim(projectId, 2, "artwork_back")],
        carry: ["invoice"],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.artworkChanged).toBe(true);
      expect(result.value.newStatus).toBe("content_review");
    }
  });

  it("non-artwork change returns to the kicking stage, files carry forward sharing r2 keys", async () => {
    const { projectId, rawToken } = await bounceAt("final_review");
    const result = await resubmitProject(
      resubmitPayload(rawToken, projectId, 2, {
        uploads: [claim(projectId, 2, "invoice", "application/pdf")],
        carry: ["artwork_front", "artwork_back"],
        note: "New invoice only.",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.artworkChanged).toBe(false);
      expect(result.value.newStatus).toBe("final_review");
    }
    // carry-forward: v2 artwork rows point at v1 keys (shared within project).
    const fileRows = await db.select().from(files).where(eq(files.projectId, projectId));
    const v2Front = fileRows.filter((f) => f.kind === "artwork_front");
    expect(v2Front).toHaveLength(2);
    expect(new Set(v2Front.map((f) => f.r2Key)).size).toBe(1);
  });

  it("mode switch to combined routes to content_review; mixing modes is rejected", async () => {
    const { projectId, rawToken } = await bounceAt("legal_review");
    const bad = await resubmitProject(
      resubmitPayload(rawToken, projectId, 2, {
        uploads: [claim(projectId, 2, "artwork_combined")],
        carry: ["artwork_front", "invoice"], // front + combined = invalid mix
      }),
    );
    expect(bad.ok).toBe(false);

    const good = await resubmitProject(
      resubmitPayload(rawToken, projectId, 2, {
        uploads: [claim(projectId, 2, "artwork_combined")],
        carry: ["invoice"],
      }),
    );
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value.newStatus).toBe("content_review");
  });

  it("rejects a no-op resubmission (nothing changed, no note)", async () => {
    const { projectId, rawToken } = await bounceAt("content_review");
    const result = await resubmitProject(
      resubmitPayload(rawToken, projectId, 2, {
        carry: ["artwork_front", "artwork_back", "invoice"],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Nothing changed/);
  });

  it("omitted total cost carries forward unchanged (price hidden from the resubmit form)", async () => {
    const { projectId, rawToken } = await bounceAt("content_review");
    const payload = resubmitPayload(rawToken, projectId, 2, {
      carry: ["artwork_front", "artwork_back", "invoice"],
      note: "Note only, cost omitted.",
    });
    delete (payload.project as { totalCostCents?: number }).totalCostCents;
    const result = await resubmitProject(payload);
    expect(result.ok).toBe(true);
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project!.totalCostCents).toBe(123456);
  });

  it("a note alone is a valid resubmission and returns to the kicking stage", async () => {
    const { projectId, rawToken } = await bounceAt("content_review");
    const result = await resubmitProject(
      resubmitPayload(rawToken, projectId, 2, {
        carry: ["artwork_front", "artwork_back", "invoice"],
        note: "The disclaimer is on the back, bottom-left — see version 1.",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.newStatus).toBe("content_review");
  });

  it("rejects resubmission when the project is not awaiting changes", async () => {
    const { projectId, rawToken } = await makeProject();
    const result = await resubmitProject(
      resubmitPayload(rawToken, projectId, 2, {
        carry: ["artwork_front", "artwork_back", "invoice"],
        note: "hello",
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid vendor token", async () => {
    const { projectId } = await makeProject();
    const result = await resubmitProject(
      resubmitPayload("not-a-real-token", projectId, 2, { note: "x" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});

describe("override wait (admin resume without resubmission)", () => {
  it("resumes at the kicking stage on the same version, then allows a fresh decision", async () => {
    const { projectId } = await makeProject();
    const advance = await decideReview({
      projectId,
      stage: "content_review",
      decision: "advanced",
      checklist: {},
      notes: null,
      adminId,
    });
    expect(advance.ok).toBe(true);
    const bounce = await decideReview({
      projectId,
      stage: "campaign_review",
      decision: "changes_requested",
      checklist: {},
      notes: "Needs the paid-for disclaimer.",
      adminId,
    });
    expect(bounce.ok).toBe(true);

    const override = await overrideWait({ projectId, adminId });
    expect(override.ok).toBe(true);
    if (override.ok) expect(override.value.newStatus).toBe("campaign_review");

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project!.status).toBe("campaign_review");
    expect(project!.changesRequestedFrom).toBeNull();

    // Same version, no new submission_versions row.
    const versions = await db
      .select()
      .from(submissionVersions)
      .where(eq(submissionVersions.projectId, projectId));
    expect(versions).toHaveLength(1);

    // The stage can be decided again (upsert over the changes_requested row).
    const redecide = await decideReview({
      projectId,
      stage: "campaign_review",
      decision: "advanced",
      checklist: {},
      notes: null,
      adminId,
    });
    expect(redecide.ok).toBe(true);

    const events2 = await db.select().from(events).where(eq(events.projectId, projectId));
    expect(events2.map((e) => e.eventType)).toContain("changes_request.overridden");
  });

  it("rejects an override when the project is not waiting on the vendor", async () => {
    const { projectId } = await makeProject();
    const result = await overrideWait({ projectId, adminId });
    expect(result.ok).toBe(false);
  });
});

describe("reopen (§5 row 10) and re-decide", () => {
  it("superuser reopens an approved project to final_review and can re-decide (upsert)", async () => {
    const { projectId } = await makeProject();
    for (const stage of [
      "content_review",
      "campaign_review",
      "legal_review",
      "final_review",
    ] as const) {
      const r = await decideReview({ projectId, stage, decision: "advanced", checklist: {}, notes: null, adminId });
      expect(r.ok).toBe(true);
    }

    const denied = await reopenProject({ projectId, reason: "", adminId: superuserId, isSuperuser: true });
    expect(denied.ok).toBe(false); // reason required

    const notSuper = await reopenProject({ projectId, reason: "Costs changed", adminId, isSuperuser: false });
    expect(notSuper.ok).toBe(false);

    const reopened = await reopenProject({ projectId, reason: "Costs changed", adminId: superuserId, isSuperuser: true });
    expect(reopened.ok).toBe(true);
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project!.status).toBe("final_review");

    // Re-decide final_review on the same version: upsert keeps one row.
    const redecide = await decideReview({
      projectId,
      stage: "final_review",
      decision: "denied",
      checklist: {},
      notes: "Costs no longer match the invoice.",
      adminId,
    });
    expect(redecide.ok).toBe(true);
    const reviews = await db
      .select()
      .from(stageReviews)
      .where(eq(stageReviews.projectId, projectId));
    expect(reviews.filter((r) => r.stage === "final_review")).toHaveLength(1);
    expect(reviews.find((r) => r.stage === "final_review")!.decision).toBe("denied");
  });
});

describe("payment tracking, link rotation, dashboard", () => {
  it("marks a paid_by_kdp contact paid/unpaid with events; rejects others", async () => {
    const { projectId } = await makeProject();
    const rows = await db.select().from(contacts).where(eq(contacts.projectId, projectId));
    const printShop = rows.find((c) => c.role === "print_shop")!;
    const mailHouse = rows.find((c) => c.role === "mail_house")!;

    const paid = await setContactPaid({ projectId, contactId: printShop.id, paid: true, adminId });
    expect(paid.ok).toBe(true);
    const notEligible = await setContactPaid({ projectId, contactId: mailHouse.id, paid: true, adminId });
    expect(notEligible.ok).toBe(false);

    const dash = await getDashboardRows();
    const row = dash.find((r) => r.id === projectId)!;
    expect(row.paidNeeded).toBe(1);
    expect(row.paidDone).toBe(1);

    const unpaid = await setContactPaid({ projectId, contactId: printShop.id, paid: false, adminId });
    expect(unpaid.ok).toBe(true);
  });

  it("admin sets the campaign contact; resubmission never clobbers it", async () => {
    const { projectId, rawToken } = await makeProject();
    const set = await setCampaignContact({
      projectId,
      name: "Casey Campaign",
      email: "Casey@Campaign.example",
      phone: "785-555-0100",
      adminId,
    });
    expect(set.ok).toBe(true);

    // Kick back and resubmit with a note; the admin-set contact must survive.
    const bounce = await decideReview({
      projectId,
      stage: "content_review",
      decision: "changes_requested",
      checklist: {},
      notes: "Fix it.",
      adminId,
    });
    expect(bounce.ok).toBe(true);
    const resubmit = await resubmitProject(
      resubmitPayload(rawToken, projectId, 2, {
        carry: ["artwork_front", "artwork_back", "invoice"],
        note: "Done.",
      }),
    );
    expect(resubmit.ok).toBe(true);

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project!.campaignContactName).toBe("Casey Campaign");
    expect(project!.campaignContactEmail).toBe("casey@campaign.example");
    expect(project!.campaignContactPhone).toBe("785-555-0100");
  });

  it("regenerating the link rotates the hash and stamps token_rotated_at", async () => {
    const { projectId, rawToken } = await makeProject();
    const before = hashVendorToken(rawToken);
    const result = await regenerateLink({ projectId, adminId });
    expect(result.ok).toBe(true);
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project!.vendorTokenHash).not.toBe(before);
    expect(project!.tokenRotatedAt).not.toBeNull();
    if (result.ok) {
      expect(hashVendorToken(result.value.rawToken)).toBe(project!.vendorTokenHash);
    }
  });
});

describe("review invites & feedback (post-spec amendment 2026-08-17)", () => {
  const rawFrom = (url: string) => url.split("/r/")[1]!;

  async function projectAtCampaignReview(): Promise<string> {
    const { projectId } = await makeProject();
    const r = await decideReview({
      projectId,
      stage: "content_review",
      decision: "advanced",
      checklist: {},
      notes: null,
      adminId,
    });
    expect(r.ok).toBe(true);
    return projectId;
  }

  it("outside reviewer feedback is recorded but never moves the project", async () => {
    const projectId = await projectAtCampaignReview();
    const [invite] = await createReviewInvites({
      projectId,
      stage: "campaign_review",
      recipients: [
        { email: "Blair@Example.com", name: "Blair", role: "outside_reviewer" },
      ],
    });

    const result = await submitReviewResponse({
      rawToken: rawFrom(invite!.url),
      decision: "approved",
      notes: "No problems spotted.",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.advanced).toBe(false);

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project!.status).toBe("campaign_review");

    const feedback = await listReviewFeedback(projectId);
    expect(feedback).toHaveLength(1);
    expect(feedback[0]!.invite.recipientEmail).toBe("blair@example.com");
    expect(feedback[0]!.responses).toHaveLength(1);
    expect(feedback[0]!.responses[0]!.decision).toBe("approved");
  });

  it("campaign contact approval advances campaign_review → legal_review", async () => {
    const projectId = await projectAtCampaignReview();
    const [invite] = await createReviewInvites({
      projectId,
      stage: "campaign_review",
      recipients: [
        { email: "casey@campaign.example", name: "Casey", role: "campaign_contact" },
      ],
    });

    const result = await submitReviewResponse({
      rawToken: rawFrom(invite!.url),
      decision: "approved",
      notes: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.advanced).toBe(true);
      expect(result.value.newStatus).toBe("legal_review");
    }
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project!.status).toBe("legal_review");

    // The window closed with the advance: the same link can't be used again.
    const again = await submitReviewResponse({
      rawToken: rawFrom(invite!.url),
      decision: "issues",
      notes: "Changed my mind.",
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.message).toMatch(/closed/);
  });

  it("a campaign contact flagging issues does NOT move the project", async () => {
    const projectId = await projectAtCampaignReview();
    const [invite] = await createReviewInvites({
      projectId,
      stage: "campaign_review",
      recipients: [
        { email: "casey@campaign.example", name: "Casey", role: "campaign_contact" },
      ],
    });
    const result = await submitReviewResponse({
      rawToken: rawFrom(invite!.url),
      decision: "issues",
      notes: "The polling place listed is wrong.",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.advanced).toBe(false);
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project!.status).toBe("campaign_review");
  });

  it("links stop working once the project leaves the stage", async () => {
    const projectId = await projectAtCampaignReview();
    const [invite] = await createReviewInvites({
      projectId,
      stage: "campaign_review",
      recipients: [
        { email: "blair@example.com", name: "Blair", role: "outside_reviewer" },
      ],
    });

    const advance = await decideReview({
      projectId,
      stage: "campaign_review",
      decision: "advanced",
      checklist: {},
      notes: null,
      adminId,
    });
    expect(advance.ok).toBe(true);

    const view = await getReviewInviteView(rawFrom(invite!.url));
    expect(view!.open).toBe(false);

    const result = await submitReviewResponse({
      rawToken: rawFrom(invite!.url),
      decision: "approved",
      notes: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("re-sending revokes the earlier invite for the same recipient+stage", async () => {
    const projectId = await projectAtCampaignReview();
    const recipient = [
      { email: "blair@example.com", name: "Blair", role: "outside_reviewer" as const },
    ];
    const [first] = await createReviewInvites({
      projectId,
      stage: "campaign_review",
      recipients: recipient,
    });
    const [second] = await createReviewInvites({
      projectId,
      stage: "campaign_review",
      recipients: recipient,
    });

    const staleView = await getReviewInviteView(rawFrom(first!.url));
    expect(staleView!.open).toBe(false);
    const stale = await submitReviewResponse({
      rawToken: rawFrom(first!.url),
      decision: "approved",
      notes: null,
    });
    expect(stale.ok).toBe(false);

    const fresh = await submitReviewResponse({
      rawToken: rawFrom(second!.url),
      decision: "approved",
      notes: null,
    });
    expect(fresh.ok).toBe(true);
  });

  it("responding again for the same version updates the earlier response", async () => {
    const projectId = await projectAtCampaignReview();
    const [invite] = await createReviewInvites({
      projectId,
      stage: "campaign_review",
      recipients: [
        { email: "blair@example.com", name: "Blair", role: "outside_reviewer" },
      ],
    });
    const raw = rawFrom(invite!.url);

    const flag = await submitReviewResponse({
      rawToken: raw,
      decision: "issues",
      notes: "Typo in the headline.",
    });
    expect(flag.ok).toBe(true);
    const revise = await submitReviewResponse({
      rawToken: raw,
      decision: "approved",
      notes: "Never mind — misread it.",
    });
    expect(revise.ok).toBe(true);

    const feedback = await listReviewFeedback(projectId);
    expect(feedback[0]!.responses).toHaveLength(1);
    expect(feedback[0]!.responses[0]!.decision).toBe("approved");
  });

  it("unknown tokens are rejected", async () => {
    expect(await getReviewInviteView("no-such-token")).toBeNull();
    const result = await submitReviewResponse({
      rawToken: "no-such-token",
      decision: "approved",
      notes: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});

describe("deletion (§10)", () => {
  it("requires the typed candidate name, purges R2, tombstones, cascades", async () => {
    const { projectId } = await makeProject();

    const wrongName = await deleteProject({ projectId, confirmName: "Wrong Name", adminId });
    expect(wrongName.ok).toBe(false);

    const result = await deleteProject({ projectId, confirmName: "Test Candidate", adminId });
    expect(result.ok).toBe(true);

    expect(
      [...r2store.keys()].filter((k) => k.startsWith(`projects/${projectId}/`)),
    ).toHaveLength(0);

    const [gone] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(gone).toBeUndefined();
    const fileRows = await db.select().from(files).where(eq(files.projectId, projectId));
    expect(fileRows).toHaveLength(0);

    const [tombstone] = await db
      .select()
      .from(deletedProjects)
      .where(eq(deletedProjects.id, projectId));
    expect(tombstone).toBeDefined();
    expect(tombstone!.candidateSupported).toBe("Test Candidate");
    expect(tombstone!.finalStatus).toBe("content_review");
  });
});
