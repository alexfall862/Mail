import { NextResponse } from "next/server";
import { setContactPaid } from "@/lib/admin-ops";
import { guardAdminRequest } from "@/lib/admin-api";
import { jsonError } from "@/lib/http";
import { setPaidSchema } from "@/lib/schemas/admin";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await guardAdminRequest(request);
  if ("response" in guard) return guard.response;
  const { id } = await params;

  const parsed = setPaidSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Invalid request.");

  const result = await setContactPaid({
    projectId: id,
    contactId: parsed.data.contactId,
    paid: parsed.data.paid,
    adminId: guard.session.admin.id,
  });
  if (!result.ok) return jsonError(result.status, result.message);
  return NextResponse.json({ ok: true });
}
