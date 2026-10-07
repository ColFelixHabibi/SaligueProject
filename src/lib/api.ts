'use client';

// Talks to Saligue's own server (server/index.mjs). By default it is the same address that serves the app;
// NEXT_PUBLIC_API_URL points a separately hosted site (e.g. GitHub Pages) at the server instead.
const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
const TOKEN_KEY = 'saligue-session';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable: the session lasts until the page is closed.
  }
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

// Live updates: the server announces what changed ("products", "comments", "orders"); listeners refresh.
type Listener = (data: any) => void;
const listeners = new Map<string, Set<Listener>>();
let source: EventSource | null = null;

export function onServerEvent(event: string, listener: Listener) {
  if (typeof window === 'undefined') return () => {};
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(listener);
  if (!source) source = new EventSource(`${API_ORIGIN}/api/events`);
  const handler = (e: MessageEvent) => {
    let data: unknown = {};
    try {
      data = JSON.parse(e.data);
    } catch {
      // Keep empty data.
    }
    listeners.get(event)?.forEach((l) => l(data));
  };
  source.addEventListener(event, handler);
  return () => {
    listeners.get(event)?.delete(listener);
    source?.removeEventListener(event, handler);
  };
}
