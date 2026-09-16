import { NextResponse } from "next/server";
import { getStoredCalendarAuth, isCalendarConfigured } from "@/lib/calendar";

// Never returns the refresh token -- only whether a calendar is connected
// and which account, so the dashboard can show "Connected as x@gmail.com".
export async function GET() {
  if (!isCalendarConfigured) {
    return NextResponse.json({ configured: false, connected: false });
  }
  try {
    const auth = await getStoredCalendarAuth();
    return NextResponse.json({
      configured: true,
      connected: Boolean(auth),
      email: auth?.email || null,
    });
  } catch (err) {
    console.error("Failed to read calendar connection status:", err);
    return NextResponse.json({ configured: true, connected: false, error: "Couldn't check calendar status." });
  }
}
