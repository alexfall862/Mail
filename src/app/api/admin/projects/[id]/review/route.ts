import { NextResponse } from "next/server";
import { decideReview } from "@/lib/admin-ops";
import { guardAdminRequest } from "@/lib/admin-api";
import { db } from "@/db";
import {
  activeAdminEmails,
  projectEmailContext,
  sendAndLog,
} from "@/lib/email/send";
import { logEvent } from "@/lib/events";
import {
  vendorApproved,
  vendorChangesRequested,
  vendorDenied,
  vendorStagePassed,
} from "@/lib/email/templates";
import { jsonError } from "@/lib/http";
import { reviewDecisionSchema } from "@/lib/schemas/admin";
import { STATUS_LABELS } from "@/lib/state-machine";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await guardAdminRequest(request);
  if ("response" in guard) return guard.response;
  const { id } = await params;

  const parsed = reviewDecisionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid review.");
  }

  const result = await decideReview({
    projectId: id,
    stage: parsed.data.stage,
    decision: parsed.data.decision,
    checklist: parsed.data.checklist,
    notes: parsed.data.notes?.trim() ? parsed.data.notes.trim() : null,
    adminId: guard.session.admin.id,
  });
  if (!result.ok) return jsonError(result.status, result.message);

  // §12 templates 3–6, chosen by the exact transition; sent after commit.
  // Admin team is CC'd by default; the panel can toggle that, add additional
  // parties, or suppress the vendor email entirely (audited).
  if (!parsed.data.notifyVendor) {
    await logEvent(db, {
      projectId: id,
      actor: "admin",
      actorId: guard.session.admin.id,
      eventType: "email.skipped",
      payload: {
        reason: "suppressed_by_reviewer",
        stage: result.value.stage,
        decision: result.value.decision,
      },
    });
    return NextResponse.json({ ok: true, newStatus: result.value.newStatus });
  }
  const ctx = await projectEmailContext(id);
  if (ctx) {
    const { emailOptions } = parsed.data;
    const cc = [
      ...(emailOptions.ccAdmins ? await activeAdminEmails() : []),
      ...emailOptions.extraCc,
    ];
    const { stage, decision, notes, newStatus } = result.value;
    const stageLabel = STATUS_LABELS[stage];
    if (ctx.magicLink === null) {
      console.warn(
        "Vendor magic link unavailable for project email (token not decryptable); consider regenerating the link.",
      );
    }
    const fallbackLink = ctx.magicLink ?? `${process.env.APP_URL}/`;
    let content = null;
    if (decision === "advanced" && newStatus === "approved") {
      content = vendorApproved(ctx.summary, ctx.magicLink);
    } else if (decision === "advanced") {
      content = vendorStagePassed(
        ctx.summary,
        stageLabel,
        STATUS_LABELS[newStatus],
        ctx.magicLink,
      );
    } else if (decision === "changes_requested") {
      content = vendorChangesRequested(
        ctx.summary,
        stageLabel,
        notes ?? "",
        fallbackLink,
      );
    } else {
      content = vendorDenied(ctx.summary, notes ?? "", ctx.magicLink);
    }
    await sendAndLog(id, ctx.primaries, content, { cc });
  }

  return NextResponse.json({ ok: true, newStatus: result.value.newStatus });
}
