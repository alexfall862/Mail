import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deactivateAdmin,
  reactivateAdmin,
  resetAdminPassword,
} from "@/lib/admin-users";
import { guardAdminRequest } from "@/lib/admin-api";
import { jsonError } from "@/lib/http";

const actionSchema = z.object({
  action: z.enum(["deactivate", "reactivate", "reset-password"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await guardAdminRequest(request, { superuser: true });
  if ("response" in guard) return guard.response;
  const { id } = await params;

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Invalid request.");

  const actingAdminId = guard.session.admin.id;
  switch (parsed.data.action) {
    case "deactivate": {
      const result = await deactivateAdmin({ adminId: id, actingAdminId });
      if (!result.ok) return jsonError(result.status, result.message);
      return NextResponse.json({ ok: true });
    }
    case "reactivate": {
      const result = await reactivateAdmin({ adminId: id, actingAdminId });
      if (!result.ok) return jsonError(result.status, result.message);
      return NextResponse.json({ ok: true });
    }
    case "reset-password": {
      const result = await resetAdminPassword({ adminId: id, actingAdminId });
      if (!result.ok) return jsonError(result.status, result.message);
      return NextResponse.json({ ok: true, tempPassword: result.value.tempPassword });
    }
  }
}
