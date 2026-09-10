import { NextRequest, NextResponse } from "next/server";

// Single-client tool, so a shared password gate is the whole auth system.
// Ponytail: add real per-user auth only if this ever serves more than one client.
const COOKIE_NAME = "lr_auth";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const appPassword = process.env.APP_PASSWORD;
  // No password configured yet (local dev before setup) — don't lock the
  // developer out of their own app.
  if (!appPassword) return NextResponse.next();

  const cookie = request.cookies.get(COOKIE_NAME)?.value;
  if (cookie === appPassword) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
