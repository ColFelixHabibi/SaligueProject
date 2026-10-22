'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

// "Take a break": after a while of watching the feeds, Saligue suggests a pause (calm design, not addiction).
// Only time actually spent on a feed with the screen visible counts; 15 minutes away starts a new session.
const SETTING = 'saligue-break-minutes';
const STATE = 'saligue-break-state';
const listeners = new Set<() => void>();

export const BREAK_CHOICES = [0, 20, 40, 60];

const readMinutes = () => {
  try {
    const v = localStorage.getItem(SETTING);
    return v === null ? 40 : Number(v);
  } catch {
    return 40;
  }
};

export function setBreakMinutes(minutes: number) {
  try {
    localStorage.setItem(SETTING, String(minutes));
  } catch {
    // Storage blocked.
  }
  listeners.forEach((l) => l());
}

export const useBreakMinutes = () =>
  useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), readMinutes, () => 40);

type State = { seconds: number; last: number; snoozeUntil: number };
const load = (): State => {
  try {
    return { seconds: 0, last: 0, snoozeUntil: 0, ...JSON.parse(sessionStorage.getItem(STATE) || '{}') };
  } catch {
    return { seconds: 0, last: 0, snoozeUntil: 0 };
  }
};
const save = (s: State) => {
  try {
    sessionStorage.setItem(STATE, JSON.stringify(s));
  } catch {
    // Storage blocked.
  }
};

/** Counts watching time while mounted; `due` turns true when it's time to suggest a break. */
export function useBreakReminder() {
  const minutes = useBreakMinutes();
  const [due, setDue] = useState(false);
  useEffect(() => {
    if (!minutes) return;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      const s = load();
      const now = Date.now();
      if (now - s.last > 15 * 60_000) s.seconds = 0;
      s.seconds += 5;
      s.last = now;
      save(s);
      if (s.seconds >= minutes * 60 && now > s.snoozeUntil) setDue(true);
    };
    const timer = setInterval(tick, 5000);
    return () => clearInterval(timer);
  }, [minutes]);
  return {
    due,
    minutes,
    snooze: () => {
      const s = load();
      save({ ...s, snoozeUntil: Date.now() + 15 * 60_000 });
      setDue(false);
    },
    takeBreak: () => {
      save({ seconds: 0, last: 0, snoozeUntil: 0 });
      setDue(false);
    },
  };
}
