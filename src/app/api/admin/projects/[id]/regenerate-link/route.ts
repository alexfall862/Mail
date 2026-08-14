import { NextResponse } from "next/server";
import { regenerateLink } from "@/lib/admin-ops";
import { guardAdminRequest } from "@/lib/admin-api";
import { projectEmailContext, sendAndLog } from "@/lib/email/send";
import { vendorLinkRegenerated } from "@/lib/email/templates";
import { jsonError } from "@/lib/http";
import { vendorLinkUrl } from "@/lib/tokens";

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

  // §12 template 8: primaries get the new link. The raw token is never
  // returned to the admin and never logged.
  const ctx = await projectEmailContext(id);
  if (ctx) {
    await sendAndLog(
      id,
      ctx.primaries,
      vendorLinkRegenerated(ctx.summary, vendorLinkUrl(result.value.rawToken)),
    );
  }

  return NextResponse.json({ ok: true });
}
