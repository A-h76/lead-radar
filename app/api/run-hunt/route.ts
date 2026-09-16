import { NextResponse } from "next/server";
import { getRunState, recordTrigger } from "@/lib/run-status";
import { fetchWithTimeout } from "@/lib/http";

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

export async function GET() {
  return NextResponse.json(getRunState());
}

export async function POST() {
  if (!N8N_WEBHOOK_URL) {
    // Demo mode: no n8n instance wired up yet.
    recordTrigger();
    return NextResponse.json({ started: true, mode: "demo" });
  }

  try {
    // No retry: if n8n already accepted the run but the response was lost,
    // retrying here would start a second scrape/scoring pass.
    const res = await fetchWithTimeout(
      N8N_WEBHOOK_URL,
      { method: "POST" },
      { timeoutMs: 10000, retries: 0 }
    );
    if (!res.ok) {
      throw new Error(`n8n responded ${res.status}`);
    }
    recordTrigger();
    return NextResponse.json({ started: true, mode: "live" });
  } catch (err) {
    console.error("Failed to trigger n8n workflow:", err);
    return NextResponse.json(
      { error: "Failed to start the lead hunt." },
      { status: 500 }
    );
  }
}
