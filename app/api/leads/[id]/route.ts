import { NextRequest, NextResponse } from "next/server";
import { updateLeadStatus } from "@/lib/airtable";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/types";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { status } = (await request.json()) as { status: LeadStatus };

  if (!LEAD_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  try {
    await updateLeadStatus(id, status);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to update lead:", err);
    return NextResponse.json(
      { error: "Failed to update lead." },
      { status: 500 }
    );
  }
}
