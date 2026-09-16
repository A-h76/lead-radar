import { NextResponse } from "next/server";
import crypto from "crypto";
import { googleAuthUrl, isCalendarConfigured } from "@/lib/calendar";

// Starts the OAuth flow. A random `state`, stored in a short-lived httpOnly
// cookie, is round-tripped through Google and checked in the callback --
// standard CSRF protection for the redirect step (on top of the whole app
// already sitting behind proxy.ts's password gate).
export async function GET() {
  if (!isCalendarConfigured) {
    return NextResponse.json(
      { error: "Calendar isn't configured -- set GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI." },
      { status: 400 }
    );
  }

  const state = crypto.randomBytes(16).toString("hex");
  const res = NextResponse.redirect(googleAuthUrl(state));
  res.cookies.set("lr_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10, // 10 minutes -- long enough for the consent screen, short enough not to linger
  });
  return res;
}
