/**
 * Admin-triggered grouped reminder: one email to one reviewer listing every
 * review they still owe, across all projects, each with its own existing
 * /r/{token} link. The list is recomputed here, so it reflects responses that
 * landed after the dashboard was loaded. A single outstanding review gets the
 * ordinary per-project reminder instead, so it stays in that project's thread.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { guardAdminRequest } from "@/lib/admin-api";
import { sendAndLog } from "@/lib/email/send";
import {
  reviewReminder,
  reviewReminderGrouped,
  type GroupedReminderItem,
} from "@/lib/email/templates";
import { formatDate, projectRef } from "@/lib/format";
import { jsonError } from "@/lib/http";
import { listOutstandingReviews, remindReviewInvite } from "@/lib/review-invites";
import { officeLabel, type Office } from "@/lib/schemas/project";
import { STATUS_LABELS } from "@/lib/state-machine";

const bodySchema = z.object({ email: z.email() });

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await guardAdminRequest(request);
  if ("response" in guard) return guard.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Invalid email address.");

  const outstanding = await listOutstandingReviews(parsed.data.email);
  if (outstanding.length === 0) {
    return jsonError(409, "This reviewer has no outstanding reviews.");
  }
  const grouped = outstanding.length > 1;

  const items: Array<GroupedReminderItem & { projectId: string }> = [];
  for (const o of outstanding) {
    const result = await remindReviewInvite({
      projectId: o.projectId,
      inviteId: o.inviteId,
      adminId: guard.session.admin.id,
      grouped,
    });
    // A project that moved on since the list was read just drops out.
    if (!result.ok) continue;
    items.push({
      projectId: o.projectId,
      p: {
        ref: projectRef(o.projectId),
        candidateSupported: o.candidateSupported,
        officeLabel: officeLabel(o.office as Office),
        mailDateFormatted: formatDate(o.mailDate),
      },
      stageLabel: STATUS_LABELS[result.value.stage],
      reviewLink: result.value.url,
      campaignContact: result.value.role === "campaign_contact",
      sameLink: result.value.sameLink,
    });
  }
  if (items.length === 0) {
    return jsonError(409, "This reviewer has no outstanding reviews.");
  }

  const email = outstanding[0]!.email;
  const freshLinks = items.filter((i) => !i.sameLink).length;
  if (items.length === 1) {
    const only = items[0]!;
    await sendAndLog(
      only.projectId,
      [email],
      reviewReminder(only.p, only.stageLabel, only.reviewLink, {
        campaignContact: only.campaignContact,
        sameLink: only.sameLink,
      }),
    );
  } else {
    await sendAndLog(null, [email], reviewReminderGrouped(outstanding[0]!.name, items));
  }

  return NextResponse.json({ ok: true, count: items.length, freshLinks });
}
