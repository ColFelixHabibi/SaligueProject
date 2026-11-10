'use client';

import { isNativeApp } from './native';

// Talks to Saligue's own server (server/index.mjs). By default it is the same address that serves the app;
// NEXT_PUBLIC_API_URL points a separately hosted site (e.g. GitHub Pages) at the server instead.
const CONFIGURED_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
// Inside the phone app the pages come from the phone itself (https://localhost), where there is no server at all.
// An app built without NEXT_PUBLIC_API_URL therefore sent every request into the void and opened on "Saligue can't
// be reached" even with full signal. There the address baked in at build time (next.config.ts → NEXT_PUBLIC_SITE_URL)
// is the only real one. The website is untouched: its own origin really does serve /api, and a dev server on
// localhost is not the app.
let cachedOrigin: string | null = null;
function apiOrigin() {
  if (cachedOrigin === null) {
    const onDevice = isNativeApp() && /^(https?|capacitor):\/\/localhost(:\d+)?$/.test(window.location.origin);
    cachedOrigin = (CONFIGURED_ORIGIN || (onDevice ? (process.env.NEXT_PUBLIC_SITE_URL ?? '') : '')).replace(/\/+$/, '');
  }
  return cachedOrigin;
}
const TOKEN_KEY = 'saligue-session';

// Every request gives up after this long. A request can stall instead of failing (HTTP/3 packets dropped part-way,
// a proxy that goes quiet) and without a limit the catalogue, the feed and the account screens never filled in: the
// page stayed on its grey placeholders, which reads as a blank white screen. Sign-in at start asks for less.
const TIMEOUT_MS = 20_000;
const TOO_LONG = 'Saligue is taking too long to answer. Check your network and try again.';

/** Stops a request that has not answered within `ms`. AbortSignal.timeout is missing in older Android WebViews and
 *  throwing there would have been reported as a broken connection, so the deadline is kept by hand. */
export function deadline(ms: number) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  return { signal: controller.signal, timedOut: () => timedOut, clear: () => clearTimeout(timer) };
}

/** Full address of a file stored on the Saligue server — a picture ("/media/…") or a chat photo, video or voice
 *  note ("/api/chat-files/…?e=…&s=…", signed): also inside the phone app, where the pages come from the phone
 *  itself, and when the website is hosted elsewhere. Anything else (a data: URL, another site) is left as it is. */
export function mediaUrl<T extends string | undefined>(path: T): T {
  const onServer = path?.startsWith('/media/') || path?.startsWith('/api/chat-files/');
  return (onServer ? `${apiOrigin()}${path}` : path) as T;
}

/** Full address of a server API path ("/products/…"), also inside the phone app. */
export const apiUrl = (path: string) => `${apiOrigin()}/api${path}`;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

let memoryToken: string | null = null;

export function setToken(token: string | null) {
  const changed = token !== getToken();
  memoryToken = token;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable: the session lasts until the page is closed (the server's cookie keeps it too).
  }
  if (changed) reconnectServerEvents();
}

// timeoutMs: give up after this long (TIMEOUT_MS unless asked otherwise). For calls the whole app waits on
// (signing in at start): on some networks a request stalls instead of failing (HTTP/3 packets dropped part-way),
// and without a limit the page waits forever.
export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const token = getToken();
  // Turned into JSON before the request: a body that cannot be written is a bug here, never a broken connection.
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  const limit = deadline(options.timeoutMs ?? TIMEOUT_MS);
  const origin = apiOrigin();
  try {
    const response = await fetch(`${origin}/api${path}`, {
      method: options.method ?? (body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
      // Same site: the session cookie goes along too (the server sets it HttpOnly). A server on another address
      // simply gets no cookie, which is why the token above is what every request really travels on.
      credentials: 'same-origin',
      signal: limit.signal,
    });
    // Read inside the deadline: an answer that stops part-way would otherwise wait forever as well.
    const data = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    if (limit.timedOut()) throw new ApiError(0, 'timeout', TOO_LONG);
    if (!response.ok) {
      throw new ApiError(response.status, data?.error?.code ?? 'server_error', data?.error?.message ?? 'Something went wrong. Please try again.');
    }
    return data as T;
  } catch (error) {
    // The server answered "no": its own word is passed on untouched.
    if (error instanceof ApiError) throw error;
    // Only a real network failure is called one; anything else is our own fault and says so instead of blaming the
    // shopper's connection.
    const name = (error as Error)?.name;
    if (limit.timedOut() || name === 'TimeoutError') throw new ApiError(0, 'timeout', TOO_LONG);
    if (name === 'AbortError') throw new ApiError(0, 'stopped', 'That was stopped. Please try again.');
    if ((error as Error)?.message === 'Failed to fetch' || name === 'TypeError' || name === 'NetworkError') {
      throw new ApiError(0, 'unavailable', 'No connection to Saligue. Check your network and try again.');
    }
    throw error;
  } finally {
    limit.clear();
  }
}

// Live updates: the server announces what changed ("products", "comments", "orders", "messages"); listeners refresh.
// The connection carries the session, so private events (like chat messages) reach only this account.
type Listener = (data: any) => void;
const listeners = new Map<string, Set<Listener>>();
let source: EventSource | null = null;
const attached = new Set<string>();

function dispatch(event: string) {
  return (e: MessageEvent) => {
    let data: unknown = {};
    try {
      data = JSON.parse(e.data);
    } catch {
      // Keep empty data.
    }
    listeners.get(event)?.forEach((l) => l(data));
  };
}

function connect() {
  source?.close();
  attached.clear();
  const token = getToken();
  source = new EventSource(`${apiOrigin()}/api/events${token ? `?token=${encodeURIComponent(token)}` : ''}`);
  for (const event of listeners.keys()) {
    source.addEventListener(event, dispatch(event));
    attached.add(event);
  }
}

/** Reconnects live updates as the current account (after signing in or out). */
export function reconnectServerEvents() {
  if (source) connect();
}

export function onServerEvent(event: string, listener: Listener) {
  if (typeof window === 'undefined') return () => {};
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(listener);
  if (!source) connect();
  else if (!attached.has(event)) {
    source.addEventListener(event, dispatch(event));
    attached.add(event);
  }
  return () => {
    listeners.get(event)?.delete(listener);
  };
}
