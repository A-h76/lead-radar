export type LeadStatus =
  | "Discovered" // exists in the CRM, not yet analyzed (manual entries only -- see below)
  | "Analyzing" // Role 2 analysis in flight
  | "Needs Review" // scored (AI or, for manual leads, skipped by choice) — awaiting a human decision
  | "Approved" // freelancer decided to pursue it
  | "Contacted"
  | "Replied"
  | "Conversation"
  | "Call Booked"
  | "Proposal"
  | "Won"
  | "Lost" // they said no / went with someone else
  | "Passed"; // she said no

// Every AI-sourced lead (n8n) is scored in one OpenAI call *before* it's ever
// written to Airtable -- there is no async gap where it would visibly sit at
// "Discovered" or "Analyzing", so n8n writes those leads directly to "Needs
// Review". Manual leads (agencies/warm network/LinkedIn/referrals) DO pass
// through Discovered -> Analyzing -> Needs Review for real, one API call at
// a time, triggered by the dashboard's "Analyze" button -- see
// app/api/leads/[id]/analyze/route.ts. Both paths converge at "Needs
// Review"; everything after that is identical regardless of source.
export const LEAD_STATUSES: LeadStatus[] = [
  "Discovered",
  "Analyzing",
  "Needs Review",
  "Approved",
  "Contacted",
  "Replied",
  "Conversation",
  "Call Booked",
  "Proposal",
  "Won",
  "Lost",
  "Passed",
];

// Statuses where the opportunity is still someone's job to move forward.
export const ACTIVE_STATUSES: LeadStatus[] = [
  "Discovered",
  "Analyzing",
  "Needs Review",
  "Approved",
  "Contacted",
  "Replied",
  "Conversation",
  "Call Booked",
  "Proposal",
];

// Won, Lost and Passed are kept as three distinct terminal outcomes (never
// collapsed) because Role 5 needs to tell "we won it" from "they said no"
// from "she declined it" to compute honest conversion rates.
export const TERMINAL_STATUSES: LeadStatus[] = ["Won", "Lost", "Passed"];

// The four forward stages that get a milestone timestamp -- see
// `repliedAt`/etc. on Lead and stampFunnelMilestones in lib/airtable.ts.
export const FUNNEL_STAGES: LeadStatus[] = ["Replied", "Conversation", "Call Booked", "Proposal"];

export type Urgency = "High" | "Medium" | "Low";
export type Confidence = "High" | "Medium" | "Low";
export type RecommendedAction = "Apply" | "Consider" | "Skip";

export const SOURCE_PLATFORMS = [
  "Upwork",
  "Company Site",
  "Agency",
  "Warm Network",
  "LinkedIn",
  "Referral",
  "Other",
] as const;

export interface Lead {
  id: string;
  title: string;
  clientName: string;
  sourceUrl: string;
  sourcePlatform: string;
  needSummary: string;
  rawDescription: string;
  budgetSignal: string;
  status: LeadStatus;
  dateFound: string; // ISO date
  closedAt: string | null; // ISO date, auto-set the moment status reaches Won/Lost/Passed

  // Funnel milestones -- each auto-set ONCE, the first time that stage is
  // reached (see lib/airtable.ts's stampFunnelMilestones), regardless of
  // what the lead's *current* status later becomes. Without these, a lead
  // that was Replied -> Conversation -> Lost would look identical to one
  // that was never replied to at all once it's marked Lost -- Role 5 needs
  // to tell those apart to compute an honest reply/conversation rate.
  repliedAt: string | null;
  conversationAt: string | null;
  callBookedAt: string | null;
  proposalAt: string | null;

  // Role 2 (Opportunity Analyst) output. Blank/zero until analysis actually
  // ran -- for manual leads that means "Discovered" and unscored is a real,
  // honest state, not a default to paper over.
  skillFitScore: number; // 1-10, expertise match
  valueScore: number; // 1-10, economic attractiveness (budget/scope/recurring)
  confidence: Confidence;
  scoreReasoning: string;
  recommendedAction: RecommendedAction;
  nicheTag: string;
  urgency: Urgency;

  // Evidence, split so nothing renders as fact that was actually a guess.
  verifiedFacts: string[]; // straight from the scraped/entered text
  inferredSignals: string[]; // the model's read on it, labeled as inference
  unknownFactors: string[]; // couldn't be determined -- shown as unknown, not guessed
  positiveSignals: string[];
  negativeSignals: string[];

  // Role 3 (Sales Strategist) output. Blank until "Generate draft" is used;
  // never sent automatically -- see app/api/leads/[id]/draft/route.ts.
  recommendedService: string; // e.g. "Ongoing content retainer", "One-off white paper"
  outreachAngle: string; // the specific personalization hook, 1-2 sentences
  outreachDraft: string; // editable -- the freelancer reviews/edits/sends it herself

  // Role 4 (CRM & Follow-Up). All optional -- most only apply once contacted.
  contactName: string;
  contactEmail: string;
  lastContact: string | null; // ISO date, set on every contact-stage transition
  followUpDue: string | null; // ISO date, auto-set +7d on "Contacted"
  notes: string;
  revenue: number | null; // ACTUAL revenue, set on Won -- never a guess (see estimatedValue/proposedValue)
  lossReason: string; // set on Lost
  isRecurring: boolean; // retainer/ongoing vs one-time -- set by the freelancer, informs Role 5's recurring-revenue read

  // Revenue pipeline (Role 5 first-class metric -- see lib/insights.ts). Both
  // are freelancer-entered estimates, never fabricated by AI, and distinct
  // from `revenue` (which is only ever the real, closed number on Won).
  estimatedValue: number | null; // her own ballpark of what the opportunity is worth, settable any time
  proposedValue: number | null; // what she actually quoted, once a Proposal is sent

  // Role 4 + calendar integration (Google Calendar -- see lib/calendar.ts).
  // Both null until a call is actually booked through "Schedule call"; a
  // lead can still be manually moved to "Call Booked" without ever setting
  // these (calendar linkage is optional, not required to use the status).
  scheduledCallAt: string | null; // ISO datetime of the booked call
  calendarEventId: string | null; // Google Calendar event id -- the idempotency key that prevents duplicate events
}

// Fields the dashboard/manual-entry form may write back. Distinguishing this
// from Lead keeps id/dateFound (server-assigned) out of the update surface.
export type LeadUpdate = Partial<Omit<Lead, "id" | "dateFound">>;
