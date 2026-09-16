import { NextRequest, NextResponse } from "next/server";
import { fetchLeads, createLead, findDuplicateLead } from "@/lib/airtable";

export async function GET() {
  try {
    const leads = await fetchLeads();
    return NextResponse.json({ leads });
  } catch (err) {
    console.error("Failed to fetch leads:", err);
    return NextResponse.json(
      { error: "Failed to fetch leads." },
      { status: 500 }
    );
  }
}

// Manual entry — Role 1's human-supplied source (agencies, warm network,
// LinkedIn, referrals). No scraping, no AI scoring: the freelancer already
// knows why this is a lead.
export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    title?: string;
    clientName?: string;
    sourceUrl?: string;
    sourcePlatform?: string;
    needSummary?: string;
    notes?: string;
    force?: boolean; // set once the freelancer has seen the duplicate warning and wants to add it anyway
  };

  if (!body.title?.trim()) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  const input = {
    title: body.title.trim(),
    clientName: body.clientName?.trim() || "Unknown",
    sourceUrl: body.sourceUrl?.trim() || "",
    sourcePlatform: body.sourcePlatform?.trim() || "Other",
    needSummary: body.needSummary?.trim() || "",
    notes: body.notes?.trim() || "",
  };

  try {
    // Conservative dedup (§9): an exact URL or client+title match is surfaced
    // as a blocker, not silently skipped or silently merged -- the freelancer
    // decides whether it's really the same opportunity via `force`.
    if (!body.force) {
      const duplicate = await findDuplicateLead(input).catch(() => null);
      if (duplicate) {
        return NextResponse.json(
          { error: "This looks like a duplicate of an existing lead.", duplicate },
          { status: 409 }
        );
      }
    }

    const lead = await createLead(input);
    return NextResponse.json({ lead });
  } catch (err) {
    console.error("Failed to create lead:", err);
    return NextResponse.json(
      { error: "Failed to create lead." },
      { status: 500 }
    );
  }
}
