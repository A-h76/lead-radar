import { NextResponse } from "next/server";
import { fetchLeads } from "@/lib/airtable";
import { computeInsights } from "@/lib/insights";

export async function GET() {
  try {
    const leads = await fetchLeads();
    return NextResponse.json(computeInsights(leads));
  } catch (err) {
    console.error("Failed to compute insights:", err);
    return NextResponse.json(
      { error: "Couldn't load performance insights." },
      { status: 500 }
    );
  }
}
