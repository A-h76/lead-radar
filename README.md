# Lead Radar

A CRM + trigger UI for Eisha's automated lead-hunting workflow. One button
kicks off the n8n pipeline (Apify scrape → OpenAI qualification → Airtable);
the table below it is the CRM view of everything it's found.

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
| **Leads (Airtable)** | 5 in-memory sample leads, resets on server restart | Real leads from your Airtable base |
| **Run Lead Hunt (n8n)** | Records a "triggered" timestamp, does nothing else | POSTs to your n8n webhook, starts the real pipeline |

This means the dashboard, status editing, filtering, and button UX can all
be built and demoed before the automation exists — which is how this was
built and tested.

## Environment variables

Copy `.env.example` to `.env.local`:

| Variable | Purpose |
|---|---|
| `APP_PASSWORD` | Shared password gating the whole site. Unset = no gate (local dev only — **always set this in production**). |
| `AIRTABLE_API_KEY` | Personal access token, read/write scope on the base. |
| `AIRTABLE_BASE_ID` | From the base's API docs page or its URL. |
| `AIRTABLE_TABLE_NAME` | Defaults to `Leads`. |
| `N8N_WEBHOOK_URL` | The Production URL of the "Manual Run (Webhook)" trigger node — see `/n8n/README.md`. |

## Auth

A single shared password (`APP_PASSWORD`), not per-user accounts. This is
deliberate: there's exactly one client using this tool. Add real
authentication (NextAuth, Clerk, etc.) only if this ever needs to serve more
than one person — building it now would be unused complexity.

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

## What's not built yet

- The daily-digest email (Airtable "top leads today" query + Email Send
  node) is in the n8n workflow but untested — verify it fires correctly
  once real data exists.
- No pagination — fine at dozens of leads, will need it well before
  hundreds.
- Airtable's free tier caps at 1,200 records/base; archive or delete
  `Passed` leads periodically once volume grows.
