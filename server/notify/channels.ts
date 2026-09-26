import dns from 'node:dns/promises';
import net from 'node:net';
import nodemailer, { type Transporter } from 'nodemailer';
import webpush from 'web-push';
import { config } from '../config.js';
import { kvGet, kvSet, type DB } from '../db.js';
import type { DealRow } from '../deals.js';
import { TIER_LABEL, cityOf, dateRange, dealHeadline, dealLine, money, pct } from '../format.js';

export interface Message {
  title: string;
  body: string;
  url: string;
  deals: DealRow[];
}

const dealUrl = (d: DealRow) => `${config.publicUrl}/deal/${d.slug}`;

export function buildMessage(deals: DealRow[], manageUrl: string): Message & { manageUrl: string } {
  const top = [...deals].sort((a, b) => b.score - a.score);
  if (top.length === 0) {
    return { title: 'Whimsy', body: '', url: `${config.publicUrl}/`, deals: top, manageUrl };
  }
  if (top.length === 1) {
    const d = top[0];
    return {
      title: `✈ ${dealHeadline(d)}`,
      body: dealLine(d),
      url: dealUrl(d),
      deals: top,
      manageUrl,
    };
  }
  return {
    title: `✈ ${top.length} new flight deals — from ${money(Math.min(...top.map((d) => d.price)))}`,
    body: top
      .slice(0, 5)
      .map((d) => `${cityOf(d.origin)} → ${cityOf(d.destination)} ${money(d.price)} (−${pct(d.discount)})`)
      .join('\n'),
    url: `${config.publicUrl}/`,
    deals: top,
    manageUrl,
  };
}

// ── email ──────────────────────────────────────────────────────────────────
let transporter: Transporter | null | undefined;
function getTransport(): Transporter | null {
  if (transporter === undefined) transporter = config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : null;
  return transporter;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function renderEmail(msg: Message & { manageUrl: string }): { html: string; text: string } {
  const rows = msg.deals
    .slice(0, 12)
    .map(
      (d) => `
      <tr><td style="padding:14px 0;border-bottom:1px solid #eee">
        <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#4a6cf7">${TIER_LABEL[d.tier]} · −${pct(d.discount)}</div>
        <div style="font-size:18px;font-weight:600;color:#0b0d17;margin:4px 0">${esc(cityOf(d.origin))} → ${esc(cityOf(d.destination))}
          <span style="float:right">${money(d.price)}</span></div>
        <div style="font-size:14px;color:#555">${esc(dateRange(d.depart_date, d.return_date))} · usually ${money(d.baseline)} · ${esc(d.airline ?? 'Various')}</div>
        <div style="margin-top:8px"><a href="${esc(dealUrl(d))}" style="color:#3154d3">See deal</a> &nbsp;·&nbsp;
          <a href="${esc(d.booking_url)}" style="color:#3154d3">Book on Google Flights</a></div>
      </td></tr>`,
    )
    .join('');
  const html = `<!doctype html><html><body style="margin:0;background:#f5f3f0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:18px;overflow:hidden">
    <tr><td style="background:linear-gradient(#132250,#8b7398 60%,#f6b877);padding:28px 28px 22px;color:#fff">
      <div style="font-size:14px;opacity:.8">Whimsy</div>
      <div style="font-size:24px;margin-top:6px">${esc(msg.title.replace(/^✈\s*/, ''))}</div></td></tr>
    <tr><td style="padding:8px 28px">${
      rows
        ? `<table width="100%">${rows}</table>`
        : '<p style="font-size:15px;color:#444;line-height:1.5;margin:18px 0">We’re scanning thousands of routes around the clock. The moment a fare that matches your alert drops well below normal, you’ll hear from us.</p>'
    }</td></tr>
    <tr><td style="padding:18px 28px 26px;font-size:12px;color:#888">Fares move fast — prices were verified moments before this email.
      <br><a href="${esc(msg.manageUrl)}" style="color:#888">Manage or pause this alert</a></td></tr>
  </table></td></tr></table></body></html>`;
  const text = `${msg.title}\n\n${msg.deals
    .slice(0, 12)
    .map((d) => `${dealHeadline(d)}\n${dealLine(d)}\n${dealUrl(d)}\n`)
    .join('\n')}\nManage this alert: ${msg.manageUrl}`;
  return { html, text };
}

export async function sendEmail(db: DB, to: string, msg: Message & { manageUrl: string }): Promise<void> {
  const { html, text } = renderEmail(msg);
  const subject = msg.title.replace(/^✈\s*/, '');
  const t = getTransport();
  if (!t) {
    // No SMTP configured: keep it in the outbox so it's visible at /api/dev/outbox.
    db.prepare('INSERT INTO outbox (recipient, subject, html, text, created_at) VALUES (?, ?, ?, ?, ?)').run(to, subject, html, text, Date.now());
    return;
  }
  await t.sendMail({ from: config.emailFrom, to, subject, html, text });
}

// ── web push ───────────────────────────────────────────────────────────────
export function vapidKeys(db: DB): { publicKey: string; privateKey: string } {
  if (config.vapidPublicKey && config.vapidPrivateKey) return { publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey };
  const stored = kvGet(db, 'vapid');
  if (stored) return JSON.parse(stored);
  const keys = webpush.generateVAPIDKeys();
  kvSet(db, 'vapid', JSON.stringify(keys));
  return keys;
}

export async function sendPush(db: DB, alertId: number, msg: Message): Promise<{ sent: number; failed: number }> {
  const keys = vapidKeys(db);
  const subs = db.prepare('SELECT id, subscription FROM push_subscriptions WHERE alert_id = ?').all(alertId) as {
    id: number;
    subscription: string;
  }[];
  let sent = 0;
  let failed = 0;
  let lastError = '';
  const payload = JSON.stringify({ title: msg.title.replace(/^✈\s*/, ''), body: msg.body, url: msg.url });
  for (const s of subs) {
    try {
      await webpush.sendNotification(JSON.parse(s.subscription), payload, {
        vapidDetails: { subject: config.vapidSubject, publicKey: keys.publicKey, privateKey: keys.privateKey },
        TTL: 6 * 3600,
      });
      sent++;
    } catch (err) {
      failed++;
      const code = (err as { statusCode?: number }).statusCode;
      lastError = code ? `HTTP ${code}` : (err as Error).message;
      // Subscription is gone (user revoked / browser uninstalled): forget it.
      if (code === 404 || code === 410) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
    }
  }
  if (!subs.length) throw new Error('no push subscriptions registered');
  if (!sent) throw new Error(`push failed for ${failed} subscription(s): ${lastError}`);
  return { sent, failed };
}

// ── ntfy ───────────────────────────────────────────────────────────────────
export async function sendNtfy(topic: string, msg: Message): Promise<void> {
  // Header values must be latin-1; the title goes in the JSON body instead.
  const res = await fetch(config.ntfyServer, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      topic,
      title: msg.title.replace(/^✈\s*/, ''),
      message: msg.body,
      click: msg.url,
      tags: ['airplane'],
      priority: msg.deals.some((d) => d.tier === 'incredible') ? 5 : 4,
      actions: msg.deals.length === 1 ? [{ action: 'view', label: 'Book', url: msg.deals[0].booking_url }] : undefined,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
}

// ── webhooks ───────────────────────────────────────────────────────────────
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.');
}

/** Reject webhooks that resolve to internal addresses (SSRF guard). */
export async function assertPublicUrl(raw: string): Promise<void> {
  if (config.allowPrivateWebhooks) return;
  const u = new URL(raw);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length || addrs.some(isPrivateIp)) throw new Error('webhook host resolves to a private address');
}

export function webhookBody(url: string, msg: Message): unknown {
  const deals = msg.deals.map((d) => ({
    route: `${d.origin}-${d.destination}`,
    from: cityOf(d.origin),
    to: cityOf(d.destination),
    price: d.price,
    typical: d.baseline,
    discount: Math.round(d.discount * 100),
    tier: d.tier,
    depart: d.depart_date,
    return: d.return_date,
    airline: d.airline,
    stops: d.stops,
    url: dealUrl(d),
    book: d.booking_url,
  }));
  const host = new URL(url).hostname;
  if (host.endsWith('discord.com') || host.endsWith('discordapp.com')) {
    return {
      username: 'Whimsy',
      content: msg.title,
      embeds: msg.deals.slice(0, 10).map((d) => ({
        title: dealHeadline(d),
        description: dealLine(d),
        url: dealUrl(d),
        color: d.tier === 'incredible' ? 0xf6b877 : d.tier === 'great' ? 0x416af4 : 0x8b7398,
      })),
    };
  }
  if (host.endsWith('hooks.slack.com')) {
    return {
      text: msg.title,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: msg.title.slice(0, 150) } },
        ...msg.deals.slice(0, 10).map((d) => ({
          type: 'section',
          text: { type: 'mrkdwn', text: `*<${dealUrl(d)}|${dealHeadline(d)}>*\n${dealLine(d)}` },
        })),
      ],
    };
  }
  return { title: msg.title, body: msg.body, url: msg.url, deals };
}

export async function sendWebhook(url: string, msg: Message): Promise<void> {
  await assertPublicUrl(url);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Whimsy-Deals/1.0' },
    body: JSON.stringify(webhookBody(url, msg)),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`webhook HTTP ${res.status}`);
}
