// Self-check for lib/insights.ts (Role 5). Imports the real module directly
// -- its only import is `type Lead`, which TS erases, so Node's native TS
// support can load it standalone (no bundler needed).
// Run: node lib/insights.selfcheck.mjs
import assert from "assert";
import { tierFor, computeInsights } from "./insights.ts";

// --- tier: sample size alone caps at "Early Signal" ---------------------------------------------
assert.equal(tierFor({ opportunities: 0, won: 0, revenue: 0, replied: 0 }), "Insufficient Data");
assert.equal(tierFor({ opportunities: 4, won: 0, revenue: 0, replied: 0 }), "Insufficient Data");
assert.equal(tierFor({ opportunities: 5, won: 0, revenue: 0, replied: 0 }), "Early Signal");
assert.equal(tierFor({ opportunities: 100, won: 0, revenue: 0, replied: 0 }), "Early Signal"); // volume alone never earns more
assert.equal(tierFor({ opportunities: 1000, won: 0, revenue: 0, replied: 0 }), "Early Signal");

// --- tier: a real outcome (reply/win) below the sample floor still counts as *something* --------
assert.equal(tierFor({ opportunities: 1, won: 1, revenue: 0, replied: 0 }), "Early Signal");
assert.equal(tierFor({ opportunities: 1, won: 0, revenue: 0, replied: 1 }), "Early Signal");

// --- tier: Promising/Strong Evidence require BOTH a sample floor AND a real outcome --------------
assert.equal(tierFor({ opportunities: 5, won: 1, revenue: 0, replied: 0 }), "Promising");
assert.equal(tierFor({ opportunities: 4, won: 1, revenue: 0, replied: 0 }), "Early Signal"); // sample floor not met yet
assert.equal(tierFor({ opportunities: 15, won: 3, revenue: 0, replied: 0 }), "Strong Evidence");
assert.equal(tierFor({ opportunities: 14, won: 3, revenue: 0, replied: 0 }), "Promising"); // sample floor not met yet
assert.equal(tierFor({ opportunities: 15, won: 0, revenue: 3000, replied: 0 }), "Strong Evidence");

// --- the exact scenario from the spec: volume-with-no-revenue must NOT outrank a proven niche ----
{
  const big = tierFor({ opportunities: 100, won: 0, revenue: 0, replied: 0 });
  const small = tierFor({ opportunities: 20, won: 3, revenue: 1500, replied: 5 });
  const RANK = { "Insufficient Data": 0, "Early Signal": 1, Promising: 2, "Strong Evidence": 3 };
  assert.ok(RANK[small] > RANK[big], `expected the converting niche (${small}) to outrank raw volume (${big})`);
}

// --- helper: minimal lead builder --------------------------------------------------------------
let n = 0;
const lead = (overrides = {}) => ({
  id: `l${++n}`,
  title: "x", clientName: "x", sourceUrl: "", sourcePlatform: "Upwork",
  needSummary: "", rawDescription: "", budgetSignal: "Not specified",
  status: "Needs Review", dateFound: "2026-01-01T00:00:00.000Z", closedAt: null,
  repliedAt: null, conversationAt: null, callBookedAt: null, proposalAt: null,
  skillFitScore: 5, valueScore: 5, confidence: "Medium", scoreReasoning: "", recommendedAction: "Consider",
  nicheTag: "health-nutrition", urgency: "Medium",
  verifiedFacts: [], inferredSignals: [], unknownFactors: [], positiveSignals: [], negativeSignals: [],
  recommendedService: "", outreachAngle: "", outreachDraft: "",
  contactName: "", contactEmail: "", lastContact: null, followUpDue: null, notes: "",
  revenue: null, lossReason: "", isRecurring: false, estimatedValue: null, proposedValue: null,
  scheduledCallAt: null, calendarEventId: null,
  ...overrides,
});

// --- a tiny niche must read as Insufficient Data, and say so in plain words --------------------
{
  const leads = [lead({ nicheTag: "tiny-niche" }), lead({ nicheTag: "tiny-niche" })];
  const { byNiche } = computeInsights(leads);
  const g = byNiche.find((g) => g.key === "tiny-niche");
  assert.equal(g.tier, "Insufficient Data");
  assert.ok(g.summary.includes("Not enough data"), g.summary);
  assert.ok(g.summary.toLowerCase().includes("continue testing"), g.summary);
}

// --- reply/win rate use the funnel-milestone fields and lastContact, not current status --------
// (a lead that replied then was later marked Lost must still count as "replied")
{
  const leads = [
    lead({ nicheTag: "n", lastContact: "2026-01-05T00:00:00.000Z", repliedAt: "2026-01-06T00:00:00.000Z", status: "Lost", closedAt: "2026-01-10T00:00:00.000Z" }),
    lead({ nicheTag: "n", lastContact: "2026-01-05T00:00:00.000Z" }), // contacted, never replied
    lead({ nicheTag: "n" }), // never contacted at all
    lead({ nicheTag: "n", status: "Won", revenue: 1000, dateFound: "2026-01-01T00:00:00.000Z", closedAt: "2026-01-11T00:00:00.000Z" }),
    lead({ nicheTag: "n" }),
  ];
  const { byNiche } = computeInsights(leads);
  const g = byNiche.find((g) => g.key === "n");
  assert.equal(g.opportunities, 5);
  assert.equal(g.contacted, 2); // two leads with lastContact set
  assert.equal(g.replied, 1); // only the one with repliedAt, regardless of it now being "Lost"
  assert.equal(g.replyRate, 50); // 1/2
  assert.equal(g.won, 1);
  assert.equal(g.lost, 1);
  assert.equal(g.winRate, 50); // 1 won / (1 won + 1 lost)
  assert.equal(g.revenue, 1000);
  assert.equal(g.avgDealValue, 1000);
  assert.equal(g.avgDaysToClose, 10); // 2026-01-01 -> 2026-01-11
}

// --- Passed is excluded from win rate (she declining is not a "loss") --------------------------
{
  const leads = [
    lead({ nicheTag: "p", status: "Won", revenue: 500, dateFound: "2026-01-01T00:00:00.000Z", closedAt: "2026-01-02T00:00:00.000Z" }),
    lead({ nicheTag: "p", status: "Passed" }),
  ];
  const g = computeInsights(leads).byNiche.find((g) => g.key === "p");
  assert.equal(g.won, 1);
  assert.equal(g.lost, 0);
  assert.equal(g.passed, 1);
  assert.equal(g.winRate, 100); // 1 / (1 + 0), Passed doesn't dilute it
}

// --- byService only includes leads Role 3 actually ran on ---------------------------------------
{
  const leads = [lead({ recommendedService: "Ongoing retainer" }), lead({ recommendedService: "" })];
  const { byService } = computeInsights(leads);
  assert.equal(byService.length, 1);
  assert.equal(byService[0].opportunities, 1);
}

// --- overall aggregates everything regardless of grouping ---------------------------------------
{
  const leads = [lead({ nicheTag: "a" }), lead({ nicheTag: "b" }), lead({ nicheTag: "b" })];
  const { overall } = computeInsights(leads);
  assert.equal(overall.opportunities, 3);
}

// --- revenue: recurring vs one-time split, pipeline value, proposed value ----------------------
{
  const leads = [
    lead({ nicheTag: "r", status: "Won", revenue: 2000, isRecurring: true }),
    lead({ nicheTag: "r", status: "Won", revenue: 500, isRecurring: false }),
    lead({ nicheTag: "r", status: "Approved", estimatedValue: 800 }),
    lead({ nicheTag: "r", status: "Proposal", proposalAt: "2026-01-01T00:00:00.000Z", proposedValue: 1200, estimatedValue: 1000 }),
    lead({ nicheTag: "r", status: "Lost", estimatedValue: 300 }), // no longer active -- excluded from pipeline
  ];
  const g = computeInsights(leads).byNiche.find((g) => g.key === "r");
  assert.equal(g.revenue, 2500);
  assert.equal(g.recurringRevenue, 2000);
  assert.equal(g.oneTimeRevenue, 500);
  assert.equal(g.pipelineValue, 1800); // Approved(800) + Proposal(1000) -- Lost is not active
  assert.equal(g.proposedValue, 1200);
}

// --- ranking: a real-revenue small group outranks a large group with zero outcomes --------------
{
  const bigNoOutcome = Array.from({ length: 100 }, () => lead({ nicheTag: "big-empty" }));
  const smallConverting = Array.from({ length: 20 }, (_, i) =>
    lead({
      nicheTag: "small-proven",
      status: i < 3 ? "Won" : "Needs Review",
      revenue: i < 3 ? 500 : null,
      lastContact: i < 5 ? "2026-01-01T00:00:00.000Z" : null,
      repliedAt: i < 5 ? "2026-01-02T00:00:00.000Z" : null,
    })
  );
  const { byNiche } = computeInsights([...bigNoOutcome, ...smallConverting]);
  const rankOf = (key) => byNiche.findIndex((g) => g.key === key);
  assert.ok(rankOf("small-proven") < rankOf("big-empty"), "the converting niche must sort above raw volume with no outcomes");
}

console.log("insights.selfcheck: all checks pass");
