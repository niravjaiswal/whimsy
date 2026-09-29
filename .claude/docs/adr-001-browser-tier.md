# ADR 001 — Add a real-browser tier (Explore discovery + live verification)

Date: 2026-09-26 · Status: proposed — NOT implemented. Blocked by the auto-mode safety check and awaiting an explicit owner decision (automated Google access with block-recovery). Fixtures kept for a possible future implementation.

## Context

Whimsy v1 used one fare source: a plain HTTP GET of the Google Flights results page, parsing
the server-rendered `ds:1` blob ("Tier 0"). Each request checks one route × one date pair, so
covering 3,832 routes took ~2.7 h at 24 req/min, and each route only ever saw a few sampled dates.

The birds-eye project (`~/development/birds-eye`) contains two relevant pieces:

1. `src/lib/fli.ts` (the shipped app): the same Tier 0 GET, plus a `tfu` "expanded" token and
   per-outbound return-board fetches to list every round-trip itinerary for **one** route.
2. `gflights-playwright/` (research library): drives a real Chromium via Playwright and reads
   Google's internal RPC responses (`GetShoppingResults`, `GetCalendarGraph`,
   `GetExploreDestinations`) off the wire. The browser mints Google's BotGuard token itself;
   nothing is forged or replayed. Its docs record that the Tier 0 blob is a *preview* (33 rows,
   some stale fares) and that the RPCs carry the live data.

## Experiments (2026-09-26, this Mac, residential IP)

| # | Question | Result |
|---|---|---|
| A | Does fli.ts's `tfu` expanded token / full `tfs` header help Tier 0? | 3–10× more rows, but cheapest price **and** Google's typical price identical on 6/6 routes. No value for deal detection, ~2× bytes. |
| B | Does Explore work headless from Node (`playwright-core`, cached Chromium 1243)? | Yes: 6 s, 84 destinations / 59 priced from DTW, each with its cheapest dates. |
| B2 | Can Explore target a region? | Yes, put a region Knowledge Graph id in the destination slot. Working ids: Europe `/m/02j9z`, Asia `/m/0j0k`, East Asia via Japan `/m/03_3d`, Africa `/m/0dg3n1`, South America `/m/06n3y`, Central America `/m/01tzh`, Mexico `/m/0b90_r`, Caribbean `/m/0261m`, Middle East `/m/04wsz`, USA `/m/09c7w0`, Canada `/m/0d060g`, Hawaii `/m/03gh4`, Australia `/m/0chghy`, New Zealand `/m/0ctw_b`. Failed (0 results): North America `/m/059g4`, Oceania `/m/05nrg`. |
| C | Price accuracy: Explore vs Tier 0 vs live browser search, same dates | Explore = live on every same-airport case. Tier 0 was **$111 high** on DTW→OSL (stale). Explore prices are per *city* (DTW→"Washington" $66 was BWI), the price row names the real airport. |
| D | Does the live `GetShoppingResults` RPC include price insights? | Yes: the first response (~2.7 s after load) has rows, `[5]` insights (typical range + history) and `[1]` places, same schema as `ds:1`, so the existing parser reads it unchanged. |

## Decision

Keep Tier 0 and add a browser tier with two jobs:

1. **Discovery: Explore sweeps.** For every origin city × 14 zones, load Explore and record the
   cheapest price + dates for every destination (~20k origin→destination pairs per sweep,
   including destinations outside `airports.ts`). One load replaces ~50–100 Tier 0 requests and
   always probes each pair's *cheapest* dates instead of a sampled date.
2. **Truth: live verification.** Any fare that might be a deal (Explore candidate, Tier 0 sample
   that scores as a deal, re-verification of an active deal, neighbour-date probes, alert-window
   targeted checks) is checked with a live search in the browser. Deals are created only from live
   results when the browser tier is healthy.

Tier 0 keeps running at a lower rate: rotation sampling of the core matrix (it supplies Google's
typical price for screening Explore candidates), and full fallback when the browser is missing,
blocked, or cooling down. Without Chromium the product behaves exactly like v1.

Not adopted from birds-eye: `tfu` expanded boards and return-board fan-out (no effect on
cheapest price or insights), price-graph clicking (UI-label dependent; Explore already finds
cheapest dates), booking-options flow (not needed for alerts).

## Design

- `server/browser/pool.ts`: one lazily launched Chromium (`BROWSER_CHANNEL=chrome` to use
  installed Chrome), one context recycled every ~40 pages, priority queue (verify > probe > sweep),
  min gap between navigations, block detection (`/sorry/`, 3xx on the RPC, HTML body, error
  frame) → retire context + exponential cooldown (1 → 30 min). Launch failure → `unavailable`,
  retried every 10 min.
- `server/browser/rpc.ts`: `wrb.fr` frame decoder (ported from gflights `rpc.py`).
- `server/providers/explore.ts`: Explore `tfs` encoder, zones, parser (destinations from `[3][0]`
  joined to price rows `[4][0]` by kgmid; real airport from price row `[6][5]`).
- `server/providers/live.ts`: live search → `FareResult` (fidelity `live`) via the existing
  `parsePayload`; `HybridProvider` = live when available else Tier 0 (fidelity `preview`).
- `server/sweeper.ts`: schedules (origin city, zone) runs every `EXPLORE_SWEEP_HOURS`, stores
  places/routes/observations, screens candidates (price vs Google typical from recent Tier 0/live
  observations, else own median ≥3 obs, else a distance-based expected fare), and enqueues the best
  few per run as live-verification jobs in the scanner.
- `server/geo.ts`: code → {city, country, region, lat, lon} from `airports.ts` + DB `places`, so
  discovered destinations work in the feed, map, alerts and notifications.
- Schema (additive migrations): `places` gains kgmid/lat/lon/region; `routes.core` (rotation
  only covers the core matrix); `observations.source`; `deals.fidelity`; `explore_runs` log.

## Risks

- Headless Chromium has been flagged intermittently in birds-eye research (rate/IP-state
  effects, not fingerprint). Mitigations: pacing, single browser, cooldown on any block signal,
  Tier 0 fallback, `BROWSER_HEADLESS=false` / `BROWSER_CHANNEL=chrome` switches.
- Positional schemas drift; fixtures (`tests/fixtures/explore-*.json`, `rpc-*.json`) catch it.
- Same ToS/robots.txt exposure as v1. No token forging or replay: every RPC is issued by the
  browser that minted its token.
- RAM: ~300–600 MB for one Chromium.
