'use client';

import { Component, type ReactNode } from 'react';
import { reportError } from '@/lib/report-error';

/**
 * Keeps one part of the screen from taking the whole app down. When something inside it breaks, the crash is
 * reported (src/lib/report-error.ts) and that part quietly steps aside — the header, the bar at the bottom or a
 * pop-up host disappears for a moment instead of the shopper seeing an error page. It tries again by itself once,
 * a second later, so a one-off hiccup (a value that was not there yet) heals without anyone noticing.
 */
export class Safe extends Component<{ name: string; children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  private retried = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    reportError(error, `part:${this.props.name}`);
    if (this.retried) return;
    this.retried = true;
    this.timer = setTimeout(() => this.setState({ failed: false }), 1000);
  }

  componentWillUnmount() {
    if (this.timer) clearTimeout(this.timer);
  }

  render() {
    return this.state.failed ? this.props.fallback ?? null : this.props.children;
  }
}
