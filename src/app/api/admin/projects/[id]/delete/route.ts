import { NextResponse } from "next/server";
import { deleteProject } from "@/lib/admin-ops";
import { guardAdminRequest } from "@/lib/admin-api";
import { jsonError } from "@/lib/http";
import { deleteProjectSchema } from "@/lib/schemas/admin";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await guardAdminRequest(request);
  if ("response" in guard) return guard.response;
  const { id } = await params;

  const parsed = deleteProjectSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request.");
  }

  const result = await deleteProject({
    projectId: id,
    confirmName: parsed.data.confirmName,
    adminId: guard.session.admin.id,
  });
  if (!result.ok) return jsonError(result.status, result.message);
  return NextResponse.json({ ok: true }); // §10: no emails on delete
}
