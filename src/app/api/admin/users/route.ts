import { NextResponse } from "next/server";
import { createAdmin } from "@/lib/admin-users";
import { guardAdminRequest } from "@/lib/admin-api";
import { jsonError } from "@/lib/http";
import { createAdminSchema } from "@/lib/schemas/admin";

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await guardAdminRequest(request, { superuser: true });
  if ("response" in guard) return guard.response;

  const parsed = createAdminSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request.");
  }

  const result = await createAdmin({
    email: parsed.data.email,
    name: parsed.data.name,
    isSuperuser: parsed.data.isSuperuser,
    actingAdminId: guard.session.admin.id,
  });
  if (!result.ok) return jsonError(result.status, result.message);

  // Temp password is shown once to the superuser, who hands it over
  // out-of-band (§7: no password reset emails).
  return NextResponse.json({ ok: true, tempPassword: result.value.tempPassword });
}
