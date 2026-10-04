import { config } from '../config.js';
import type { DB } from '../db.js';
import { rowToAlert, type Alert } from '../alerts.js';
import type { DealRow } from '../deals.js';
import { buildMessage, sendEmail, sendNtfy, sendPush, sendWebhook } from './channels.js';

export const manageUrl = (a: Pick<Alert, 'token'>) => `${config.publicUrl}/alerts/${a.token}`;

type Channel = 'email' | 'push' | 'ntfy' | 'webhook';

export interface FlushReport {
  alerts: number;
  deals: number;
  results: { alertId: number; channel: Channel; ok: boolean; error?: string }[];
}

/**
 * Send everything queued in alert_matches. Batching per alert means a burst of
 * deals becomes one digest instead of a notification storm.
 */
export async function flushNotifications(db: DB, now = Date.now()): Promise<FlushReport> {
  const pending = (await db.all(`SELECT m.id AS match_id, m.alert_id, d.* FROM alert_matches m JOIN deals d ON d.id = m.deal_id
       WHERE m.sent_at IS NULL ORDER BY m.alert_id, d.score DESC`)) as unknown as (DealRow & { match_id: number; alert_id: number })[];

  const byAlert = new Map<number, (DealRow & { match_id: number })[]>();
  for (const row of pending) {
    const list = byAlert.get(row.alert_id) ?? [];
    list.push(row);
    byAlert.set(row.alert_id, list);
  }

  const report: FlushReport = { alerts: 0, deals: 0, results: [] };
  const markSent = (id: number) => db.run('UPDATE alert_matches SET sent_at = ? WHERE id = ?', now, id);

  for (const [alertId, rows] of byAlert) {
    const alertRow = (await db.get('SELECT * FROM alerts WHERE id = ?', alertId)) as any;
    if (!alertRow) continue;
    const alert = rowToAlert(alertRow);
    if (alert.frequency === 'daily' && alert.lastNotifiedAt && now - alert.lastNotifiedAt < 24 * 3600_000) continue;

    // Drop deals that died while waiting in the queue.
    const live = rows.filter((r) => r.status === 'active');
    for (const r of rows) if (r.status !== 'active') await markSent(r.match_id);
    if (!live.length || alert.paused) {
      for (const r of live) await markSent(r.match_id);
      continue;
    }
    // Same deal can be queued twice (price dropped again): keep one.
    const deals = [...new Map(live.map((r) => [r.id, r])).values()];
    const msg = buildMessage(deals, manageUrl(alert));

    const jobs: [Channel, () => Promise<unknown>][] = [];
    // Unconfirmed addresses never get deal emails.
    if (alert.channels.email && alert.email && alert.emailVerified) {
      const key = `deals-${alert.id}-${deals.map((d) => `${d.id}:${d.price}`).join(',')}`;
      jobs.push(['email', () => sendEmail(db, alert.email!, msg, key)]);
    }
    if (alert.channels.push) jobs.push(['push', () => sendPush(db, alert.id, msg)]);
    if (alert.channels.ntfy) jobs.push(['ntfy', () => sendNtfy(alert.channels.ntfy!, msg)]);
    if (alert.channels.webhook) jobs.push(['webhook', () => sendWebhook(alert.channels.webhook!, msg)]);

    const insert = (channel: Channel, ok: number, error: string | null) =>
      db.run('INSERT INTO deliveries (alert_id, channel, deal_count, ok, error, created_at) VALUES (?, ?, ?, ?, ?, ?)', alert.id, channel, deals.length, ok, error, now);
    for (const [channel, fn] of jobs) {
      try {
        await fn();
        await insert(channel, 1, null);
        report.results.push({ alertId, channel, ok: true });
      } catch (err) {
        const error = (err as Error).message.slice(0, 300);
        await insert(channel, 0, error);
        report.results.push({ alertId, channel, ok: false, error });
      }
    }
    for (const r of live) await markSent(r.match_id);
    (await db.run('UPDATE alerts SET last_notified_at = ? WHERE id = ?', now, alert.id));
    report.alerts++;
    report.deals += deals.length;
  }
  return report;
}
