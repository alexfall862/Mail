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
import { projectEmailContext, sendAndLog } from "@/lib/email/send";
import { campaignReviewRequest } from "@/lib/email/templates";
import { jsonError } from "@/lib/http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await guardAdminRequest(request);
  if ("response" in guard) return guard.response;
  const { id } = await params;

  const [project] = await db
    .select({
      status: projects.status,
      campaignContactEmail: projects.campaignContactEmail,
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
    return jsonError(400, "This project has no campaign contact email on file.");
  }

  const ctx = await projectEmailContext(id);
  if (!ctx) return jsonError(404, "Project not found.");

  const primaryOrgs = (
    await db
      .select({ orgName: contacts.orgName })
      .from(contacts)
      .where(and(eq(contacts.projectId, id), eq(contacts.isPrimary, true)))
  ).map((c) => c.orgName);

  await sendAndLog(
    id,
    [project.campaignContactEmail],
    campaignReviewRequest(ctx.summary, primaryOrgs, ctx.magicLink),
  );

  return NextResponse.json({ ok: true });
}
