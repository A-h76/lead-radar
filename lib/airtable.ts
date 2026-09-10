import type { Lead, LeadStatus } from "./types";
import { sampleLeads } from "./sample-leads";

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

// Airtable record -> our Lead shape. Adjust the field names on the left if
// the base's column names differ from the schema in the README.
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
    fitScore: Number(f["Fit Score"] ?? 0),
    scoreReasoning: (f["Score Reasoning"] as string) || "",
    urgency: ((f["Urgency"] as string) || "Low") as Lead["urgency"],
    status: ((f["Status"] as string) || "New") as LeadStatus,
    dateFound: (f["Date Found"] as string) || new Date().toISOString(),
  };
}

export async function fetchLeads(): Promise<Lead[]> {
  if (!isAirtableConfigured) {
    return [...devLeads].sort((a, b) => b.fitScore - a.fitScore);
  }

  const res = await fetch(`${airtableUrl()}?pageSize=100&sort[0][field]=Fit%20Score&sort[0][direction]=desc`, {
    headers: airtableHeaders(),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Airtable fetch failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    records: { id: string; fields: Record<string, unknown> }[];
  };
  return data.records.map(fromAirtableRecord);
}

export async function updateLeadStatus(
  id: string,
  status: LeadStatus
): Promise<void> {
  if (!isAirtableConfigured) {
    devLeads = devLeads.map((l) => (l.id === id ? { ...l, status } : l));
    return;
  }

  const res = await fetch(`${airtableUrl(`/${id}`)}`, {
    method: "PATCH",
    headers: airtableHeaders(),
    body: JSON.stringify({ fields: { Status: status } }),
  });

  if (!res.ok) {
    throw new Error(`Airtable update failed: ${res.status} ${await res.text()}`);
  }
}
