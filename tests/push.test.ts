import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAlert } from '../server/alerts.js';
import { recordResult } from '../server/deals.js';
import { buildMessage, sendPush, vapidKeys } from '../server/notify/channels.js';
import { addRoute, fare, memDb } from './helpers.js';

let server: https.Server;
let port = 0;
const hits: { headers: http.IncomingHttpHeaders; bytes: number; url: string }[] = [];

beforeAll(async () => {
  // web-push only speaks https: stand up a throwaway self-signed push service.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whimsy-push-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
    '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem')], { stdio: 'ignore' });
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const tls = { key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) };
  server = https.createServer(tls, (req, res) => {
    let bytes = 0;
    req.on('data', (c) => (bytes += c.length));
    req.on('end', () => {
      hits.push({ headers: req.headers, bytes, url: req.url! });
      res.writeHead(req.url === '/gone' ? 410 : 201).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as any).port;
});
afterAll(() => {
  server.close();
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
});

function fakeSubscription(p: string) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `https://127.0.0.1:${port}${p}`,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') },
  };
}

describe('web push', () => {
  it('persists VAPID keys once', async () => {
    const db = await memDb();
    expect(await vapidKeys(db)).toEqual(await vapidKeys(db));
  });

  it('sends an encrypted, VAPID-signed push and prunes dead subscriptions', async () => {
    const db = await memDb();
    const alert = await createAlert(db, { channels: { push: true } });
    for (const p of ['/ok', '/gone']) {
      const sub = fakeSubscription(p);
      await db.run('INSERT INTO push_subscriptions (alert_id, endpoint, subscription, created_at) VALUES (?, ?, ?, ?)', alert.id, sub.endpoint, JSON.stringify(sub), Date.now());
    }
    const deal = (await recordResult(db, await addRoute(db), fare({ price: 400 })))!.deal;
    const r = await sendPush(db, alert.id, buildMessage([deal], 'https://x/alerts/t'));
    expect(r).toEqual({ sent: 1, failed: 1 });
    const ok = hits.find((h) => h.url === '/ok')!;
    expect(ok.headers['content-encoding']).toBe('aes128gcm');
    expect(ok.headers.authorization).toMatch(/^vapid t=/);
    expect(ok.bytes).toBeGreaterThan(100);
    const left = (await db.all('SELECT endpoint FROM push_subscriptions')) as { endpoint: string }[];
    expect(left.map((x) => x.endpoint)).toEqual([`https://127.0.0.1:${port}/ok`]);
  });
});
