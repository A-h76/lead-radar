# Lead Radar — n8n Workflow

Import `lead-radar.workflow.json` into your n8n instance:
**Workflows → Add workflow → ⋮ menu → Import from File.**

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

The workflow calls two actors via Apify's `run-sync-get-dataset-items`
endpoint (runs synchronously and returns results directly — no polling
needed):

- **Upwork search** — search the Apify Store for an Upwork job-search actor,
  configure it with the search queries already in the "Apify: Upwork
  Search" node's body (`medical writer`, `white paper nutrition`, etc — edit
  freely), then set `APIFY_UPWORK_ACTOR_ID` to its actor ID.
- **Company sites** — `apify/website-content-crawler` (Apify's own generic
  actor) works well. Edit the `startUrls` in the "Apify: Company Sites"
  node to the actual health-tech/legal-tech blogs and career pages you and
  Eisha pick together.

**Cost control:** both nodes cap `maxItems`/`maxCrawlPages` low. Run daily,
not hourly, and check Apify's usage dashboard after the first week before
raising those numbers — this is what keeps you inside the $5/month credit.

## 4. Airtable base

Create a base named anything, with one table called **Leads** and these
fields (types matter for the formulas to work):

| Field | Type |
|---|---|
| Title | Single line text |
| Client/Company | Single line text |
| Source URL | URL |
| Source Platform | Single select (Upwork / Company Site) |
| Need Summary | Long text |
| Raw Description | Long text |
| Budget Signal | Single line text |
| Fit Score | Number |
| Score Reasoning | Long text |
| Urgency | Single select (High / Medium / Low) |
| Status | Single select (New / Applied / Won / Passed) |
| Date Found | Date (include time) |

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

## 6. Calibrate before trusting it

Run it 2–3 times manually first (via the webhook or n8n's "Execute
Workflow" button). Sit with Eisha and review 15–20 scored leads together —
expect to revise the OpenAI system prompt in "OpenAI: Score Lead" once
after seeing real false-positives/negatives. Only turn on the Daily
Schedule trigger after that pass.
