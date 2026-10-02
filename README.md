# Whimsy ✈︎ cheap flights to wherever

Most fare tools make you pick a route first. Whimsy doesn't. It scans thousands of routes all day,
works out what each trip usually costs, and tells you when a fare drops well below that, wherever
it's going.

- **Always-on scanner**: 3,800+ routes (31 US/Canada hubs × 130 destinations), rotating through
  departure dates from 3 weeks to 7 months out, with trip lengths that fit the distance.
- **Real fares**: live Google Flights results, including Google's "typical price" range and 60-day
  price history for each search.
- **Deal detection**: a fare counts as a deal when it's **≥40% below baseline, ≥15% under Google's
  typical-low price, and $60+ saved**. Tiers are *good* (40%+), *great* (50%+) and *incredible* (60%+). Deals are
  re-checked every 6h and expire once the price recovers. When a deal is found, the scanner also
  checks nearby dates, because cheap fares tend to cluster.
- **Alerts without a route**: pick origins (or any), regions or cities (or anywhere), months, max
  price and deal tier. Notifications go out by **browser push**, **email**, **ntfy** (phone push,
  no account), or **Discord/Slack/webhooks**. They can be instant or a daily digest, and several
  deals found together are batched into one message.
- **Live UI**: the deals feed, world map ("Atlas"), deal pages with price history, the alert
  builder with a live match preview, and a scanner dashboard all update over SSE.

## Run it locally

```bash
npm install
npm run dev          # API + scanner on :8787, Vite UI on :5173
```

Open http://localhost:5173. Locally the database is PGlite (Postgres compiled to
WASM, stored in `data/pglite`), so there's nothing else to install. Set
`DATABASE_URL` to use a real Postgres instead.

## Production

| Piece | Where | What |
|---|---|---|
| Frontend | **Vercel** — https://whimsy-gamma.vercel.app | Static Vite build (`vercel.json`); `VITE_API_URL` points at the API |
| API + scanner + notifier | **Railway** | One long-running container (`Dockerfile`, `railway.json`, health check `/api/health`) |
| Database | **Supabase** Postgres | Schema in `supabase/migrations`; RLS on, Data API locked out |

Deploying changes: **push to `main`**. Railway rebuilds
the API and Vercel rebuilds the frontend automatically. Database migrations are the one
manual step:

```bash
supabase db push                 # apply new supabase/migrations (after `supabase link`)
```

`railway up --service api` and `vercel deploy --prod` still work for deploying a local tree.

Railway variables: `DATABASE_URL` (Supabase session pooler, port 5432),
`PUBLIC_URL`, `CORS_ORIGINS`, `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` /
`VAPID_SUBJECT`, `SCAN_RPM`, `SCAN_CONCURRENCY`, `DATABASE_POOL_SIZE`,
`AGENTMAIL_API_KEY` / `AGENTMAIL_INBOX`. Email goes out through AgentMail from
`whimsy@agentmail.to` (SMTP via `SMTP_URL` is the fallback). Addresses must be
confirmed through a one-click link before any deal email is sent.
Run exactly one Railway replica: the scanner and notifier are in-process.

`npx tsx server/cli.ts import-sqlite data/whimsy.db` copies a v1 SQLite database
into an empty `DATABASE_URL`.

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

## License

[MIT](LICENSE)
