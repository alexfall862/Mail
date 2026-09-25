import { NextResponse } from "next/server";
import { amendProjectCost } from "@/lib/admin-ops";
import { guardAdminRequest } from "@/lib/admin-api";
import { jsonError } from "@/lib/http";
import { amendCostSchema } from "@/lib/schemas/admin";

/** Amend an approved project's total cost (final invoice vs. quote). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await guardAdminRequest(request);
  if ("response" in guard) return guard.response;
  const { id } = await params;

  const parsed = amendCostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Invalid request.");

  const result = await amendProjectCost({
    projectId: id,
    totalCostCents: parsed.data.totalCostCents,
    reason: parsed.data.reason,
    adminId: guard.session.admin.id,
  });
  if (!result.ok) return jsonError(result.status, result.message);
  return NextResponse.json({ ok: true, ...result.value });
}
