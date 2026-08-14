/**
 * Admin-triggered notice to the standing reviewer contacts (compliance,
 * legal, etc.) configured for the project's current stage in
 * src/lib/reviewer-contacts.ts. Recipients must come from that roster;
 * re-sending is allowed and every send lands in the event timeline.
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
import { reviewerContactsFor } from "@/lib/reviewer-contacts";
import { emailOptionsSchema } from "@/lib/schemas/admin";
import { isReviewStage, STATUS_LABELS } from "@/lib/state-machine";

const bodySchema = z.object({
  /** Subset of the configured roster; omitted = everyone configured. */
  recipients: z.array(z.email()).max(20).optional(),
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
    .select({ status: projects.status })
    .from(projects)
    .where(eq(projects.id, id));
  if (!project) return jsonError(404, "Project not found.");
  if (!isReviewStage(project.status)) {
    return jsonError(409, "This project is not at a review stage right now.");
  }

  const configured = reviewerContactsFor(project.status);
  if (configured.length === 0) {
    return jsonError(
      400,
      "No reviewer contacts are configured for this stage (src/lib/reviewer-contacts.ts).",
    );
  }
  const configuredEmails = new Set(configured.map((c) => c.email.toLowerCase()));
  const to = (
    parsed.data.recipients ?? configured.map((c) => c.email)
  ).filter((e) => configuredEmails.has(e.toLowerCase()));
  if (to.length === 0) {
    return jsonError(400, "Select at least one configured reviewer contact.");
  }

  const ctx = await projectEmailContext(id);
  if (!ctx) return jsonError(404, "Project not found.");

  const cc = [
    ...(parsed.data.emailOptions.ccAdmins ? await activeAdminEmails() : []),
    ...parsed.data.emailOptions.extraCc,
  ];
  await sendAndLog(
    id,
    [...new Set(to)],
    reviewerNotice(ctx.summary, STATUS_LABELS[project.status], ctx.magicLink),
    { cc },
  );

  return NextResponse.json({ ok: true });
}
