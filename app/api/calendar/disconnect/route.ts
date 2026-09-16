import { NextResponse } from "next/server";
import { clearCalendarAuth } from "@/lib/calendar";

// Clears the stored refresh token. Existing calendar events already created
// for booked calls are left alone -- disconnecting is about the freelancer
// revoking Lead Radar's future access, not retroactively deleting her
// calendar history.
export async function POST() {
  try {
    await clearCalendarAuth();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to disconnect calendar:", err);
    return NextResponse.json({ error: "Failed to disconnect." }, { status: 500 });
  }
}
