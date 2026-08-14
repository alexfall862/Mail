/**
 * UX guard for /admin routes: redirect to login when the session cookie is
 * absent. The security boundary is the DB-backed session check every admin
 * page and API performs via getSessionAdmin/requireAdmin — this middleware
 * just keeps logged-out users from seeing protected shells.
 */
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";

export function middleware(request: NextRequest) {
  // §13: enforce HTTPS behind Railway's proxy (TLS terminates upstream).
  if (
    process.env.NODE_ENV === "production" &&
    request.headers.get("x-forwarded-proto") === "http"
  ) {
    const httpsUrl = new URL(request.url);
    httpsUrl.protocol = "https:";
    return NextResponse.redirect(httpsUrl, 308);
  }

  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/admin")) {
    if (pathname === "/admin/login") return NextResponse.next();
    if (!request.cookies.get(SESSION_COOKIE)?.value) {
      const login = new URL("/admin/login", request.url);
      return NextResponse.redirect(login);
    }
  }
  return NextResponse.next();
}

export const config = {
  // Everything except static assets — the https redirect must be global.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
