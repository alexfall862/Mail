/**
 * Admin-triggered reminder for one outstanding review request. Re-sends the
 * recipient's existing /r/{token} link, so the original email keeps working
 * (unlike the reviewer-notice / campaign-request buttons, which rotate it).
 * Goes to the reviewer only; the send lands in the event timeline.
 */
import { NextResponse } from "next/server";
import { guardAdminRequest } from "@/lib/admin-api";
import { projectEmailContext, sendAndLog } from "@/lib/email/send";
import { reviewReminder } from "@/lib/email/templates";
import { jsonError } from "@/lib/http";
import { remindReviewInvite } from "@/lib/review-invites";
import { STATUS_LABELS } from "@/lib/state-machine";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; inviteId: string }> },
): Promise<NextResponse> {
  const guard = await guardAdminRequest(request);
  if ("response" in guard) return guard.response;
  const { id, inviteId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(inviteId)) {
    return jsonError(404, "Review request not found.");
  }

  const ctx = await projectEmailContext(id);
  if (!ctx) return jsonError(404, "Project not found.");

  const result = await remindReviewInvite({
    projectId: id,
    inviteId,
    adminId: guard.session.admin.id,
  });
  if (!result.ok) return jsonError(result.status, result.message);
  const target = result.value;

  await sendAndLog(
    id,
    [target.email],
    reviewReminder(ctx.summary, STATUS_LABELS[target.stage], target.url, {
      campaignContact: target.role === "campaign_contact",
      sameLink: target.sameLink,
    }),
  );

  return NextResponse.json({ ok: true, sameLink: target.sameLink });
}
