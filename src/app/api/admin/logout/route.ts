import { NextResponse } from "next/server";
import { deleteSession, getSessionAdmin, SESSION_COOKIE } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/http";

export async function POST(request: Request): Promise<NextResponse> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const session = await getSessionAdmin();
  if (session) await deleteSession(session.sessionId);

  const response = NextResponse.redirect(new URL("/admin/login", request.url), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
