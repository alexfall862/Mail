/**
 * Per-recipient review magic links + logged feedback (post-spec amendment,
 * 2026-08-17). Outside reviewers and the campaign contact each get their own
 * /r/{token} link so feedback is attributed to a person; a link works only
 * while the project still sits at the invite's stage, so input can never race
 * a stage change. A campaign contact's "approve" at campaign_review advances
 * the project (admin team notified, vendor deliberately not).
 *
 * Token handling mirrors the vendor magic link: 32 random bytes base64url,
 * only sha256 stored. Unlike the vendor token there is no encrypted copy —
 * a re-send simply revokes the old invite and issues a fresh token.
 */
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  files as filesTable,
  projects,
  reviewInvites,
  reviewResponses,
  stageReviews,
  submissionVersions,
} from "@/db/schema";
import { logEvent } from "./events";
import {
  transition,
  type ProjectStatus,
  type ReviewStage,
} from "./state-machine";
import { generateVendorToken, hashVendorToken } from "./tokens";

export type InviteRole = "outside_reviewer" | "campaign_contact";
export type ResponseDecision = "approved" | "issues";

export type InviteOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; message: string };

function fail<T>(status: number, message: string): InviteOpResult<T> {
  return { ok: false, status, message };
}

export function reviewInviteUrl(rawToken: string): string {
  return `${process.env.APP_URL}/r/${rawToken}`;
}

export type CreatedInvite = {
  email: string;
  name: string;
  role: InviteRole;
  /** Full /r/{token} link; exists only in memory and outgoing email. */
  url: string;
};

/**
 * Issue one invite per recipient for a project+stage. Any live invite for the
 * same (project, stage, email) is revoked first, so a re-send invalidates the
 * previously emailed link rather than leaving two live tokens per person.
 */
export async function createReviewInvites(input: {
  projectId: string;
  stage: ProjectStatus;
  recipients: Array<{ email: string; name: string; role: InviteRole }>;
}): Promise<CreatedInvite[]> {
  const created: Array<CreatedInvite & { hash: string }> = [];
  for (const r of input.recipients) {
    const token = generateVendorToken();
    created.push({
      email: r.email.trim().toLowerCase(),
      name: r.name.trim(),
      role: r.role,
      url: reviewInviteUrl(token.raw),
      hash: token.hash,
    });
  }
  await db.transaction(async (tx) => {
    for (const invite of created) {
      await tx
        .update(reviewInvites)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(reviewInvites.projectId, input.projectId),
            eq(reviewInvites.stage, input.stage),
            eq(reviewInvites.recipientEmail, invite.email),
            isNull(reviewInvites.revokedAt),
          ),
        );
      await tx.insert(reviewInvites).values({
        projectId: input.projectId,
        stage: input.stage,
        role: invite.role,
        recipientEmail: invite.email,
        recipientName: invite.name,
        tokenHash: invite.hash,
      });
    }
  });
  return created.map(({ hash: _hash, ...invite }) => invite);
}

export type ReviewInviteView = {
  invite: typeof reviewInvites.$inferSelect;
  project: typeof projects.$inferSelect;
  /** Usable now: not revoked and the project still sits at the invite stage. */
  open: boolean;
  currentVersion:
    | (typeof submissionVersions.$inferSelect & {
        files: Array<typeof filesTable.$inferSelect>;
      })
    | null;
  /** This invite's response for the current version, if any. */
  response: typeof reviewResponses.$inferSelect | null;
  /** Stage that denied the current version (while status = denied), for the
   * progress timeline. */
  deniedStage: ReviewStage | null;
};

/** Load everything the /r/{token} page needs. Null = unknown token. */
export async function getReviewInviteView(
  rawToken: string,
): Promise<ReviewInviteView | null> {
  const tokenHash = hashVendorToken(rawToken);
  const [invite] = await db
    .select()
    .from(reviewInvites)
    .where(eq(reviewInvites.tokenHash, tokenHash));
  if (!invite) return null;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, invite.projectId));
  if (!project) return null;

  let currentVersion: ReviewInviteView["currentVersion"] = null;
  let response: ReviewInviteView["response"] = null;
  let deniedStage: ReviewStage | null = null;
  if (project.currentVersionId) {
    if (project.status === "denied") {
      const [denial] = await db
        .select({ stage: stageReviews.stage })
        .from(stageReviews)
        .where(
          and(
            eq(stageReviews.versionId, project.currentVersionId),
            eq(stageReviews.decision, "denied"),
          ),
        );
      deniedStage = (denial?.stage as ReviewStage | undefined) ?? null;
    }
    const [version] = await db
      .select()
      .from(submissionVersions)
      .where(eq(submissionVersions.id, project.currentVersionId));
    if (version) {
      const versionFiles = await db
        .select()
        .from(filesTable)
        .where(eq(filesTable.versionId, version.id));
      currentVersion = { ...version, files: versionFiles };
    }
    const [existing] = await db
      .select()
      .from(reviewResponses)
      .where(
        and(
          eq(reviewResponses.inviteId, invite.id),
          eq(reviewResponses.versionId, project.currentVersionId),
        ),
      );
    response = existing ?? null;
  }

  return {
    invite,
    project,
    open: invite.revokedAt === null && project.status === invite.stage,
    currentVersion,
    response,
    deniedStage,
  };
}

export type SubmittedResponse = {
  projectId: string;
  role: InviteRole;
  recipientEmail: string;
  recipientName: string;
  decision: ResponseDecision;
  /** True when a campaign-contact approval advanced the project. */
  advanced: boolean;
  newStatus: ProjectStatus | null;
};

/**
 * Record a reviewer's response. Runs under the project row lock so the
 * stage check and the campaign-signoff advance can't race an admin decision
 * (the loser sees a clean "window closed" error). Responding again for the
 * same version updates the earlier response.
 */
export async function submitReviewResponse(input: {
  rawToken: string;
  decision: ResponseDecision;
  notes: string | null;
}): Promise<InviteOpResult<SubmittedResponse>> {
  const tokenHash = hashVendorToken(input.rawToken);
  const [found] = await db
    .select({ id: reviewInvites.id, projectId: reviewInvites.projectId })
    .from(reviewInvites)
    .where(eq(reviewInvites.tokenHash, tokenHash));
  if (!found) return fail(404, "This review link isn't valid.");

  return db.transaction(async (tx) => {
    // Same lock discipline as admin-ops: row lock first, then re-read both
    // rows inside the lock so the stage/revocation check is race-free.
    await tx.execute(
      sql`select id from projects where id = ${found.projectId} for update`,
    );
    const [project] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, found.projectId));
    const [invite] = await tx
      .select()
      .from(reviewInvites)
      .where(eq(reviewInvites.id, found.id));
    if (!project || !invite) return fail(404, "This review link isn't valid.");

    if (invite.revokedAt !== null) {
      return fail(
        409,
        "This link was replaced by a newer one. Check your email for the most recent review link.",
      );
    }
    if (project.status !== invite.stage) {
      return fail(
        409,
        "This review window has closed. The project has moved on since this link was sent.",
      );
    }
    if (!project.currentVersionId) {
      return fail(500, "Project has no current version.");
    }

    await tx
      .insert(reviewResponses)
      .values({
        inviteId: invite.id,
        projectId: project.id,
        versionId: project.currentVersionId,
        decision: input.decision,
        notes: input.notes,
      })
      .onConflictDoUpdate({
        target: [reviewResponses.inviteId, reviewResponses.versionId],
        set: {
          decision: input.decision,
          notes: input.notes,
          createdAt: new Date(),
        },
      });

    await logEvent(tx, {
      projectId: project.id,
      actor: "reviewer",
      eventType: "review_response.submitted",
      payload: {
        stage: invite.stage,
        role: invite.role,
        email: invite.recipientEmail,
        name: invite.recipientName,
        decision: input.decision,
        notes: input.notes,
      },
    });

    // Campaign sign-off: an approval from the campaign contact at campaign
    // review advances the project on the spot (no admin decision needed).
    let advanced = false;
    let newStatus: ProjectStatus | null = null;
    if (
      invite.role === "campaign_contact" &&
      invite.stage === "campaign_review" &&
      input.decision === "approved"
    ) {
      const result = transition(
        {
          status: project.status,
          changesRequestedFrom: project.changesRequestedFrom,
        },
        { kind: "campaign_signoff" },
      );
      if (!result.ok) return fail(409, result.message);
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
        actor: "reviewer",
        eventType: "status.changed",
        payload: {
          from: project.status,
          to: result.state.status,
          via: "campaign_signoff",
          email: invite.recipientEmail,
        },
      });
      advanced = true;
      newStatus = result.state.status;
    }

    return {
      ok: true as const,
      value: {
        projectId: project.id,
        role: invite.role as InviteRole,
        recipientEmail: invite.recipientEmail,
        recipientName: invite.recipientName,
        decision: input.decision,
        advanced,
        newStatus,
      },
    };
  });
}

export type ReviewFeedbackItem = {
  invite: typeof reviewInvites.$inferSelect;
  responses: Array<
    typeof reviewResponses.$inferSelect & { versionNumber: number | null }
  >;
};

/** All invites for a project with their responses, for the admin panel. */
export async function listReviewFeedback(
  projectId: string,
): Promise<ReviewFeedbackItem[]> {
  const invites = await db
    .select()
    .from(reviewInvites)
    .where(eq(reviewInvites.projectId, projectId))
    .orderBy(desc(reviewInvites.createdAt));
  if (invites.length === 0) return [];
  const responses = await db
    .select({
      response: reviewResponses,
      versionNumber: submissionVersions.versionNumber,
    })
    .from(reviewResponses)
    .leftJoin(
      submissionVersions,
      eq(reviewResponses.versionId, submissionVersions.id),
    )
    .where(eq(reviewResponses.projectId, projectId))
    .orderBy(asc(reviewResponses.createdAt));
  return invites.map((invite) => ({
    invite,
    responses: responses
      .filter((r) => r.response.inviteId === invite.id)
      .map((r) => ({ ...r.response, versionNumber: r.versionNumber })),
  }));
}
