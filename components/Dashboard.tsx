"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Lead, LeadStatus, LeadUpdate } from "@/lib/types";
import { ACTIVE_STATUSES, LEAD_STATUSES, SOURCE_PLATFORMS } from "@/lib/types";
import type { RunRecord } from "@/lib/runs";
import type { GroupStats, Insights } from "@/lib/insights";

type SortKey = "score" | "date";
type StatusFilter = "All" | LeadStatus;

const URGENCY_COLOR: Record<Lead["urgency"], string> = {
  High: "var(--coral)",
  Medium: "var(--blush)",
  Low: "var(--aqua)",
};

const CONFIDENCE_LABEL: Record<Lead["confidence"], string> = {
  High: "High confidence",
  Medium: "Medium confidence",
  Low: "Low confidence",
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

function dueLabel(iso: string) {
  const diffMs = new Date(iso).getTime() - Date.now();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "due today";
  return `due in ${days}d`;
}

function isOverdue(lead: Lead) {
  return (
    !!lead.followUpDue &&
    new Date(lead.followUpDue).getTime() <= Date.now() &&
    ACTIVE_STATUSES.includes(lead.status)
  );
}

function isUpcomingCall(lead: Lead) {
  return !!lead.scheduledCallAt && new Date(lead.scheduledCallAt).getTime() > Date.now();
}

function formatCallTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Local "now, an hour from now" defaults for the schedule-call datetime
// inputs, formatted for <input type="datetime-local">.
function localInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const emptyForm = {
  title: "",
  clientName: "",
  sourceUrl: "",
  sourcePlatform: "Warm Network" as string,
  needSummary: "",
  notes: "",
};

export default function Dashboard({
  initialLeads,
  demoMode,
  initialError,
}: {
  initialLeads: Lead[];
  demoMode: boolean;
  initialError?: string | null;
}) {
  const router = useRouter();
  const [leads, setLeads] = useState(initialLeads);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [lastTriggered, setLastTriggered] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState(emptyForm);
  const [adding, setAdding] = useState(false);
  const [lastRun, setLastRun] = useState<RunRecord | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [showInsights, setShowInsights] = useState(false);
  const [calendarStatus, setCalendarStatus] = useState<{
    configured: boolean;
    connected: boolean;
    email?: string | null;
  } | null>(null);
  const [calendarMessage, setCalendarMessage] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<Lead | null>(null);

  function refreshCalendarStatus() {
    fetch("/api/calendar/status")
      .then((r) => r.json())
      .then(setCalendarStatus)
      .catch(() => {});
  }

  useEffect(() => {
    fetch("/api/run-hunt")
      .then((r) => r.json())
      .then((d) => setLastTriggered(d.lastTriggeredAt))
      .catch(() => {});
    fetch("/api/runs")
      .then((r) => r.json())
      .then((d) => setLastRun(d.run))
      .catch(() => {});
    fetch("/api/insights")
      .then((r) => r.json())
      .then((d) => setInsights(d.overall ? d : null))
      .catch(() => {});
    refreshCalendarStatus();

    // The OAuth callback (app/api/calendar/callback) redirects back here
    // with ?calendar=connected|error -- surface it once, then scrub the URL
    // so a page refresh doesn't re-show a stale banner. Routed through a
    // microtask (not a bare setState call in the effect body) so this reads
    // as "react to an external redirect result", matching the pattern the
    // fetches above already use via .then().
    Promise.resolve().then(() => {
      const params = new URLSearchParams(window.location.search);
      const calendarResult = params.get("calendar");
      if (calendarResult === "connected") {
        setCalendarMessage("Google Calendar connected.");
      } else if (calendarResult === "error") {
        setCalendarMessage(
          `Couldn't connect Google Calendar${params.get("calendar_error") ? `: ${params.get("calendar_error")}` : "."}`
        );
      }
      if (calendarResult) {
        const url = new URL(window.location.href);
        url.searchParams.delete("calendar");
        url.searchParams.delete("calendar_error");
        window.history.replaceState({}, "", url.toString());
      }
    });
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

  async function updateLead(id: string, update: LeadUpdate) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...update } : l)));
    const res = await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    if (res.ok) {
      // The server may have derived more than we sent (follow-up date,
      // closedAt, funnel milestones — see lib/airtable.ts) — merge its
      // actual applied update rather than trusting only our guess.
      const data = await res.json();
      if (data.update) {
        setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...data.update } : l)));
      }
    }
  }

  async function handleStatusChange(id: string, status: LeadStatus) {
    await updateLead(id, { status });
  }

  // Role 2, run on demand for a manual (unscored) lead. Returns the response
  // body so the button can show its own error inline without Dashboard
  // having to track per-lead loading/error state for every lead at once.
  async function handleAnalyze(id: string) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status: "Analyzing" } : l)));
    const res = await fetch(`/api/leads/${id}/analyze`, { method: "POST" });
    const data = await res.json();
    setLeads((prev) =>
      prev.map((l) =>
        l.id === id ? { ...l, ...(res.ok ? data.update : { status: "Discovered" }) } : l
      )
    );
    return data as { error?: string };
  }

  // Role 3. Never sends anything -- just fills in the draft fields for the
  // freelancer to review/edit/copy herself. mode="followup" (§7) shifts the
  // prompt from a first-contact pitch to a gentle nudge -- see
  // app/api/leads/[id]/draft/route.ts.
  async function handleDraft(id: string, mode: "initial" | "followup" = "initial") {
    const res = await fetch(`/api/leads/${id}/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    const data = await res.json();
    if (res.ok) {
      setLeads((prev) =>
        prev.map((l) =>
          l.id === id
            ? {
                ...l,
                recommendedService: data.recommendedService,
                outreachAngle: data.outreachAngle,
                outreachDraft: data.outreachDraft,
              }
            : l
        )
      );
    }
    return data as { error?: string };
  }

  // Calendar (§8). Idempotent server-side (see the schedule-call route) --
  // a double-click just reschedules the same event, never creates a second.
  async function handleScheduleCall(id: string, startISO: string, endISO: string, timeZone: string) {
    const res = await fetch(`/api/leads/${id}/schedule-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startISO, endISO, timeZone }),
    });
    const data = await res.json();
    if (res.ok && data.update) {
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...data.update } : l)));
    }
    return data as { error?: string; eventLink?: string };
  }

  async function handleCancelCall(id: string) {
    const res = await fetch(`/api/leads/${id}/schedule-call`, { method: "DELETE" });
    const data = await res.json();
    if (res.ok) {
      setLeads((prev) =>
        prev.map((l) => (l.id === id ? { ...l, calendarEventId: null, scheduledCallAt: null } : l))
      );
    }
    return data as { error?: string };
  }

  async function submitAddLead(force: boolean) {
    setAdding(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...addForm, force }),
      });
      const data = await res.json();
      if (res.status === 409 && data.duplicate) {
        setDuplicateWarning(data.duplicate as Lead);
        return;
      }
      if (res.ok) {
        setLeads((prev) => [data.lead, ...prev]);
        setAddForm(emptyForm);
        setShowAddForm(false);
        setDuplicateWarning(null);
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleAddLead(e: React.FormEvent) {
    e.preventDefault();
    if (!addForm.title.trim()) return;
    setDuplicateWarning(null);
    await submitAddLead(false);
  }

  const followUps = useMemo(() => leads.filter(isOverdue), [leads]);
  const upcomingCalls = useMemo(
    () =>
      leads
        .filter(isUpcomingCall)
        .sort((a, b) => new Date(a.scheduledCallAt as string).getTime() - new Date(b.scheduledCallAt as string).getTime()),
    [leads]
  );

  const visibleLeads = useMemo(() => {
    let list = leads;
    if (statusFilter !== "All") list = list.filter((l) => l.status === statusFilter);
    return [...list].sort((a, b) =>
      sortKey === "score"
        ? b.skillFitScore - a.skillFitScore
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
          {initialError && (
            <p className="mt-2 text-xs text-coral">{initialError}</p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <button
              onClick={() => setShowAddForm((s) => !s)}
              className="btn btn-ghost"
            >
              + Add lead
            </button>
            <button onClick={handleRun} disabled={running} className="btn">
              {running ? "Starting…" : "🔍 Run Lead Hunt"}
            </button>
          </div>
          {lastTriggered && (
            <p className="text-xs text-ink-3">
              Last triggered {timeAgo(lastTriggered)}
            </p>
          )}
          {calendarStatus?.configured && (
            <p className="text-xs text-ink-3">
              {calendarStatus.connected ? (
                <>
                  📅 Connected as {calendarStatus.email}
                  {" · "}
                  <button
                    onClick={async () => {
                      await fetch("/api/calendar/disconnect", { method: "POST" });
                      refreshCalendarStatus();
                    }}
                    className="underline underline-offset-2 hover:text-ink"
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <a href="/api/calendar/connect" className="underline underline-offset-2 hover:text-ink">
                  📅 Connect Google Calendar
                </a>
              )}
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

      {calendarMessage && (
        <p className="mt-4 rounded-lg bg-white px-4 py-3 text-sm text-ink-2 shadow-sm">
          {calendarMessage}{" "}
          <button onClick={() => setCalendarMessage(null)} className="text-xs text-ink-3 underline underline-offset-2">
            Dismiss
          </button>
        </p>
      )}

      {lastRun && <RunHealthBanner run={lastRun} />}

      {runMessage && (
        <p className="mt-4 rounded-lg bg-white px-4 py-3 text-sm text-ink-2 shadow-sm">
          {runMessage}
        </p>
      )}

      {showAddForm && (
        <form
          onSubmit={handleAddLead}
          className="mt-4 space-y-3 rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5"
        >
          <p className="text-xs uppercase tracking-wide text-ink-3">
            Manual lead — agency, warm intro, referral, LinkedIn contact.
            Skips AI scoring since you already know why it&apos;s a lead.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              required
              placeholder="Title *"
              value={addForm.title}
              onChange={(e) => setAddForm((f) => ({ ...f, title: e.target.value }))}
              className="field"
            />
            <input
              placeholder="Client / company"
              value={addForm.clientName}
              onChange={(e) => setAddForm((f) => ({ ...f, clientName: e.target.value }))}
              className="field"
            />
            <select
              value={addForm.sourcePlatform}
              onChange={(e) => setAddForm((f) => ({ ...f, sourcePlatform: e.target.value }))}
              className="field"
            >
              {SOURCE_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <input
              placeholder="Source URL (optional)"
              value={addForm.sourceUrl}
              onChange={(e) => setAddForm((f) => ({ ...f, sourceUrl: e.target.value }))}
              className="field"
            />
          </div>
          <textarea
            placeholder="What do they need?"
            value={addForm.needSummary}
            onChange={(e) => setAddForm((f) => ({ ...f, needSummary: e.target.value }))}
            className="field w-full"
            rows={2}
          />
          <textarea
            placeholder="Notes"
            value={addForm.notes}
            onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))}
            className="field w-full"
            rows={2}
          />
          {duplicateWarning && (
            <div className="rounded-lg bg-blush/30 p-3 text-xs ring-1 ring-blush">
              <p className="text-ink-2">
                This looks like a duplicate of <strong>{duplicateWarning.title}</strong> (
                {duplicateWarning.clientName}, {duplicateWarning.status}) already in the CRM.
                Conservative dedup (§9) blocks an exact match rather than silently merging it —
                you decide.
              </p>
              <div className="mt-2 flex gap-3">
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => {
                    setShowAddForm(false);
                    setExpandedId(duplicateWarning.id);
                    setDuplicateWarning(null);
                  }}
                >
                  View existing lead
                </button>
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => submitAddLead(true)}
                >
                  Add anyway — it&apos;s different
                </button>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={adding} className="btn">
              {adding ? "Adding…" : "Add lead"}
            </button>
            <button type="button" onClick={() => setShowAddForm(false)} className="btn btn-ghost">
              Cancel
            </button>
          </div>
        </form>
      )}

      {upcomingCalls.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-2">
            📞 Upcoming calls ({upcomingCalls.length})
          </h2>
          <div className="mt-3 space-y-2">
            {upcomingCalls.map((lead) => (
              <div
                key={lead.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-black/5"
              >
                <div>
                  <span className="font-medium">{lead.title}</span>
                  <span className="ml-2 text-ink-3">{lead.clientName}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink-2">{formatCallTime(lead.scheduledCallAt as string)}</span>
                  <button
                    className="text-xs underline underline-offset-2"
                    onClick={() => setExpandedId(lead.id)}
                  >
                    Open ↓
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {followUps.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-coral">
            ⚠ Follow up ({followUps.length})
          </h2>
          <div className="mt-3 space-y-2">
            {followUps.map((lead) => (
              <div
                key={lead.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-coral/30"
              >
                <div>
                  <span className="font-medium">{lead.title}</span>
                  <span className="ml-2 text-ink-3">{lead.clientName}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-coral">
                    {dueLabel(lead.followUpDue as string)}
                  </span>
                  <button
                    className="text-xs underline underline-offset-2"
                    onClick={() => setExpandedId(lead.id)}
                  >
                    Open ↓
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <InsightsPanel
        insights={insights}
        open={showInsights}
        onToggle={() => {
          setShowInsights((s) => !s);
          fetch("/api/insights")
            .then((r) => r.json())
            .then((d) => setInsights(d.overall ? d : null))
            .catch(() => {});
        }}
      />

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
          const scored = lead.skillFitScore > 0 || lead.valueScore > 0;
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
                  style={{ background: scoreColor(lead.skillFitScore) }}
                  title="Skill fit score"
                >
                  {scored ? lead.skillFitScore : "—"}
                </div>

                <div className="md:col-span-4">
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
                  className="md:col-span-2"
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
                <LeadDetail
                  lead={lead}
                  calendarConnected={Boolean(calendarStatus?.connected)}
                  onUpdate={(u) => updateLead(lead.id, u)}
                  onAnalyze={() => handleAnalyze(lead.id)}
                  onDraft={(mode) => handleDraft(lead.id, mode)}
                  onScheduleCall={(startISO, endISO, timeZone) =>
                    handleScheduleCall(lead.id, startISO, endISO, timeZone)
                  }
                  onCancelCall={() => handleCancelCall(lead.id)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Role 1/4 observability: makes a broken source visible instead of the
// dashboard just quietly showing fewer leads than usual. See n8n/README.md
// (the Runs table + error-handler workflow) for where this data comes from.
function RunHealthBanner({ run }: { run: RunRecord }) {
  if (run.overallStatus === "Failed") {
    return (
      <p className="mt-4 rounded-lg bg-coral/20 px-4 py-3 text-sm text-ink ring-1 ring-coral">
        ⚠ Last run <strong>failed</strong> ({timeAgo(run.endedAt)}){run.errors ? `: ${run.errors}` : "."}
      </p>
    );
  }
  const tone = run.overallStatus === "No Items Found" ? "bg-blush/30 ring-blush" : "bg-white ring-black/5";
  return (
    <p className={`mt-4 rounded-lg px-4 py-3 text-xs text-ink-3 shadow-sm ring-1 ${tone}`}>
      Last run {timeAgo(run.endedAt)} ({run.trigger.toLowerCase()}) — {run.overallStatus === "No Items Found"
        ? "0 opportunities found"
        : `${run.newOpportunities ?? 0} new, ${run.duplicates ?? 0} duplicate`}
      {run.sourceStatus ? ` · ${run.sourceStatus}` : ""}
    </p>
  );
}

const TIER_TONE: Record<GroupStats["tier"], string> = {
  "Insufficient Data": "text-ink-3",
  "Early Signal": "text-ink-2",
  Promising: "text-aqua",
  "Strong Evidence": "text-coral",
};

// Role 5. Every number here is computed in lib/insights.ts -- no AI call,
// on purpose (see that file's header comment) -- so there's no risk of a
// model dressing up 2 data points as a trend. "Insufficient Data" is a real,
// expected state early on, not an error.
function InsightsPanel({
  insights,
  open,
  onToggle,
}: {
  insights: Insights | null;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mt-8 rounded-xl bg-white shadow-sm ring-1 ring-black/5">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="text-sm font-medium">
          📊 Performance Insights
          {insights && (
            <span className="ml-2 text-xs font-normal text-ink-3">
              {insights.overall.opportunities} opportunities tracked · {insights.overall.tier}
            </span>
          )}
        </span>
        <span className="text-xs text-ink-3">{open ? "Hide ▲" : "Show ▼"}</span>
      </button>
      {open && (
        <div className="space-y-5 border-t border-line px-5 py-4">
          {!insights ? (
            <p className="text-sm text-ink-3">Loading…</p>
          ) : (
            <>
              <GroupSection title="By niche" groups={insights.byNiche} />
              <GroupSection title="By source" groups={insights.bySource} />
              <GroupSection
                title="By service (Role 3 drafts only)"
                groups={insights.byService}
                emptyNote="No outreach drafts generated yet — use “Generate outreach draft” on a lead to start tracking this."
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function GroupSection({
  title,
  groups,
  emptyNote,
}: {
  title: string;
  groups: GroupStats[];
  emptyNote?: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</p>
      {groups.length === 0 ? (
        <p className="mt-2 text-sm text-ink-3">{emptyNote || "Nothing recorded yet."}</p>
      ) : (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {groups.map((g) => (
            <div key={g.key} className="rounded-lg bg-mint/40 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{g.key}</span>
                <span className={`text-xs font-medium ${TIER_TONE[g.tier]}`}>{g.tier}</span>
              </div>
              <p className="mt-1 text-xs text-ink-2">{g.summary}</p>
              {g.tier !== "Insufficient Data" && (
                <p className="mt-1 text-xs text-ink-3">
                  {g.won} won · {g.lost} lost · {g.passed} passed
                  {g.avgDaysToClose != null ? ` · ~${g.avgDaysToClose}d to close` : ""}
                </p>
              )}
              {g.pipelineValue > 0 && (
                <p className="mt-1 text-xs text-ink-3">
                  ${g.pipelineValue.toLocaleString()} in active pipeline
                  {g.proposedValue > 0 ? ` (${g.proposedValue.toLocaleString()} proposed)` : ""}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EvidenceList({ label, items, tone }: { label: string; items: string[]; tone?: string }) {
  if (!items.length) return null;
  return (
    <div>
      <p className={`text-xs font-semibold uppercase tracking-wide ${tone || "text-ink-3"}`}>
        {label}
      </p>
      <ul className="mt-1 list-inside list-disc text-sm text-ink-2">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function LeadDetail({
  lead,
  calendarConnected,
  onUpdate,
  onAnalyze,
  onDraft,
  onScheduleCall,
  onCancelCall,
}: {
  lead: Lead;
  calendarConnected: boolean;
  onUpdate: (update: LeadUpdate) => void;
  onAnalyze: () => Promise<{ error?: string }>;
  onDraft: (mode?: "initial" | "followup") => Promise<{ error?: string }>;
  onScheduleCall: (startISO: string, endISO: string, timeZone: string) => Promise<{ error?: string; eventLink?: string }>;
  onCancelCall: () => Promise<{ error?: string }>;
}) {
  const [notes, setNotes] = useState(lead.notes);
  const [draft, setDraft] = useState(lead.outreachDraft);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const scored = lead.skillFitScore > 0 || lead.valueScore > 0;
  const isTerminal = lead.status === "Won" || lead.status === "Lost";
  const isClosed = isTerminal || lead.status === "Passed";
  const needsAnalysis = lead.status === "Discovered" || lead.status === "Analyzing";
  // Once she's contacted them at least once, a fresh draft defaults to a
  // follow-up nudge rather than repeating the first-contact pitch (§7).
  const draftMode: "initial" | "followup" = lead.lastContact ? "followup" : "initial";

  async function runAnalyze() {
    setAnalyzing(true);
    setAnalyzeError(null);
    const res = await onAnalyze();
    if (res.error) setAnalyzeError(res.error);
    setAnalyzing(false);
  }

  async function runDraft() {
    setDrafting(true);
    setDraftError(null);
    const res = await onDraft(draftMode);
    if (res.error) setDraftError(res.error);
    setDrafting(false);
  }

  return (
    <div className="space-y-4 border-t border-line px-5 py-4 text-sm">
      {needsAnalysis && (
        <div className="rounded-lg bg-mint/50 p-3">
          <p className="text-xs text-ink-2">
            Not yet analyzed — this was added manually, so it skipped AI
            scoring. Run it through Role 2 for a fit/value score and
            evidence, or move it straight to Approved if you already know
            it&apos;s worth pursuing.
          </p>
          <button onClick={runAnalyze} disabled={analyzing} className="btn btn-ghost mt-2 text-xs">
            {analyzing ? "Analyzing…" : lead.status === "Analyzing" ? "Resume analysis" : "Analyze this opportunity"}
          </button>
          {analyzeError && <p className="mt-1 text-xs text-coral">{analyzeError}</p>}
        </div>
      )}

      {scored && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-ink-3">
          <span className="rounded-full bg-mint px-3 py-1 font-medium text-ink">
            Fit {lead.skillFitScore}/10
          </span>
          <span className="rounded-full bg-mint px-3 py-1 font-medium text-ink">
            Value {lead.valueScore}/10
          </span>
          <span>{CONFIDENCE_LABEL[lead.confidence]}</span>
          {lead.nicheTag && <span>· {lead.nicheTag}</span>}
          <span>· Recommended: {lead.recommendedAction}</span>
        </div>
      )}

      {lead.scoreReasoning && (
        <p>
          <span className="font-medium text-ink-2">Why this score: </span>
          {lead.scoreReasoning}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <EvidenceList label="Verified" items={lead.verifiedFacts} />
        <EvidenceList label="Inferred (AI judgment)" items={lead.inferredSignals} />
        <EvidenceList label="Unknown" items={lead.unknownFactors} tone="text-ink-3" />
        <div className="space-y-3">
          <EvidenceList label="Positive signals" items={lead.positiveSignals} tone="text-aqua" />
          <EvidenceList label="Negative signals" items={lead.negativeSignals} tone="text-coral" />
        </div>
      </div>

      <p>
        <span className="font-medium text-ink-2">Budget signal: </span>
        {lead.budgetSignal}
      </p>
      {lead.rawDescription && <p className="text-ink-2">{lead.rawDescription}</p>}
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

      <div className="border-t border-line pt-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
            Outreach (Role 3 — draft only, review before sending)
          </p>
          <button onClick={runDraft} disabled={drafting} className="btn btn-ghost text-xs">
            {drafting
              ? "Generating…"
              : draftMode === "followup"
                ? "Generate follow-up draft"
                : lead.outreachDraft
                  ? "Regenerate"
                  : "Generate outreach draft"}
          </button>
        </div>
        {draftError && <p className="mt-1 text-xs text-coral">{draftError}</p>}
        {lead.recommendedService && (
          <p className="mt-2 text-xs text-ink-2">
            <span className="font-medium">Recommended service: </span>
            {lead.recommendedService}
          </p>
        )}
        {lead.outreachAngle && (
          <p className="mt-1 text-xs text-ink-2">
            <span className="font-medium">Angle: </span>
            {lead.outreachAngle}
          </p>
        )}
        {(lead.outreachDraft || draft) && (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => onUpdate({ outreachDraft: draft })}
              className="field mt-2 w-full"
              rows={5}
            />
            <button
              onClick={() => {
                navigator.clipboard?.writeText(draft).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
              className="btn btn-ghost mt-2 text-xs"
            >
              {copied ? "Copied ✓" : "Copy draft"}
            </button>
            <p className="mt-1 text-xs text-ink-3">
              Nothing is sent automatically — copy this, send it yourself, then set status to
              Contacted below.
            </p>
          </>
        )}
      </div>

      <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
        <label className="text-xs text-ink-3">
          Contact name
          <input
            defaultValue={lead.contactName}
            onBlur={(e) => onUpdate({ contactName: e.target.value })}
            className="field mt-1"
          />
        </label>
        <label className="text-xs text-ink-3">
          Contact email
          <input
            defaultValue={lead.contactEmail}
            onBlur={(e) => onUpdate({ contactEmail: e.target.value })}
            className="field mt-1"
          />
        </label>
        <label className="text-xs text-ink-3">
          Follow-up due
          <input
            type="date"
            defaultValue={lead.followUpDue ? lead.followUpDue.slice(0, 10) : ""}
            onBlur={(e) =>
              onUpdate({
                followUpDue: e.target.value ? new Date(e.target.value).toISOString() : null,
              })
            }
            className="field mt-1"
          />
        </label>
        <label className="text-xs text-ink-3">
          Last contact
          <span className="mt-1 block text-ink-2">
            {lead.lastContact ? timeAgo(lead.lastContact) : "—"}
          </span>
        </label>
      </div>

      {!isClosed && (
        <CallScheduler
          lead={lead}
          calendarConnected={calendarConnected}
          onScheduleCall={onScheduleCall}
          onCancelCall={onCancelCall}
        />
      )}

      <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
        <label className="text-xs text-ink-3">
          Estimated value ($)
          <input
            type="number"
            defaultValue={lead.estimatedValue ?? ""}
            onBlur={(e) => onUpdate({ estimatedValue: e.target.value ? Number(e.target.value) : null })}
            className="field mt-1"
          />
        </label>
        {(lead.status === "Proposal" || lead.proposalAt) && (
          <label className="text-xs text-ink-3">
            Proposed value ($)
            <input
              type="number"
              defaultValue={lead.proposedValue ?? ""}
              onBlur={(e) => onUpdate({ proposedValue: e.target.value ? Number(e.target.value) : null })}
              className="field mt-1"
            />
          </label>
        )}
        <label className="flex items-center gap-2 text-xs text-ink-3">
          <input
            type="checkbox"
            defaultChecked={lead.isRecurring}
            onChange={(e) => onUpdate({ isRecurring: e.target.checked })}
          />
          Recurring / retainer (vs. one-time)
        </label>
      </div>

      <label className="block text-xs text-ink-3">
        Notes
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => onUpdate({ notes })}
          className="field mt-1 w-full"
          rows={2}
        />
      </label>

      {isTerminal && (
        <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
          {lead.status === "Won" && (
            <>
              <label className="text-xs text-ink-3">
                Revenue ($)
                <input
                  type="number"
                  defaultValue={lead.revenue ?? ""}
                  onBlur={(e) =>
                    onUpdate({ revenue: e.target.value ? Number(e.target.value) : null })
                  }
                  className="field mt-1"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-ink-3">
                <input
                  type="checkbox"
                  defaultChecked={lead.isRecurring}
                  onChange={(e) => onUpdate({ isRecurring: e.target.checked })}
                />
                Recurring / retainer (vs. one-time) — feeds Role 5&apos;s recurring-revenue read
              </label>
            </>
          )}
          {lead.status === "Lost" && (
            <label className="text-xs text-ink-3">
              Loss reason
              <input
                defaultValue={lead.lossReason}
                onBlur={(e) => onUpdate({ lossReason: e.target.value })}
                className="field mt-1"
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

// Calendar (§8). The server-side idempotency guard (a lead's own
// calendarEventId) means this component never needs to track "did I already
// click this" itself -- a second click just reschedules the same event.
// Timezone is read from the browser (Intl), not asked for explicitly: a
// solo freelancer scheduling her own calls doesn't need a timezone picker,
// just her own local time interpreted correctly.
function CallScheduler({
  lead,
  calendarConnected,
  onScheduleCall,
  onCancelCall,
}: {
  lead: Lead;
  calendarConnected: boolean;
  onScheduleCall: (startISO: string, endISO: string, timeZone: string) => Promise<{ error?: string; eventLink?: string }>;
  onCancelCall: () => Promise<{ error?: string }>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [start, setStart] = useState(() => localInputValue(new Date(Date.now() + 60 * 60 * 1000)));
  const [durationMin, setDurationMin] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!lead.calendarEventId && !showForm) {
    return (
      <div className="border-t border-line pt-4">
        <button
          onClick={() => setShowForm(true)}
          disabled={!calendarConnected}
          className="btn btn-ghost text-xs disabled:opacity-50"
          title={calendarConnected ? undefined : "Connect Google Calendar above to schedule calls"}
        >
          📅 Schedule a call
        </button>
        {!calendarConnected && (
          <p className="mt-1 text-xs text-ink-3">Connect Google Calendar (top of page) to schedule calls.</p>
        )}
      </div>
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const startDate = new Date(start);
    const endISO = new Date(startDate.getTime() + durationMin * 60 * 1000).toISOString();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const res = await onScheduleCall(startDate.toISOString(), endISO, timeZone);
    if (res.error) setError(res.error);
    else setShowForm(false);
    setBusy(false);
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    const res = await onCancelCall();
    if (res.error) setError(res.error);
    setBusy(false);
  }

  return (
    <div className="border-t border-line pt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Call</p>
      {lead.calendarEventId && lead.scheduledCallAt && !showForm ? (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-2">
          <span>📅 Scheduled for {formatCallTime(lead.scheduledCallAt)}</span>
          <button onClick={() => setShowForm(true)} className="underline underline-offset-2">
            Reschedule
          </button>
          <button onClick={cancel} disabled={busy} className="underline underline-offset-2 text-coral">
            {busy ? "Cancelling…" : "Cancel call"}
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="text-xs text-ink-3">
            Start
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="field mt-1"
            />
          </label>
          <label className="text-xs text-ink-3">
            Duration
            <select
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
              className="field mt-1"
            >
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={60}>60 min</option>
            </select>
          </label>
          <button onClick={submit} disabled={busy} className="btn text-xs">
            {busy ? "Scheduling…" : lead.calendarEventId ? "Save new time" : "Confirm"}
          </button>
          <button onClick={() => setShowForm(false)} className="btn btn-ghost text-xs">
            Cancel
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-coral">{error}</p>}
    </div>
  );
}
