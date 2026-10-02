const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export const config = {
  port: num(process.env.PORT, 8787),
  publicUrl: (process.env.PUBLIC_URL ?? `http://localhost:${num(process.env.PORT, 8787)}`).replace(/\/$/, ''),
  /** Set SCANNER=off to run the site without scanning (e.g. a read replica). */
  scannerEnabled: process.env.SCANNER !== 'off',
  scanRpm: num(process.env.SCAN_RPM, 24),
  scanConcurrency: num(process.env.SCAN_CONCURRENCY, 2),
  /** Comma-separated IATA codes to scan from. Defaults to every hub in airports.ts. */
  origins: process.env.ORIGINS?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
  smtpUrl: process.env.SMTP_URL,
  /**
   * Email alerts need a real transport in production (AgentMail or SMTP). Without
   * one, dev keeps emails in the outbox table and production hides the channel.
   */
  emailEnabled: !!(process.env.AGENTMAIL_API_KEY || process.env.SMTP_URL) || process.env.NODE_ENV !== 'production',
  /** AgentMail (https://agentmail.to) API transport; preferred over SMTP when set. */
  agentmailApiKey: process.env.AGENTMAIL_API_KEY,
  agentmailInbox: process.env.AGENTMAIL_INBOX ?? 'whimsy@agentmail.to',
  /** Browser origins allowed to call the API (e.g. the Vercel frontend). */
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
  emailFrom: process.env.EMAIL_FROM ?? 'Whimsy <deals@whimsy.local>',
  ntfyServer: (process.env.NTFY_SERVER ?? 'https://ntfy.sh').replace(/\/$/, ''),
  vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:deals@whimsy.local',
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
  /** Optional accounts (Supabase Auth). All three must be set to enable sign-in. */
  supabaseUrl: process.env.SUPABASE_URL,
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  notifyFlushMs: num(process.env.NOTIFY_FLUSH_MS, 60_000),
  /** Allow webhooks to private/loopback addresses (tests & local dev only). */
  allowPrivateWebhooks: process.env.ALLOW_PRIVATE_WEBHOOKS === '1',
};
