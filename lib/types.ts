export type LeadStatus = "New" | "Applied" | "Won" | "Passed";
export type Urgency = "High" | "Medium" | "Low";

export interface Lead {
  id: string;
  title: string;
  clientName: string;
  sourceUrl: string;
  sourcePlatform: string;
  needSummary: string;
  rawDescription: string;
  budgetSignal: string;
  fitScore: number;
  scoreReasoning: string;
  urgency: Urgency;
  status: LeadStatus;
  dateFound: string; // ISO date
}

export const LEAD_STATUSES: LeadStatus[] = ["New", "Applied", "Won", "Passed"];
