# ADR 002 — Optional accounts (Supabase Auth)

Date: 2026-10-02 · Status: accepted, implemented

## Product decision

Whimsy's core promise is "set an alert in 30 seconds, no signup". That stays: anonymous
alerts with a private manage link keep working exactly as before. Accounts are an
**optional upgrade** that removes v1's real pain points:

| v1 pain | With an account |
|---|---|
| Alerts live in one browser's localStorage + manage links people lose | All your alerts, every device |
| Every alert's email needs its own confirmation click | Your account email is already proven; alerts using it are confirmed instantly |
| No way to keep an interesting deal | Save deals (heart) and find them on your account page |
| Re-pick "From" every visit | Home airports become the default origin filter |
| Deleting your data means hunting down every link | One "delete account" removes the account, alerts and saved deals |

Explicitly not doing: passwords (one more thing to leak and reset; travellers sign in rarely),
social login (needs OAuth app setup outside this repo; easy to add later in Supabase), paywalls.

## Engineering decisions

- **Passwordless email codes, sent by us.** The backend calls Supabase's admin
  `generate_link` (creates the user on first sign-in, returns an 8-digit OTP without sending
  anything) and emails the code itself through AgentMail. Reasons: Supabase's built-in mailer
  is capped at a few emails/hour, and the email matches Whimsy's other mail. The email also
  carries a one-tap link to `/signin#email=…&code=…` (hash, so the code never hits server logs).
- **Session handling in the browser** with `@supabase/auth-js` (just the auth client, not all of
  supabase-js): `verifyOtp` → session persisted in localStorage, auto-refresh.
- **The API verifies access tokens locally** against the project's JWKS (ES256) with `jose`, no
  network call per request. `/api/meta` hands the frontend the Supabase URL + publishable key at
  runtime, so the Vercel build needs no extra env vars.
- **Data stays in our schema, locked behind the API** (RLS on, no policies, Data API revoked):
  `profiles` (home airports), `saved_deals`, `alerts.user_id`. FKs to `auth.users` with
  `ON DELETE CASCADE` are added only where the `auth` schema exists (Supabase, not PGlite).
- **Claiming:** on sign-in the browser sends the manage tokens it remembers; the server attaches
  any unowned ones. Alerts whose email equals the account email are claimed and marked confirmed
  automatically (owning the inbox was just proven).
- Manage links keep working for owned alerts: the token stays the capability, accounts add a
  second way in.
- Auth is optional per deployment: without `SUPABASE_*` env the UI hides sign-in (tests and local
  dev use a fake auth service).
- Abuse limits on code requests: per IP and per email address.
