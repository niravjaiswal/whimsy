import { AIRPORT_BY_CODE } from './airports.js';
import { ValidationError, rowToAlert, type Alert } from './alerts.js';
import type { AuthUser } from './auth.js';
import type { DB } from './db.js';
import type { DealRow } from './deals.js';

/*
 * Per-user data for optional accounts: profile (home airports), saved deals and
 * alert ownership. Identity itself lives in Supabase Auth.
 */

export interface Profile {
  email: string;
  homeAirports: string[];
  createdAt: number;
}

/** Create or refresh the profile, then attach alerts the user provably owns. */
export async function syncUser(db: DB, user: AuthUser, now = Date.now()): Promise<{ profile: Profile; claimed: number }> {
  const row = (await db.get(
    `INSERT INTO profiles (user_id, email, created_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at
     RETURNING email, home_airports, created_at`,
    user.id,
    user.email,
    now,
    now,
  )) as { email: string; home_airports: string; created_at: number };
  // Signing in proved the user owns this inbox: their unowned alerts on it are theirs,
  // and confirmed.
  const res = await db.run(
    `UPDATE alerts SET user_id = ?, email_verified_at = COALESCE(email_verified_at, ?)
     WHERE user_id IS NULL AND email = ?`,
    user.id,
    now,
    user.email,
  );
  return {
    profile: { email: row.email, homeAirports: JSON.parse(row.home_airports), createdAt: row.created_at },
    claimed: res.changes,
  };
}

/** Attach anonymous alerts the browser holds manage links for. Owned alerts are never moved. */
export async function claimAlerts(db: DB, user: AuthUser, tokens: unknown, now = Date.now()): Promise<number> {
  if (!Array.isArray(tokens)) throw new ValidationError('tokens must be a list');
  const list = tokens.map(String).filter((t) => /^[A-Za-z0-9_-]{16,64}$/.test(t)).slice(0, 100);
  if (!list.length) return 0;
  const res = await db.run(
    `UPDATE alerts SET user_id = ?,
       email_verified_at = CASE WHEN email = ? THEN COALESCE(email_verified_at, ?) ELSE email_verified_at END
     WHERE user_id IS NULL AND token = ANY(?::text[])`,
    user.id,
    user.email,
    now,
    list,
  );
  return res.changes;
}

export async function setHomeAirports(db: DB, user: AuthUser, codes: unknown, now = Date.now()): Promise<string[]> {
  if (!Array.isArray(codes)) throw new ValidationError('homeAirports must be a list');
  const clean = [...new Set(codes.map((c) => String(c).trim().toUpperCase()))];
  for (const c of clean) if (!AIRPORT_BY_CODE.get(c)?.hub) throw new ValidationError(`${c} isn't one of the airports we scan from`);
  if (clean.length > 10) throw new ValidationError('Pick up to 10 home airports');
  await db.run('UPDATE profiles SET home_airports = ?, updated_at = ? WHERE user_id = ?', JSON.stringify(clean), now, user.id);
  return clean;
}

export async function userAlerts(db: DB, user: AuthUser): Promise<Alert[]> {
  const rows = await db.all('SELECT * FROM alerts WHERE user_id = ? ORDER BY created_at DESC', user.id);
  return rows.map((r) => rowToAlert(r as never));
}

export async function saveDeal(db: DB, user: AuthUser, slug: string, now = Date.now()): Promise<boolean> {
  const deal = await db.get<{ id: number }>('SELECT id FROM deals WHERE slug = ?', slug.toLowerCase());
  if (!deal) return false;
  await db.run('INSERT INTO saved_deals (user_id, deal_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', user.id, deal.id, now);
  return true;
}

export async function unsaveDeal(db: DB, user: AuthUser, slug: string): Promise<void> {
  await db.run('DELETE FROM saved_deals WHERE user_id = ? AND deal_id = (SELECT id FROM deals WHERE slug = ?)', user.id, slug.toLowerCase());
}

/** Saved deals, newest first. Expired ones stay listed (marked by their status). */
export async function savedDeals(db: DB, user: AuthUser): Promise<(DealRow & { saved_at: number })[]> {
  return (await db.all(
    `SELECT d.*, s.created_at AS saved_at FROM saved_deals s JOIN deals d ON d.id = s.deal_id
     WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 200`,
    user.id,
  )) as (DealRow & { saved_at: number })[];
}

/** Remove everything Whimsy stores for a user (the auth user is deleted separately). */
export async function deleteAccountData(db: DB, user: AuthUser): Promise<{ alerts: number }> {
  return db.tx(async (t) => {
    const alerts = await t.run('DELETE FROM alerts WHERE user_id = ?', user.id); // cascades matches, deliveries, push subs
    await t.run('DELETE FROM saved_deals WHERE user_id = ?', user.id);
    await t.run('DELETE FROM profiles WHERE user_id = ?', user.id);
    return { alerts: alerts.changes };
  });
}
