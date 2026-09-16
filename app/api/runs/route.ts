import { NextResponse } from "next/server";
import { fetchLatestRun } from "@/lib/runs";

export async function GET() {
  try {
    const run = await fetchLatestRun();
    return NextResponse.json({ run });
  } catch (err) {
    console.error("Failed to fetch latest run:", err);
    // Degrade, don't 500 -- a Runs-fetch failure shouldn't take the banner
    // (or anything reading it) down with it.
    return NextResponse.json({ run: null, error: "Couldn't load run status." });
  }
}
