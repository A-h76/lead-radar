// Reads the "Runs" table the n8n workflow (and its error-handler workflow)
// write to after every execution — see n8n/README.md. Mirrors lib/airtable.ts's
// configured/demo-mode pattern, kept as its own small module rather than
// folded into lib/airtable.ts since it's a different table with no writes
// from the website side.
import { isAirtableConfigured } from "./airtable";
import { fetchWithTimeout } from "./http";

export type RunStatus = "Success" | "No Items Found" | "Failed";

export interface RunRecord {
  runId: string;
  trigger: string;
  startedAt: string;
  endedAt: string;
  durationSec: number | null;
  overallStatus: RunStatus;
  sourceStatus: string;
  itemsDiscovered: number | null;
  itemsFiltered: number | null;
  newOpportunities: number | null;
  duplicates: number | null;
  aiAnalyses: number | null;
  aiFailures: number | null;
  errors: string;
}

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const RUNS_TABLE = "Runs";

const sampleRun: RunRecord = {
  runId: "sample-run-1",
  trigger: "Scheduled",
  startedAt: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
  endedAt: new Date(Date.now() - 1000 * 60 * 60 * 8 + 1000 * 95).toISOString(),
  durationSec: 95,
  overallStatus: "Success",
  sourceStatus: "Upwork: 0 items | Company Site: 4 items",
  itemsDiscovered: 4,
  itemsFiltered: 2,
  newOpportunities: 1,
  duplicates: 1,
  aiAnalyses: 1,
  aiFailures: 0,
  errors: "",
};

function num(v: unknown): number | null {
  return v === "" || v == null ? null : Number(v);
}

function fromRecord(record: { fields: Record<string, unknown> }): RunRecord {
  const f = record.fields;
  return {
    runId: (f["Run ID"] as string) || "",
    trigger: (f["Trigger Type"] as string) || "Unknown",
    startedAt: (f["Started At"] as string) || "",
    endedAt: (f["Ended At"] as string) || "",
    durationSec: num(f["Duration (sec)"]),
    overallStatus: ((f["Overall Status"] as string) || "Failed") as RunStatus,
    sourceStatus: (f["Source Status"] as string) || "",
    itemsDiscovered: num(f["Items Discovered"]),
    itemsFiltered: num(f["Items Filtered"]),
    newOpportunities: num(f["New Opportunities"]),
    duplicates: num(f["Duplicates"]),
    aiAnalyses: num(f["AI Analyses"]),
    aiFailures: num(f["AI Failures"]),
    errors: (f["Errors"] as string) || "",
  };
}

/** Most recent run, or null if the Runs table is empty / not configured yet
 *  (a fresh base before the workflow has executed once — not an error). */
export async function fetchLatestRun(): Promise<RunRecord | null> {
  if (!isAirtableConfigured) return sampleRun;

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${RUNS_TABLE}?pageSize=1&sort[0][field]=Started%20At&sort[0][direction]=desc`;
  const res = await fetchWithTimeout(
    url,
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }, cache: "no-store" },
    { retries: 2 }
  );

  if (!res.ok) {
    // The Runs table may simply not exist yet on an older base — degrade to
    // "no data" rather than surfacing a scary error for a one-time setup gap.
    if (res.status === 404 || res.status === 422) return null;
    throw new Error(`Airtable Runs fetch failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { records: { fields: Record<string, unknown> }[] };
  return data.records[0] ? fromRecord(data.records[0]) : null;
}
