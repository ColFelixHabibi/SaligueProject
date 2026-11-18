'use client';

import { useEffect } from 'react';

// Fast at first, gentle at the end (ease-out cubic): a page glides into place instead of jumping.
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const DURATION_MS = 450;

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const running = new WeakMap<HTMLElement, number>();

/**
 * Scrolls `el` to a place with easing. Snapping is paused while it moves (the browser would otherwise pull it to
 * the nearest page halfway), then put back. Someone who asked their device to reduce motion gets the jump.
 */
export function easeScrollTo(el: HTMLElement, to: { top?: number; left?: number }, duration = DURATION_MS): Promise<void> {
  const frame = running.get(el);
  if (frame) cancelAnimationFrame(frame);
  const fromTop = el.scrollTop;
  const fromLeft = el.scrollLeft;
  const top = to.top ?? fromTop;
  const left = to.left ?? fromLeft;
  if (reducedMotion() || (top === fromTop && left === fromLeft)) {
    el.scrollTo({ top, left, behavior: 'auto' });
    return Promise.resolve();
  }
  const snap = el.style.scrollSnapType;
  el.style.scrollSnapType = 'none';
  const start = performance.now();
  return new Promise((done) => {
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const k = easeOut(t);
      el.scrollTop = fromTop + (top - fromTop) * k;
      el.scrollLeft = fromLeft + (left - fromLeft) * k;
      if (t < 1) {
        running.set(el, requestAnimationFrame(step));
      } else {
        running.delete(el);
        el.style.scrollSnapType = snap;
        done();
      }
    };
    running.set(el, requestAnimationFrame(step));
  });
}

/** Whether `el` is still gliding (a page change is under way). */
export const isEasing = (el: HTMLElement) => running.has(el);

/** True when the wheel is over a box between the target and the feed that can still scroll that way itself (comments). */
function scrollsOnItsOwn(target: EventTarget | null, feed: HTMLElement, deltaY: number) {
  for (let node = target as HTMLElement | null; node && node !== feed; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
      const atTop = node.scrollTop <= 0;
      const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
      if ((deltaY < 0 && !atTop) || (deltaY > 0 && !atBottom)) return true;
    }
  }
  return false;
}

/**
 * A feed that moves one full page at a time (For You, Learn): the mouse wheel, a trackpad and the arrow / Page
 * keys glide to the next or previous page with easing, one page per gesture. Touch is left to the phone, whose own
 * swipe already eases.
 */
export function useEasedPaging(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let quietUntil = 0;
    let pending = 0;
    const page = (direction: number) => {
      const height = el.clientHeight;
      if (!height) return;
      const current = Math.round(el.scrollTop / height);
      const last = Math.max(0, Math.round((el.scrollHeight - height) / height));
      const next = Math.max(0, Math.min(last, current + direction));
      if (next === current) return;
      void easeScrollTo(el, { top: next * height });
    };
    const onWheel = (e: WheelEvent) => {
      // Sideways (a photo gallery), zooming, or a scrollable box inside the page: not ours.
      // A feed inside a feed (Learn inside For You) has already taken it.
      if (e.defaultPrevented || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (scrollsOnItsOwn(e.target, el, e.deltaY)) return;
      e.preventDefault();
      const now = performance.now();
      // One page per flick: a trackpad sends many small events, the tail of one flick must not turn a second page.
      if (now < quietUntil || isEasing(el)) {
        quietUntil = now + 180;
        return;
      }
      pending += e.deltaY;
      if (Math.abs(pending) < 30) return;
      page(Math.sign(pending));
      pending = 0;
      quietUntil = now + 500;
    };
    const onKey = (e: KeyboardEvent) => {
      // Only the feed on screen, and only the innermost one (Learn inside For You); never behind an open panel.
      if (e.defaultPrevented || !el.isConnected || !el.offsetParent || document.querySelector('[role="dialog"][data-state="open"], [aria-modal="true"]')) return;
      if ([...el.querySelectorAll<HTMLElement>('[data-eased-feed]')].some((f) => f.offsetParent)) return;
      const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');
      if (typing || e.altKey || e.ctrlKey || e.metaKey) return;
      const direction = e.key === 'ArrowDown' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey) ? 1
        : e.key === 'ArrowUp' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey) ? -1 : 0;
      if (!direction) return;
      e.preventDefault();
      page(direction);
    };
    el.dataset.easedFeed = '';
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      delete el.dataset.easedFeed;
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, [ref]);
}
