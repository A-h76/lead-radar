"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Lead, LeadStatus } from "@/lib/types";
import { LEAD_STATUSES } from "@/lib/types";

type SortKey = "score" | "date";
type StatusFilter = "All" | LeadStatus;

const URGENCY_COLOR: Record<Lead["urgency"], string> = {
  High: "var(--coral)",
  Medium: "var(--blush)",
  Low: "var(--aqua)",
};

function scoreColor(score: number) {
  if (score >= 8) return "var(--coral)";
  if (score >= 5) return "var(--aqua)";
  return "var(--line)";
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function Dashboard({
  initialLeads,
  demoMode,
}: {
  initialLeads: Lead[];
  demoMode: boolean;
}) {
  const router = useRouter();
  const [leads, setLeads] = useState(initialLeads);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [lastTriggered, setLastTriggered] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/run-hunt")
      .then((r) => r.json())
      .then((d) => setLastTriggered(d.lastTriggeredAt))
      .catch(() => {});
  }, []);

  async function refreshLeads() {
    const res = await fetch("/api/leads", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setLeads(data.leads);
    }
  }

  async function handleRun() {
    setRunning(true);
    setRunMessage(null);
    try {
      const res = await fetch("/api/run-hunt", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start.");
      setLastTriggered(new Date().toISOString());
      setRunMessage(
        data.mode === "demo"
          ? "Demo mode — no n8n workflow connected yet. Set N8N_WEBHOOK_URL to go live."
          : "Started — new leads usually appear within 2-3 minutes. Refresh to check."
      );
    } catch (err) {
      setRunMessage(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setRunning(false);
    }
  }

  async function handleStatusChange(id: string, status: LeadStatus) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
    await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  const visibleLeads = useMemo(() => {
    let list = leads;
    if (statusFilter !== "All") list = list.filter((l) => l.status === statusFilter);
    return [...list].sort((a, b) =>
      sortKey === "score"
        ? b.fitScore - a.fitScore
        : new Date(b.dateFound).getTime() - new Date(a.dateFound).getTime()
    );
  }, [leads, statusFilter, sortKey]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-line pb-8">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-ink-3">
            Lead Radar
          </p>
          <h1 className="font-display mt-2 text-3xl font-semibold tracking-tight">
            Eisha&apos;s Lead Hunter
          </h1>
          {demoMode && (
            <p className="mt-2 text-xs text-coral">
              Showing sample data — connect Airtable to see real leads.
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          <button onClick={handleRun} disabled={running} className="btn">
            {running ? "Starting…" : "🔍 Run Lead Hunt"}
          </button>
          {lastTriggered && (
            <p className="text-xs text-ink-3">
              Last triggered {timeAgo(lastTriggered)}
            </p>
          )}
          <button
            onClick={async () => {
              await fetch("/api/logout", { method: "POST" });
              router.push("/login");
              router.refresh();
            }}
            className="text-xs text-ink-3 underline underline-offset-2 hover:text-ink"
          >
            Log out
          </button>
        </div>
      </header>

      {runMessage && (
        <p className="mt-4 rounded-lg bg-white px-4 py-3 text-sm text-ink-2 shadow-sm">
          {runMessage}
        </p>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="field w-auto text-sm"
        >
          <option value="All">All statuses</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="field w-auto text-sm"
        >
          <option value="score">Sort: Fit score</option>
          <option value="date">Sort: Date found</option>
        </select>

        <button onClick={refreshLeads} className="btn btn-ghost text-sm">
          Refresh
        </button>

        <span className="ml-auto text-sm text-ink-3">
          {visibleLeads.length} lead{visibleLeads.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {visibleLeads.length === 0 && (
          <p className="rounded-lg bg-white px-6 py-10 text-center text-sm text-ink-3 shadow-sm">
            No leads match this filter.
          </p>
        )}

        {visibleLeads.map((lead) => {
          const expanded = expandedId === lead.id;
          return (
            <div
              key={lead.id}
              className="rounded-xl bg-white shadow-sm ring-1 ring-black/5"
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => setExpandedId(expanded ? null : lead.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setExpandedId(expanded ? null : lead.id);
                  }
                }}
                className="grid w-full cursor-pointer grid-cols-1 gap-3 px-5 py-4 text-left md:grid-cols-12 md:items-center md:gap-4"
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold md:col-span-1"
                  style={{ background: scoreColor(lead.fitScore) }}
                  title="Fit score"
                >
                  {lead.fitScore}
                </div>

                <div className="md:col-span-5">
                  <p className="font-medium">{lead.title}</p>
                  <p className="text-sm text-ink-3">{lead.clientName}</p>
                </div>

                <p className="text-sm text-ink-2 md:col-span-3">
                  {lead.needSummary}
                </p>

                <span
                  className="inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-medium md:col-span-1"
                  style={{ background: URGENCY_COLOR[lead.urgency] }}
                >
                  {lead.urgency}
                </span>

                <span className="text-xs text-ink-3 md:col-span-1">
                  {timeAgo(lead.dateFound)}
                </span>

                <div
                  className="md:col-span-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <select
                    value={lead.status}
                    onChange={(e) =>
                      handleStatusChange(lead.id, e.target.value as LeadStatus)
                    }
                    className="field text-xs"
                  >
                    {LEAD_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {expanded && (
                <div className="space-y-3 border-t border-line px-5 py-4 text-sm">
                  <p>
                    <span className="font-medium text-ink-2">Why this score: </span>
                    {lead.scoreReasoning}
                  </p>
                  <p>
                    <span className="font-medium text-ink-2">Budget signal: </span>
                    {lead.budgetSignal}
                  </p>
                  <p className="text-ink-2">{lead.rawDescription}</p>
                  <p className="flex flex-wrap items-center gap-3 text-xs text-ink-3">
                    <span>{lead.sourcePlatform}</span>
                    {lead.sourceUrl && (
                      <a
                        href={lead.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2 hover:text-ink"
                      >
                        View original listing ↗
                      </a>
                    )}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
