import { NextRequest, NextResponse } from "next/server";
import { getLead, updateLead } from "@/lib/airtable";
import { callOpenAIJson, isOpenAIConfigured } from "@/lib/openai";
import { clientKey, rateLimit } from "@/lib/rateLimit";
import type { LeadUpdate } from "@/lib/types";

// Role 2 (Opportunity Analyst) run on demand for a manually-added lead.
// Identical rubric to n8n's "OpenAI: Score Lead" node (n8n/lead-radar.workflow.json)
// -- kept in sync by hand, same trade-off as lib/airtable.ts's toLines/fromLines --
// so a scraped lead and a manually-added one are scored on the same scale and
// Role 5 can compare across sources honestly.
const SYSTEM_PROMPT =
  "You are the Opportunity Analyst for a freelance writer with an MSc in Human Nutrition and Dietetics who works across two core pillars: (1) evidence-based nutrition and health content that requires clinical accuracy and primary-source research, and (2) technology, AI, SaaS and B2B content that explains complex products to non-expert audiences. White papers and long-form explainers are core work in either pillar. Score SKILL FIT (does she have the expertise to do this well) separately from VALUE (is it worth her time -- budget, scope, recurring potential). TIER A skill fit 7-10: work in either core pillar that needs genuine subject-matter literacy -- clinical accuracy, research skill, or the ability to explain a technical product credibly. TIER B skill fit 4-6: general commercial writing she accepts but does not specialize in -- SEO blog posts, website and About copy, product descriptions, e-commerce content, email and social copy, executive ghostwriting. TIER C skill fit 1-3: content-mill work, unrelated industries, no-budget or spammy postings, unpaid guest posts, or sites that charge writers to publish. Score VALUE higher for a strong or clearly stated budget, recurring or retainer language, and an established-looking client; score it lower for unstated budget, one-off scope, or content-mill pay signals. Separate what the listing text actually states (verified_facts) from what you are guessing based on context (inferred_signals) from what cannot be determined at all (unknown_factors) -- never state an inference as if it were a fact. Set confidence to Low whenever the listing text is thin, vague, or mostly boilerplate. Set recommended_action to Apply only for skill_fit 7+ with no major negative signal, Skip for skill_fit 3 or below or any disqualifying red flag, Consider otherwise. Set niche_tag to a short lowercase-hyphenated label for the opportunity type, such as health-nutrition, tech-saas-b2b, or general-content -- invent a new tag if neither fits, so the freelancer can eventually see which niches are actually converting. Return ONLY a JSON object with keys: client_name, need_summary (1-2 sentences), budget_signal (or Not specified), skill_fit_score (integer 1-10), value_score (integer 1-10), confidence (High, Medium, or Low), score_reasoning (1 sentence, specific about which pillar and tier and why), recommended_action (Apply, Consider, or Skip), niche_tag (short lowercase-hyphenated label), verified_facts (array of short strings, only things the listing text actually states), inferred_signals (array of short strings, your judgment calls, may be empty), unknown_factors (array of short strings naming what is unknown, may be empty), positive_signals (array of short strings), negative_signals (array of short strings), urgency (one of High, Medium, Low).";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isOpenAIConfigured) {
    return NextResponse.json(
      { error: "AI analysis isn't configured -- set OPENAI_API_KEY on the website." },
      { status: 400 }
    );
  }

  // Cost control (§10): a generous cap that only kicks in for a runaway
  // client/bug, not normal one-freelancer usage.
  const limit = rateLimit(`analyze:${clientKey(request)}`, 30, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many analysis requests -- wait a moment and retry." }, { status: 429 });
  }

  const lead = await getLead(id);
  if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });

  // Mark the transition as real, not just a client-side spinner -- if the
  // tab closes mid-call, the lead is left at "Analyzing" (retriable) rather
  // than silently reverting with no trace anything was attempted.
  await updateLead(id, { status: "Analyzing" });

  const userContent = [
    `Listing title: ${lead.title}`,
    `Client/company (as entered): ${lead.clientName}`,
    `Platform: ${lead.sourcePlatform}`,
    `Listing text: ${lead.needSummary || lead.rawDescription || "(no description provided)"}`,
    lead.notes ? `Freelancer's own notes: ${lead.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const ai = await callOpenAIJson(SYSTEM_PROMPT, userContent);
    const lines = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

    const update: LeadUpdate = {
      status: "Needs Review",
      skillFitScore: Number(ai.skill_fit_score) || 0,
      valueScore: Number(ai.value_score) || 0,
      confidence: ((ai.confidence as string) || "Low") as LeadUpdate["confidence"],
      scoreReasoning: (ai.score_reasoning as string) || "",
      recommendedAction: ((ai.recommended_action as string) ||
        "Consider") as LeadUpdate["recommendedAction"],
      nicheTag: (ai.niche_tag as string) || "",
      urgency: ((ai.urgency as string) || "Medium") as LeadUpdate["urgency"],
      verifiedFacts: lines(ai.verified_facts),
      inferredSignals: lines(ai.inferred_signals),
      unknownFactors: lines(ai.unknown_factors),
      positiveSignals: lines(ai.positive_signals),
      negativeSignals: lines(ai.negative_signals),
      // client_name/need_summary/budget_signal are NOT overwritten here --
      // the freelancer entered those herself; her own words outrank a model
      // guess made from the same sparse text she just gave it.
    };

    await updateLead(id, update);
    return NextResponse.json({ success: true, update });
  } catch (err) {
    console.error("Analysis failed:", err);
    // Never leave it stuck at "Analyzing" -- roll back so the button is
    // retriable and the failure is visible, not silent.
    await updateLead(id, { status: "Discovered" }).catch(() => {});
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analysis failed." },
      { status: 500 }
    );
  }
}
