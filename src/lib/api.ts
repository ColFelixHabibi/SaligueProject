'use client';

// Talks to Saligue's own server (server/index.mjs). By default it is the same address that serves the app;
// NEXT_PUBLIC_API_URL points a separately hosted site (e.g. GitHub Pages) at the server instead.
const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
const TOKEN_KEY = 'saligue-session';

/** Full address of a picture stored on the Saligue server ("/media/…"), also when the website is hosted elsewhere. */
export function mediaUrl<T extends string | undefined>(path: T): T {
  return (path?.startsWith('/media/') ? `${API_ORIGIN}${path}` : path) as T;
}

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

export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}/api${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      // Same site: the session cookie goes along too (the server sets it HttpOnly).
      credentials: API_ORIGIN ? 'omit' : 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'unavailable', 'No connection to Saligue. Check your network and try again.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, data?.error?.code ?? 'server_error', data?.error?.message ?? 'Something went wrong. Please try again.');
  }
  return data as T;
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
  source = new EventSource(`${API_ORIGIN}/api/events${token ? `?token=${encodeURIComponent(token)}` : ''}`);
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
