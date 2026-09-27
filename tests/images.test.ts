import { describe, expect, it } from 'vitest';
import { getAirport } from '../server/airports.js';
import { acceptable, findCityImage, resizeWikimedia, syncCityImages } from '../server/images.js';
import { memDb } from './helpers.js';

const img = (file: string, width = 1280, height = 720) => ({ url: `https://upload.wikimedia.org/x/1280px-${file}`, file, width, height });

describe('city images', () => {
  it('rejects flags, maps, portraits and small images', () => {
    expect(acceptable(img('Skyline.jpg'))).toBe(true);
    expect(acceptable(img('Flag_of_Aruba.svg'))).toBe(false);
    expect(acceptable(img('Maui_Landsat_Photo.jpg'))).toBe(false);
    expect(acceptable(img('Belize_City_Montage.jpeg'))).toBe(false);
    expect(acceptable(img('Tall.jpg', 1280, 1900))).toBe(false);
    expect(acceptable(img('Tiny.jpg', 498, 300))).toBe(false);
  });

  it('resizes Wikimedia thumbnail URLs, keeping query strings', () => {
    const u = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/be/A.jpg/1280px-A.jpg?utm_source=x';
    expect(resizeWikimedia(u, 960)).toBe('https://thumb.wikimedia.org/wikipedia/commons/thumb/b/be/A.jpg/960px-A.jpg?utm_source=x');
  });

  it('walks override titles until one has a usable photo', async () => {
    const seen: string[] = [];
    const found = await findCityImage(getAirport('AUA')!, async (titles) => {
      seen.push(...titles);
      return new Map(titles.map((t) => [t, t === 'Eagle Beach' ? img('Flag_of_Aruba.svg') : img('Palm_Beach.jpg')]));
    });
    expect(seen).toEqual(['Eagle Beach', 'Palm Beach, Aruba']);
    expect(found?.file).toBe('Palm_Beach.jpg');
  });

  it('caches results (including misses) and skips fresh entries', async () => {
    const db = memDb();
    const airports = [getAirport('LIS')!, getAirport('ATL')!];
    const orig = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(
        JSON.stringify({
          query: {
            pages: {
              1: { title: 'Lisbon', pageimage: 'Lisboa.jpg', thumbnail: { source: 'https://upload.wikimedia.org/a/1280px-Lisboa.jpg', width: 1280, height: 800 } },
              2: { title: 'Atlanta' },
            },
          },
        }),
      );
    }) as typeof fetch;
    try {
      expect(await syncCityImages(db, { airports, delayMs: 0, log: () => {} })).toEqual({ checked: 2, found: 1 });
      expect(await syncCityImages(db, { airports, delayMs: 0, log: () => {} })).toEqual({ checked: 0, found: 0 });
      // One batched request covers both cities.
      expect(calls).toBe(1);
      const rows = db.prepare('SELECT code, url FROM city_images ORDER BY code').all() as any[];
      expect(rows).toEqual([
        { code: 'ATL', url: null },
        { code: 'LIS', url: 'https://upload.wikimedia.org/a/1280px-Lisboa.jpg' },
      ]);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
