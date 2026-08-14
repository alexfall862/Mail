/** Shared guard boilerplate for admin API route handlers. */
import { NextResponse } from "next/server";
import { requireAdmin, type SessionAdmin } from "./auth";
import { assertSameOrigin, jsonError } from "./http";

export async function guardAdminRequest(
  request: Request,
  opts: { superuser?: boolean } = {},
): Promise<{ session: SessionAdmin } | { response: NextResponse }> {
  const originError = assertSameOrigin(request);
  if (originError) return { response: originError };
  const session = await requireAdmin();
  if (!session) return { response: jsonError(401, "Not signed in.") };
  if (opts.superuser && !session.admin.isSuperuser) {
    return { response: jsonError(403, "Superuser access required.") };
  }
  return { session };
}
