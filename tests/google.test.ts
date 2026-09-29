import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { encodeTfs, extractPayload, parsePayload } from '../server/providers/google.js';
import { ProviderError } from '../server/providers/types.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/jfk-lis-rt.json', import.meta.url), 'utf8'));
const q = { origin: 'JFK', destination: 'LIS', departDate: '2026-11-10', returnDate: '2026-11-17' };

describe('encodeTfs', () => {
  it('matches the canonical fast-flights encoding (round trip)', async () => {
    expect(encodeTfs(q)).toBe('GhoSCjIwMjYtMTEtMTBqBRIDSkZLcgUSA0xJUxoaEgoyMDI2LTExLTE3agUSA0xJU3IFEgNKRktCAQFIAZgBAQ==');
  });
  it('matches the canonical encoding (one way)', async () => {
    expect(encodeTfs({ origin: 'DTW', destination: 'SFO', departDate: '2026-10-20' })).toBe(
      'GhoSCjIwMjYtMTAtMjBqBRIDRFRXcgUSA1NGT0IBAUgBmAEC',
    );
  });
});

describe('parsePayload', () => {
  const r = parsePayload(fixture, q);
  it('extracts itineraries sorted by price', async () => {
    expect(r.itineraries.length).toBeGreaterThan(5);
    const prices = r.itineraries.map((i) => i.price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(r.cheapest?.price).toBe(prices[0]);
  });
  it('parses itinerary details', async () => {
    const it0 = r.itineraries.find((i) => i.airlineCode === 'UX')!;
    expect(it0.airlines).toEqual(['Air Europa']);
    expect(it0.stops).toBe(1);
    expect(it0.via).toEqual(['MAD']);
    expect(it0.departTime).toBe('22:05');
    expect(it0.durationMinutes).toBe(730);
  });
  it('parses Google price insights and history', async () => {
    expect(r.insight).toMatchObject({ level: 5, current: 642, typical: 431, typicalLow: 415, typicalHigh: 590 });
    expect(r.insight!.history.length).toBe(61);
  });
  it('parses places with city + image', async () => {
    expect(r.origin).toMatchObject({ code: 'JFK', city: 'New York', country: 'United States' });
    expect(r.destination).toMatchObject({ code: 'LIS', city: 'Lisbon', country: 'Portugal' });
    expect(r.destination!.image).toMatch(/^https:\/\//);
  });
  it('builds a Google Flights booking link', async () => {
    expect(r.bookingUrl).toContain('google.com/travel/flights/search?tfs=');
  });
});

describe('extractPayload', () => {
  it('reads the ds:1 script block', async () => {
    const html = `<html><script class="ds:1" nonce="x">AF_initDataCallback({key: 'ds:1', hash: '1', data:${JSON.stringify([1, [2]])}, sideChannel: {}});</script>`;
    expect(extractPayload(html)).toEqual([1, [2]]);
  });
  it('flags blocked/changed pages as retryable', async () => {
    try {
      extractPayload('<html>captcha</html>');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).retryable).toBe(true);
    }
  });
});
