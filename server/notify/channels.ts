import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import nodemailer, { type Transporter } from 'nodemailer';
import webpush from 'web-push';
import { config } from '../config.js';
import { kvGet, type DB } from '../db.js';
import type { DealRow } from '../deals.js';
import { TIER_LABEL, cityOf, dateRange, dealHeadline, dealLine, money, pct } from '../format.js';

export interface Message {
  title: string;
  body: string;
  url: string;
  /** One representative (cheapest) deal per route. */
  deals: DealRow[];
  /** Other qualifying dates on the same route, keyed by the representative's id. */
  moreDates?: Record<number, DealRow[]>;
}

/** Group deals by route: cheapest fare represents the route, the rest are "more dates". */
export function groupByRoute(deals: DealRow[]): { reps: DealRow[]; moreDates: Record<number, DealRow[]> } {
  const groups = new Map<string, DealRow[]>();
  for (const d of deals) {
    const k = `${d.origin}-${d.destination}`;
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  const reps: DealRow[] = [];
  const moreDates: Record<number, DealRow[]> = {};
  for (const g of groups.values()) {
    const sorted = [...g].sort((a, b) => a.price - b.price || b.score - a.score);
    reps.push(sorted[0]);
    if (sorted.length > 1) moreDates[sorted[0].id] = sorted.slice(1);
  }
  return { reps, moreDates };
}

const moreLine = (msg: Pick<Message, 'moreDates'>, d: DealRow) => {
  const more = msg.moreDates?.[d.id];
  return more?.length ? `+${more.length} more date${more.length > 1 ? 's' : ''} from ${money(Math.min(...more.map((m) => m.price)))}` : '';
};

const dealUrl = (d: DealRow) => `${config.publicUrl}/deal/${d.slug}`;

export function buildMessage(deals: DealRow[], manageUrl: string): Message & { manageUrl: string } {
  const { reps, moreDates } = groupByRoute(deals);
  const top = reps.sort((a, b) => b.score - a.score);
  if (top.length === 0) {
    return { title: 'Whimsy', body: '', url: `${config.publicUrl}/`, deals: top, moreDates, manageUrl };
  }
  const base = { deals: top, moreDates, manageUrl };
  if (top.length === 1) {
    const d = top[0];
    const more = moreLine(base, d);
    return { ...base, title: `✈ ${dealHeadline(d)}`, body: more ? `${dealLine(d)} · ${more}` : dealLine(d), url: dealUrl(d) };
  }
  return {
    ...base,
    title: `✈ ${top.length} new flight deals — from ${money(Math.min(...top.map((d) => d.price)))}`,
    body: top
      .slice(0, 5)
      .map((d) => `${cityOf(d.origin)} → ${cityOf(d.destination)} ${money(d.price)} (−${pct(d.discount)})`)
      .join('\n'),
    url: `${config.publicUrl}/`,
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
        ${moreLine(msg, d) ? `<div style="font-size:13px;color:#888;margin-top:2px">${esc(moreLine(msg, d))}</div>` : ''}
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
    .map((d) => `${dealHeadline(d)}\n${dealLine(d)}${moreLine(msg, d) ? ` · ${moreLine(msg, d)}` : ''}\n${dealUrl(d)}\n`)
    .join('\n')}\nManage this alert: ${msg.manageUrl}`;
  return { html, text };
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Makes retries safe: AgentMail drops a second send with the same key. */
  idempotencyKey?: string;
}

async function sendViaAgentMail(mail: OutgoingEmail): Promise<void> {
  // A stable idempotency key makes the single retry below safe: AgentMail drops duplicates.
  const key = mail.idempotencyKey ?? crypto.randomUUID();
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(config.agentmailInbox)}/messages/send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.agentmailApiKey}`, 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify({ to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html, labels: ['whimsy'] }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) return;
      lastErr = new Error(`AgentMail HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      if (res.status < 500 && res.status !== 429) throw lastErr; // client error: retrying won't help
    } catch (err) {
      lastErr = err as Error;
      if (/AgentMail HTTP 4(?!29)/.test(lastErr.message)) throw lastErr;
    }
  }
  throw lastErr!;
}

/** Send through AgentMail, else SMTP, else (dev) park it in the outbox table. */
export async function deliverEmail(db: DB, mail: OutgoingEmail): Promise<void> {
  if (config.agentmailApiKey) return sendViaAgentMail(mail);
  const t = getTransport();
  if (t) {
    await t.sendMail({ from: config.emailFrom, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text });
    return;
  }
  await db.run(
    'INSERT INTO outbox (recipient, subject, html, text, created_at) VALUES (?, ?, ?, ?, ?)',
    mail.to,
    mail.subject,
    mail.html,
    mail.text,
    Date.now(),
  );
}

/** "Confirm your email" — the only email an unconfirmed address ever receives. */
export function renderConfirmEmail(opts: { confirmUrl: string; manageUrl: string; alertName: string | null }): { subject: string; html: string; text: string } {
  const subject = 'Confirm your email for Whimsy flight deals';
  const html = `<!doctype html><html><body style="margin:0;background:#f5f3f0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:18px;overflow:hidden">
    <tr><td style="background:linear-gradient(#132250,#8b7398 60%,#f6b877);padding:28px 28px 22px;color:#fff">
      <div style="font-size:14px;opacity:.8">Whimsy</div>
      <div style="font-size:24px;margin-top:6px">One click and you’re on the list</div></td></tr>
    <tr><td style="padding:24px 28px;font-size:15px;color:#333;line-height:1.55">
      Someone (hopefully you) asked Whimsy to email this address when cheap flights show up${opts.alertName ? ` for <b>${esc(opts.alertName)}</b>` : ''}.
      Confirm and we’ll start sending deals.
      <div style="margin:22px 0"><a href="${esc(opts.confirmUrl)}" style="display:inline-block;background:#3154d3;color:#fff;text-decoration:none;padding:12px 22px;border-radius:24px;font-weight:600">Confirm my email</a></div>
      Didn’t sign up? Ignore this email and you won’t hear from us again.</td></tr>
    <tr><td style="padding:0 28px 26px;font-size:12px;color:#888"><a href="${esc(opts.manageUrl)}" style="color:#888">Manage or delete this alert</a></td></tr>
  </table></td></tr></table></body></html>`;
  const text = `Confirm your email for Whimsy flight deals

Someone (hopefully you) asked Whimsy to email this address when cheap flights show up${opts.alertName ? ` for "${opts.alertName}"` : ''}.

Confirm: ${opts.confirmUrl}

Didn't sign up? Ignore this email and you won't hear from us again.
Manage or delete this alert: ${opts.manageUrl}`;
  return { subject, html, text };
}

/** Sign-in code. The link carries the code in the URL hash so it never reaches a server log. */
export function renderSignInEmail(opts: { code: string; link: string }): { subject: string; html: string; text: string } {
  const pretty = opts.code.length === 8 ? `${opts.code.slice(0, 4)} ${opts.code.slice(4)}` : opts.code;
  const subject = `${pretty} is your Whimsy sign-in code`;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f3f0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
  <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:18px;overflow:hidden">
    <tr><td style="background:linear-gradient(#132250,#8b7398 60%,#f6b877);padding:28px;color:#fff">
      <div style="font-size:14px;opacity:.8">Whimsy</div><div style="font-size:24px;margin-top:6px">Your sign-in code</div></td></tr>
    <tr><td style="padding:26px 28px;font-size:15px;color:#333;line-height:1.55">
      <div style="font-size:34px;letter-spacing:.18em;font-weight:600;color:#0b0d17;margin:4px 0 18px">${esc(pretty)}</div>
      Enter it on Whimsy, or tap below to sign in on this device.
      <div style="margin:22px 0"><a href="${esc(opts.link)}" style="display:inline-block;background:#3154d3;color:#fff;text-decoration:none;padding:12px 22px;border-radius:24px;font-weight:600">Sign in to Whimsy</a></div>
      <span style="color:#888;font-size:13px">The code expires in an hour. If you didn’t ask for it, ignore this email — nobody can sign in without it.</span></td></tr>
  </table></td></tr></table></body></html>`;
  const text = `Your Whimsy sign-in code: ${pretty}\n\nOr sign in with this link: ${opts.link}\n\nThe code expires in an hour. If you didn't ask for it, ignore this email.`;
  return { subject, html, text };
}

export function renderRecoveryEmail(alerts: { name: string | null; url: string }[]): { subject: string; html: string; text: string } {
  const subject = 'Your Whimsy alert links';
  const items = alerts
    .map((a) => `<li style="margin:8px 0"><a href="${esc(a.url)}" style="color:#3154d3">${esc(a.name ?? 'Deal alert')}</a></li>`)
    .join('');
  const html = `<!doctype html><html><body style="margin:0;background:#f5f3f0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:18px;overflow:hidden">
    <tr><td style="background:linear-gradient(#132250,#8b7398 60%,#f6b877);padding:28px;color:#fff;font-size:22px">Your Whimsy alerts</td></tr>
    <tr><td style="padding:20px 28px 28px;font-size:15px;color:#333;line-height:1.5">Here are the private links to manage each alert on this address:
      <ul style="padding-left:18px">${items}</ul>
      Anyone with a link can edit that alert, so keep them to yourself.</td></tr>
  </table></td></tr></table></body></html>`;
  const text = `Your Whimsy alerts\n\n${alerts.map((a) => `${a.name ?? 'Deal alert'}: ${a.url}`).join('\n')}\n\nAnyone with a link can edit that alert, so keep them to yourself.`;
  return { subject, html, text };
}

export async function sendEmail(db: DB, to: string, msg: Message & { manageUrl: string }, idempotencyKey?: string): Promise<void> {
  const { html, text } = renderEmail(msg);
  await deliverEmail(db, { to, subject: msg.title.replace(/^✈\s*/, ''), html, text, idempotencyKey });
}

// ── web push ───────────────────────────────────────────────────────────────
export async function vapidKeys(db: DB): Promise<{ publicKey: string; privateKey: string }> {
  if (config.vapidPublicKey && config.vapidPrivateKey) return { publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey };
  const stored = await kvGet(db, 'vapid');
  if (stored) return JSON.parse(stored);
  // First boot: generate once. ON CONFLICT keeps whichever process won the race.
  await db.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING', 'vapid', JSON.stringify(webpush.generateVAPIDKeys()));
  return JSON.parse((await kvGet(db, 'vapid'))!);
}

export async function sendPush(db: DB, alertId: number, msg: Message): Promise<{ sent: number; failed: number }> {
  const keys = await vapidKeys(db);
  const subs = (await db.all('SELECT id, subscription FROM push_subscriptions WHERE alert_id = ?', alertId)) as {
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
      if (code === 404 || code === 410) (await db.run('DELETE FROM push_subscriptions WHERE id = ?', s.id));
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
    otherDates: (msg.moreDates?.[d.id] ?? []).map((m) => ({ depart: m.depart_date, return: m.return_date, price: m.price, url: dealUrl(m) })),
  }));
  const host = new URL(url).hostname;
  if (host.endsWith('discord.com') || host.endsWith('discordapp.com')) {
    return {
      username: 'Whimsy',
      content: msg.title,
      embeds: msg.deals.slice(0, 10).map((d) => ({
        title: dealHeadline(d),
        description: [dealLine(d), moreLine(msg, d)].filter(Boolean).join(' · '),
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
          text: { type: 'mrkdwn', text: `*<${dealUrl(d)}|${dealHeadline(d)}>*\n${[dealLine(d), moreLine(msg, d)].filter(Boolean).join(' · ')}` },
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
