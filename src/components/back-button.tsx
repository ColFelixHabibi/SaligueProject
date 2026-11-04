'use client';

import { useEffect } from 'react';

/**
 * The phone's back button (Android app, see MainActivity.java) asks this first: if a menu, sheet or dialog is
 * open, it closes it (as Escape does) and the page stays. Otherwise the app goes back to the page before.
 */
export function BackButton() {
  useEffect(() => {
    const w = window as { __saligueBack?: () => boolean };
    w.__saligueBack = () => {
      const open = document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"]');
      if (!open) return false;
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      return true;
    };
    return () => {
      delete w.__saligueBack;
    };
  }, []);
  return null;
}
