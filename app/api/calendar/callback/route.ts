import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, fetchGoogleAccountEmail, saveCalendarAuth } from "@/lib/calendar";

// Google redirects here after consent. Exchanges the one-time code for a
// refresh token server-side and stores it (lib/calendar.ts's Settings
// table) -- the token itself never reaches the browser, only a redirect
// back to the dashboard with a plain success/failure flag in the query
// string.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const expectedState = request.cookies.get("lr_oauth_state")?.value;

  const redirectTo = (status: "connected" | "error", message?: string) => {
    const dest = new URL("/", url.origin);
    dest.searchParams.set("calendar", status);
    if (message) dest.searchParams.set("calendar_error", message);
    const res = NextResponse.redirect(dest);
    res.cookies.delete("lr_oauth_state");
    return res;
  };

  if (error) return redirectTo("error", error);
  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectTo("error", "Invalid or expired connection attempt -- try again.");
  }

  try {
    const { refreshToken, accessToken } = await exchangeCodeForTokens(code);
    const email = await fetchGoogleAccountEmail(accessToken);
    await saveCalendarAuth({ refreshToken, email });
    return redirectTo("connected");
  } catch (err) {
    console.error("Calendar connect failed:", err);
    return redirectTo("error", err instanceof Error ? err.message : "Connection failed.");
  }
}
