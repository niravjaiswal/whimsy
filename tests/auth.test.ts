import http from 'node:http';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseAuth } from '../server/auth.js';

// A stand-in for Supabase's JWKS endpoint, so verification runs the real code path.
let server: http.Server;
let base = '';
let sign: (claims: Record<string, unknown>, opts?: { issuer?: string; exp?: string; key?: CryptoKey }) => Promise<string>;
let otherKey: CryptoKey;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  otherKey = (await generateKeyPair('ES256')).privateKey as CryptoKey;
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
  server = http.createServer((req, res) => {
    if (req.url === '/auth/v1/.well-known/jwks.json') res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
    else res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  sign = (claims, opts = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setIssuer(opts.issuer ?? `${base}/auth/v1`)
      .setAudience('authenticated')
      .setExpirationTime(opts.exp ?? '1h')
      .sign(opts.key ?? (privateKey as CryptoKey));
});
afterAll(() => server.close());

describe('SupabaseAuth.verifyAccessToken', () => {
  const user = { sub: '11111111-1111-4111-8111-111111111111', email: 'Alice@Example.com' };

  it('accepts a valid token and normalizes the email', async () => {
    const auth = new SupabaseAuth(base, 'pub', 'svc');
    expect(await auth.verifyAccessToken(await sign(user))).toEqual({ id: user.sub, email: 'alice@example.com' });
  });

  it('rejects tampered, expired, foreign-issuer and wrong-key tokens', async () => {
    const auth = new SupabaseAuth(base, 'pub', 'svc');
    const good = await sign(user);
    const [h, p, sig] = good.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), email: 'mallory@example.com' })).toString('base64url');
    expect(await auth.verifyAccessToken(`${h}.${forgedPayload}.${sig}`)).toBeNull();
    expect(await auth.verifyAccessToken(await sign(user, { exp: '-1m' }))).toBeNull();
    expect(await auth.verifyAccessToken(await sign(user, { issuer: 'https://evil.example/auth/v1' }))).toBeNull();
    expect(await auth.verifyAccessToken(await sign(user, { key: otherKey }))).toBeNull();
    expect(await auth.verifyAccessToken('not-a-jwt')).toBeNull();
    expect(await auth.verifyAccessToken(await sign({ sub: user.sub }))).toBeNull(); // no email
  });
});
