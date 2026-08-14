import { NextResponse } from "next/server";
import { setCampaignContact } from "@/lib/admin-ops";
import { guardAdminRequest } from "@/lib/admin-api";
import { jsonError } from "@/lib/http";
import { campaignContactSchema } from "@/lib/schemas/admin";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await guardAdminRequest(request);
  if ("response" in guard) return guard.response;
  const { id } = await params;

  const parsed = campaignContactSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request.");
  }

  const result = await setCampaignContact({
    projectId: id,
    name: parsed.data.name,
    email: parsed.data.email,
    phone: parsed.data.phone ?? null,
    adminId: guard.session.admin.id,
  });
  if (!result.ok) return jsonError(result.status, result.message);
  return NextResponse.json({ ok: true });
}
