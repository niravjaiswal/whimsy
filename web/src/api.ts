import { useEffect, useRef, useState } from 'react';

export type Tier = 'good' | 'great' | 'incredible';
export type Region = 'north-america' | 'caribbean' | 'latin-america' | 'europe' | 'asia' | 'oceania' | 'middle-east' | 'africa';

export interface Airport {
  code: string;
  city: string;
  country: string;
  region: Region;
  lat: number;
  lon: number;
  hub?: boolean;
  vibe?: string;
  image: string | null;
}

export interface Place {
  code: string;
  city: string;
  country: string;
  region: Region | null;
  lat: number | null;
  lon: number | null;
  vibe: string | null;
  image: string | null;
  thumb: string | null;
  imageHd: boolean;
  imageCredit: string | null;
}

export interface Deal {
  id: number;
  slug: string;
  origin: Place;
  destination: Place;
  distance: number | null;
  departDate: string;
  returnDate: string | null;
  nights: number | null;
  price: number;
  firstPrice: number;
  baseline: number;
  typicalLow: number | null;
  typicalHigh: number | null;
  discount: number;
  tier: Tier;
  score: number;
  airline: string | null;
  airlineCode: string | null;
  stops: number | null;
  durationMinutes: number | null;
  departTime: string | null;
  arriveTime: string | null;
  via: string[];
  history: [number, number][];
  bookingUrl: string;
  status: 'active' | 'expired';
  foundAt: number;
  updatedAt: number;
  verifiedAt: number;
}

export interface Dip {
  origin: { code: string; city: string };
  destination: { code: string; city: string; image: string | null };
  departDate: string;
  returnDate: string | null;
  price: number;
  typical: number;
  discount: number;
  observedAt: number;
  bookingUrl: string;
}

export interface ScanEvent {
  routeId: number;
  origin: string;
  destination: string;
  departDate: string;
  returnDate?: string;
  ok: boolean;
  price: number | null;
  typical: number | null;
  error?: string;
  durationMs: number;
  at: number;
  kind: 'sample' | 'verify' | 'probe';
}

export interface Stats {
  now: number;
  scanner: { running: boolean; inFlight?: number; pausedUntil?: number | null; rpm?: number; provider?: string };
  routes: number;
  covered24h: number;
  scansLastHour: number;
  successRateLastHour: number | null;
  scans24h: number;
  totalScans: number;
  activeDeals: number;
  dealsToday: number;
  alerts: number;
  bestDiscount: number | null;
  recent: {
    origin: string;
    destination: string;
    depart_date: string;
    return_date: string | null;
    ok: number;
    price: number | null;
    error: string | null;
    duration_ms: number;
    created_at: number;
    last_typical: number | null;
  }[];
}

export interface AlertChannels {
  email?: boolean;
  push?: boolean;
  ntfy?: string;
  webhook?: string;
}

export interface Alert {
  token: string;
  name: string | null;
  email: string | null;
  origins: string[];
  regions: Region[];
  destinations: string[];
  maxPrice: number | null;
  minTier: Tier;
  months: string[];
  departFrom: string | null;
  departTo: string | null;
  minNights: number | null;
  maxNights: number | null;
  channels: AlertChannels;
  frequency: 'instant' | 'daily';
  paused: boolean;
  createdAt: number;
  lastNotifiedAt: number | null;
  manageUrl: string;
}

export interface Meta {
  airports: Airport[];
  regions: { id: Region; label: string }[];
  vapidPublicKey: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { ...(init?.json !== undefined ? { 'content-type': 'application/json' } : {}), ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

/** Fetch-on-mount hook with refetch. */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    api<T>(path)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => !cancelled && setError(e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);
  return { data, error, loading, refetch: () => setNonce((n) => n + 1), setData };
}

let metaPromise: Promise<Meta> | null = null;
export function loadMeta() {
  metaPromise ??= api<Meta>('/meta');
  return metaPromise;
}
export function useMeta() {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    loadMeta().then(setMeta).catch(() => (metaPromise = null));
  }, []);
  return meta;
}

type StreamHandlers = {
  scan?: (e: ScanEvent) => void;
  deal?: (e: { kind: 'new' | 'dropped' | 'refreshed' | 'expired'; deal: Deal }) => void;
  stats?: (s: Stats) => void;
};

/** Subscribe to the live SSE feed from the scanner. */
export function useLiveStream(handlers: StreamHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener('scan', (e) => ref.current.scan?.(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('deal', (e) => ref.current.deal?.(JSON.parse((e as MessageEvent).data)));
    const onStats = (e: Event) => ref.current.stats?.(JSON.parse((e as MessageEvent).data));
    es.addEventListener('hello', onStats);
    es.addEventListener('stats', onStats);
    return () => es.close();
  }, []);
  return connected;
}

// ── "my alerts" are remembered locally by token ─────────────────────────────
const MY_ALERTS = 'whimsy:alerts';
export function rememberedAlerts(): { token: string; name: string; createdAt: number }[] {
  try {
    return JSON.parse(localStorage.getItem(MY_ALERTS) ?? '[]');
  } catch {
    return [];
  }
}
export function rememberAlert(a: { token: string; name: string }) {
  try {
    const list = rememberedAlerts().filter((x) => x.token !== a.token);
    list.unshift({ ...a, createdAt: Date.now() });
    localStorage.setItem(MY_ALERTS, JSON.stringify(list.slice(0, 20)));
  } catch {}
}
export function forgetAlert(token: string) {
  try {
    localStorage.setItem(MY_ALERTS, JSON.stringify(rememberedAlerts().filter((x) => x.token !== token)));
  } catch {}
}

// ── web push ────────────────────────────────────────────────────────────────
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Ask permission and return a push subscription (JSON) or throw with a human message. */
export async function subscribePush(vapidPublicKey: string): Promise<PushSubscriptionJSON> {
  if (!pushSupported()) throw new Error('This browser does not support push notifications');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked for this site');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }));
  return sub.toJSON();
}
