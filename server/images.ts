import { AIRPORTS, type Airport } from './airports.js';
import { config } from './config.js';
import type { DB } from './db.js';

/*
 * High-resolution destination photos from Wikipedia lead images.
 *
 * Google only hands us 225px thumbnails, which look mushy on deal cards. The
 * Wikipedia page image for a city is usually a big, well-composed skyline or
 * landmark shot, served from upload.wikimedia.org (hotlinking allowed).
 */

/** Wikipedia titles to try, in order, where the plain city name is ambiguous or its lead image is a flag/map. */
export const WIKI_TITLES: Record<string, string[]> = {
  CLT: ['Charlotte, North Carolina'],
  JFK: ['New York City'],
  EWR: ['Newark, New Jersey'],
  MCO: ['Orlando, Florida'],
  PHX: ['Phoenix, Arizona'],
  PDX: ['Portland, Oregon'],
  IAD: ['Washington, D.C.', 'National Mall', 'United States Capitol'],
  AUS: ['Austin, Texas'],
  SAV: ['Savannah, Georgia', 'Savannah Historic District', 'Forsyth Park'],
  CHS: ['Charleston, South Carolina'],
  SJU: ['San Juan, Puerto Rico', 'Old San Juan'],
  NAS: ['Nassau, Bahamas'],
  STT: ['Charlotte Amalie, U.S. Virgin Islands', 'Magens Bay'],
  SJO: ['San José, Costa Rica', 'Arenal Volcano', 'Costa Rica'],
  LIR: ['Tamarindo, Costa Rica', 'Guanacaste Province', 'Rincón de la Vieja Volcano'],
  CTG: ['Cartagena, Colombia'],
  AUA: ['Eagle Beach', 'Palm Beach, Aruba', 'Oranjestad'],
  PDL: ['Ponta Delgada', 'Sete Cidades', 'São Miguel Island'],
  HKG: ['Victoria Peak', 'Hong Kong Island', 'Tsim Sha Tsui'],
  SIN: ['Marina Bay, Singapore', 'Gardens by the Bay'],
  DPS: ['Ubud', 'Tegallalang', 'Uluwatu Temple'],
  NAN: ['Denarau Island', 'Mamanuca Islands', 'Nadi'],
  PPT: ['Moorea', 'Papeete'],
  OGG: ['Wailea, Hawaii', 'Haleakalā National Park', 'Kaanapali, Hawaii'],
  HNL: ['Honolulu', 'Waikiki'],
  PTY: ['Casco Viejo, Panama', 'Panama Canal'],
  BZE: ['Caye Caulker', 'Ambergris Caye', 'Great Blue Hole'],
  UIO: ['Historic Center of Quito', 'Quito'],
  DEL: ['India Gate', 'Humayun\'s Tomb', 'Delhi'],
  PVR: ['Puerto Vallarta', 'Los Arcos Marine Park', 'Banderas Bay'],
  HND: ['Tokyo'],
  NRT: ['Tokyo'],
  IAH: ['Houston', 'Downtown Houston'],
  MBJ: ['Montego Bay'],
  CUZ: ['Cusco', 'Machu Picchu'],
  JAC: ['Jackson Hole', 'Grand Teton National Park'],
  BZN: ['Bozeman, Montana', 'Yellowstone National Park'],
  PUJ: ['Punta Cana'],
  SJD: ['Los Cabos', 'Cabo San Lucas'],
};

const BAD_NAME = /flag|map|locator|location|seal|coat_of_arms|emblem|logo|landsat|from_space|iss0|montage|collage|diagram|svg$|\.tif|\.gif/i;

export interface WikiImage {
  url: string; // 1280px wide
  file: string; // Commons file name, for attribution
  width: number;
  height: number;
}

/** Is this Wikipedia page image good enough to be a card photo? */
export function acceptable(img: { file: string; width: number; height: number }): boolean {
  if (BAD_NAME.test(img.file)) return false;
  if (img.width < 1000) return false;
  return img.width >= img.height * 1.15; // landscape only: cards are wide
}

/**
 * Swap the width segment in a Wikimedia thumbnail URL (…/1280px-Foo.jpg → …/960px-Foo.jpg).
 * Wikimedia only serves standard widths (e.g. 330, 500, 960, 1280); others return 400.
 */
export function resizeWikimedia(url: string, width: number): string {
  return url.replace(/\/(\d+)px-([^/]+)$/, `/${width}px-$2`);
}

export function candidatesFor(a: Airport): string[] {
  return WIKI_TITLES[a.code] ?? [a.city];
}

type Fetcher = (titles: string[]) => Promise<Map<string, WikiImage | null>>;

const UA = `WhimsyDeals/0.1 (${config.publicUrl}; ${config.vapidSubject.replace(/^mailto:/, '')})`;

/** Look up lead images for up to 50 titles in one request, following normalization + redirects. */
export async function lookupBatch(titles: string[], attempt = 0): Promise<Map<string, WikiImage | null>> {
  const url =
    'https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageimages' +
    `&piprop=thumbnail|name&pithumbsize=1280&pilimit=50&titles=${encodeURIComponent(titles.join('|'))}`;
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 429 && attempt < 4) {
    const wait = Number(res.headers.get('retry-after')) * 1000 || 5000 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, wait));
    return lookupBatch(titles, attempt + 1);
  }
  if (!res.ok) throw new Error(`wikipedia HTTP ${res.status}`);
  const j = (await res.json()) as {
    query?: {
      normalized?: { from: string; to: string }[];
      redirects?: { from: string; to: string }[];
      pages?: Record<string, { title: string; pageimage?: string; thumbnail?: { source: string; width: number; height: number } }>;
    };
  };
  const norm = new Map((j.query?.normalized ?? []).map((n) => [n.from, n.to]));
  const redir = new Map((j.query?.redirects ?? []).map((n) => [n.from, n.to]));
  const pages = new Map(Object.values(j.query?.pages ?? {}).map((p) => [p.title, p]));
  const out = new Map<string, WikiImage | null>();
  for (const t of titles) {
    let key = norm.get(t) ?? t;
    key = redir.get(key) ?? key;
    const p = pages.get(key);
    out.set(t, p?.pageimage && p.thumbnail ? { url: p.thumbnail.source, file: p.pageimage, width: p.thumbnail.width, height: p.thumbnail.height } : null);
  }
  return out;
}

/**
 * Resolve photos for many airports: round 1 asks for every airport's first
 * candidate title in batches, round 2 the second candidate for the misses, etc.
 */
export async function findCityImages(airports: Airport[], fetcher: Fetcher = lookupBatch, delayMs = 1000) {
  const result = new Map<string, (WikiImage & { title: string }) | null>();
  let pending = airports;
  for (let round = 0; pending.length; round++) {
    const asks = pending.map((a) => ({ a, title: candidatesFor(a)[round] })).filter((x) => x.title);
    for (const a of pending) if (!candidatesFor(a)[round]) result.set(a.code, null);
    const next: Airport[] = [];
    for (let i = 0; i < asks.length; i += 50) {
      const chunk = asks.slice(i, i + 50);
      const found = await fetcher([...new Set(chunk.map((x) => x.title))]);
      for (const { a, title } of chunk) {
        const img = found.get(title);
        if (img && acceptable(img)) result.set(a.code, { ...img, title });
        else next.push(a);
      }
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }
    pending = next;
  }
  return result;
}

export async function findCityImage(a: Airport, fetcher: Fetcher = lookupBatch) {
  return (await findCityImages([a], fetcher, 0)).get(a.code) ?? null;
}

const REFRESH_MS = 30 * 86400_000;

/**
 * Fill/refresh the city_images cache in the background. Misses are cached too
 * (url NULL) so we don't hammer Wikipedia for cities without a usable photo.
 */
export async function syncCityImages(db: DB, { airports = AIRPORTS, delayMs = 1000, log = console.log, fetcher = lookupBatch } = {}) {
  const fresh = new Set(
    ((await db.all('SELECT code FROM city_images WHERE fetched_at > ?', Date.now() - REFRESH_MS)) as { code: string }[]).map((r) => r.code),
  );
  const todo = airports.filter((a) => !fresh.has(a.code));
  if (!todo.length) return { checked: 0, found: 0 };
  const images = await findCityImages(todo, fetcher, delayMs);
  let found = 0;
  for (const [code, img] of images) {
    await db.run(
      `INSERT INTO city_images (code, url, file, title, fetched_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (code) DO UPDATE SET url = excluded.url, file = excluded.file, title = excluded.title, fetched_at = excluded.fetched_at`,
      code,
      img?.url ?? null,
      img?.file ?? null,
      img?.title ?? null,
      Date.now(),
    );
    if (img) found++;
  }
  log(`[images] ${found}/${todo.length} city photos resolved`);
  return { checked: todo.length, found };
}
