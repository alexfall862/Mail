import { NextResponse } from "next/server";
import { decideReview } from "@/lib/admin-ops";
import { guardAdminRequest } from "@/lib/admin-api";
import { jsonError } from "@/lib/http";
import { reviewDecisionSchema } from "@/lib/schemas/admin";

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

  // Phase 7 wires the per-transition vendor emails here (post-commit).

  return NextResponse.json({ ok: true, newStatus: result.value.newStatus });
}
