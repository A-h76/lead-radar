import type { Lead, LeadUpdate } from "./types";
import { FUNNEL_STAGES, TERMINAL_STATUSES } from "./types";
import { sampleLeads } from "./sample-leads";
import { fetchWithTimeout } from "./http";

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE = process.env.AIRTABLE_TABLE_NAME || "Leads";

/** True once real Airtable credentials are set — until then, every read/write
 *  falls back to in-memory sample data so the site works standalone. */
export const isAirtableConfigured = Boolean(AIRTABLE_API_KEY && AIRTABLE_BASE_ID);

// In-memory store backing the dashboard when Airtable isn't configured yet.
// Resets on server restart — fine for demoing the UI, not for real leads.
let devLeads: Lead[] = sampleLeads.map((l) => ({ ...l }));

function airtableUrl(path = "") {
  return `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
    AIRTABLE_TABLE
  )}${path}`;
}

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_API_KEY}`,
    "Content-Type": "application/json",
  };
}

// Long-text Airtable fields hold evidence lists as "\n"-joined bullets rather
// than JSON — keeps the base itself human-readable when someone opens it
// directly, which is half the point of using Airtable as the store.
const toLines = (v: unknown) =>
  ((v as string) || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
const fromLines = (arr: string[]) => (arr || []).filter(Boolean).join("\n");

// Airtable record -> our Lead shape. Adjust the field names on the left if
// the base's column names differ from the schema in n8n/README.md.
function fromAirtableRecord(record: {
  id: string;
  fields: Record<string, unknown>;
}): Lead {
  const f = record.fields;
  return {
    id: record.id,
    title: (f["Title"] as string) || "Untitled lead",
    clientName: (f["Client/Company"] as string) || "Unknown",
    sourceUrl: (f["Source URL"] as string) || "",
    sourcePlatform: (f["Source Platform"] as string) || "Other",
    needSummary: (f["Need Summary"] as string) || "",
    rawDescription: (f["Raw Description"] as string) || "",
    budgetSignal: (f["Budget Signal"] as string) || "Not specified",
    status: ((f["Status"] as string) || "Needs Review") as Lead["status"],
    dateFound: (f["Date Found"] as string) || new Date().toISOString(),
    closedAt: (f["Closed At"] as string) || null,
    repliedAt: (f["Replied At"] as string) || null,
    conversationAt: (f["Conversation At"] as string) || null,
    callBookedAt: (f["Call Booked At"] as string) || null,
    proposalAt: (f["Proposal At"] as string) || null,

    skillFitScore: Number(f["Fit Score"] ?? 0),
    valueScore: Number(f["Value Score"] ?? 0),
    confidence: ((f["Confidence"] as string) || "Low") as Lead["confidence"],
    scoreReasoning: (f["Score Reasoning"] as string) || "",
    recommendedAction: ((f["Recommended Action"] as string) ||
      "Consider") as Lead["recommendedAction"],
    nicheTag: (f["Niche Tag"] as string) || "",
    urgency: ((f["Urgency"] as string) || "Low") as Lead["urgency"],

    verifiedFacts: toLines(f["Verified Facts"]),
    inferredSignals: toLines(f["Inferred Signals"]),
    unknownFactors: toLines(f["Unknown Factors"]),
    positiveSignals: toLines(f["Positive Signals"]),
    negativeSignals: toLines(f["Negative Signals"]),

    recommendedService: (f["Recommended Service"] as string) || "",
    outreachAngle: (f["Outreach Angle"] as string) || "",
    outreachDraft: (f["Outreach Draft"] as string) || "",

    contactName: (f["Contact Name"] as string) || "",
    contactEmail: (f["Contact Email"] as string) || "",
    lastContact: (f["Last Contact"] as string) || null,
    followUpDue: (f["Follow-up Due"] as string) || null,
    notes: (f["Notes"] as string) || "",
    revenue: f["Revenue"] != null ? Number(f["Revenue"]) : null,
    lossReason: (f["Loss Reason"] as string) || "",
    isRecurring: Boolean(f["Recurring"]),
    estimatedValue: f["Estimated Value"] != null ? Number(f["Estimated Value"]) : null,
    proposedValue: f["Proposed Value"] != null ? Number(f["Proposed Value"]) : null,
    scheduledCallAt: (f["Scheduled Call At"] as string) || null,
    calendarEventId: (f["Calendar Event ID"] as string) || null,
  };
}

// Our Lead(-ish) shape -> Airtable fields, for create/update. Only fields
// present in `update` are sent, so a status-only PATCH doesn't clobber
// everything else with blanks.
function toAirtableFields(update: LeadUpdate): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const map: [keyof LeadUpdate, string][] = [
    ["title", "Title"],
    ["clientName", "Client/Company"],
    ["sourceUrl", "Source URL"],
    ["sourcePlatform", "Source Platform"],
    ["needSummary", "Need Summary"],
    ["rawDescription", "Raw Description"],
    ["budgetSignal", "Budget Signal"],
    ["status", "Status"],
    ["closedAt", "Closed At"],
    ["repliedAt", "Replied At"],
    ["conversationAt", "Conversation At"],
    ["callBookedAt", "Call Booked At"],
    ["proposalAt", "Proposal At"],
    ["skillFitScore", "Fit Score"],
    ["valueScore", "Value Score"],
    ["confidence", "Confidence"],
    ["scoreReasoning", "Score Reasoning"],
    ["recommendedAction", "Recommended Action"],
    ["nicheTag", "Niche Tag"],
    ["urgency", "Urgency"],
    ["recommendedService", "Recommended Service"],
    ["outreachAngle", "Outreach Angle"],
    ["outreachDraft", "Outreach Draft"],
    ["contactName", "Contact Name"],
    ["contactEmail", "Contact Email"],
    ["lastContact", "Last Contact"],
    ["followUpDue", "Follow-up Due"],
    ["notes", "Notes"],
    ["revenue", "Revenue"],
    ["lossReason", "Loss Reason"],
    ["isRecurring", "Recurring"],
    ["estimatedValue", "Estimated Value"],
    ["proposedValue", "Proposed Value"],
    ["scheduledCallAt", "Scheduled Call At"],
    ["calendarEventId", "Calendar Event ID"],
  ];
  for (const [key, field] of map) {
    if (update[key] !== undefined) out[field] = update[key];
  }
  const lineFields: [keyof LeadUpdate, string][] = [
    ["verifiedFacts", "Verified Facts"],
    ["inferredSignals", "Inferred Signals"],
    ["unknownFactors", "Unknown Factors"],
    ["positiveSignals", "Positive Signals"],
    ["negativeSignals", "Negative Signals"],
  ];
  for (const [key, field] of lineFields) {
    const v = update[key];
    if (v !== undefined) out[field] = fromLines(v as string[]);
  }
  return out;
}

// Role 4 (CRM & Follow-Up Manager): both deterministic, not AI.
//
// Moving a lead to "Contacted" without an explicit follow-up date
// auto-schedules one 7 days out — the single change most likely to stop a
// live conversation from silently going cold.
function applyFollowUpRule(update: LeadUpdate): LeadUpdate {
  if (update.status !== "Contacted") return update;
  const next = { ...update };
  if (next.lastContact === undefined) next.lastContact = new Date().toISOString();
  if (next.followUpDue === undefined) {
    const due = new Date();
    due.setDate(due.getDate() + 7);
    next.followUpDue = due.toISOString();
  }
  return next;
}

// Reaching Won/Lost/Passed stamps a close date automatically -- this is what
// lets Role 5 compute time-to-conversion without anyone remembering to fill
// in a date by hand.
function applyClosedAtRule(update: LeadUpdate): LeadUpdate {
  if (!update.status || !TERMINAL_STATUSES.includes(update.status)) return update;
  if (update.closedAt !== undefined) return update;
  return { ...update, closedAt: new Date().toISOString() };
}

function applyDeterministicRules(update: LeadUpdate): LeadUpdate {
  return applyClosedAtRule(applyFollowUpRule(update));
}

// Role 4 + Role 5: stamps each funnel milestone (Replied/Conversation/Call
// Booked/Proposal) the FIRST time it's reached, and backfills any earlier
// ones a status jump skipped over (e.g. going straight to "Proposal" also
// stamps repliedAt/conversationAt if they weren't already set) -- so a lead
// that later becomes Won/Lost/Passed still carries an honest record of how
// far it actually got, which Role 5's funnel rates depend on. Needs the
// CURRENT stored lead (not just the patch) to know what's already stamped,
// so this lives at the route layer where the lead has already been fetched
// -- see app/api/leads/[id]/route.ts.
export function stampFunnelMilestones(current: Lead, update: LeadUpdate): LeadUpdate {
  if (!update.status) return update;
  const idx = FUNNEL_STAGES.indexOf(update.status);
  if (idx === -1) return update;
  const field: Record<string, keyof Lead> = {
    Replied: "repliedAt",
    Conversation: "conversationAt",
    "Call Booked": "callBookedAt",
    Proposal: "proposalAt",
  };
  const next = { ...update };
  const now = new Date().toISOString();
  for (let i = 0; i <= idx; i++) {
    const key = field[FUNNEL_STAGES[i]] as "repliedAt" | "conversationAt" | "callBookedAt" | "proposalAt";
    if (!current[key] && next[key] === undefined) next[key] = now;
  }
  return next;
}

export async function fetchLeads(): Promise<Lead[]> {
  if (!isAirtableConfigured) {
    return [...devLeads].sort((a, b) => b.skillFitScore - a.skillFitScore);
  }

  const res = await fetchWithTimeout(
    `${airtableUrl()}?pageSize=100&sort[0][field]=Fit%20Score&sort[0][direction]=desc`,
    {
      headers: airtableHeaders(),
      cache: "no-store",
    },
    { retries: 2 }
  );

  if (!res.ok) {
    throw new Error(`Airtable fetch failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    records: { id: string; fields: Record<string, unknown> }[];
  };
  return data.records.map(fromAirtableRecord);
}

/** Single lead, for the analyze/draft routes which need current evidence
 *  before calling OpenAI. Returns null if not found. */
export async function getLead(id: string): Promise<Lead | null> {
  if (!isAirtableConfigured) {
    return devLeads.find((l) => l.id === id) ?? null;
  }

  const res = await fetchWithTimeout(
    airtableUrl(`/${id}`),
    { headers: airtableHeaders(), cache: "no-store" },
    { retries: 2 }
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Airtable fetch failed: ${res.status} ${await res.text()}`);
  }
  return fromAirtableRecord(await res.json());
}

// Returns the update as actually applied (after applyFollowUpRule/
// applyClosedAtRule add whatever they derive) so callers -- specifically
// the PATCH route, which echoes this back to the client -- can report what
// really landed in storage rather than just what was requested.
export async function updateLead(id: string, update: LeadUpdate): Promise<LeadUpdate> {
  const withRules = applyDeterministicRules(update);

  if (!isAirtableConfigured) {
    devLeads = devLeads.map((l) => (l.id === id ? { ...l, ...withRules } : l));
    return withRules;
  }

  const res = await fetchWithTimeout(airtableUrl(`/${id}`), {
    method: "PATCH",
    headers: airtableHeaders(),
    // typecast lets Airtable auto-create a missing single-select option
    // (e.g. a base created before "Call Booked"/"Discovered" existed)
    // instead of hard-failing the write.
    body: JSON.stringify({ fields: toAirtableFields(withRules), typecast: true }),
  });

  if (!res.ok) {
    throw new Error(`Airtable update failed: ${res.status} ${await res.text()}`);
  }
  return withRules;
}

// Manual entry (Role 1, human-supplied source): agencies, warm network,
// LinkedIn, referrals -- opportunities that were never scraped. Starts at
// "Discovered", genuinely unscored -- the dashboard's "Analyze" button runs
// Role 2 on it on demand (app/api/leads/[id]/analyze), or it can be moved
// straight to "Approved" without analysis if the freelancer already knows
// it's worth pursuing.
export async function createLead(input: {
  title: string;
  clientName: string;
  sourceUrl: string;
  sourcePlatform: string;
  needSummary: string;
  notes: string;
}): Promise<Lead> {
  const fields: LeadUpdate = {
    title: input.title,
    clientName: input.clientName || "Unknown",
    sourceUrl: input.sourceUrl,
    sourcePlatform: input.sourcePlatform || "Other",
    needSummary: input.needSummary,
    notes: input.notes,
    status: "Discovered",
    closedAt: null,
    repliedAt: null,
    conversationAt: null,
    callBookedAt: null,
    proposalAt: null,
    rawDescription: "",
    budgetSignal: "Not specified",
    skillFitScore: 0,
    valueScore: 0,
    confidence: "Low",
    scoreReasoning: "",
    recommendedAction: "Consider",
    nicheTag: "",
    urgency: "Medium",
    verifiedFacts: [],
    inferredSignals: [],
    unknownFactors: [],
    positiveSignals: [],
    negativeSignals: [],
    recommendedService: "",
    outreachAngle: "",
    outreachDraft: "",
    contactName: "",
    contactEmail: "",
    lastContact: null,
    followUpDue: null,
    revenue: null,
    lossReason: "",
    isRecurring: false,
    estimatedValue: null,
    proposedValue: null,
    scheduledCallAt: null,
    calendarEventId: null,
  };

  if (!isAirtableConfigured) {
    const lead: Lead = {
      id: `manual-${Date.now()}`,
      dateFound: new Date().toISOString(),
      ...(fields as Omit<Lead, "id" | "dateFound">),
    };
    devLeads = [lead, ...devLeads];
    return lead;
  }

  const res = await fetchWithTimeout(
    airtableUrl(),
    {
      method: "POST",
      headers: airtableHeaders(),
      body: JSON.stringify({
        fields: { ...toAirtableFields(fields), "Date Found": new Date().toISOString() },
        typecast: true,
      }),
    },
    // Never auto-retry a create: if the first attempt actually succeeded
    // server-side but the response was lost, retrying would create a second
    // record -- exactly the duplicate this app works hard elsewhere to avoid.
    { retries: 0 }
  );

  if (!res.ok) {
    throw new Error(`Airtable create failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { id: string; fields: Record<string, unknown> };
  return fromAirtableRecord(data);
}

const escapeFormulaValue = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

// Conservative dedup (Role 1/9) for manually-added leads -- checked in
// priority order: canonical source URL, then exact client+title. Fuzzy/
// near-duplicate matching is deliberately NOT done here: silently merging
// two opportunities that just *look* similar risks losing a real, distinct
// one, so a near-miss stays something the freelancer eyeballs herself
// (app/api/leads POST surfaces this as a warning, not a hard block) rather
// than something code decides for her. Source+external-ID matching (the
// n8n pipeline's own dedup tier, keyed on the scraped listing's canonical
// URL) doesn't apply to manual entries -- they have no external ID.
export async function findDuplicateLead(input: {
  sourceUrl: string;
  clientName: string;
  title: string;
}): Promise<Lead | null> {
  const url = input.sourceUrl.trim();
  const title = input.title.trim().toLowerCase();
  const client = input.clientName.trim().toLowerCase();

  if (!isAirtableConfigured) {
    if (url) {
      const byUrl = devLeads.find((l) => l.sourceUrl.trim() === url);
      if (byUrl) return byUrl;
    }
    if (title && client) {
      return (
        devLeads.find(
          (l) =>
            l.title.trim().toLowerCase() === title &&
            l.clientName.trim().toLowerCase() === client
        ) ?? null
      );
    }
    return null;
  }

  async function queryOne(formula: string): Promise<Lead | null> {
    const res = await fetchWithTimeout(
      `${airtableUrl()}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`,
      { headers: airtableHeaders(), cache: "no-store" },
      { retries: 1 }
    );
    if (!res.ok) return null; // best-effort -- a dedup-check failure shouldn't block adding a real lead
    const data = (await res.json()) as { records: { id: string; fields: Record<string, unknown> }[] };
    return data.records[0] ? fromAirtableRecord(data.records[0]) : null;
  }

  if (url) {
    const match = await queryOne(`{Source URL} = "${escapeFormulaValue(url)}"`);
    if (match) return match;
  }
  if (title && client) {
    const match = await queryOne(
      `AND(LOWER({Title}) = "${escapeFormulaValue(title)}", LOWER({Client/Company}) = "${escapeFormulaValue(client)}")`
    );
    if (match) return match;
  }
  return null;
}
