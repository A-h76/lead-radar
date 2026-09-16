// Standalone check for the two small pure helpers in lib/airtable.ts that
// aren't otherwise exercised by `tsc --noEmit` (it checks types, not
// behavior). Duplicated here rather than imported because Node's ESM loader
// needs explicit .ts extensions that the Next.js-resolved source doesn't
// use -- keep this in sync with lib/airtable.ts if either changes.
// Run: node lib/airtable.selfcheck.mjs
import assert from "assert";

const toLines = (v) =>
  (v || "").split("\n").map((s) => s.trim()).filter(Boolean);
const fromLines = (arr) => (arr || []).filter(Boolean).join("\n");

function applyFollowUpRule(update) {
  if (update.status !== "Contacted") return update;
  const next = { ...update };
  if (next.lastContact === undefined) next.lastContact = new Date().toISOString();
  if (next.followUpDue === undefined) {
    const due = new Date();
    due.setDate(due.getDate() + 7);
    next.followUpDue = due.toISOString();
  }
  return next;
}

const TERMINAL_STATUSES = ["Won", "Lost", "Passed"];
function applyClosedAtRule(update) {
  if (!update.status || !TERMINAL_STATUSES.includes(update.status)) return update;
  if (update.closedAt !== undefined) return update;
  return { ...update, closedAt: new Date().toISOString() };
}

const FUNNEL_STAGES = ["Replied", "Conversation", "Call Booked", "Proposal"];
function stampFunnelMilestones(current, update) {
  if (!update.status) return update;
  const idx = FUNNEL_STAGES.indexOf(update.status);
  if (idx === -1) return update;
  const field = { Replied: "repliedAt", Conversation: "conversationAt", "Call Booked": "callBookedAt", Proposal: "proposalAt" };
  const next = { ...update };
  const now = new Date().toISOString();
  for (let i = 0; i <= idx; i++) {
    const key = field[FUNNEL_STAGES[i]];
    if (!current[key] && next[key] === undefined) next[key] = now;
  }
  return next;
}

// toLines/fromLines round-trip, ignoring blank lines
assert.deepEqual(toLines("a\nb\n\nc"), ["a", "b", "c"]);
assert.equal(fromLines(["a", "b", "c"]), "a\nb\nc");
assert.deepEqual(toLines(""), []);
assert.equal(fromLines([]), "");

// Moving to Contacted auto-schedules a follow-up 7 days out
{
  const before = Date.now();
  const out = applyFollowUpRule({ status: "Contacted" });
  assert.ok(out.lastContact && out.followUpDue);
  const dueMs = new Date(out.followUpDue).getTime();
  const days = Math.round((dueMs - before) / (1000 * 60 * 60 * 24));
  assert.equal(days, 7);
}

// An explicit follow-up date is respected, not overwritten
{
  const explicit = "2030-01-01T00:00:00.000Z";
  const out = applyFollowUpRule({ status: "Contacted", followUpDue: explicit });
  assert.equal(out.followUpDue, explicit);
}

// Non-"Contacted" status transitions are untouched
{
  const out = applyFollowUpRule({ status: "Won", revenue: 500 });
  assert.equal(out.followUpDue, undefined);
  assert.equal(out.revenue, 500);
}

// Reaching a terminal status stamps closedAt once, doesn't re-stamp if already set
{
  const out = applyClosedAtRule({ status: "Won" });
  assert.ok(out.closedAt);
}
assert.equal(applyClosedAtRule({ status: "Approved" }).closedAt, undefined);
assert.equal(applyClosedAtRule({ status: "Won", closedAt: "2030-01-01T00:00:00.000Z" }).closedAt, "2030-01-01T00:00:00.000Z");
for (const s of ["Won", "Lost", "Passed"]) assert.ok(applyClosedAtRule({ status: s }).closedAt, s);

// Funnel milestones: reaching a later stage backfills any earlier ones skipped, never overwrites
{
  const current = { repliedAt: null, conversationAt: null, callBookedAt: null, proposalAt: null };
  const out = stampFunnelMilestones(current, { status: "Call Booked" }); // skipped Replied/Conversation
  assert.ok(out.repliedAt && out.conversationAt && out.callBookedAt);
  assert.equal(out.proposalAt, undefined); // not reached yet
}
{
  // an already-set milestone is left OUT of the patch entirely (nothing to
  // change -- it's already correct in storage), not re-sent or overwritten
  const current = { repliedAt: "2020-01-01T00:00:00.000Z", conversationAt: null, callBookedAt: null, proposalAt: null };
  const out = stampFunnelMilestones(current, { status: "Conversation" });
  assert.equal(out.repliedAt, undefined);
  assert.ok(out.conversationAt);
}
// a status outside the tracked funnel (e.g. "Approved") stamps nothing
assert.deepEqual(stampFunnelMilestones({ repliedAt: null }, { status: "Approved" }), { status: "Approved" });

// --- dedup (§9): priority order URL -> exact client+title, exact-match only, no fuzzy ------------
// Mirrors findDuplicateLead's devLeads-path matching in lib/airtable.ts -- see that file's header
// comment for why this is duplicated rather than imported (the .env-dependent fetch path there).
function findDup(devLeads, input) {
  const url = input.sourceUrl.trim();
  const title = input.title.trim().toLowerCase();
  const client = input.clientName.trim().toLowerCase();
  if (url) {
    const byUrl = devLeads.find((l) => l.sourceUrl.trim() === url);
    if (byUrl) return byUrl;
  }
  if (title && client) {
    return devLeads.find(
      (l) => l.title.trim().toLowerCase() === title && l.clientName.trim().toLowerCase() === client
    ) ?? null;
  }
  return null;
}
const existing = [
  { id: "a", sourceUrl: "https://x.com/job/1", title: "Writer", clientName: "Acme" },
  { id: "b", sourceUrl: "", title: "Nutrition Writer", clientName: "Renew Health" },
];
// exact URL match wins
assert.equal(findDup(existing, { sourceUrl: "https://x.com/job/1", title: "different", clientName: "different" })?.id, "a");
// no URL -> falls back to exact client+title, case/whitespace-insensitive
assert.equal(findDup(existing, { sourceUrl: "", title: " nutrition writer ", clientName: "RENEW HEALTH" })?.id, "b");
// a merely-similar title is NOT a match -- fuzzy matching is deliberately not done here
assert.equal(findDup(existing, { sourceUrl: "", title: "Nutrition Writer II", clientName: "Renew Health" }), null);
// neither URL nor client+title given -> no match, not a false positive
assert.equal(findDup(existing, { sourceUrl: "", title: "", clientName: "" }), null);
// a genuinely new lead with a different URL and different client+title -> no match
assert.equal(findDup(existing, { sourceUrl: "https://x.com/job/2", title: "Writer", clientName: "Other Co" }), null);

console.log("airtable.selfcheck: all checks pass");
