/**
 * Admin-triggered review notice. Recipients may be any configured reviewer
 * (any stage's roster) or the project's campaign contact; with no recipients
 * selected the notice goes to the admin team only (quick internal heads-up
 * or testing). Each outside recipient gets a personal /r/{token} review link
 * (one email per person) so feedback they record is attributed; re-sending is
 * allowed and rotates their link. Every send lands in the event timeline.
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
import { createReviewInvites } from "@/lib/review-invites";
import { allReviewerContacts } from "@/lib/reviewer-contacts";
import { emailOptionsSchema } from "@/lib/schemas/admin";
import { isReviewStage, STATUS_LABELS } from "@/lib/state-machine";

const bodySchema = z.object({
  /** Reviewer/campaign-contact emails; empty = admin team only. */
  recipients: z.array(z.email()).max(20).default([]),
  emailOptions: emailOptionsSchema.default({ ccAdmins: false, extraCc: [] }),
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
      campaignContactName: projects.campaignContactName,
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
  const stageLabel = STATUS_LABELS[project.status];

  if (adminOnly) {
    await sendAndLog(id, admins, reviewerNotice(ctx.summary, stageLabel, ctx.adminUrl), {
      cc: parsed.data.emailOptions.extraCc,
    });
    return NextResponse.json({ ok: true, adminOnly });
  }

  // Each recipient gets their own /r/{token} review link so feedback they
  // record on the page is attributed to them — one email per recipient
  // (a shared CC'd send can't carry per-person links).
  const nameByEmail = new Map(
    allReviewerContacts().map((c) => [c.email.toLowerCase(), c.name]),
  );
  const campaignEmail = project.campaignContactEmail.toLowerCase();
  const invites = await createReviewInvites({
    projectId: id,
    stage: project.status,
    recipients: requested.map((email) => {
      const isCampaignContact = email.toLowerCase() === campaignEmail;
      return {
        email,
        name: isCampaignContact
          ? project.campaignContactName
          : (nameByEmail.get(email.toLowerCase()) ?? ""),
        role: isCampaignContact ? "campaign_contact" : "outside_reviewer",
      };
    }),
  });

  // CC list (admin team + extras) rides on the first send only — every send
  // is individually logged in the event timeline, and N carbon copies of
  // near-identical notices would drown the admin inbox.
  const cc = [
    ...(parsed.data.emailOptions.ccAdmins ? admins : []),
    ...parsed.data.emailOptions.extraCc,
  ];
  for (const [i, invite] of invites.entries()) {
    await sendAndLog(
      id,
      [invite.email],
      reviewerNotice(ctx.summary, stageLabel, invite.url),
      { cc: i === 0 ? cc : [] },
    );
  }

  return NextResponse.json({ ok: true, adminOnly });
}
