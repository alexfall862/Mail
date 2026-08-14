import { NextResponse } from "next/server";
import { regenerateLink } from "@/lib/admin-ops";
import { guardAdminRequest } from "@/lib/admin-api";
import { jsonError } from "@/lib/http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await guardAdminRequest(request);
  if ("response" in guard) return guard.response;
  const { id } = await params;

  const result = await regenerateLink({
    projectId: id,
    adminId: guard.session.admin.id,
  });
  if (!result.ok) return jsonError(result.status, result.message);

  // Phase 7 wires the vendor_link_regenerated email here (post-commit). The
  // raw token is never returned to the admin and never logged.

  return NextResponse.json({ ok: true });
}
