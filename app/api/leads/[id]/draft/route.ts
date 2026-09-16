import { NextRequest, NextResponse } from "next/server";
import { getLead, updateLead } from "@/lib/airtable";
import { callOpenAIJson, isOpenAIConfigured } from "@/lib/openai";
import { clientKey, rateLimit } from "@/lib/rateLimit";

// Role 3 (Sales Strategist). Produces a draft; never sends anything. The
// freelancer reviews/edits it in the dashboard (the draft field is a normal
// editable textarea, saved like Notes) and sends it herself, outside this
// system, then records the outcome by moving the lead's status to
// "Contacted" -- see components/Dashboard.tsx.
//
// Edit this to reflect Eisha's actual background/portfolio as it grows.
const FREELANCER_PROFILE =
  "A freelance writer with an MSc in Human Nutrition and Dietetics, working across two pillars: (1) evidence-based nutrition and health content requiring clinical accuracy and primary-source research, and (2) technology, AI, SaaS and B2B content that explains complex products to non-expert audiences. She is early in her freelance career and does not yet have a large portfolio of client testimonials -- outreach should lead with specific, verifiable expertise (the MSc, and demonstrated willingness to read primary literature or technical documentation) rather than years of experience or client names she does not have.";

const SHARED_RULES = `RULES:
- Never invent facts about the client, their company, or the opportunity that are not present in the evidence given. If a detail would strengthen the message but is not known, leave a bracketed placeholder like [confirm timeline] rather than guessing.
- Never claim a portfolio, past clients, testimonials, or years of experience the freelancer does not have.
- The draft is SHORT (under 150 words), not salesy, and ends with one clear, low-pressure next step.
- This is a DRAFT for the freelancer to review and edit before she sends it herself -- never phrase it as if it has already been sent, and never include any instruction to send it automatically.`;

// Role 3 covers both stages of outreach (§7's "AI can generate follow-up
// draft"), with distinct framing rather than reusing the initial-outreach
// prompt as-is: a follow-up must read as a natural nudge to someone who
// already has her first message, not a repeat of the same pitch.
const SYSTEM_PROMPTS: Record<"initial" | "followup", string> = {
  initial: `You are the Sales Strategist. Given one opportunity's evidence and the freelancer's background below, produce a recommended service framing, a specific personalization angle, and a short draft FIRST-CONTACT outreach message.

FREELANCER BACKGROUND: ${FREELANCER_PROFILE}

${SHARED_RULES}
- Reference something real from the evidence, not generic flattery -- this is the first message this client will see from her.

Return ONLY a JSON object with keys: recommended_service (a short label, e.g. "Ongoing content retainer" or "One-off white paper"), outreach_angle (1-2 sentences explaining the personalization hook chosen and why), draft (the outreach message text).`,

  followup: `You are the Sales Strategist. This opportunity was already contacted and hasn't had a reply. Given the evidence below and the freelancer's background, produce a short, low-pressure FOLLOW-UP message -- not a repeat of the original pitch.

FREELANCER BACKGROUND: ${FREELANCER_PROFILE}

${SHARED_RULES}
- Assume she already sent an initial message; this is a gentle bump, not a re-pitch. Do not re-explain her qualifications at length -- one line of context is enough.
- Acknowledge that she hasn't heard back without sounding impatient or entitled to a reply.
- If it's been a while, it's fine to offer a graceful out (e.g. "if the timing's off, no worries").

Return ONLY a JSON object with keys: recommended_service (unchanged framing, short label), outreach_angle (1 sentence on the follow-up angle chosen), draft (the follow-up message text).`,
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isOpenAIConfigured) {
    return NextResponse.json(
      { error: "Draft generation isn't configured -- set OPENAI_API_KEY on the website." },
      { status: 400 }
    );
  }

  const limit = rateLimit(`draft:${clientKey(request)}`, 30, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many draft requests -- wait a moment and retry." }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { mode?: string };
  const mode: "initial" | "followup" = body.mode === "followup" ? "followup" : "initial";

  const lead = await getLead(id);
  if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });

  const daysSinceContact = lead.lastContact
    ? Math.round((Date.now() - new Date(lead.lastContact).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const userContent = [
    `Opportunity: ${lead.title}`,
    `Client/company: ${lead.clientName}`,
    `Platform: ${lead.sourcePlatform}`,
    `What they need: ${lead.needSummary || lead.rawDescription || "(not recorded)"}`,
    `Budget signal: ${lead.budgetSignal}`,
    `Niche: ${lead.nicheTag || "not yet classified"}`,
    lead.verifiedFacts.length ? `Verified facts: ${lead.verifiedFacts.join("; ")}` : "",
    lead.scoreReasoning ? `Why this looked like a fit: ${lead.scoreReasoning}` : "",
    lead.notes ? `Freelancer's own notes: ${lead.notes}` : "",
    mode === "followup" && lead.outreachDraft ? `Her original message: ${lead.outreachDraft}` : "",
    mode === "followup" && daysSinceContact != null ? `Days since she last contacted them: ${daysSinceContact}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const ai = await callOpenAIJson(SYSTEM_PROMPTS[mode], userContent);
    const update = {
      recommendedService: (ai.recommended_service as string) || lead.recommendedService,
      outreachAngle: (ai.outreach_angle as string) || "",
      outreachDraft: (ai.draft as string) || "",
    };
    await updateLead(id, update);
    return NextResponse.json({ success: true, ...update });
  } catch (err) {
    console.error("Draft generation failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Draft generation failed." },
      { status: 500 }
    );
  }
}
