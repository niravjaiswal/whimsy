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

## Front-end performance (2026-10-02)

Scrolling the feed used to show empty tiles for a beat. Causes and fixes:

- **Images.** Tiles hot-linked 960px Wikimedia JPEGs (100–260 KB each) into a
  128px-tall slot; mini rows pulled the same files for 44px thumbnails. In
  production every city photo now goes through Vercel's image optimizer
  (`/_vercel/image`, configured under `images` in `vercel.json`, enabled by
  `VITE_IMAGE_OPTIMIZER=1` in the Vercel build). It serves same-origin,
  edge-cached AVIF/WebP at the slot's 1x/2x width (`web/src/img.ts`). Widths and
  quality must stay in sync with `vercel.json`. The Hobby plan's monthly
  transformation quota is far above what ~150 cities × a few widths need, and
  `minimumCacheTTL` is 31 days. Dev and self-hosted builds fall back to
  Wikimedia's standard thumbnail widths.
- **Paint.** The first six cards load eagerly; photos fade in once decoded.
  Hovering a card prefetches the deal page's data and hero.
- **Scroll cost.** The fixed sky animated SVG groups that carry
  feTurbulence/displacement filters, so Chrome re-ran those filters every
  frame. Each cloud band is now its own composited layer that moves as a
  finished bitmap. Badges inside cards no longer use `backdrop-filter`.
- **Data.** `useApi` keeps an in-memory stale-while-revalidate cache with
  shared in-flight requests. Back navigation renders instantly, and
  `ScrollManager` restores the scroll position. `main.tsx` starts the feed
  request before React renders.
- **API.** `/deals` skips the `history` column, which only the deal page
  chart uses (about 35% of the payload). `/deals` and `/dips` are served from a
  20s in-memory snapshot that scanner deal events clear (`feedCacheMs`).
  `/meta` is browser-cacheable for 5 minutes.
- **Bundle.** Non-landing pages, the Atlas map (d3-geo) and the Supabase auth
  client are lazy chunks, warmed when the browser is idle. Initial JS went from
  529 KB to about 300 KB.
