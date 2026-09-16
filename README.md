# Lead Radar

Not just an Upwork scraper — a CRM + opportunity-intelligence layer for a
solo freelancer starting from zero. One button kicks off the n8n pipeline
(Apify scrape → AI qualification with evidence, not just a bare score →
Airtable); the dashboard below it is a follow-up-aware CRM, and leads don't
have to come from a scraper — agencies, warm intros, and LinkedIn contacts
get added by hand through the same pipeline. See [Product model](#product-model)
below for how the pieces fit together.

Runs fully on sample data with zero configuration, so it can be reviewed
before Airtable/n8n exist — see [Modes](#modes) below.

## Stack

Next.js 16 (App Router) · Tailwind v4 · Airtable REST API · a single-password
gate (see [Auth](#auth) for why that's enough here).

## Local development

```bash
npm install
npm run dev          # http://localhost:3000
```

```bash
npm run build
npm run start
npm run lint
npx tsc --noEmit
```

## Modes

The site works in two states, controlled entirely by environment variables —
no code changes needed to go from one to the other:

| | Not configured | Configured |
|---|---|---|
| **Leads (Airtable)** | ~10 in-memory sample leads, resets on server restart | Real leads from your Airtable base |
| **Run Lead Hunt (n8n)** | Records a "triggered" timestamp, does nothing else | POSTs to your n8n webhook, starts the real pipeline |
| **Analyze / Generate draft (OpenAI)** | Button shows "not configured" error, no cost | Calls OpenAI directly from the website |

This means the dashboard, status editing, filtering, and button UX can all
be built and demoed before the automation exists — which is how this was
built and tested. The sample data is deliberately small enough that
Performance Insights shows "Insufficient Data" everywhere — that's the
honest state for a system this new, not a bug in the demo.

## Product model

The system is not an Upwork scraper with AI scoring bolted on. It's five
functional roles — kept as stages in one deterministic pipeline with two
AI calls in it, not five separate autonomous agents:

1. **Market Researcher** — Apify scraping (n8n) *and* manual entry (the
   dashboard's "+ Add lead") for sources that shouldn't be scraped:
   agencies, warm intros, referrals, LinkedIn contacts.
2. **Opportunity Analyst** — one OpenAI call per lead, scored on *skill
   fit* and *value* separately, with every claim labeled Verified (from
   the listing text), Inferred (the model's judgment), or Unknown — never
   presented as fact when it's a guess. Runs automatically for scraped
   leads (n8n); runs on demand for manual leads via the dashboard's
   "Analyze" button (`app/api/leads/[id]/analyze`), since a manually-added
   lead starts genuinely unscored rather than defaulted to something
   fake-looking.
3. **Sales Strategist** — the dashboard's "Generate outreach draft" button
   (`app/api/leads/[id]/draft`) produces a recommended service, a
   personalization angle, and an editable draft message, grounded only in
   that lead's actual evidence (never invents client facts or a track
   record the freelancer doesn't have — see the prompt in that route).
   **Never sends anything.** The freelancer reviews, edits, copies, and
   sends it herself, then records the outcome by moving the lead's status
   to Contacted.
4. **CRM & Follow-Up Manager** — the status lifecycle (`Discovered →
   Analyzing → Needs Review → Approved → Contacted → Replied →
   Conversation → Call Booked → Proposal → Won/Lost/Passed`, each a
   distinct outcome — no collapsing "she passed" into "they said no"),
   deterministic (not AI) follow-up scheduling and funnel-milestone
   timestamps (`lib/airtable.ts`), and the dashboard's overdue-follow-up
   queue. A stale draft doesn't repeat the first pitch either — once a lead
   has been contacted, "Generate outreach draft" switches to a distinct
   follow-up-nudge prompt (`app/api/leads/[id]/draft`, `mode: "followup"`).
   This role also owns the **Google Calendar integration** (§ below) for
   booked calls — creating/rescheduling/cancelling the linked event, always
   idempotent on the lead's own `calendarEventId` — and *the system's own
   reliability*: every n8n run writes a health record (`n8n/README.md` §6)
   so a dead source reads as "failed," never as a quiet, healthy-looking
   zero.
5. **Growth & Niche Strategist** — `lib/insights.ts`, deliberately with
   **no AI call in it.** Deterministic aggregation by niche/source/service,
   gated through an explicit evidence tier — `Insufficient Data → Early
   Signal → Promising → Strong Evidence`. The tier is **not** sample size
   alone: reaching "Promising"/"Strong Evidence" requires a real outcome
   (a reply, a win, revenue) on top of a minimum sample, so e.g. 100
   opportunities with zero replies caps at "Early Signal" forever, while 20
   opportunities with 3 wins and real revenue can outrank it — both in the
   tier shown and in display order (`tierFor`/`groupBy` in that file).
   Revenue is tracked as three distinct numbers, never conflated:
   `estimatedValue` (her own ballpark, any time), `proposedValue` (what she
   quoted, once it reaches Proposal), and `revenue` (the real, closed
   number — Won only). Groups also surface `pipelineValue` (estimated value
   still in flight) and a recurring/one-time revenue split. This is the one
   role where using an LLM for the headline judgment would have been the
   wrong call: templating a stats table into a sentence doesn't need one,
   and a model asked to "sound confident" is exactly the failure mode this
   role exists to prevent.

Nothing sends a message to a prospect automatically. Outreach, applying,
and pricing stay human actions — see `n8n/README.md` and `lib/types.ts` for
the reasoning per field.

**Conservative deduplication.** Two layers, both exact-match, never fuzzy:
n8n's own pipeline checks the scraped listing's canonical URL before ever
calling OpenAI (`n8n/README.md` §4, "Airtable: Check Duplicate"); the
website's "+ Add lead" (`app/api/leads/route.ts`, `findDuplicateLead` in
`lib/airtable.ts`) checks source URL first, falling back to exact
client+title for URL-less sources (referrals, warm intros). Either way, a
match is surfaced as a blocker the freelancer resolves herself (view the
existing lead, or confirm "add anyway") — never a silent merge or a silent
skip.

## Environment variables

Copy `.env.example` to `.env.local`:

| Variable | Purpose |
|---|---|
| `APP_PASSWORD` | Shared password gating the whole site. Unset = no gate (local dev only — **always set this in production**). |
| `AUTH_COOKIE_SECRET` | Optional. Signs the login session cookie (see [Auth](#auth)) — recommended in production, not required. |
| `AIRTABLE_API_KEY` | Personal access token, read/write scope on the base. |
| `AIRTABLE_BASE_ID` | From the base's API docs page or its URL. |
| `AIRTABLE_TABLE_NAME` | Defaults to `Leads`. |
| `N8N_WEBHOOK_URL` | The Production URL of the "Manual Run (Webhook)" trigger node — see `/n8n/README.md`. |
| `OPENAI_API_KEY` | Powers the website's own two AI features — Role 2 "Analyze" on manual leads, Role 3 "Generate outreach draft". **Separate from n8n's copy of the same variable** — n8n runs its own instance and needs its own key (see `/n8n/README.md`); this one is for calls made directly from the website's server routes. Unset = both buttons show a clear "not configured" error instead of failing silently. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Google Calendar integration (§8) — see [Calendar setup](#calendar-setup). Unset = the calendar UI stays hidden/disabled; nothing else in the app is affected. |

## Auth

A single shared password (`APP_PASSWORD`), not per-user accounts. This is
deliberate: there's exactly one client using this tool. Add real
authentication (NextAuth, Clerk, etc.) only if this ever needs to serve more
than one person — building it now would be unused complexity.

The login session cookie is **not** the raw password — `lib/auth.ts` signs
it (HMAC-SHA256, keyed by `AUTH_COOKIE_SECRET` if set) before it's ever
written to the browser, so a leaked cookie discloses a token good only for
this app's session, not a password the freelancer might reuse elsewhere.
`/api/login` is rate-limited (10 attempts / 15 min per IP, `lib/rateLimit.ts`)
against brute-forcing the shared password. Both are defense-in-depth on top
of the cookie already being `httpOnly` + `secure` (in production) +
`sameSite: lax`.

## Calendar setup

**Provider: Google Calendar**, not a pluggable multi-provider system —
evaluated deliberately for this single-freelancer product. There is exactly
one user and one calendar to connect; Google Calendar is free, has a
well-documented REST API, and is the default calendar for most freelancers
already on Gmail (this project's own n8n digest email goes to a Gmail
address — see `n8n/README.md`). A provider abstraction built for one user
would be unused complexity — add Outlook/Cal.com only if a real second
user actually needs it.

**What's built:** connect/disconnect from the dashboard, creating a
calendar event for a booked call, linking it to the lead
(`calendarEventId`/`scheduledCallAt` on the Lead), idempotent
reschedule (never a duplicate event on a repeat click or retry), manual
cancel, and auto-cancel when a lead with a still-*future* booked call is
marked Lost/Passed before the call happens. **What's deliberately not
built:** a full availability/free-busy view inside the dashboard — a solo
freelancer picking a time for her own single calendar doesn't need one;
she can glance at her own calendar before choosing a slot. Add it later
(Google's `freebusy.query` endpoint) if that stops being true.

Setup (Google Cloud Console):

1. Create a project (or reuse one) at [console.cloud.google.com](https://console.cloud.google.com).
2. **APIs & Services → Library** — enable the **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** — External user type is fine
   for a single freelancer's own account; add her Google account as a Test
   User while the app is unverified (Google limits unverified apps to
   explicitly-added test users, which is exactly right here — no one else
   needs access).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**,
   type **Web application**. Add an **Authorized redirect URI**:
   `https://your-domain.com/api/calendar/callback` (and
   `http://localhost:3000/api/calendar/callback` for local dev).
5. Copy the generated Client ID and Client Secret into `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET`; set `GOOGLE_REDIRECT_URI` to the exact redirect
   URI you registered.
6. Add the **Settings** table to the Airtable base — see `n8n/README.md` §8
   — where the connected account's refresh token is stored server-side.
7. In the dashboard, click **"📅 Connect Google Calendar"** and approve
   access. The button then reads "Connected as [email] · Disconnect".

Tokens are never sent to the browser: `app/api/calendar/status` returns
only a connected boolean and the connected email; every calendar API call
happens server-side (`lib/calendar.ts`), reading the stored refresh token
and exchanging it for a fresh access token on each request rather than
caching one — simplest-correct for this call volume, see that file's
comments if it ever needs to change.

## The n8n workflow

Lives in `/n8n/` — an importable workflow file plus a setup guide covering
environment variables, Apify actor selection, the Airtable schema, and one
thing that needs manual verification after import (a loop-direction check
that varies by n8n version). **Read `/n8n/README.md` before importing.**

## Deploying

Same pattern as the portfolio site: push to GitHub, Railway → Deploy from
GitHub repo, set the environment variables above, Generate Domain. Railpack
auto-detects `npm run build` / `npm run start` — no config file needed.

If the generated domain 502s with clean build/start logs, it's almost
certainly the Railway port mismatch (domain targets 3000, container listens
on `PORT`) — set `PORT=3000` as a service variable. See the portfolio
repo's README for the full explanation.

## End-to-end walkthrough

Every stage below has a real UI/API path, not a mock — the numbered items
map directly to files if you want to read the code alongside this:

1. **Discover** — n8n scrapes (Apify) or the freelancer clicks "+ Add lead"
   (`app/api/leads/route.ts` `POST`). A scraped lead is created already at
   `Needs Review`; a manual one starts at `Discovered`.
2. **Analyze** — automatic for scraped leads (n8n's `OpenAI: Score Lead`
   node, before the Airtable write); on-demand for manual ones via the
   dashboard's "Analyze this opportunity" button
   (`app/api/leads/[id]/analyze`), which moves `Discovered → Analyzing →
   Needs Review` for real, one OpenAI call, rolling back to `Discovered`
   (not stuck) if the call fails.
3. **Review** — the dashboard's expanded lead row shows the fit/value
   scores, confidence, and the Verified/Inferred/Unknown/Positive/Negative
   evidence breakdown Role 2 produced.
4. **Approve** — the status dropdown, `Needs Review → Approved`.
5. **Generate outreach** — "Generate outreach draft" (Role 3,
   `app/api/leads/[id]/draft`) fills in a recommended service, an angle,
   and an editable draft.
6. **Human approves & sends** — the draft is a plain editable textarea with
   a "Copy draft" button. No send integration exists anywhere in this
   codebase; sending happens on Upwork/email/LinkedIn, outside the system,
   by the freelancer.
7. **Contact recorded** — status → `Contacted`, which auto-schedules a
   7-day follow-up (`lib/airtable.ts`'s `applyFollowUpRule`) and shows up
   in the dashboard's overdue-follow-up queue if it goes unanswered.
8. **Follow up / Reply / Conversation / Call / Proposal** — status moves
   forward through those stages; each one stamps a `*At` milestone
   timestamp the first time it's reached (`stampFunnelMilestones`), which
   is what makes step 12 honest even for leads that later close as Lost.
9. **Book a call** — from an active lead, "📅 Schedule a call" (visible once
   Google Calendar is connected) creates a linked calendar event and moves
   status to `Call Booked`; a second click on an already-scheduled lead
   reschedules the same event rather than creating a second one
   (`app/api/leads/[id]/schedule-call`).
10. **Won / Lost / Passed** — three distinct terminal statuses (never
    collapsed); `closedAt` auto-stamps; `Revenue` + recurring flag (Won) or
    `Loss Reason` (Lost) become editable fields in the expanded row. Marking
    Lost/Passed while a booked call is still in the future auto-cancels
    that calendar event.
11. **Performance insights** — the dashboard's "📊 Performance Insights"
    panel (`lib/insights.ts`, `app/api/insights`), deterministic, grouped
    by niche/source/service, each group tagged with its evidence tier
    (weighing real outcomes, not just opportunity count) and a
    plain-language, honestly-hedged summary, plus pipeline/recurring
    revenue where relevant.

**What "done" does not mean here:** it does not mean every group in
Performance Insights will show a confident recommendation — on real
day-one data, most or all of them will correctly say "Insufficient Data."
That's the system working as designed, not a gap.

## Production setup checklist

**Required before real client delivery:**

1. Set `APP_PASSWORD` (and ideally `AUTH_COOKIE_SECRET`) — an unset
   password leaves the site wide open, by design for local dev only.
2. Create the Airtable base: **Leads**, **Runs**, and (if using calendar)
   **Settings** tables — full schemas in `n8n/README.md`.
3. Set `AIRTABLE_API_KEY` / `AIRTABLE_BASE_ID` — without these the site
   silently runs on throwaway in-memory sample data.
4. Set `OPENAI_API_KEY` on **both** the website and n8n (they're separate
   copies of the same key — see `n8n/README.md`).
5. Import and configure the n8n workflows (`n8n/README.md` in full,
   including §6's error-handler workflow link — skipping that step means a
   crashed run vanishes silently instead of recording `Failed`).
6. Set `N8N_WEBHOOK_URL` so "Run Lead Hunt" starts the real pipeline
   instead of demo mode.
7. Calibrate the OpenAI scoring prompt against 15–20 real leads before
   turning on the Daily Schedule trigger (`n8n/README.md` §7).
8. Deploy behind HTTPS (Railway's default domain has this) so `secure`
   cookies and OAuth redirects work correctly.

**Optional / can follow later, without blocking delivery:**

- Google Calendar (`GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URI` — see
  [Calendar setup](#calendar-setup)). Everything else works without it;
  "Call Booked" remains a status the freelancer can set by hand.
- Re-enabling the Upwork Apify branches once a paid/alternate actor is
  wired up (`n8n/README.md` §3) — Company Sites + manual entry cover
  sourcing until then.
- A settings UI for the Role 3 freelancer-profile blurb (see below).

## Known limitations

- The three Upwork Apify branches are currently disabled (hit a free-tier
  actor cap) — see `n8n/README.md` §3. Company Sites is the only live
  automated source; manual entry covers the gap for warm/agency/LinkedIn
  leads in the meantime. A single dead/failing source (once more than one
  is live) currently fails the *whole* n8n run rather than degrading just
  that source — see the Security/Reliability review notes in the delivery
  report for why this wasn't changed in this pass.
- The daily-digest email (Airtable "top leads today" query + Email Send
  node) is in the n8n workflow but untested against a live Airtable base —
  verify it fires correctly once real data exists. It only fires from the
  6am schedule, not the manual button, so repeat clicks won't double-send.
- No pagination — fine at dozens of leads, will need it well before
  hundreds.
- Airtable's free tier caps at 1,200 records/base; archive or delete
  `Won`/`Lost`/`Passed` leads periodically once volume grows.
- Performance Insights groups by the *current* niche tag / source /
  service label. Renaming a niche tag going forward doesn't retroactively
  relabel past leads, so a renamed niche briefly looks like two separate,
  smaller groups until enough new data accumulates under the new name.
- Funnel-milestone timestamps (`Replied At` etc.) only exist from this
  release forward — leads created before this change won't have them
  backfilled, so Insights will slightly undercount reply/conversation
  rates until enough post-release data accumulates.
- The freelancer's background/portfolio blurb that Role 3 drafts from is a
  hardcoded constant (`FREELANCER_PROFILE` in
  `app/api/leads/[id]/draft/route.ts`), not an editable settings field —
  edit that file directly as her positioning evolves. A settings UI was
  deliberately not built for a single hardcoded value with one editor.
- Calendar: no in-dashboard availability/free-busy view (see
  [Calendar setup](#calendar-setup) for why); the refresh token is stored
  in Airtable (server-side only, never sent to the browser) rather than a
  dedicated secrets vault — a reasonable trade-off for a single-user tool
  already trusting Airtable with its business data, not one for a
  multi-tenant product.
- Rate limiting (`lib/rateLimit.ts`) is in-memory, per-process — resets on
  restart/redeploy and doesn't coordinate across replicas. Fine for a
  single-instance deployment; move to Redis/Upstash only if this ever runs
  more than one instance.
