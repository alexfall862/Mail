import { NextResponse } from "next/server";
import { reopenProject } from "@/lib/admin-ops";
import { guardAdminRequest } from "@/lib/admin-api";
import { jsonError } from "@/lib/http";
import { reopenSchema } from "@/lib/schemas/admin";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // §5 row 10: superuser only.
  const guard = await guardAdminRequest(request, { superuser: true });
  if ("response" in guard) return guard.response;
  const { id } = await params;

  const parsed = reopenSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request.");
  }

  const result = await reopenProject({
    projectId: id,
    reason: parsed.data.reason,
    adminId: guard.session.admin.id,
    isSuperuser: guard.session.admin.isSuperuser,
  });
  if (!result.ok) return jsonError(result.status, result.message);

  // Phase 7 wires the admin notification email here (post-commit).

  return NextResponse.json({ ok: true, newStatus: result.value.newStatus });
}
