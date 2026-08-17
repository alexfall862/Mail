/**
 * Admin-triggered email asking the campaign contact to review the piece.
 * Only meaningful while the project sits in campaign review; re-sending is
 * allowed (every send lands in the event timeline).
 */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { contacts, projects } from "@/db/schema";
import { guardAdminRequest } from "@/lib/admin-api";
import {
  activeAdminEmails,
  projectEmailContext,
  sendAndLog,
} from "@/lib/email/send";
import { campaignReviewRequest } from "@/lib/email/templates";
import { jsonError } from "@/lib/http";
import { createReviewInvites } from "@/lib/review-invites";
import { emailOptionsSchema } from "@/lib/schemas/admin";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await guardAdminRequest(request);
  if ("response" in guard) return guard.response;
  const { id } = await params;

  const body = await request.json().catch(() => ({}));
  const options = emailOptionsSchema.safeParse(
    (body as { emailOptions?: unknown }).emailOptions ?? {},
  );
  if (!options.success) return jsonError(400, "Invalid additional email address.");

  const [project] = await db
    .select({
      status: projects.status,
      campaignContactEmail: projects.campaignContactEmail,
      campaignContactName: projects.campaignContactName,
    })
    .from(projects)
    .where(eq(projects.id, id));
  if (!project) return jsonError(404, "Project not found.");
  if (project.status !== "campaign_review") {
    return jsonError(
      409,
      "This project is not in campaign review, so the campaign review email can't be sent.",
    );
  }
  if (!project.campaignContactEmail) {
    return jsonError(
      400,
      "Set a campaign contact on the ticket before sending the review email.",
    );
  }

  const ctx = await projectEmailContext(id);
  if (!ctx) return jsonError(404, "Project not found.");

  const primaryOrgs = (
    await db
      .select({ orgName: contacts.orgName })
      .from(contacts)
      .where(and(eq(contacts.projectId, id), eq(contacts.isPrimary, true)))
  ).map((c) => c.orgName);

  // Personal review link: the contact approves (or flags issues) directly on
  // the page, and an approval advances the project out of campaign review.
  // Re-sending rotates the link; the previously emailed one stops working.
  const [invite] = await createReviewInvites({
    projectId: id,
    stage: "campaign_review",
    recipients: [
      {
        email: project.campaignContactEmail,
        name: project.campaignContactName,
        role: "campaign_contact",
      },
    ],
  });

  const cc = [
    ...(options.data.ccAdmins ? await activeAdminEmails() : []),
    ...options.data.extraCc,
  ];
  await sendAndLog(
    id,
    [project.campaignContactEmail],
    campaignReviewRequest(ctx.summary, primaryOrgs, invite!.url),
    { cc },
  );

  return NextResponse.json({ ok: true });
}
