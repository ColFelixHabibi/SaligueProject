'use client';

import { useEffect, useRef, useState } from 'react';

const TRIGGER = 70; // px pulled (after resistance) that starts a refresh
const MAX = 110;

/**
 * Pull down at the top of a scrolling element to refresh, like TikTok and Instagram.
 * Returns how far it is pulled (for the spinner) and whether a refresh is running.
 */
export function usePullToRefresh(ref: React.RefObject<HTMLElement | null>, onRefresh: () => Promise<unknown>, enabled = true) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(onRefresh);
  latest.current = onRefresh;
  const busy = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let startY: number | null = null;
    let distance = 0;
    const start = (e: TouchEvent) => {
      startY = el.scrollTop <= 0 && !busy.current && e.touches.length === 1 ? e.touches[0].clientY : null;
      distance = 0;
    };
    const move = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || el.scrollTop > 0) {
        startY = dy < 0 ? null : startY;
        distance = 0;
        setPull(0);
        return;
      }
      // Resistance: the further you pull, the slower it follows.
      distance = Math.min(MAX, dy * 0.5);
      setPull(distance);
    };
    const end = () => {
      if (startY === null) return;
      startY = null;
      if (distance < TRIGGER) {
        setPull(0);
        return;
      }
      busy.current = true;
      setRefreshing(true);
      setPull(TRIGGER);
      latest.current().catch(() => {}).finally(() => {
        busy.current = false;
        setRefreshing(false);
        setPull(0);
      });
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [ref, enabled]);

  return { pull, refreshing, ready: pull >= TRIGGER };
}
