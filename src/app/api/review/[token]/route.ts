/**
 * Reviewer feedback submission (/r/{token} form target). Public but token-
 * authenticated; valid only while the project sits at the invite's stage.
 * A campaign contact's approval at campaign review advances the project —
 * the admin team is emailed, the vendor deliberately is not (per the
 * 2026-08-17 amendment; the vendor still sees the status page update).
 */
import { NextResponse } from "next/server";
import {
  activeAdminEmails,
  projectEmailContext,
  sendAndLog,
} from "@/lib/email/send";
import { adminCampaignApproved } from "@/lib/email/templates";
import { assertSameOrigin, getClientIp, jsonError, rateLimited } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { submitReviewResponse } from "@/lib/review-invites";
import { reviewResponseSchema } from "@/lib/schemas/review";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const ip = getClientIp(request);
  const limit = rateLimit("reviewResponse", ip);
  if (!limit.allowed) return rateLimited(limit);

  const { token } = await params;
  const parsed = reviewResponseSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid feedback.");
  }

  const result = await submitReviewResponse({
    rawToken: token,
    decision: parsed.data.decision,
    notes: parsed.data.notes?.trim() ? parsed.data.notes.trim() : null,
  });
  if (!result.ok) return jsonError(result.status, result.message);

  // Campaign sign-off advanced the project: tell the admin team (post-commit,
  // like every send). No vendor email for this transition.
  if (result.value.advanced) {
    const ctx = await projectEmailContext(result.value.projectId);
    if (ctx) {
      await sendAndLog(
        result.value.projectId,
        await activeAdminEmails(),
        adminCampaignApproved(
          ctx.summary,
          result.value.recipientName,
          result.value.recipientEmail,
          ctx.adminUrl,
        ),
      );
    }
  }

  return NextResponse.json({ ok: true, advanced: result.value.advanced });
}
