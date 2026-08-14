/**
 * Admin-triggered review notice. Recipients may be any configured reviewer
 * (any stage's roster) or the project's campaign contact; with no recipients
 * selected the notice goes to the admin team only (quick internal heads-up
 * or testing). Re-sending is allowed; every send lands in the event timeline.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { guardAdminRequest } from "@/lib/admin-api";
import {
  activeAdminEmails,
  projectEmailContext,
  sendAndLog,
} from "@/lib/email/send";
import { reviewerNotice } from "@/lib/email/templates";
import { jsonError } from "@/lib/http";
import { allReviewerContacts } from "@/lib/reviewer-contacts";
import { emailOptionsSchema } from "@/lib/schemas/admin";
import { isReviewStage, STATUS_LABELS } from "@/lib/state-machine";

const bodySchema = z.object({
  /** Reviewer/campaign-contact emails; empty = admin team only. */
  recipients: z.array(z.email()).max(20).default([]),
  emailOptions: emailOptionsSchema.default({ ccAdmins: true, extraCc: [] }),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await guardAdminRequest(request);
  if ("response" in guard) return guard.response;
  const { id } = await params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, "Invalid request.");

  const [project] = await db
    .select({
      status: projects.status,
      campaignContactEmail: projects.campaignContactEmail,
    })
    .from(projects)
    .where(eq(projects.id, id));
  if (!project) return jsonError(404, "Project not found.");
  if (!isReviewStage(project.status)) {
    return jsonError(409, "This project is not at a review stage right now.");
  }

  // Whitelist: every configured reviewer plus this ticket's campaign
  // contact. At campaign review the campaign contact is excluded — the
  // dedicated sign-off request is the only email to them at that stage, so
  // they can never be double-emailed.
  const allowed = new Set(
    allReviewerContacts().map((c) => c.email.toLowerCase()),
  );
  if (project.campaignContactEmail && project.status !== "campaign_review") {
    allowed.add(project.campaignContactEmail.toLowerCase());
  }
  const requested = [...new Set(parsed.data.recipients)];
  const invalid = requested.filter((e) => !allowed.has(e.toLowerCase()));
  if (invalid.length > 0) {
    const isCampaignContact =
      project.campaignContactEmail &&
      invalid.some(
        (e) => e.toLowerCase() === project.campaignContactEmail.toLowerCase(),
      );
    return jsonError(
      400,
      isCampaignContact
        ? "At campaign review, email the campaign contact via the campaign sign-off request instead."
        : "Recipients must come from the configured reviewer rosters or be this project's campaign contact.",
    );
  }

  const ctx = await projectEmailContext(id);
  if (!ctx) return jsonError(404, "Project not found.");

  const admins = await activeAdminEmails();
  const adminOnly = requested.length === 0;
  const to = adminOnly ? admins : requested;
  const cc = adminOnly
    ? parsed.data.emailOptions.extraCc
    : [
        ...(parsed.data.emailOptions.ccAdmins ? admins : []),
        ...parsed.data.emailOptions.extraCc,
      ];

  await sendAndLog(
    id,
    to,
    reviewerNotice(ctx.summary, STATUS_LABELS[project.status], ctx.magicLink),
    { cc },
  );

  return NextResponse.json({ ok: true, adminOnly });
}
