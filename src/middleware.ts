/**
 * UX guard for /admin routes: redirect to login when the session cookie is
 * absent. The security boundary is the DB-backed session check every admin
 * page and API performs via getSessionAdmin/requireAdmin — this middleware
 * just keeps logged-out users from seeing protected shells.
 */
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/admin/login") return NextResponse.next();

  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    const login = new URL("/admin/login", request.url);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
