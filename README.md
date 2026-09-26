# Whimsy ✈︎ cheap flights to wherever

Most fare tools make you pick a route first. Whimsy doesn't. It scans thousands of routes all day,
works out what each trip usually costs, and tells you when a fare drops well below that, wherever
it's going.

- **Always-on scanner**: 3,800+ routes (31 US/Canada hubs × 130 destinations), rotating through
  departure dates from 3 weeks to 7 months out, with trip lengths that fit the distance.
- **Real fares**: live Google Flights results, including Google's "typical price" range and 60-day
  price history for each search.
- **Deal detection**: a fare counts as a deal when it's **≥20% below baseline _and_ at or under the
  typical-low price**. Tiers are *good* (20%+), *great* (35%+) and *incredible* (50%+). Deals are
  re-checked every 6h and expire once the price recovers. When a deal is found, the scanner also
  checks nearby dates, because cheap fares tend to cluster.
- **Alerts without a route**: pick origins (or any), regions or cities (or anywhere), months, max
  price and deal tier. Notifications go out by **browser push**, **email**, **ntfy** (phone push,
  no account), or **Discord/Slack/webhooks**. They can be instant or a daily digest, and several
  deals found together are batched into one message.
- **Live UI**: the deals feed, world map ("Atlas"), deal pages with price history, the alert
  builder with a live match preview, and a scanner dashboard all update over SSE.

## Run it

```bash
npm install
npm run dev          # API + scanner on :8787, Vite UI on :5173
```

Open http://localhost:5173. The scanner starts immediately, and the first deals usually show up
within a few minutes.

Production (single process: API + scanner + static UI):

```bash
npm run build
npm start            # http://localhost:8787
```

Or with Docker:

```bash
docker build -t whimsy . && docker run -p 8787:8787 -v whimsy-data:/data whimsy
```

The scanner needs a long-running host (Fly.io, Railway, a VPS). Serverless won't work.

## Config

Copy `.env.example` to `.env`. It's loaded automatically. The important settings:

| var | default | |
|---|---|---|
| `PUBLIC_URL` | `http://localhost:8787` | used for links in notifications |
| `SCAN_RPM` | `24` | fare checks per minute; keep it polite |
| `ORIGINS` | all hubs | comma-separated IATA codes to scan from |
| `SMTP_URL` | none | without it, emails go to the dev outbox at `/api/dev/outbox` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | auto | push keys, generated and stored in the DB if unset |

## CLI

```bash
npm run scan:once -- 20                                    # scan 20 routes and print results
npx tsx server/cli.ts quote JFK LIS 2026-11-10 2026-11-17  # one live quote
```

## Tests

```bash
npm test         # provider parsing (real payload fixture), scoring, deal lifecycle, scanner
                 # scheduling/backoff/probes, alert matching, notifier batching, push, API
npm run typecheck
```

## Layout

```
server/
  providers/google.ts   tfs protobuf encoder + ds:1 payload parser
  scanner.ts            scheduler: verify stale deals → probe neighbours → most overdue route
  deals.ts              baseline blend, tiers, deal upsert/expiry
  alerts.ts             validation, matching, match queue
  notify/               email · web push · ntfy · webhooks, batched flush
  api.ts                REST + SSE
web/src/                React UI (Birds Eye-inspired dusk-sky design)
```

Design notes live in `.claude/docs/architecture.md`.

## A note on the data source

Fares come from Google Flights' public search pages. Scraping them is against Google's Terms of
Service, so treat this as a prototype or personal tool. It runs at a low, rate-limited request
rate with backoff. For a commercial launch, put a licensed fare API (Duffel, Amadeus Enterprise,
Travelport, etc.) behind the `FareProvider` interface in `server/providers/types.ts`.
