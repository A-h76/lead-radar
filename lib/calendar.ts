// Google Calendar integration (§8) -- OAuth2 + Calendar API via raw fetch,
// same trade-off as lib/openai.ts/lib/airtable.ts: no SDK dependency for a
// handful of REST calls.
//
// Provider choice: Google Calendar, not a pluggable multi-provider
// abstraction. There is exactly one freelancer using this product and she
// already runs on Gmail (see the n8n digest recipient in n8n/README.md);
// Google Calendar's API is free, well-documented, and the de facto default
// for a solo freelancer. A provider interface built for a product with one
// user and one calendar would be unused complexity -- add a second
// provider (e.g. Outlook) only if a real second user actually needs one.
//
// Token storage piggybacks on the same Airtable base as Leads/Runs (a new
// "Settings" table, one row keyed "google_calendar") rather than adding a
// database -- consistent with how this app already treats Airtable as its
// only datastore. The refresh token is never sent to the browser; every
// route in app/api/calendar/* returns at most a connected-or-not boolean
// and the connected account's email.
import { fetchWithTimeout } from "./http";
import { isAirtableConfigured } from "./airtable";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

export const isCalendarConfigured = Boolean(
  GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI
);

const SCOPE = "https://www.googleapis.com/auth/calendar.events";

export function googleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID!,
    redirect_uri: GOOGLE_REDIRECT_URI!,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // forces a fresh refresh_token every connect, not just the first ever
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// ---- token storage (Airtable "Settings" table, or in-memory in demo mode) ----------------------

interface CalendarAuth {
  refreshToken: string;
  email: string;
  connectedAt: string;
}

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const SETTINGS_TABLE = "Settings";
const SETTINGS_KEY = "google_calendar";

let devCalendarAuth: CalendarAuth | null = null;

function settingsUrl(path = "") {
  return `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${SETTINGS_TABLE}${path}`;
}
function settingsHeaders() {
  return { Authorization: `Bearer ${AIRTABLE_API_KEY}`, "Content-Type": "application/json" };
}

async function findSettingsRecordId(): Promise<string | null> {
  const res = await fetchWithTimeout(
    `${settingsUrl()}?maxRecords=1&filterByFormula=${encodeURIComponent(`{Key} = "${SETTINGS_KEY}"`)}`,
    { headers: settingsHeaders(), cache: "no-store" },
    { retries: 1 }
  );
  if (!res.ok) throw new Error(`Airtable Settings lookup failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { records: { id: string }[] };
  return data.records[0]?.id ?? null;
}

export async function getStoredCalendarAuth(): Promise<CalendarAuth | null> {
  if (!isAirtableConfigured) return devCalendarAuth;

  const res = await fetchWithTimeout(
    `${settingsUrl()}?maxRecords=1&filterByFormula=${encodeURIComponent(`{Key} = "${SETTINGS_KEY}"`)}`,
    { headers: settingsHeaders(), cache: "no-store" },
    { retries: 1 }
  );
  // The Settings table may simply not exist yet on a base set up before
  // calendar support was added -- degrade to "not connected", not an error.
  if (res.status === 404 || res.status === 422) return null;
  if (!res.ok) throw new Error(`Airtable Settings fetch failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { records: { fields: Record<string, unknown> }[] };
  const f = data.records[0]?.fields;
  if (!f?.["Refresh Token"]) return null;
  return {
    refreshToken: f["Refresh Token"] as string,
    email: (f["Calendar Email"] as string) || "",
    connectedAt: (f["Connected At"] as string) || "",
  };
}

export async function saveCalendarAuth(auth: { refreshToken: string; email: string }): Promise<void> {
  const fields = {
    Key: SETTINGS_KEY,
    "Refresh Token": auth.refreshToken,
    "Calendar Email": auth.email,
    "Connected At": new Date().toISOString(),
  };

  if (!isAirtableConfigured) {
    devCalendarAuth = { refreshToken: auth.refreshToken, email: auth.email, connectedAt: fields["Connected At"] };
    return;
  }

  const existingId = await findSettingsRecordId();
  const res = existingId
    ? await fetchWithTimeout(
        settingsUrl(`/${existingId}`),
        { method: "PATCH", headers: settingsHeaders(), body: JSON.stringify({ fields, typecast: true }) },
        { retries: 1 } // PATCH-by-id is idempotent, safe to retry
      )
    : await fetchWithTimeout(
        settingsUrl(),
        { method: "POST", headers: settingsHeaders(), body: JSON.stringify({ fields, typecast: true }) },
        { retries: 0 } // never retry a create -- see the same rule in lib/airtable.ts
      );
  if (!res.ok) throw new Error(`Airtable Settings write failed: ${res.status} ${await res.text()}`);
}

export async function clearCalendarAuth(): Promise<void> {
  if (!isAirtableConfigured) {
    devCalendarAuth = null;
    return;
  }
  const existingId = await findSettingsRecordId();
  if (!existingId) return;
  const res = await fetchWithTimeout(
    settingsUrl(`/${existingId}`),
    {
      method: "PATCH",
      headers: settingsHeaders(),
      // Blank the token rather than delete the row -- keeps "Connected At"
      // history and avoids a delete-then-recreate race on reconnect.
      body: JSON.stringify({
        fields: { "Refresh Token": "", "Calendar Email": "" },
        typecast: true,
      }),
    },
    { retries: 1 }
  );
  if (!res.ok) throw new Error(`Airtable Settings clear failed: ${res.status} ${await res.text()}`);
}

// ---- OAuth token exchange -------------------------------------------------------------------

export async function exchangeCodeForTokens(
  code: string
): Promise<{ refreshToken: string; accessToken: string }> {
  const res = await fetchWithTimeout(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
        redirect_uri: GOOGLE_REDIRECT_URI!,
        grant_type: "authorization_code",
      }),
    },
    { retries: 0 } // an auth code is single-use -- retrying after an ambiguous failure would just fail again
  );
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { refresh_token?: string; access_token: string };
  if (!data.refresh_token) {
    throw new Error(
      "Google didn't return a refresh token. Revoke this app's access at myaccount.google.com/permissions and reconnect."
    );
  }
  return { refreshToken: data.refresh_token, accessToken: data.access_token };
}

async function getFreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetchWithTimeout(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
        grant_type: "refresh_token",
      }),
    },
    { retries: 1 } // a plain token refresh is safely retriable -- no side effect on Google's side
  );
  if (!res.ok) {
    throw new Error(
      `Google Calendar isn't connecting -- your access may have been revoked. Reconnect it. (${res.status})`
    );
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export async function fetchGoogleAccountEmail(accessToken: string): Promise<string> {
  const res = await fetchWithTimeout(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    { headers: { Authorization: `Bearer ${accessToken}` } },
    { retries: 1 }
  );
  if (!res.ok) return "";
  const data = (await res.json()) as { email?: string };
  return data.email || "";
}

// ---- calendar events -------------------------------------------------------------------------

export interface CalendarEventInput {
  summary: string;
  description: string;
  startISO: string;
  endISO: string;
  timeZone: string;
}

async function withAccessToken<T>(fn: (accessToken: string) => Promise<T>): Promise<T> {
  const auth = await getStoredCalendarAuth();
  if (!auth) throw new Error("Google Calendar isn't connected.");
  const accessToken = await getFreshAccessToken(auth.refreshToken);
  return fn(accessToken);
}

export async function createCalendarEvent(
  input: CalendarEventInput
): Promise<{ id: string; htmlLink: string }> {
  return withAccessToken(async (accessToken) => {
    const res = await fetchWithTimeout(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: input.summary,
          description: input.description,
          start: { dateTime: input.startISO, timeZone: input.timeZone },
          end: { dateTime: input.endISO, timeZone: input.timeZone },
        }),
      },
      // Never auto-retry a create -- see the same rule in lib/airtable.ts's
      // createLead. This is exactly the call the idempotency guard in
      // app/api/leads/[id]/schedule-call/route.ts exists to protect: it
      // only ever calls this once per lead, checking calendarEventId first.
      { retries: 0 }
    );
    if (!res.ok) throw new Error(`Calendar event creation failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { id: string; htmlLink: string };
    return { id: data.id, htmlLink: data.htmlLink };
  });
}

export async function updateCalendarEvent(
  eventId: string,
  input: CalendarEventInput
): Promise<{ id: string; htmlLink: string }> {
  return withAccessToken(async (accessToken) => {
    const res = await fetchWithTimeout(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      {
        method: "PATCH", // PATCH-by-id is idempotent, safe to retry
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: input.summary,
          description: input.description,
          start: { dateTime: input.startISO, timeZone: input.timeZone },
          end: { dateTime: input.endISO, timeZone: input.timeZone },
        }),
      },
      { retries: 1 }
    );
    if (!res.ok) throw new Error(`Calendar event update failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { id: string; htmlLink: string };
    return { id: data.id, htmlLink: data.htmlLink };
  });
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  return withAccessToken(async (accessToken) => {
    const res = await fetchWithTimeout(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
      { retries: 1 } // DELETE-by-id is idempotent
    );
    // 404/410 means it's already gone (e.g. deleted by hand in Google
    // Calendar) -- that's the end state we wanted, not a failure.
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      throw new Error(`Calendar event deletion failed: ${res.status} ${await res.text()}`);
    }
  });
}
