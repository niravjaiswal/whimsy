import { GoTrueClient as AuthClient, type Session } from '@supabase/auth-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, loadMeta, rememberedAlerts, setAccessToken, type Alert, type Deal } from './api';

/*
 * Optional accounts (see .claude/docs/adr-002-accounts.md). Supabase's auth client
 * handles the session (persisted, auto-refreshed); everything else goes through
 * the Whimsy API with the access token attached.
 */

export interface Me {
  user: { id: string; email: string };
  profile: { email: string; homeAirports: string[]; createdAt: number };
  alerts: Alert[];
  saved: (Deal & { savedAt: number })[];
}

interface AccountState {
  /** Accounts are available on this server. */
  enabled: boolean;
  /** Initial session check finished. */
  ready: boolean;
  session: Session | null;
  me: Me | null;
  refresh: () => Promise<void>;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  isSaved: (slug: string) => boolean;
  toggleSaved: (slug: string) => Promise<void>;
  setHomeAirports: (codes: string[]) => Promise<void>;
}

const AccountContext = createContext<AccountState | null>(null);

export function useAccount(): AccountState {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount outside AccountProvider');
  return ctx;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<AuthClient | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const claimedFor = useRef<string | null>(null);

  // Boot: the API tells us whether accounts exist and how to reach Supabase.
  useEffect(() => {
    let unsub: (() => void) | undefined;
    loadMeta()
      .then(async (meta) => {
        if (!meta.auth) return setReady(true);
        const c = new AuthClient({
          url: `${meta.auth.url}/auth/v1`,
          headers: { apikey: meta.auth.publishableKey },
          storageKey: 'whimsy-auth',
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        });
        setClient(c);
        setEnabled(true);
        const { data } = c.onAuthStateChange((_event, s) => {
          setAccessToken(s?.access_token ?? null);
          setSession(s);
        });
        unsub = () => data.subscription.unsubscribe();
        const { data: initial } = await c.getSession();
        setAccessToken(initial.session?.access_token ?? null);
        setSession(initial.session);
        setReady(true);
      })
      .catch(() => setReady(true));
    return () => unsub?.();
  }, []);

  const refresh = useCallback(async () => {
    if (!session) return setMe(null);
    try {
      setMe(await api<Me>('/me'));
    } catch {
      setMe(null);
    }
  }, [session]);

  // On sign-in: adopt the alerts this browser created anonymously, then load the account.
  useEffect(() => {
    if (!session) {
      setMe(null);
      claimedFor.current = null;
      return;
    }
    (async () => {
      if (claimedFor.current !== session.user.id) {
        claimedFor.current = session.user.id;
        const tokens = rememberedAlerts().map((a) => a.token);
        if (tokens.length) await api('/me/claim', { method: 'POST', json: { tokens } }).catch(() => {});
      }
      await refresh();
    })();
  }, [session, refresh]);

  const value = useMemo<AccountState>(
    () => ({
      enabled,
      ready,
      session,
      me,
      refresh,
      sendCode: async (email) => {
        await api('/auth/code', { method: 'POST', json: { email } });
      },
      verifyCode: async (email, code) => {
        if (!client) throw new Error('Accounts are unavailable');
        const { error } = await client.verifyOtp({ email, token: code.replace(/\D/g, ''), type: 'email' });
        if (error) throw new Error(/expired|invalid/i.test(error.message) ? 'That code is wrong or expired — request a new one' : error.message);
      },
      signOut: async () => {
        await client?.signOut({ scope: 'local' });
        setMe(null);
      },
      deleteAccount: async () => {
        await api('/me', { method: 'DELETE' });
        await client?.signOut({ scope: 'local' });
        setMe(null);
      },
      isSaved: (slug) => !!me?.saved.some((d) => d.slug === slug),
      toggleSaved: async (slug) => {
        if (!me) return;
        const saved = me.saved.some((d) => d.slug === slug);
        // Optimistic: flip locally, then reconcile with the server.
        setMe({ ...me, saved: saved ? me.saved.filter((d) => d.slug !== slug) : me.saved });
        await api(`/me/saved/${slug}`, { method: saved ? 'DELETE' : 'PUT' });
        await refresh();
      },
      setHomeAirports: async (codes) => {
        if (me) setMe({ ...me, profile: { ...me.profile, homeAirports: codes } });
        await api('/me', { method: 'PATCH', json: { homeAirports: codes } });
      },
    }),
    [enabled, ready, session, me, refresh, client],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
