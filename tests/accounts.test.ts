import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createApi } from '../server/api.js';
import type { AuthService, AuthUser } from '../server/auth.js';
import { recordResult } from '../server/deals.js';
import { addRoute, fare, memDb } from './helpers.js';

/** Fake Supabase: tokens are "user:<uuid>:<email>", codes are fixed. */
class FakeAuth implements AuthService {
  readonly enabled = true;
  issued: string[] = [];
  deleted: string[] = [];
  publicConfig() {
    return { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' };
  }
  async issueCode(email: string) {
    this.issued.push(email);
    return { code: '12345678' };
  }
  async verifyAccessToken(token: string): Promise<AuthUser | null> {
    const m = token.match(/^user:([0-9a-f-]{36}):(.+)$/);
    return m ? { id: m[1], email: m[2] } : null;
  }
  async deleteUser(id: string) {
    this.deleted.push(id);
  }
}

const ALICE = { id: '11111111-1111-4111-8111-111111111111', email: 'alice@example.com' };
const BOB = { id: '22222222-2222-4222-8222-222222222222', email: 'bob@example.com' };
const bearer = (u: AuthUser) => ({ authorization: `Bearer user:${u.id}:${u.email}` });

async function setup() {
  const db = await memDb();
  const auth = new FakeAuth();
  const api = createApi({ db, bus: new EventEmitter(), auth });
  const json = (path: string, init: RequestInit & { as?: AuthUser } = {}) =>
    api.request(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.as ? bearer(init.as) : {}), ...(init.headers ?? {}) },
    });
  return { db, auth, json };
}

describe('accounts', () => {
  it('advertises auth in meta', async () => {
    const { json } = await setup();
    expect((await (await json('/meta')).json()).auth).toEqual({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' });
  });

  it('emails a sign-in code with a one-tap link, and rate limits per address', async () => {
    const { db, auth, json } = await setup();
    expect((await json('/auth/code', { method: 'POST', body: JSON.stringify({ email: 'nope' }) })).status).toBe(400);
    const res = await json('/auth/code', { method: 'POST', body: JSON.stringify({ email: ' Alice@Example.com ' }) });
    expect(res.status).toBe(200);
    expect(auth.issued).toEqual(['alice@example.com']);
    const mail = (await db.get('SELECT recipient, subject, text FROM outbox')) as any;
    expect(mail.recipient).toBe('alice@example.com');
    expect(mail.subject).toBe('1234 5678 is your Whimsy sign-in code');
    expect(mail.text).toContain('/signin#email=alice%40example.com&code=12345678');
    for (let i = 0; i < 4; i++) await json('/auth/code', { method: 'POST', body: JSON.stringify({ email: 'alice@example.com' }) });
    expect((await json('/auth/code', { method: 'POST', body: JSON.stringify({ email: 'alice@example.com' }) })).status).toBe(429);
  });

  it('requires a valid token for /me', async () => {
    const { json } = await setup();
    expect((await json('/me')).status).toBe(401);
    expect((await json('/me', { headers: { authorization: 'Bearer forged' } })).status).toBe(401);
  });

  it('claims unowned alerts on the account email and confirms them', async () => {
    const { json } = await setup();
    const anon = await (await json('/alerts', { method: 'POST', body: JSON.stringify({ email: 'alice@example.com', channels: { email: true } }) })).json();
    expect(anon.alert.emailVerified).toBe(false);
    const me = await (await json('/me', { as: ALICE })).json();
    expect(me).toMatchObject({ user: ALICE, claimed: 1, profile: { email: 'alice@example.com', homeAirports: [] } });
    expect(me.alerts[0]).toMatchObject({ token: anon.alert.token, emailVerified: true });
    // Bob can't see Alice's alerts.
    expect((await (await json('/me', { as: BOB })).json()).alerts).toEqual([]);
  });

  it('claims alerts by manage token but never steals owned ones', async () => {
    const { json } = await setup();
    const a1 = (await (await json('/alerts', { method: 'POST', body: JSON.stringify({ channels: { push: true } }) })).json()).alert;
    const a2 = (await (await json('/alerts', { method: 'POST', body: JSON.stringify({ channels: { push: true } }), as: BOB })).json()).alert;
    const claim = await (await json('/me/claim', { method: 'POST', body: JSON.stringify({ tokens: [a1.token, a2.token, 'x'] }), as: ALICE })).json();
    expect(claim.claimed).toBe(1);
    const alice = await (await json('/me', { as: ALICE })).json();
    expect(alice.alerts.map((a: any) => a.token)).toEqual([a1.token]);
    expect((await (await json('/me', { as: BOB })).json()).alerts.map((a: any) => a.token)).toEqual([a2.token]);
  });

  it('confirms the account email instantly for alerts created while signed in', async () => {
    const { db, json } = await setup();
    const own = await (await json('/alerts', { method: 'POST', body: JSON.stringify({ email: 'alice@example.com', channels: { email: true } }), as: ALICE })).json();
    expect(own.alert.emailVerified).toBe(true);
    expect(((await db.get('SELECT COUNT(*) n FROM outbox')) as any).n).toBe(0); // no confirmation email needed
    // A different address still needs its own confirmation.
    const other = await (await json('/alerts', { method: 'POST', body: JSON.stringify({ email: 'friend@example.com', channels: { email: true } }), as: ALICE })).json();
    expect(other.alert.emailVerified).toBe(false);
    expect(((await db.get('SELECT COUNT(*) n FROM outbox')) as any).n).toBe(1);
    // Switching an alert to the account email while signed in confirms it.
    const upd = await (await json(`/alerts/${other.alert.token}`, { method: 'PATCH', body: JSON.stringify({ email: 'alice@example.com' }), as: ALICE })).json();
    expect(upd.alert.emailVerified).toBe(true);
  });

  it('saves home airports and deals', async () => {
    const { db, json } = await setup();
    await recordResult(db, await addRoute(db), fare({ price: 400 }));
    expect((await json('/me', { method: 'PATCH', body: JSON.stringify({ homeAirports: ['XXX'] }), as: ALICE })).status).toBe(400);
    const patched = await (await json('/me', { method: 'PATCH', body: JSON.stringify({ homeAirports: ['dtw', 'ORD'] }), as: ALICE })).json();
    expect(patched.homeAirports).toEqual(['DTW', 'ORD']);
    expect((await json('/me/saved/nope', { method: 'PUT', as: ALICE })).status).toBe(404);
    await json('/me/saved/dtw-lis-2026-11-10-2026-11-17', { method: 'PUT', as: ALICE });
    await json('/me/saved/dtw-lis-2026-11-10-2026-11-17', { method: 'PUT', as: ALICE }); // idempotent
    let me = await (await json('/me', { as: ALICE })).json();
    expect(me.profile.homeAirports).toEqual(['DTW', 'ORD']);
    expect(me.saved.map((d: any) => d.slug)).toEqual(['dtw-lis-2026-11-10-2026-11-17']);
    expect(me.saved[0].savedAt).toEqual(expect.any(Number));
    await json('/me/saved/dtw-lis-2026-11-10-2026-11-17', { method: 'DELETE', as: ALICE });
    me = await (await json('/me', { as: ALICE })).json();
    expect(me.saved).toEqual([]);
  });

  it('deletes the account and everything it owns', async () => {
    const { db, auth, json } = await setup();
    await recordResult(db, await addRoute(db), fare({ price: 400 }));
    const mine = (await (await json('/alerts', { method: 'POST', body: JSON.stringify({ channels: { push: true } }), as: ALICE })).json()).alert;
    const bobs = (await (await json('/alerts', { method: 'POST', body: JSON.stringify({ channels: { push: true } }), as: BOB })).json()).alert;
    await json('/me/saved/dtw-lis-2026-11-10-2026-11-17', { method: 'PUT', as: ALICE });
    const res = await (await json('/me', { method: 'DELETE', as: ALICE })).json();
    expect(res).toEqual({ ok: true, deletedAlerts: 1 });
    expect(auth.deleted).toEqual([ALICE.id]);
    expect((await json(`/alerts/${mine.token}`)).status).toBe(404);
    expect((await json(`/alerts/${bobs.token}`)).status).toBe(200);
    expect(((await db.get('SELECT COUNT(*) n FROM saved_deals')) as any).n).toBe(0);
    expect(((await db.get('SELECT COUNT(*) n FROM profiles')) as any).n).toBe(0);
  });
});
