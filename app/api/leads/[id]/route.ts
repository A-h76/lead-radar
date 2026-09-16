import { NextRequest, NextResponse } from "next/server";
import { getLead, stampFunnelMilestones, updateLead } from "@/lib/airtable";
import { deleteCalendarEvent } from "@/lib/calendar";
import { LEAD_STATUSES, TERMINAL_STATUSES, type LeadUpdate } from "@/lib/types";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as LeadUpdate;

  if (body.status && !LEAD_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  try {
    let update = body;
    if (body.status) {
      // Only fetch the current record when the status is actually changing
      // -- a notes-only edit shouldn't cost an extra read.
      const current = await getLead(id);
      if (!current) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
      update = stampFunnelMilestones(current, body);

      // Calendar §8: a still-*future* booked call whose lead is marked Lost
      // or Passed before the call happened is no longer happening -- cancel
      // it so it doesn't sit on her calendar. A call already in the past by
      // the time the lead closes is left alone; it already happened and the
      // event is now just history. Won is never auto-cancelled here -- the
      // call that led to winning already occurred. Best-effort: a calendar
      // hiccup must not block recording the actual outcome.
      if (
        body.status !== current.status &&
        TERMINAL_STATUSES.includes(body.status) &&
        body.status !== "Won" &&
        current.calendarEventId &&
        current.scheduledCallAt &&
        new Date(current.scheduledCallAt).getTime() > Date.now()
      ) {
        await deleteCalendarEvent(current.calendarEventId).catch((err) =>
          console.error("Auto-cancel of calendar event failed (non-blocking):", err)
        );
        update = { ...update, calendarEventId: null, scheduledCallAt: null };
      }
    }
    const applied = await updateLead(id, update);
    // Echo back the update actually applied (after stampFunnelMilestones /
    // the follow-up+closedAt rules in lib/airtable.ts) so the client can
    // merge real server-computed values instead of guessing or refetching.
    return NextResponse.json({ success: true, update: applied });
  } catch (err) {
    console.error("Failed to update lead:", err);
    return NextResponse.json(
      { error: "Failed to update lead." },
      { status: 500 }
    );
  }
}
