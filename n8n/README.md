# Lead Radar — n8n Workflow

Import `lead-radar.workflow.json` into your n8n instance:
**Workflows → Add workflow → ⋮ menu → Import from File.** Import
`lead-radar-error-handler.workflow.json` the same way, as a second,
separate workflow — §6 explains why it's split out and the one-time step
to link the two.

This was hand-authored (not exported from a running n8n instance), using
plain HTTP Request nodes for Apify/OpenAI/Airtable instead of their
dedicated n8n nodes — that avoids needing pre-configured n8n "credentials"
baked into the file, which wouldn't survive an import into a fresh instance
anyway. It has **not** been run inside n8n itself, so treat it as a strong
starting scaffold, not a guaranteed one-click workflow — check the two
items below before you trust it.

## 1. Set these environment variables on your n8n instance

Not in the website's `.env` — these belong to n8n itself (e.g. in
`docker-compose.yml`'s `environment:` block, or n8n's own `.env` if
self-hosting that way):

```
APIFY_TOKEN=
APIFY_UPWORK_ACTOR_ID=        # from the Apify Store, after you pick an actor
APIFY_CRAWLER_ACTOR_ID=       # e.g. apify/website-content-crawler
OPENAI_API_KEY=
AIRTABLE_API_KEY=
AIRTABLE_BASE_ID=
DIGEST_FROM_EMAIL=
DIGEST_TO_EMAIL=eishamuzafar907@gmail.com
```

## 2. Verify after import — the one thing that can't be checked from here

The **"Loop Leads"** node (Split In Batches) has two outputs: one continues
the loop, one fires once after every item is processed. Which output is
which has changed across n8n versions, so after importing:

1. Open "Loop Leads" and hover each output dot — n8n labels them "loop" /
   "done" in recent versions.
2. Confirm: the **loop** output feeds "Airtable: Check Duplicate" (continues
   per-item), and the **done** output feeds "Airtable: Get Today's Top
   Leads" (runs once, after the loop finishes).
3. If they're swapped, drag the connections to match — everything else
   should be untouched.

Also open each HTTP Request node once — if n8n flags a parameter it doesn't
recognize (shown in red), that's a version mismatch in that node's schema,
not a logic error. Match it against the guide below and fix inline.

## 3. Pick your Apify actors

The workflow starts each actor async (`POST /v2/acts/{id}/runs`) and polls
`GET /v2/actor-runs/{id}` every 15s until it's done, then fetches the
dataset — not the sync endpoint, which times out on a real crawl. Three
parallel "Upwork N" branches (start → wait → check → get items) cover three
query sets, merged before scoring; one "Company Sites" branch crawls
configured career/board pages.

- **Upwork search** — search the Apify Store for an Upwork job-search actor,
  configure it with the search queries already in the "Apify: Start Upwork
  1/2/3" nodes' bodies (`medical writer`, `SaaS content writer`,
  `white paper writer`, etc — edit freely), then set
  `APIFY_UPWORK_ACTOR_ID` to its actor ID (format `user~actor-name`, not a
  slash — a slash 404s against the runs endpoint).
- **Company sites** — `apify/website-content-crawler` (Apify's own generic
  actor, actor ID `apify~website-content-crawler`) works well. Edit the
  `startUrls`/`includeUrlGlobs` in "Apify: Start Company Sites" to the
  actual health-tech/B2B-SaaS career pages and boards you and Eisha pick.

**The three "Apify: Start/Wait/Check/Run Done?/Get Items Upwork N" branches
are currently `disabled`** in the committed workflow — the free-tier Upwork
actor in use hit its 100-result lifetime cap. Company Sites is the only
live automated source until a paid/alternate Upwork actor is wired up and
these 15 nodes are re-enabled (flip `disabled` back on each). Until then,
lean on manual entry (§4) for warm/agency/LinkedIn leads — it's not a
workaround, it's a legitimate source in its own right (see the root
README's product notes).

**Cost control:** both branches cap `maxItems`/`maxCrawlPages` low. Run
daily, not hourly, and check Apify's usage dashboard after the first week
before raising those numbers.

**Reliability:** every outbound HTTP node (Apify/Airtable/OpenAI) retries up
to 3 times with a 2s gap on failure (`retryOnFail`), so one transient 5xx
doesn't kill the whole run or drop the rest of the batch.

## 4. Airtable base

Create a base named anything, with one table called **Leads** and these
fields (types matter for the formulas to work):

| Field | Type |
|---|---|
| Title | Single line text |
| Client/Company | Single line text |
| Source URL | URL |
| Source Platform | Single select (Upwork / Company Site / Agency / Warm Network / LinkedIn / Referral / Other) |
| Need Summary | Long text |
| Raw Description | Long text |
| Budget Signal | Single line text |
| Fit Score | Number — skill-fit (expertise match), 1-10 |
| Value Score | Number — economic attractiveness (budget/scope/recurring), 1-10 |
| Confidence | Single select (High / Medium / Low) |
| Score Reasoning | Long text |
| Recommended Action | Single select (Apply / Consider / Skip) |
| Niche Tag | Single line text — short lowercase-hyphenated label the model assigns, e.g. `health-nutrition` |
| Verified Facts | Long text — one bullet per line, only what the listing text stated |
| Inferred Signals | Long text — one bullet per line, the model's judgment calls |
| Unknown Factors | Long text — one bullet per line, what couldn't be determined |
| Positive Signals | Long text |
| Negative Signals | Long text |
| Urgency | Single select (High / Medium / Low) |
| Status | Single select — see the lifecycle below |
| Date Found | Date (include time) |
| Closed At | Date (include time) — auto-set the moment Status reaches Won/Lost/Passed |
| Replied At | Date (include time) — auto-set once, the first time Status reaches Replied (or later) |
| Conversation At | Date (include time) — same, for Conversation |
| Call Booked At | Date (include time) — same, for Call Booked |
| Proposal At | Date (include time) — same, for Proposal |
| Recommended Service | Single line text — Role 3's suggested framing, e.g. "Ongoing content retainer" |
| Outreach Angle | Long text — Role 3's personalization hook, 1-2 sentences |
| Outreach Draft | Long text — Role 3's editable draft message. Never sent by the system. |
| Contact Name | Single line text |
| Contact Email | Single line text |
| Last Contact | Date (include time) |
| Follow-up Due | Date (include time) |
| Notes | Long text |
| Revenue | Currency or Number — set on Won, the actual closed number |
| Loss Reason | Single line text — set on Lost |
| Recurring | Checkbox — retainer/ongoing vs. one-time, informs Role 5's recurring-revenue split |
| Estimated Value | Currency or Number — freelancer's own ballpark of what the opportunity is worth, settable any time |
| Proposed Value | Currency or Number — what she actually quoted, once a Proposal is sent |
| Scheduled Call At | Date (include time) — set when a call is booked through the dashboard's calendar integration (§ below) |
| Calendar Event ID | Single line text — the linked Google Calendar event's id, the idempotency key that prevents duplicate events |

**Revenue is tracked as three distinct numbers, never conflated:** `Estimated Value` (her own guess, updatable any time an opportunity is active), `Proposed Value` (what was actually quoted, once it reaches Proposal), and `Revenue` (the real, closed number — only ever set on Won, never a projection). `lib/insights.ts` sums `Estimated Value` across still-active opportunities into a pipeline-value figure and splits closed `Revenue` into recurring vs. one-time using `Recurring` — see the root README's Product Model, Role 5.

## 8. Calendar integration (website-side, not n8n)

Google Calendar (`lib/calendar.ts`, `app/api/calendar/*`, `app/api/leads/[id]/schedule-call`) is entirely a **website-side** feature — n8n never touches it, and this workflow file needs no changes for it. It reads and writes the same **Leads** table above (the `Scheduled Call At` / `Calendar Event ID` fields) plus one more table:

Add a **Settings** table to the same base, with:

| Field | Type |
|---|---|
| Key | Single line text — always `google_calendar` (one row, reused) |
| Refresh Token | Long text |
| Calendar Email | Single line text |
| Connected At | Date (include time) |

This table holds exactly one row, written the first time the freelancer clicks "Connect Google Calendar" in the dashboard. The refresh token is never sent to the browser — only `app/api/calendar/status` reads it server-side, and it returns just a connected/disconnected boolean plus the connected account's email. See the root README's "Calendar setup" section for the Google Cloud OAuth setup steps.

**Status** values: `Discovered / Analyzing / Needs Review / Approved /
Contacted / Replied / Conversation / Call Booked / Proposal / Won / Lost /
Passed`. n8n only ever writes `Needs Review` on create — an AI-sourced lead
is scored (Role 2) in the same pass that discovers it, so it never visibly
sits at `Discovered`/`Analyzing`. Those two ARE real, reachable states for
manual leads (added via the website's "+ Add lead"), which start at
`Discovered` and pass through `Analyzing` for real when the dashboard's
"Analyze" button calls Role 2 on them — see `lib/types.ts` for the full
reasoning. Won, Lost and Passed are kept as three separate terminal values,
never collapsed — Role 5 needs to tell "we won it" from "they said no" from
"she declined it" to compute honest conversion rates.

**Writes use `typecast: true`** (both from n8n and from the website), so
Airtable auto-creates a missing single-select option — e.g. on a base built
before `Call Booked` existed — instead of hard-failing the write. Still
worth configuring the options list above ahead of time; this is a safety
net, not a substitute for it.

**The four `*At` milestone fields are what makes Role 5's funnel numbers
honest.** Without them, a lead that was actually replied-to, had a
conversation, and was then marked `Lost` would look identical — once
closed — to one that was never replied to at all; "reply rate" would be
uncomputable for anything but currently-open leads. Each is stamped once,
the first time that stage is reached (skipping straight to `Proposal` also
backfills `Replied At`/`Conversation At` if they weren't set), and never
overwritten. See `stampFunnelMilestones` in `lib/airtable.ts`.

**Evidence fields hold bullets as newline-separated plain text**, not JSON —
each `Verified Facts`/`Inferred Signals`/etc. cell is one bullet per line, so
opening the base directly in Airtable is still readable. `lib/airtable.ts`
(website) and the "Parse AI Response" node (n8n) both join/split on `\n` —
keep them in sync if you change the format.

**Manual leads (agencies, warm intros, LinkedIn contacts, referrals) are
added from the website's "+ Add lead" button, not through this n8n
workflow.** n8n only ever writes AI-sourced leads. A manual lead starts
unscored (`Discovered`) rather than being force-scored on creation — the
freelancer can run it through the same Role 2 rubric on demand via the
dashboard's "Analyze" button (`app/api/leads/[id]/analyze`), or skip
straight to `Approved` if she already knows it's worth pursuing.

Grab the base ID from its API docs page (`airtable.com/api`, or the base's
URL) for `AIRTABLE_BASE_ID`. Generate a token with read/write scope on this
base at `airtable.com/create/tokens` for `AIRTABLE_API_KEY`.

## 5. Two ways to run it

- **Manual Run (Webhook)** — the trigger the website's "Run Lead Hunt"
  button calls. Copy this node's Production URL into the website's
  `N8N_WEBHOOK_URL` environment variable.
- **Daily Schedule** — runs automatically at 6am, no button needed. Both
  triggers feed the same pipeline; leave both active if you want automatic
  runs *and* an on-demand button.

**Only the Daily Schedule trigger sends the digest email.** "Start Run"
(the first node after both triggers) records which one fired this run;
"Was Scheduled?" later reads that back and routes manual runs away from
the digest branch entirely — otherwise clicking the dashboard button twice
in an afternoon would re-email the same day's top leads twice.

## 6. Runs health-check — knowing "0 leads" from "something's broken"

Every execution writes one row to a second Airtable table, **Runs**, so the
dashboard (and you) can tell a quiet day apart from a dead source. Two
workflows write to it:

- **The main workflow, on every successful run** (`Start Run` → `Record
  Source Stats` → `Write Run Record` → `Airtable: Write Run`, running in
  parallel with the digest gate so a Runs row is written for manual *and*
  scheduled runs alike). `Start Run` resets a small counters object in
  workflow static data and stamps the run with n8n's own execution id;
  `Record Source Stats` taps the merged Apify output (before Keyword
  Pre-Filter) to record a real/zero item count per source; `Write Run
  Record` reads Loop Leads' full accumulated output at the end to tally
  duplicates vs. new opportunities (told apart by whether the item has an
  Airtable `id`/`fields` — a duplicate-skip keeps its original scraped
  shape) and AI-parse failures (detected by the exact fallback string
  `Parse AI Response` writes into `Score Reasoning` on a JSON-parse
  failure — see that node's code).
- **A separate error-handler workflow, on any crash.** n8n's Error Trigger
  node has to live in its own workflow — import
  `lead-radar-error-handler.workflow.json` as a second workflow, then on
  the **main** workflow go to **Settings → Error Workflow** and select it.
  Without this step, a hard failure (e.g. every retry on a broken Apify
  actor exhausted) still just vanishes into n8n's own execution log like it
  did before this layer existed — the whole point is that it doesn't.
  `Build Failure Record` reads n8n's Error Trigger payload defensively
  (its exact shape has shifted across n8n versions — same caveat as the
  Loop Leads output-order note in §2); trigger a real failure once after
  importing both workflows and check that node's output matches the field
  paths in its code, adjusting if your version differs.

**This is the property that actually matters: a failed run must never look
like a healthy "0 opportunities today" run.** The main workflow's own
Runs-writer only ever runs on the happy path — if anything upstream throws,
execution stops before reaching it, and only the error-handler workflow
writes a row, with `Overall Status = Failed`. `n8n/e2e-sim.mjs` asserts this
directly (scenarios L/M: a crashed run writes zero rows to the main
workflow's Runs mock) and `n8n/check-error-workflow.mjs` asserts the
error-handler always produces a `Failed` row. Neither can verify the two
workflows are actually *linked* in your n8n instance, though — that's the
one manual step above.

Add a **Runs** table to the same base, with:

| Field | Type |
|---|---|
| Run ID | Single line text |
| Trigger Type | Single select (Manual / Scheduled / Unknown) |
| Started At | Date (include time) |
| Ended At | Date (include time) |
| Duration (sec) | Number |
| Overall Status | Single select (Success / No Items Found / Failed) |
| Source Status | Long text — e.g. `Upwork: 0 items \| Company Site: 4 items` |
| Items Discovered | Number |
| Items Filtered | Number — removed by the keyword/RD pre-filter |
| New Opportunities | Number |
| Duplicates | Number |
| AI Analyses | Number |
| AI Failures | Number |
| Errors | Long text — blank on a healthy run |

The website reads only the single most recent row (`lib/runs.ts`) to show a
one-line health banner above the lead list — not a dashboard/chart, on
purpose (see the root README's UX notes on avoiding unread analytics).

## 7. Calibrate before trusting it

Run it 2–3 times manually first (via the webhook or n8n's "Execute
Workflow" button). Sit with Eisha and review 15–20 scored leads together —
expect to revise the OpenAI system prompt in "OpenAI: Score Lead" once
after seeing real false-positives/negatives. Only turn on the Daily
Schedule trigger after that pass.
