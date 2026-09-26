import {
  ProviderError,
  type FareProvider,
  type FareQuery,
  type FareResult,
  type Itinerary,
  type PlaceInfo,
  type PriceInsight,
} from './types.js';

/*
 * Google Flights provider.
 *
 * The public search page embeds its full result set in a `<script class="ds:1">`
 * block. We build the `tfs` query param (a base64 protobuf) ourselves and parse
 * that block. See .claude/docs/architecture.md for the payload map.
 */

// ── minimal protobuf writer ────────────────────────────────────────────────
function varint(n: number): number[] {
  const out: number[] = [];
  while (n > 127) {
    out.push((n & 127) | 128);
    n >>>= 7;
  }
  out.push(n);
  return out;
}
const tag = (field: number, wire: number) => varint((field << 3) | wire);
const pbString = (field: number, s: string) => {
  const bytes = [...Buffer.from(s, 'utf8')];
  return [...tag(field, 2), ...varint(bytes.length), ...bytes];
};
const pbMessage = (field: number, bytes: number[]) => [...tag(field, 2), ...varint(bytes.length), ...bytes];
const pbInt = (field: number, v: number) => [...tag(field, 0), ...varint(v)];

function leg(from: string, to: string, date: string): number[] {
  return pbMessage(3, [...pbString(2, date), ...pbMessage(13, pbString(2, from)), ...pbMessage(14, pbString(2, to))]);
}

/** Encode a fare query as Google Flights' `tfs` parameter. */
export function encodeTfs(q: FareQuery): string {
  const bytes = [
    ...leg(q.origin, q.destination, q.departDate),
    ...(q.returnDate ? leg(q.destination, q.origin, q.returnDate) : []),
    ...pbMessage(8, [1]), // passengers: packed repeated enum, one adult
    ...pbInt(9, 1), // economy
    ...pbInt(19, q.returnDate ? 1 : 2), // 1 = round trip, 2 = one way
  ];
  return Buffer.from(bytes).toString('base64');
}

export function googleFlightsUrl(q: FareQuery, currency = 'USD'): string {
  return `https://www.google.com/travel/flights/search?tfs=${encodeURIComponent(encodeTfs(q))}&hl=en&curr=${currency}&gl=US`;
}

// ── parsing ────────────────────────────────────────────────────────────────
type J = any; // Google's payload is untyped nested arrays

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (t: J): string => {
  const v = Array.isArray(t) ? t : [];
  return `${pad(v[0] ?? 0)}:${pad(v[1] ?? 0)}`;
};
const ymd = (d: J): string => (Array.isArray(d) && d.length === 3 ? `${d[0]}-${pad(d[1])}-${pad(d[2])}` : '');
const num = (v: J): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function extractPayload(html: string): J {
  const m = html.match(/<script class="ds:1"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new ProviderError('results block not found (blocked or layout changed)', true);
  const after = m[1].split('data:')[1];
  if (!after) throw new ProviderError('results block malformed', false);
  const json = after.slice(0, after.lastIndexOf(','));
  if (json.trimEnd().endsWith('errorHasStatus: true')) throw new ProviderError('no results', false);
  return JSON.parse(json);
}

function parseItinerary(row: J): Itinerary | null {
  const f = row?.[0];
  const price = num(row?.[1]?.[0]?.[1]);
  if (!Array.isArray(f) || price == null) return null;
  const segments: J[] = Array.isArray(f[2]) ? f[2] : [];
  return {
    price,
    airlines: Array.isArray(f[1]) ? f[1] : [],
    airlineCode: typeof f[0] === 'string' ? f[0] : 'multi',
    stops: Math.max(0, segments.length - 1),
    durationMinutes: num(f[9]) ?? 0,
    departTime: hhmm(f[5]),
    arriveTime: hhmm(f[8]),
    arriveDate: ymd(f[7]),
    via: segments.slice(0, -1).map((s) => s?.[6]).filter((c): c is string => typeof c === 'string'),
  };
}

function parseInsight(s: J): PriceInsight | null {
  if (!Array.isArray(s)) return null;
  const history: [number, number][] = Array.isArray(s[10]?.[0])
    ? s[10][0].filter((p: J) => Array.isArray(p) && num(p[0]) != null && num(p[1]) != null)
    : [];
  return {
    level: num(s[0]),
    current: num(s[1]?.[1]),
    typical: num(s[2]?.[1]),
    typicalLow: num(s[4]?.[1]),
    typicalHigh: num(s[5]?.[1]),
    history,
  };
}

function parsePlace(p: J): PlaceInfo | null {
  // [[code,0], airportName, [freebaseId, cityName, [[img],[img]]], [lat,lng], countryCode, 0, countryName]
  const code = p?.[0]?.[0];
  if (typeof code !== 'string') return null;
  const img = p?.[2]?.[2]?.[0]?.[0];
  return {
    code,
    city: typeof p?.[2]?.[1] === 'string' ? p[2][1] : null,
    country: typeof p?.[6] === 'string' ? p[6] : null,
    image: typeof img === 'string' ? img : null,
  };
}

export function parsePayload(payload: J, query: FareQuery): Omit<FareResult, 'fetchedAt'> {
  const rows: J[] = [...(payload?.[2]?.[0] ?? []), ...(payload?.[3]?.[0] ?? [])];
  const itineraries = rows
    .map(parseItinerary)
    .filter((i): i is Itinerary => i !== null)
    .sort((a, b) => a.price - b.price);
  const legs = payload?.[1]?.[0]?.[0];
  return {
    query,
    currency: 'USD',
    itineraries,
    cheapest: itineraries[0] ?? null,
    insight: parseInsight(payload?.[5]),
    origin: parsePlace(legs?.[0]),
    destination: parsePlace(payload?.[1]?.[0]?.[1]?.[0] ?? legs?.[1]),
    bookingUrl: googleFlightsUrl(query),
  };
}

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
];

export class GoogleFlightsProvider implements FareProvider {
  name = 'google-flights';
  constructor(private readonly timeoutMs = 20_000) {}

  async search(q: FareQuery, signal?: AbortSignal): Promise<FareResult> {
    const url = googleFlightsUrl(q);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: {
          'user-agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
          'accept-language': 'en-US,en;q=0.9',
          accept: 'text/html,application/xhtml+xml',
        },
      });
    } catch (err) {
      throw new ProviderError(`network: ${(err as Error).message}`, true);
    }
    if (res.status === 429 || res.status >= 500) throw new ProviderError(`HTTP ${res.status}`, true, res.status);
    if (!res.ok) throw new ProviderError(`HTTP ${res.status}`, false, res.status);
    const html = await res.text();
    const payload = extractPayload(html);
    return { ...parsePayload(payload, q), fetchedAt: Date.now() };
  }
}
