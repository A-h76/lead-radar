import { NextResponse } from "next/server";
import { fetchLeads } from "@/lib/airtable";

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
