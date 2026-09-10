import type { Lead } from "./types";

/**
 * Shown until AIRTABLE_API_KEY + AIRTABLE_BASE_ID are set. Lets the site be
 * built, reviewed, and demoed before the n8n workflow has produced real rows.
 */
export const sampleLeads: Lead[] = [
  {
    id: "sample-1",
    title: "Clinical Content Writer for Metabolic Health Platform",
    clientName: "Vero Health (telehealth startup)",
    sourceUrl: "https://example.com/jobs/clinical-writer-1",
    sourcePlatform: "Upwork",
    needSummary:
      "Ongoing patient-facing articles on metabolic conditions; wants a writer who can read clinical literature directly.",
    rawDescription:
      "We're a telehealth platform looking for a long-term content partner to write patient education material on metabolic health. Must be comfortable reading peer-reviewed studies and translating findings for a general audience. Nutrition background strongly preferred.",
    budgetSignal: "$60-80/hr, ongoing",
    fitScore: 9,
    scoreReasoning:
      "Directly requires nutrition science literacy and primary-source reading — a strong match for an MSc-credentialed writer, not generic content work.",
    urgency: "High",
    status: "New",
    dateFound: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
  },
  {
    id: "sample-2",
    title: "White Paper: Gut Microbiome & Supplement Efficacy",
    clientName: "NutraLine Sciences",
    sourceUrl: "https://example.com/jobs/white-paper-2",
    sourcePlatform: "Company Blog",
    needSummary:
      "One-off 5,000 word white paper synthesizing microbiome research for an advisory board.",
    rawDescription:
      "Seeking a freelance writer to produce a white paper reviewing current research on gut microbiome and supplement efficacy, for internal advisory board use. Must cite primary literature and note study limitations.",
    budgetSignal: "$1,800 flat",
    fitScore: 8,
    scoreReasoning:
      "Literature synthesis with explicit evidence-grading requirement — squarely in her research-writing specialism.",
    urgency: "Medium",
    status: "New",
    dateFound: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
  },
  {
    id: "sample-3",
    title: "Legal-Tech Compliance Blog — 4 articles/month",
    clientName: "Statuly (legal-tech SaaS)",
    sourceUrl: "https://example.com/jobs/legal-3",
    sourcePlatform: "Upwork",
    needSummary:
      "Recurring plain-language compliance articles for a legal SaaS product's users.",
    rawDescription:
      "Legal-tech company needs a writer to turn regulatory frameworks into plain-language blog posts for our SaaS users. No legal advice, just accurate explainers. Looking for someone who won't need heavy compliance-team rewrites.",
    budgetSignal: "Not specified",
    fitScore: 7,
    scoreReasoning:
      "Legal-adjacent explainer writing matching her stated specialism, though budget is unclear and worth confirming before proposing.",
    urgency: "Medium",
    status: "Applied",
    dateFound: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
  },
  {
    id: "sample-4",
    title: "SEO Blog Writer — Home & Lifestyle",
    clientName: "CasaBlog Media",
    sourceUrl: "https://example.com/jobs/generic-4",
    sourcePlatform: "Upwork",
    needSummary: "Generic SEO content across home decor, lifestyle, and travel topics.",
    rawDescription:
      "Content mill looking for fast turnaround SEO writers across multiple lifestyle verticals. No subject-matter expertise required, volume-based pay.",
    budgetSignal: "$0.03/word",
    fitScore: 2,
    scoreReasoning:
      "No health, legal, or research component and pay signals a content-mill model — poor fit for a credentialed specialist.",
    urgency: "Low",
    status: "Passed",
    dateFound: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
  },
  {
    id: "sample-5",
    title: "Government RFP Response — Public Health Initiative",
    clientName: "Sequoia Consulting Group",
    sourceUrl: "https://example.com/jobs/rfp-5",
    sourcePlatform: "Company Blog",
    needSummary:
      "One-off proposal writing for a public health RFP submission, evaluator-scored format.",
    rawDescription:
      "Consulting group needs a proposal writer experienced with public health RFPs to help structure a response against a scoring rubric. Deadline in 3 weeks.",
    budgetSignal: "$2,500 flat",
    fitScore: 9,
    scoreReasoning:
      "Proposal/RFP writing for public health is a named specialism and the scoring-rubric detail suggests a sophisticated, well-paying client.",
    urgency: "High",
    status: "Won",
    dateFound: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
  },
];
