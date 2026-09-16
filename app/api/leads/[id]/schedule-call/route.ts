import { NextRequest, NextResponse } from "next/server";
import { getLead, stampFunnelMilestones, updateLead } from "@/lib/airtable";
import { createCalendarEvent, deleteCalendarEvent, isCalendarConfigured, updateCalendarEvent } from "@/lib/calendar";

// Role 4 + calendar (§8): books/reschedules/cancels the Google Calendar
// event for a "Call Booked" opportunity, and keeps the CRM record linked to
// it. The idempotency guard is simple and deliberate: the lead's own
// `calendarEventId`, re-read fresh from storage on every call, is the only
// source of truth for "does an event already exist" -- a second click (or a
// retried request after a dropped response) always finds it and updates the
// same event instead of creating a second one. A full per-lead lock would
// close the last sliver of a race between two concurrent requests, but this
// is a single-freelancer tool clicking one button at a time.
// ponytail: no per-lead lock; add one if concurrent scheduling ever matters.
function validateWindow(startISO: unknown, endISO: unknown, timeZone: unknown) {
  if (typeof startISO !== "string" || typeof endISO !== "string" || typeof timeZone !== "string" || !timeZone) {
    throw new Error("startISO, endISO, and timeZone are required.");
  }
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new Error("Invalid start/end time.");
  if (end.getTime() <= start.getTime()) throw new Error("End time must be after start time.");
  return { start, end, timeZone };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isCalendarConfigured) {
    return NextResponse.json(
      { error: "Calendar isn't configured -- set GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI." },
      { status: 400 }
    );
  }

  const body = (await request.json()) as { startISO?: unknown; endISO?: unknown; timeZone?: unknown };
  let start: Date, end: Date, timeZone: string;
  try {
    ({ start, end, timeZone } = validateWindow(body.startISO, body.endISO, body.timeZone));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid input." }, { status: 400 });
  }

  const lead = await getLead(id);
  if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });

  const summary = `Call: ${lead.title} — ${lead.clientName}`;
  const description = [
    lead.needSummary,
    lead.sourceUrl ? `Listing: ${lead.sourceUrl}` : "",
    "Booked via Lead Radar.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const eventInput = { summary, description, startISO: start.toISOString(), endISO: end.toISOString(), timeZone };

  try {
    // Idempotency: an event already linked to this lead is rescheduled
    // (PATCH-by-id), never re-created.
    const event = lead.calendarEventId
      ? await updateCalendarEvent(lead.calendarEventId, eventInput)
      : await createCalendarEvent(eventInput);

    const update = stampFunnelMilestones(lead, {
      status: "Call Booked",
      scheduledCallAt: start.toISOString(),
      calendarEventId: event.id,
    });
    await updateLead(id, update);
    return NextResponse.json({ success: true, update, eventLink: event.htmlLink });
  } catch (err) {
    console.error("Calendar scheduling failed:", err);
    // No lead field is written unless the Google call above already
    // succeeded -- a failure here leaves the lead exactly as it was, so the
    // button is safely retriable.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to schedule the call." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const lead = await getLead(id);
  if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });

  if (!lead.calendarEventId) {
    // Nothing to cancel -- treat as success (idempotent), not an error.
    return NextResponse.json({ success: true });
  }

  try {
    await deleteCalendarEvent(lead.calendarEventId);
  } catch (err) {
    console.error("Calendar event cancellation failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to cancel the calendar event." },
      { status: 500 }
    );
  }

  await updateLead(id, { calendarEventId: null, scheduledCallAt: null });
  return NextResponse.json({ success: true });
}
