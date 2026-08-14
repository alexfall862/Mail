import { NextResponse } from "next/server";
import { overrideWait } from "@/lib/admin-ops";
import { guardAdminRequest } from "@/lib/admin-api";
import { jsonError } from "@/lib/http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await guardAdminRequest(request);
  if ("response" in guard) return guard.response;
  const { id } = await params;

  const result = await overrideWait({
    projectId: id,
    adminId: guard.session.admin.id,
  });
  if (!result.ok) return jsonError(result.status, result.message);

  // Deliberately no emails: this resumes review after an out-of-band
  // clarification; nothing changed for the vendor.

  return NextResponse.json({ ok: true, newStatus: result.value.newStatus });
}
