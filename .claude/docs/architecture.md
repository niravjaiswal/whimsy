# Whimsy — architecture & plan

Product: continuously scan fares across a large matrix of routes, flag prices far
below normal, and notify people who only care about "cheap + somewhere cool",
not a specific route. Visual language borrowed from Birds Eye (dusk sky gradient,
stars, crescent sun, clouds, grain, dark glass pills, blue gradient CTA, black
rounded result cards).

## Data source (verified 2026-09-26)

- Google Flights search page `https://www.google.com/travel/flights/search?tfs=<b64 protobuf>`
  returns full results server-rendered in `<script class="ds:1">`. Plain `fetch` works
  (~1.2–2.5s/query). RPC endpoints (`GetCalendarGraph`, `GetShoppingResults`) now
  return empty without a browser session — don't use.
- Payload map:
  - `p[2][0]`, `p[3][0]`: itinerary rows. `row[0]` = flight, `row[1][0][1]` = price.
    flight: `[0]` airline code|"multi", `[1]` airline names, `[2]` segments,
    `[3]` origin, `[4]` dep date, `[5]` dep time, `[6]` dest, `[7]` arr date,
    `[8]` arr time, `[9]` duration min. stops = segments.length-1.
  - `p[5]` price insights: `[level, [,current], [,typical], [,diff], [,typLow], [,typHigh], …, [[[ts,price]…]] history 60d]`.
    level 1/2 ≈ low/typical, 4/5 ≈ high.
  - `p[1]`: origin/dest airport + city name + image thumbnails + lat/lng + country.
- Scraping Google is against their ToS; provider is pluggable (`server/providers`),
  rate-limited and polite by default. Swap for a licensed API in production.

## Components (single Node process)

- `server/db.ts` — `node:sqlite` (no native deps). Tables: airports/cities, routes,
  scans, observations, deals, alerts, deliveries, push_subscriptions, kv.
- `server/scanner.ts` — priority scheduler over route matrix (origins × destinations,
  distance-filtered). Each route has `next_scan_at`; picks date sample by rotation
  (lead times 2–26 weeks; trip length by distance). Token-bucket rate limit
  (`SCAN_RPM`), exponential backoff on failures.
- `server/deals.ts` — scoring. baseline = Google typical price, blended with our own
  observed median once we have ≥5 observations. discount = 1 - price/baseline.
  Deal if discount ≥ 20% and price ≤ typical low. Tiers: good ≥20%, great ≥35%,
  incredible ≥50%. Deals expire on departure or when rescans show price recovered.
- `server/alerts.ts` — match deals to alerts (origins, regions/destinations or
  anywhere, max price, min tier, travel months). Dedupe per (alert, deal), re-notify
  only on further ≥10% drop.
- `server/notify/*` — web push (VAPID auto-generated), email (SMTP via nodemailer,
  or dev outbox), ntfy.sh topics (phone push, no app account), webhooks
  (Discord/Slack/generic JSON).
- `server/api.ts` — Hono REST + SSE live feed. Serves built SPA.
- `web/` — Vite + React SPA: live deals feed + map, deal detail, alert builder,
  alert management (token link), scanner status.

## Deploy

`npm run build && npm start` → one process (API + scanner + static). Dockerfile
included. Needs a long-running host (Fly/Railway/VPS) — not serverless.
