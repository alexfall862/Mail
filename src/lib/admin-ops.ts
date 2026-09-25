/**
 * Admin project operations (SPEC §5, §7, §10). Every state transition runs in
 * a transaction holding SELECT … FOR UPDATE on the project row; the losing
 * side of a concurrent action gets a clean "already moved" error.
 */
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  admins,
  contacts as contactsTable,
  deletedProjects,
  events as eventsTable,
  files as filesTable,
  projects,
  stageReviews,
  submissionVersions,
} from "@/db/schema";
import { logEvent } from "./events";
import { deleteProjectPrefix } from "./r2";
import {
  transition,
  type ProjectStatus,
  type ReviewDecision,
  type ReviewStage,
} from "./state-machine";
import { encryptVendorToken } from "./token-crypto";
import { generateVendorToken } from "./tokens";

export type OpResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; message: string };

function fail<T>(status: number, message: string): OpResult<T> {
  return { ok: false, status, message };
}

async function lockProject(tx: Tx, projectId: string) {
  await tx.execute(sql`select id from projects where id = ${projectId} for update`);
  const [project] = await tx
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  return project ?? null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ReviewOutcome = {
  projectId: string;
  stage: ReviewStage;
  decision: ReviewDecision;
  notes: string | null;
  newStatus: ProjectStatus;
};

/** §5 rows 3–6, 8: an admin review decision at the project's current stage. */
export async function decideReview(input: {
  projectId: string;
  stage: ReviewStage;
  decision: ReviewDecision;
  checklist: Record<string, boolean>;
  notes: string | null;
  adminId: string;
}): Promise<OpResult<ReviewOutcome>> {
  return db.transaction(async (tx) => {
    const project = await lockProject(tx, input.projectId);
    if (!project) return fail(404, "Project not found.");

    const result = transition(
      {
        status: project.status,
        changesRequestedFrom: project.changesRequestedFrom,
      },
      { kind: "review_decision", stage: input.stage, decision: input.decision },
    );
    if (!result.ok) return fail(409, result.message);
    if (!project.currentVersionId) return fail(500, "Project has no current version.");

    // One decision per stage per version. The only legitimate re-decide is
    // after a superuser reopen (same version back at final_review) — upsert
    // keeps the constraint intact with the latest decision; the full history
    // stays in events.
    await tx
      .insert(stageReviews)
      .values({
        projectId: project.id,
        versionId: project.currentVersionId,
        stage: input.stage,
        decision: input.decision,
        checklist: input.checklist,
        notes: input.notes,
        reviewerId: input.adminId,
      })
      .onConflictDoUpdate({
        target: [stageReviews.versionId, stageReviews.stage],
        set: {
          decision: input.decision,
          checklist: input.checklist,
          notes: input.notes,
          reviewerId: input.adminId,
          decidedAt: new Date(),
        },
      });

    await tx
      .update(projects)
      .set({
        status: result.state.status,
        changesRequestedFrom: result.state.changesRequestedFrom,
        statusChangedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, project.id));

    await logEvent(tx, {
      projectId: project.id,
      actor: "admin",
      actorId: input.adminId,
      eventType: "review.decided",
      payload: {
        stage: input.stage,
        decision: input.decision,
        checklist: input.checklist,
        notes: input.notes,
      },
    });
    await logEvent(tx, {
      projectId: project.id,
      actor: "admin",
      actorId: input.adminId,
      eventType: "status.changed",
      payload: { from: project.status, to: result.state.status },
    });

    return {
      ok: true as const,
      value: {
        projectId: project.id,
        stage: input.stage,
        decision: input.decision,
        notes: input.notes,
        newStatus: result.state.status,
      },
    };
  });
}

/** §5 row 10: superuser reopen with a required reason. */
export async function reopenProject(input: {
  projectId: string;
  reason: string;
  adminId: string;
  isSuperuser: boolean;
}): Promise<OpResult<{ newStatus: ProjectStatus; reason: string }>> {
  return db.transaction(async (tx) => {
    const project = await lockProject(tx, input.projectId);
    if (!project) return fail(404, "Project not found.");

    const result = transition(
      {
        status: project.status,
        changesRequestedFrom: project.changesRequestedFrom,
      },
      {
        kind: "superuser_reopen",
        actorIsSuperuser: input.isSuperuser,
        reason: input.reason,
      },
    );
    if (!result.ok) {
      return fail(result.code === "not_superuser" ? 403 : 409, result.message);
    }

    await tx
      .update(projects)
      .set({
        status: result.state.status,
        changesRequestedFrom: null,
        statusChangedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, project.id));

    await logEvent(tx, {
      projectId: project.id,
      actor: "admin",
      actorId: input.adminId,
      eventType: "project.reopened",
      payload: {
        reason: input.reason.trim(),
        from: project.status,
        to: result.state.status,
      },
    });
    await logEvent(tx, {
      projectId: project.id,
      actor: "admin",
      actorId: input.adminId,
      eventType: "status.changed",
      payload: { from: project.status, to: result.state.status },
    });

    return {
      ok: true as const,
      value: { newStatus: result.state.status, reason: input.reason.trim() },
    };
  });
}

/**
 * §10 deletion: R2 purge first (an orphaned object costs ~nothing; a dangling
 * DB row is worse), then tombstone + cascade delete in one transaction.
 * Requires the typed candidate name to match. No emails.
 */
export async function deleteProject(input: {
  projectId: string;
  confirmName: string;
  adminId: string;
}): Promise<OpResult<{ deleted: true }>> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId));
  if (!project) return fail(404, "Project not found.");
  if (input.confirmName.trim() !== project.candidateSupported) {
    return fail(
      400,
      "The name you typed doesn't match the candidate on this project.",
    );
  }

  // First-attempt R2 purge before the transaction; log leftovers rather than
  // blocking the DB delete.
  try {
    const purge = await deleteProjectPrefix(project.id);
    if (!purge.verifiedEmpty) {
      console.error(
        `R2 purge incomplete for project ${project.id}: prefix not empty after delete`,
      );
    }
  } catch (err) {
    console.error(`R2 purge failed for project ${project.id}:`, err);
  }

  await db.transaction(async (tx) => {
    await tx.insert(deletedProjects).values({
      id: project.id,
      candidateSupported: project.candidateSupported,
      office: project.office,
      mailDate: project.mailDate,
      finalStatus: project.status,
      totalCostCents: project.totalCostCents,
      deletedBy: input.adminId,
    });
    // Cascades remove versions, files, contacts, reviews, events.
    await tx.delete(projects).where(eq(projects.id, project.id));
  });

  return { ok: true as const, value: { deleted: true } };
}

/** §7: regenerate the magic link; old link stops working immediately. */
export async function regenerateLink(input: {
  projectId: string;
  adminId: string;
}): Promise<OpResult<{ rawToken: string }>> {
  const token = generateVendorToken();
  const result = await db.transaction(async (tx) => {
    const project = await lockProject(tx, input.projectId);
    if (!project) return fail<{ rawToken: string }>(404, "Project not found.");
    await tx
      .update(projects)
      .set({
        vendorTokenHash: token.hash,
        vendorTokenEncrypted: encryptVendorToken(token.raw),
        tokenRotatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, project.id));
    await logEvent(tx, {
      projectId: project.id,
      actor: "admin",
      actorId: input.adminId,
      eventType: "token.rotated",
      payload: {},
    });
    return { ok: true as const, value: { rawToken: token.raw } };
  });
  return result;
}

/**
 * Admin override of the changes_requested wait: resume review at the stage
 * that requested changes, on the same version, with no emails. Used when a
 * "requested change" turns out to be a misunderstanding cleared up out of
 * band.
 */
export async function overrideWait(input: {
  projectId: string;
  adminId: string;
}): Promise<OpResult<{ newStatus: ProjectStatus }>> {
  return db.transaction(async (tx) => {
    const project = await lockProject(tx, input.projectId);
    if (!project) return fail(404, "Project not found.");

    const result = transition(
      {
        status: project.status,
        changesRequestedFrom: project.changesRequestedFrom,
      },
      { kind: "admin_resume_review" },
    );
    if (!result.ok) return fail(409, result.message);

    await tx
      .update(projects)
      .set({
        status: result.state.status,
        changesRequestedFrom: null,
        statusChangedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, project.id));

    await logEvent(tx, {
      projectId: project.id,
      actor: "admin",
      actorId: input.adminId,
      eventType: "changes_request.overridden",
      payload: { resumedStage: result.state.status },
    });
    await logEvent(tx, {
      projectId: project.id,
      actor: "admin",
      actorId: input.adminId,
      eventType: "status.changed",
      payload: { from: project.status, to: result.state.status },
    });

    return { ok: true as const, value: { newStatus: result.state.status } };
  });
}

/** Set/approve the campaign contact on a ticket (admin-owned data). */
export async function setCampaignContact(input: {
  projectId: string;
  name: string;
  email: string;
  phone: string | null;
  adminId: string;
}): Promise<OpResult<{ updated: true }>> {
  return db.transaction(async (tx) => {
    const project = await lockProject(tx, input.projectId);
    if (!project) return fail(404, "Project not found.");
    const email = input.email.trim().toLowerCase();
    const phone = input.phone?.trim() ? input.phone.trim() : null;
    await tx
      .update(projects)
      .set({
        campaignContactName: input.name.trim(),
        campaignContactEmail: email,
        campaignContactPhone: phone,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, project.id));
    await logEvent(tx, {
      projectId: project.id,
      actor: "admin",
      actorId: input.adminId,
      eventType: "campaign_contact.updated",
      payload: {
        previous: {
          name: project.campaignContactName,
          email: project.campaignContactEmail,
        },
        name: input.name.trim(),
        email,
      },
    });
    return { ok: true as const, value: { updated: true } };
  });
}

/**
 * Amend an approved project's total cost without touching its status: the
 * final invoice often differs from the quote on the submission, and sending
 * the piece back through review for a number change would be absurd.
 * Approved only — while a project is still in review the vendor resubmits
 * with the corrected quote, which keeps the reviewed artwork and cost in
 * step. Audited as `cost.amended` with both figures and an optional reason.
 */
export async function amendProjectCost(input: {
  projectId: string;
  totalCostCents: number;
  reason?: string;
  adminId: string;
}): Promise<OpResult<{ from: number; to: number }>> {
  return db.transaction(async (tx) => {
    const project = await lockProject(tx, input.projectId);
    if (!project) return fail(404, "Project not found.");
    if (project.status !== "approved") {
      return fail(
        409,
        "Only approved projects can have their cost amended; while a project is in review the vendor resubmits with the corrected quote.",
      );
    }
    const from = project.totalCostCents;
    const to = input.totalCostCents;
    if (from === to) return { ok: true as const, value: { from, to } };
    const reason = input.reason?.trim() || null;
    await tx
      .update(projects)
      .set({ totalCostCents: to, updatedAt: new Date() })
      .where(eq(projects.id, project.id));
    await logEvent(tx, {
      projectId: project.id,
      actor: "admin",
      actorId: input.adminId,
      eventType: "cost.amended",
      payload: { from, to, reason },
    });
    return { ok: true as const, value: { from, to } };
  });
}

/**
 * Record, amend, or clear a KDP payment to a vendor (visible only where
 * paid_by_kdp). Three cases:
 *  - paid=false: clears paid_at and the check details (`contact.unpaid`).
 *  - paid=true on an unpaid contact: stamps paid_at now, stores the check
 *    details given (`contact.paid`).
 *  - paid=true on an already-paid contact: keeps the original paid_at and
 *    marker, updates only the check fields that were supplied
 *    (`contact.payment_updated`) — so a check number can be attached to a
 *    payment recorded before check tracking existed.
 * `checkNumber`/`amountCents` undefined = leave unchanged; "" / null = clear.
 */
export async function setContactPaid(input: {
  projectId: string;
  contactId: string;
  paid: boolean;
  checkNumber?: string;
  amountCents?: number | null;
  adminId: string;
}): Promise<
  OpResult<{
    paidAt: Date | null;
    checkNumber: string | null;
    amountCents: number | null;
  }>
> {
  return db.transaction(async (tx) => {
    const [contact] = await tx
      .select()
      .from(contactsTable)
      .where(eq(contactsTable.id, input.contactId));
    if (!contact || contact.projectId !== input.projectId) {
      return fail(404, "Contact not found.");
    }
    if (!contact.paidByKdp) {
      return fail(400, "This vendor is not marked as needing KDP payment.");
    }

    const trimmedCheck = input.checkNumber?.trim();
    const checkNumber =
      input.checkNumber === undefined
        ? contact.paidCheckNumber
        : trimmedCheck
          ? trimmedCheck
          : null;
    const amountCents =
      input.amountCents === undefined ? contact.paidAmountCents : input.amountCents;

    if (!input.paid) {
      await tx
        .update(contactsTable)
        .set({
          paidAt: null,
          paidMarkedBy: null,
          paidCheckNumber: null,
          paidAmountCents: null,
        })
        .where(eq(contactsTable.id, contact.id));
      await logEvent(tx, {
        projectId: input.projectId,
        actor: "admin",
        actorId: input.adminId,
        eventType: "contact.unpaid",
        payload: {
          contactId: contact.id,
          role: contact.role,
          org: contact.orgName,
          previousCheckNumber: contact.paidCheckNumber,
        },
      });
      return {
        ok: true as const,
        value: { paidAt: null, checkNumber: null, amountCents: null },
      };
    }

    const alreadyPaid = contact.paidAt !== null;
    const paidAt = alreadyPaid ? contact.paidAt! : new Date();
    await tx
      .update(contactsTable)
      .set({
        paidAt,
        paidMarkedBy: alreadyPaid ? contact.paidMarkedBy : input.adminId,
        paidCheckNumber: checkNumber,
        paidAmountCents: amountCents,
      })
      .where(eq(contactsTable.id, contact.id));
    await logEvent(tx, {
      projectId: input.projectId,
      actor: "admin",
      actorId: input.adminId,
      eventType: alreadyPaid ? "contact.payment_updated" : "contact.paid",
      payload: {
        contactId: contact.id,
        role: contact.role,
        org: contact.orgName,
        checkNumber,
        amountCents,
        ...(alreadyPaid
          ? {
              previousCheckNumber: contact.paidCheckNumber,
              previousAmountCents: contact.paidAmountCents,
            }
          : {}),
      },
    });
    return { ok: true as const, value: { paidAt, checkNumber, amountCents } };
  });
}

// ---------------------------------------------------------------------------
// Admin read models
// ---------------------------------------------------------------------------

export type AdminProjectView = {
  project: typeof projects.$inferSelect;
  contacts: Array<typeof contactsTable.$inferSelect>;
  versions: Array<
    typeof submissionVersions.$inferSelect & {
      files: Array<typeof filesTable.$inferSelect>;
    }
  >;
  reviews: Array<
    typeof stageReviews.$inferSelect & { reviewerName: string | null }
  >;
  events: Array<typeof eventsTable.$inferSelect & { actorName: string | null }>;
};

export async function getAdminProjectView(
  projectId: string,
): Promise<AdminProjectView | null> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) return null;

  const [contactRows, versions, allFiles, reviewRows, eventRows] =
    await Promise.all([
      db
        .select()
        .from(contactsTable)
        .where(eq(contactsTable.projectId, projectId))
        .orderBy(asc(contactsTable.role)),
      db
        .select()
        .from(submissionVersions)
        .where(eq(submissionVersions.projectId, projectId))
        .orderBy(desc(submissionVersions.versionNumber)),
      db.select().from(filesTable).where(eq(filesTable.projectId, projectId)),
      db
        .select({
          review: stageReviews,
          reviewerName: admins.name,
        })
        .from(stageReviews)
        .leftJoin(admins, eq(stageReviews.reviewerId, admins.id))
        .where(eq(stageReviews.projectId, projectId))
        .orderBy(desc(stageReviews.decidedAt)),
      db
        .select({ event: eventsTable, actorName: admins.name })
        .from(eventsTable)
        .leftJoin(admins, eq(eventsTable.actorId, admins.id))
        .where(eq(eventsTable.projectId, projectId))
        .orderBy(desc(eventsTable.createdAt), desc(eventsTable.id)),
    ]);

  return {
    project,
    contacts: contactRows,
    versions: versions.map((v) => ({
      ...v,
      files: allFiles.filter((f) => f.versionId === v.id),
    })),
    reviews: reviewRows.map((r) => ({ ...r.review, reviewerName: r.reviewerName })),
    events: eventRows.map((e) => ({ ...e.event, actorName: e.actorName })),
  };
}

/** One KDP-payable vendor on a project, as the dashboard needs it. Dates are
 * ISO strings so the row can cross into client components unchanged. */
export type DashboardPayment = {
  contactId: string;
  role: string;
  orgName: string;
  paidAt: string | null;
  checkNumber: string | null;
  amountCents: number | null;
};

export type DashboardRow = {
  id: string;
  candidateSupported: string;
  office: string;
  status: ProjectStatus;
  changesRequestedFrom: ProjectStatus | null;
  mailDate: string;
  pieceCount: number;
  totalCostCents: number;
  paidNeeded: number;
  paidDone: number;
  /** Vendors with paid_by_kdp on this project (paidNeeded === payments.length). */
  payments: DashboardPayment[];
};

export async function getDashboardRows(
  statusFilter?: ProjectStatus,
): Promise<DashboardRow[]> {
  const rows = await db
    .select()
    .from(projects)
    .where(statusFilter ? eq(projects.status, statusFilter) : undefined)
    .orderBy(asc(projects.mailDate)); // §8: default sort mail_date asc
  if (rows.length === 0) return [];
  const allContacts = await db
    .select()
    .from(contactsTable)
    .where(eq(contactsTable.paidByKdp, true))
    .orderBy(asc(contactsTable.role));
  const byProject = new Map<string, DashboardPayment[]>();
  for (const c of allContacts) {
    const list = byProject.get(c.projectId) ?? [];
    list.push({
      contactId: c.id,
      role: c.role,
      orgName: c.orgName,
      paidAt: c.paidAt?.toISOString() ?? null,
      checkNumber: c.paidCheckNumber,
      amountCents: c.paidAmountCents,
    });
    byProject.set(c.projectId, list);
  }
  return rows.map((p) => {
    const payments = byProject.get(p.id) ?? [];
    return {
      id: p.id,
      candidateSupported: p.candidateSupported,
      office: p.office,
      status: p.status,
      changesRequestedFrom: p.changesRequestedFrom,
      mailDate: p.mailDate,
      pieceCount: p.pieceCount,
      totalCostCents: p.totalCostCents,
      paidNeeded: payments.length,
      paidDone: payments.filter((c) => c.paidAt !== null).length,
      payments,
    };
  });
}
