'use client';

import { useEffect } from 'react';
import { translate, useLang, type Lang } from '@/lib/i18n';

// Translates every screen into Kinyarwanda or French without changing each page: texts, placeholders, titles and
// labels that match an English text in /i18n/<lang>.json are swapped in place (and restored for English).
// Only whole texts are matched, so names, prices and what people write stay as they are.
const ATTRS = ['placeholder', 'title', 'aria-label'] as const;
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'NOSCRIPT']);
const dicts: Partial<Record<Lang, Record<string, string>>> = {};

async function loadDict(lang: Lang) {
  if (lang === 'en') return {};
  if (!dicts[lang]) {
    try {
      dicts[lang] = await (await fetch(`/i18n/${lang}.json`, { cache: 'force-cache' })).json();
    } catch {
      dicts[lang] = {};
    }
  }
  return dicts[lang]!;
}

const originalText = new WeakMap<Text, string>();
const shownText = new WeakMap<Text, string>();
const originalAttr = new WeakMap<Element, Record<string, string>>();
const shownAttr = new WeakMap<Element, Record<string, string>>();

export function PageTranslator() {
  const lang = useLang();
  useEffect(() => {
    let cancelled = false;
    let observer: MutationObserver | null = null;
    document.documentElement.lang = lang;
    (async () => {
      const dict = await loadDict(lang);
      if (cancelled) return;
      const lookup = (english: string) => (lang === 'en' ? null : dict[english] ?? (translate(english, lang) !== english ? translate(english, lang) : null));

      // Each text remembers its English original and what we showed, so switching language (or back to English)
      // starts from the English; a text React changed since is taken as the new English.
      const doText = (node: Text) => {
        const parent = node.parentElement;
        if (!parent || SKIP.has(parent.tagName) || parent.closest('[data-no-translate],[contenteditable="true"]')) return;
        const value = node.nodeValue ?? '';
        const ours = shownText.get(node) === value;
        const english = ours ? originalText.get(node)! : value;
        const key = english.trim();
        if (!key || key.length > 400) return;
        const translated = lookup(key);
        const next = translated ? english.replace(key, translated) : english;
        if (next !== value) node.nodeValue = next;
        if (translated) {
          originalText.set(node, english);
          shownText.set(node, next);
        } else {
          originalText.delete(node);
          shownText.delete(node);
        }
      };
      const doElement = (el: Element) => {
        for (const attr of ATTRS) {
          const value = el.getAttribute(attr);
          if (!value) continue;
          const saved = originalAttr.get(el) ?? {};
          const shown = shownAttr.get(el) ?? {};
          const english = shown[attr] === value ? saved[attr] : value;
          const translated = lookup(english.trim());
          const next = translated ?? english;
          if (next !== value) el.setAttribute(attr, next);
          originalAttr.set(el, { ...saved, [attr]: english });
          shownAttr.set(el, { ...shown, [attr]: next });
        }
      };
      const walk = (root: Node) => {
        if (root.nodeType === Node.TEXT_NODE) return doText(root as Text);
        if (root.nodeType !== Node.ELEMENT_NODE) return;
        const el = root as Element;
        if (SKIP.has(el.tagName)) return;
        doElement(el);
        el.querySelectorAll('[placeholder],[title],[aria-label]').forEach(doElement);
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) doText(n as Text);
      };
      walk(document.body);
      observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'characterData') doText(m.target as Text);
          else if (m.type === 'attributes') doElement(m.target as Element);
          else m.addedNodes.forEach(walk);
        }
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
    })();
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [lang]);
  return null;
}
