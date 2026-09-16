// Role 5 (Growth & Niche Strategist). Deliberately has NO AI call in it.
//
// Turning "8 opportunities, 2 replies" into a sentence doesn't need an LLM,
// and the one thing this role must never do -- state a conclusion the
// evidence doesn't support -- is exactly the failure mode a model can slip
// into under a vague "sound confident" pull. Computing the tier in code and
// only ever templating from it removes that risk entirely rather than
// trusting a prompt to self-police it every time.
import type { Lead } from "./types";

export type EvidenceTier = "Insufficient Data" | "Early Signal" | "Promising" | "Strong Evidence";

export interface TierInputs {
  opportunities: number;
  won: number;
  revenue: number;
  replied: number;
}

// ponytail: named thresholds, not a statistical model -- good enough to stop
// the dashboard from ever saying "your niche is X" off raw volume alone.
// Revisit once real outcome volume exists to compare against.
//
// Sample size alone can only ever earn "Early Signal" -- a pile of
// opportunities with zero replies and zero wins is not a pattern, it's an
// untested pile. Reaching "Promising"/"Strong Evidence" requires a real
// outcome (a reply, a win, revenue) on top of a minimum sample, specifically
// so that e.g. 100 opportunities + $0 revenue can never automatically
// outrank 20 opportunities + 3 wins + $1,500 -- see groupBy's sort below,
// which enforces the same rule for display order, not just the tier label.
const TIER_THRESHOLDS = {
  earlySignalSample: 5,
  promisingSample: 5,
  promisingReplied: 3,
  promisingWon: 1,
  promisingRevenue: 500,
  strongSample: 15,
  strongWon: 3,
  strongRevenue: 3000,
};

export function tierFor(s: TierInputs): EvidenceTier {
  const { opportunities, won, revenue, replied } = s;
  const hasStrongSignal = won >= TIER_THRESHOLDS.strongWon || revenue >= TIER_THRESHOLDS.strongRevenue;
  const hasPromisingSignal =
    replied >= TIER_THRESHOLDS.promisingReplied ||
    won >= TIER_THRESHOLDS.promisingWon ||
    revenue >= TIER_THRESHOLDS.promisingRevenue;

  if (opportunities >= TIER_THRESHOLDS.strongSample && hasStrongSignal) return "Strong Evidence";
  if (opportunities >= TIER_THRESHOLDS.promisingSample && hasPromisingSignal) return "Promising";
  if (opportunities >= TIER_THRESHOLDS.earlySignalSample || won >= 1 || replied >= 1) return "Early Signal";
  return "Insufficient Data";
}

const TIER_RANK: Record<EvidenceTier, number> = {
  "Insufficient Data": 0,
  "Early Signal": 1,
  Promising: 2,
  "Strong Evidence": 3,
};

export interface GroupStats {
  key: string;
  tier: EvidenceTier;
  opportunities: number;
  contacted: number;
  replied: number;
  conversations: number;
  callsBooked: number;
  proposals: number;
  won: number;
  lost: number;
  passed: number;
  revenue: number; // actual, closed (Won only) -- never a guess
  recurringRevenue: number; // subset of `revenue` from leads marked isRecurring
  oneTimeRevenue: number; // subset of `revenue` from leads not marked recurring
  pipelineValue: number; // sum of estimatedValue across still-active opportunities -- what's in flight, not closed
  proposedValue: number; // sum of proposedValue across leads that reached Proposal or later (active or won)
  avgDealValue: number | null;
  replyRate: number | null; // replied / contacted
  winRate: number | null; // won / (won + lost) -- passed excluded, she declined it, it's not a loss
  avgDaysToClose: number | null; // mean(closedAt - dateFound) over Won leads only
  summary: string;
}

const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));

const rate = (numerator: number, denominator: number) =>
  denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null; // one decimal place, %

const ACTIVE_FOR_PIPELINE = new Set([
  "Discovered",
  "Analyzing",
  "Needs Review",
  "Approved",
  "Contacted",
  "Replied",
  "Conversation",
  "Call Booked",
  "Proposal",
]);

function computeGroup(key: string, leads: Lead[]): GroupStats {
  const opportunities = leads.length;
  const contacted = leads.filter((l) => l.lastContact).length;
  const replied = leads.filter((l) => l.repliedAt).length;
  const conversations = leads.filter((l) => l.conversationAt).length;
  const callsBooked = leads.filter((l) => l.callBookedAt).length;
  const proposals = leads.filter((l) => l.proposalAt).length;
  const wonLeads = leads.filter((l) => l.status === "Won");
  const won = wonLeads.length;
  const lost = leads.filter((l) => l.status === "Lost").length;
  const passed = leads.filter((l) => l.status === "Passed").length;
  const revenue = wonLeads.reduce((sum, l) => sum + (l.revenue || 0), 0);
  const recurringRevenue = wonLeads
    .filter((l) => l.isRecurring)
    .reduce((sum, l) => sum + (l.revenue || 0), 0);
  const oneTimeRevenue = revenue - recurringRevenue;
  const pipelineValue = leads
    .filter((l) => ACTIVE_FOR_PIPELINE.has(l.status))
    .reduce((sum, l) => sum + (l.estimatedValue || 0), 0);
  const proposedValue = leads
    .filter((l) => l.proposalAt)
    .reduce((sum, l) => sum + (l.proposedValue || 0), 0);

  const tier = tierFor({ opportunities, won, revenue, replied });

  const daysToClose = wonLeads
    .filter((l) => l.closedAt)
    .map((l) => daysBetween(l.dateFound, l.closedAt as string));

  const stats: Omit<GroupStats, "summary"> = {
    key,
    tier,
    opportunities,
    contacted,
    replied,
    conversations,
    callsBooked,
    proposals,
    won,
    lost,
    passed,
    revenue,
    recurringRevenue,
    oneTimeRevenue,
    pipelineValue,
    proposedValue,
    avgDealValue: won > 0 ? Math.round(revenue / won) : null,
    replyRate: rate(replied, contacted),
    winRate: rate(won, won + lost),
    avgDaysToClose: daysToClose.length
      ? Math.round(daysToClose.reduce((a, b) => a + b, 0) / daysToClose.length)
      : null,
  };

  return { ...stats, summary: summarize(stats) };
}

function summarize(s: Omit<GroupStats, "summary">): string {
  if (s.tier === "Insufficient Data") {
    const noun = s.opportunities === 1 ? "opportunity" : "opportunities";
    return `Not enough data yet (${s.opportunities} ${noun}) — continue testing opportunities in "${s.key}" before drawing conclusions.`;
  }
  const parts: string[] = [`${s.opportunities} opportunities`];
  if (s.replyRate != null) parts.push(`${s.replyRate}% reply rate`);
  if (s.winRate != null) parts.push(`${s.winRate}% win rate`);
  if (s.revenue > 0) parts.push(`$${s.revenue.toLocaleString()} revenue`);
  if (s.recurringRevenue > 0) parts.push(`$${s.recurringRevenue.toLocaleString()} of it recurring`);
  const hedge =
    s.tier === "Early Signal"
      ? "Early signal — worth continued testing, not yet a conclusion."
      : s.tier === "Promising"
        ? "Current evidence suggests a real pattern is forming."
        : "Strong evidence — this is a demonstrated pattern.";
  return `${parts.join(", ")}. ${hedge}`;
}

// Groups are ranked by evidence tier first, then by real outcomes (revenue,
// wins), and only fall back to raw opportunity count as the last tiebreaker.
// This is what makes the tier's intent (never let sample size alone win)
// hold in the UI too -- a bigger pile of untested leads cannot bump a
// smaller group with real, converted revenue further down the list.
function groupBy(leads: Lead[], keyOf: (l: Lead) => string): GroupStats[] {
  const groups = new Map<string, Lead[]>();
  for (const l of leads) {
    const key = keyOf(l) || "(unlabeled)";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  }
  return [...groups.entries()]
    .map(([key, group]) => computeGroup(key, group))
    .sort(
      (a, b) =>
        TIER_RANK[b.tier] - TIER_RANK[a.tier] ||
        b.revenue - a.revenue ||
        b.won - a.won ||
        b.opportunities - a.opportunities
    );
}

export interface Insights {
  overall: GroupStats;
  byNiche: GroupStats[];
  bySource: GroupStats[];
  byService: GroupStats[]; // only leads that have gone through Role 3 (recommendedService set)
}

export function computeInsights(leads: Lead[]): Insights {
  return {
    overall: computeGroup("All opportunities", leads),
    byNiche: groupBy(leads, (l) => l.nicheTag),
    bySource: groupBy(leads, (l) => l.sourcePlatform),
    byService: groupBy(
      leads.filter((l) => l.recommendedService),
      (l) => l.recommendedService
    ),
  };
}
