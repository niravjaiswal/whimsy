import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from './config.js';

/*
 * Optional accounts on Supabase Auth (see .claude/docs/adr-002-accounts.md).
 *
 * We never let Supabase send email: the admin API mints a one-time code (and
 * creates the user on first sign-in), and Whimsy emails it through AgentMail.
 * Access tokens are verified locally against the project's JWKS.
 */

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthService {
  readonly enabled: boolean;
  /** What the browser needs to run the Supabase auth client (public values). */
  publicConfig(): { url: string; publishableKey: string } | null;
  /** Create the user if needed and return a one-time sign-in code. Sends nothing. */
  issueCode(email: string): Promise<{ code: string }>;
  verifyAccessToken(token: string): Promise<AuthUser | null>;
  deleteUser(id: string): Promise<void>;
}

export class AuthUnavailableError extends Error {}

export class DisabledAuth implements AuthService {
  readonly enabled = false;
  publicConfig() {
    return null;
  }
  async issueCode(): Promise<{ code: string }> {
    throw new AuthUnavailableError('Accounts are not enabled on this server');
  }
  async verifyAccessToken() {
    return null;
  }
  async deleteUser() {}
}

export class SupabaseAuth implements AuthService {
  readonly enabled = true;
  private readonly jwks;
  private readonly issuer: string;

  constructor(
    private readonly url: string,
    private readonly publishableKey: string,
    private readonly serviceKey: string,
  ) {
    this.issuer = `${url}/auth/v1`;
    this.jwks = createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`), { cooldownDuration: 60_000 });
  }

  publicConfig() {
    return { url: this.url, publishableKey: this.publishableKey };
  }

  private async admin(path: string, init: RequestInit): Promise<Response> {
    return fetch(`${this.url}/auth/v1/admin${path}`, {
      ...init,
      headers: { apikey: this.serviceKey, authorization: `Bearer ${this.serviceKey}`, 'content-type': 'application/json', ...init.headers },
      signal: AbortSignal.timeout(15_000),
    });
  }

  async issueCode(email: string): Promise<{ code: string }> {
    // "magiclink" creates the user on first use and returns an email OTP without mailing it.
    const res = await this.admin('/generate_link', { method: 'POST', body: JSON.stringify({ type: 'magiclink', email }) });
    const body = (await res.json().catch(() => ({}))) as { email_otp?: string; properties?: { email_otp?: string }; msg?: string; message?: string };
    const code = body.email_otp ?? body.properties?.email_otp;
    if (!res.ok || !code) throw new Error(`Supabase generate_link failed (${res.status}): ${body.msg ?? body.message ?? 'no code'}`);
    return { code };
  }

  async verifyAccessToken(token: string): Promise<AuthUser | null> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, { issuer: this.issuer, audience: 'authenticated' });
      if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null;
      return { id: payload.sub, email: payload.email.toLowerCase() };
    } catch {
      return null;
    }
  }

  async deleteUser(id: string): Promise<void> {
    const res = await this.admin(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`Supabase delete user failed (${res.status})`);
  }
}

export function authFromConfig(): AuthService {
  const { supabaseUrl, supabasePublishableKey, supabaseServiceKey } = config;
  if (supabaseUrl && supabasePublishableKey && supabaseServiceKey) {
    return new SupabaseAuth(supabaseUrl.replace(/\/$/, ''), supabasePublishableKey, supabaseServiceKey);
  }
  return new DisabledAuth();
}
