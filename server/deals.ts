import type { DB } from './db.js';
import type { RouteRow } from './routes.js';
import type { FareQuery, FareResult, PriceInsight } from './providers/types.js';

export type Tier = 'good' | 'great' | 'incredible';
export const TIER_RANK: Record<Tier, number> = { good: 1, great: 2, incredible: 3 };
export const TIERS: Tier[] = ['good', 'great', 'incredible'];

/*
 * Bar for a "deal", tuned on ~80k real observations (Sept 2026): Google itself
 * rates ~28% of searched fares as "low", so being under typical isn't enough.
 * Good ≈ 6% of fares, great ≈ 2%, incredible ≈ 0.5%.
 */
export const THRESHOLDS = { good: 0.4, great: 0.5, incredible: 0.6 } as const;
/** Must also beat Google's typical-low bound by this factor… */
export const LOW_MARGIN = 0.85;
/** …and save real money (a 40% drop on a $90 hop isn't news). */
export const MIN_SAVINGS = 60;

/** Apply the bar to a scored fare. Used at scan time and to re-grade stored deals. */
export function qualifyingTier(price: number, baseline: number, discount: number, typicalLow: number | null): Tier | null {
  const tier = tierFor(discount);
  if (!tier) return null;
  if (baseline - price < MIN_SAVINGS) return null;
  if (typicalLow != null && price > typicalLow * LOW_MARGIN) return null;
  return tier;
}

/** Minimum own observations before we trust our own median. */
const MIN_OWN_SAMPLES = 5;

export interface OwnStats {
  median: number | null;
  count: number;
}

export interface Score {
  baseline: number;
  discount: number;
  tier: Tier | null;
  score: number;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

export function tierFor(discount: number): Tier | null {
  if (discount >= THRESHOLDS.incredible) return 'incredible';
  if (discount >= THRESHOLDS.great) return 'great';
  if (discount >= THRESHOLDS.good) return 'good';
  return null;
}

/**
 * Decide how good a fare is.
 *
 * Baseline = what this trip normally costs. We lean on Google's "typical price"
 * for the exact search, sanity-checked against the 60-day price history for that
 * search and our own observations of the route. A deal must beat the baseline by
 * ≥40% *and* sit well under Google's typical-low bound when one exists — this
 * stops "cheap-looking" fares on routes that are always cheap from firing.
 */
export function scoreFare(price: number, insight: PriceInsight | null, own: OwnStats, distance: number): Score | null {
  const candidates: { v: number; w: number }[] = [];
  if (insight?.typical) candidates.push({ v: insight.typical, w: 0.5 });
  else if (insight?.typicalLow && insight?.typicalHigh)
    candidates.push({ v: (insight.typicalLow + insight.typicalHigh) / 2, w: 0.5 });
  const hist = median((insight?.history ?? []).map((p) => p[1]));
  if (hist && (insight?.history.length ?? 0) >= 14) candidates.push({ v: hist, w: 0.3 });
  if (own.median && own.count >= MIN_OWN_SAMPLES) candidates.push({ v: own.median, w: 0.2 });
  if (!candidates.length) return null;

  const wsum = candidates.reduce((s, c) => s + c.w, 0);
  const baseline = Math.round(candidates.reduce((s, c) => s + c.v * c.w, 0) / wsum);
  if (baseline <= 0 || price < 15) return null;

  const discount = Math.max(0, 1 - price / baseline);
  const tier = qualifyingTier(price, baseline, discount, insight?.typicalLow ?? null);

  // Score rewards depth of discount, with a bump for long-haul adventures
  // (a 40% drop to Tokyo is more exciting than 40% off a 90-minute hop).
  const reach = 1 + Math.min(distance, 7000) / 10000;
  const score = Math.round(discount * 100 * reach * 10) / 10;
  return { baseline, discount, tier, score };
}

export interface DealRow {
  id: number;
  slug: string;
  route_id: number;
  origin: string;
  destination: string;
  depart_date: string;
  return_date: string | null;
  price: number;
  first_price: number;
  baseline: number;
  typical_low: number | null;
  typical_high: number | null;
  discount: number;
  tier: Tier;
  score: number;
  airline: string | null;
  airline_code: string | null;
  stops: number | null;
  duration_minutes: number | null;
  depart_time: string | null;
  arrive_time: string | null;
  via: string | null;
  history: string | null;
  booking_url: string;
  status: 'active' | 'expired';
  found_at: number;
  updated_at: number;
  verified_at: number;
  expired_at: number | null;
}

export const dealSlug = (q: FareQuery) =>
  `${q.origin}-${q.destination}-${q.departDate}${q.returnDate ? `-${q.returnDate}` : ''}`.toLowerCase();

export async function ownStats(db: DB, routeId: number, now = Date.now()): Promise<OwnStats> {
  const rows = (await db.all('SELECT price FROM observations WHERE route_id = ? AND observed_at > ?', routeId, now - 60 * 86400_000)) as { price: number }[];
  return { median: median(rows.map((r) => r.price)), count: rows.length };
}

export type DealEvent = { kind: 'new' | 'dropped' | 'refreshed' | 'expired'; deal: DealRow };

/**
 * Persist a scan result: observation, place metadata, and deal upsert/expiry.
 * Returns what happened to the deal for this exact date pair, if anything.
 */
export async function recordResult(db: DB, route: RouteRow, result: FareResult, now = Date.now()): Promise<DealEvent | null> {
  const q = result.query;
  const cheapest = result.cheapest;
  const ins = result.insight;

  for (const place of [result.origin, result.destination]) {
    if (place?.code) {
      (await db.run(`INSERT INTO places (code, city, country, image, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (code) DO UPDATE SET city = COALESCE(excluded.city, places.city), country = COALESCE(excluded.country, places.country),
           image = COALESCE(excluded.image, places.image), updated_at = excluded.updated_at`, place.code, place.city, place.country, place.image, now));
    }
  }

  const slug = dealSlug(q);
  const existing = (await db.get('SELECT * FROM deals WHERE slug = ?', slug)) as DealRow | undefined;

  if (!cheapest) {
    if (existing?.status === 'active') return await expireDeal(db, existing, now);
    return null;
  }

  const stats = await ownStats(db, route.id, now);
  (await db.run(`INSERT INTO observations (route_id, depart_date, return_date, price, typical, typical_low, typical_high, level, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, route.id, q.departDate, q.returnDate ?? null, cheapest.price, ins?.typical ?? null, ins?.typicalLow ?? null, ins?.typicalHigh ?? null, ins?.level ?? null, now));
  (await db.run('UPDATE routes SET last_price = ?, last_typical = ? WHERE id = ?', cheapest.price, ins?.typical ?? null, route.id));

  const s = scoreFare(cheapest.price, ins, stats, route.distance);
  if (!s?.tier) {
    if (existing?.status === 'active') return await expireDeal(db, existing, now);
    return null;
  }

  const fields = {
    price: cheapest.price,
    baseline: s.baseline,
    typical_low: ins?.typicalLow ?? null,
    typical_high: ins?.typicalHigh ?? null,
    discount: s.discount,
    tier: s.tier,
    score: s.score,
    airline: cheapest.airlines.join(', ') || null,
    airline_code: cheapest.airlineCode,
    stops: cheapest.stops,
    duration_minutes: cheapest.durationMinutes,
    depart_time: cheapest.departTime,
    arrive_time: cheapest.arriveTime,
    via: cheapest.via.join(',') || null,
    history: ins?.history.length ? JSON.stringify(ins.history) : null,
    booking_url: result.bookingUrl,
  };

  if (existing) {
    const reactivated = existing.status !== 'active';
    const dropped = cheapest.price <= existing.price * 0.95;
    (await db.run(`UPDATE deals SET price=?, baseline=?, typical_low=?, typical_high=?, discount=?, tier=?, score=?, airline=?, airline_code=?,
         stops=?, duration_minutes=?, depart_time=?, arrive_time=?, via=?, history=?, booking_url=?, status='active',
         updated_at=?, verified_at=?, expired_at=NULL ${reactivated ? ', found_at = ?, first_price = ?' : ''}
       WHERE id = ?`, ...Object.values(fields),
      now,
      now,
      ...(reactivated ? [now, cheapest.price] : []),
      existing.id,));
    const deal = (await db.get('SELECT * FROM deals WHERE id = ?', existing.id)) as unknown as DealRow;
    return { kind: reactivated ? 'new' : dropped ? 'dropped' : 'refreshed', deal };
  }

  const res = (await db.run(`INSERT INTO deals (slug, route_id, origin, destination, depart_date, return_date, first_price, found_at, updated_at, verified_at,
         price, baseline, typical_low, typical_high, discount, tier, score, airline, airline_code, stops, duration_minutes,
         depart_time, arrive_time, via, history, booking_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`, slug, route.id, q.origin, q.destination, q.departDate, q.returnDate ?? null, cheapest.price, now, now, now, ...Object.values(fields)));
  return { kind: 'new', deal: res.rows[0] as DealRow };
}

async function expireDeal(db: DB, deal: DealRow, now: number): Promise<DealEvent> {
  (await db.run("UPDATE deals SET status = 'expired', expired_at = ?, updated_at = ? WHERE id = ?", now, now, deal.id));
  return { kind: 'expired', deal: { ...deal, status: 'expired', expired_at: now } };
}

/** Expire deals whose departure is too close or which haven't been re-verified in a while. */
export async function sweepStaleDeals(db: DB, now = Date.now(), maxUnverifiedMs = 36 * 3600_000): Promise<number> {
  const tomorrow = new Date(now + 86400_000).toISOString().slice(0, 10);
  const res = (await db.run(`UPDATE deals SET status = 'expired', expired_at = ?, updated_at = ?
       WHERE status = 'active' AND (depart_date <= ? OR verified_at < ?)`, now, now, tomorrow, now - maxUnverifiedMs));
  return Number(res.changes);
}

/**
 * Re-grade active deals against the current bar (thresholds change over time):
 * expire the ones that no longer qualify, fix tiers on the rest.
 */
export async function regradeActiveDeals(db: DB, now = Date.now()): Promise<{ expired: number; retiered: number }> {
  const deals = await db.all<Pick<DealRow, 'id' | 'price' | 'baseline' | 'discount' | 'typical_low' | 'tier'>>(
    "SELECT id, price, baseline, discount, typical_low, tier FROM deals WHERE status = 'active'",
  );
  let expired = 0;
  let retiered = 0;
  for (const d of deals) {
    const tier = qualifyingTier(d.price, d.baseline, d.discount, d.typical_low);
    if (!tier) {
      await db.run("UPDATE deals SET status = 'expired', expired_at = ?, updated_at = ? WHERE id = ?", now, now, d.id);
      expired++;
    } else if (tier !== d.tier) {
      await db.run('UPDATE deals SET tier = ? WHERE id = ?', tier, d.id);
      retiered++;
    }
  }
  return { expired, retiered };
}
