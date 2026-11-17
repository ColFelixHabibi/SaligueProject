'use client';

// What a page does when it breaks, so the shopper almost never sees an error screen:
//   1. it quietly tries again (a value that was not there yet, a race while loading);
//   2. then reloads itself once — and straight away when the break is a missing code file, which is what a phone
//      that still holds the old page meets after every deploy;
//   3. only a page that keeps breaking after both shows a calm "reload" screen.
// Attempts are kept per page for 30 seconds in sessionStorage, so a reload knows it already happened and the page
// can never fall into a reload loop.

const KEY = 'saligue-recover';
const WINDOW_MS = 30_000;

type Attempts = { path: string; n: number; at: number };
let memory: Attempts | null = null;

const read = (): Attempts | null => {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Attempts) : null;
  } catch {
    return memory;
  }
};
const write = (a: Attempts) => {
  memory = a;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    // Private mode: the in-memory copy still stops a loop of soft retries; a reload starts it again at most once.
  }
};

/** A code file that is no longer on the server (a deploy happened since this page was opened). */
export function isStaleCode(error: unknown) {
  const e = error as { name?: string; message?: string } | null;
  return /ChunkLoadError|Loading (CSS )?chunk|dynamically imported module|Importing a module script failed|error loading dynamically imported/i
    .test(`${e?.name ?? ''} ${e?.message ?? String(error)}`);
}

export type Recovery = 'retry' | 'reload' | 'show';

/** Decides the next step for a page that just broke, and records it. */
export function nextStep(error: unknown): Recovery {
  if (typeof window === 'undefined') return 'show';
  const path = location.pathname;
  const last = read();
  const n = last && last.path === path && Date.now() - last.at < WINDOW_MS ? last.n : 0;
  const step: Recovery = n === 0 ? (isStaleCode(error) ? 'reload' : 'retry') : n === 1 ? 'reload' : 'show';
  // After a reload there is nothing left to try by ourselves: the next break on this page shows the screen.
  write({ path, n: step === 'reload' ? 2 : n + 1, at: Date.now() });
  return step;
}
