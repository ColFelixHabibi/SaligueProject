'use client';

import { useMemo, useState } from 'react';
import { Globe2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import regionsData from '@/lib/regions.json';

export type CountryRule = { mode: 'only' | 'except'; countries: string[] };

const UN: string[] = regionsData.un;
const REGIONS = regionsData.regions as Record<string, string[]>;
const GROUPS: [string, (code: string) => boolean][] = [
  ['East Africa', (c) => REGIONS[c]?.[1] === 'eastern-africa'],
  ['All of Africa', (c) => REGIONS[c]?.[0] === 'africa'],
  ['Europe', (c) => REGIONS[c]?.[0] === 'europe'],
  ['Asia', (c) => REGIONS[c]?.[0] === 'asia'],
  ['Americas', (c) => REGIONS[c]?.[0] === 'north-america' || REGIONS[c]?.[0] === 'south-america'],
  ['Oceania', (c) => REGIONS[c]?.[0] === 'oceania'],
];
const flag = (code: string) => String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));

/** "Everywhere", "Only 12 countries" or "Everywhere except 3". */
export function ruleSummary(rule?: CountryRule) {
  if (!rule?.countries.length) return 'Everywhere';
  return rule.mode === 'only' ? `Only ${rule.countries.length} ${rule.countries.length === 1 ? 'country' : 'countries'}` : `All except ${rule.countries.length}`;
}

/** Choose where a feature works: everywhere, only in some of the 195 UN countries, or everywhere except some. */
export function FeatureCountries({ label, rule, onSave }: { label: string; rule?: CountryRule; onSave: (rule: CountryRule | null) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'all' | 'only' | 'except'>(rule?.countries.length ? rule.mode : 'all');
  const [picked, setPicked] = useState<Set<string>>(new Set(rule?.countries ?? []));
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const names = useMemo(() => {
    let display: Intl.DisplayNames | null = null;
    try {
      display = new Intl.DisplayNames([typeof navigator !== 'undefined' ? navigator.language : 'en', 'en'], { type: 'region' });
    } catch {
      // Very old browser: codes only.
    }
    return new Map(UN.map((c) => [c, display?.of(c) ?? c]));
  }, []);
  const list = UN.filter((c) => !q.trim() || names.get(c)!.toLowerCase().includes(q.trim().toLowerCase()) || c.toLowerCase() === q.trim().toLowerCase())
    .sort((a, b) => names.get(a)!.localeCompare(names.get(b)!));
  const toggle = (c: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(c)) n.delete(c);
    else n.add(c);
    return n;
  });
  const reset = () => {
    setMode(rule?.countries.length ? rule.mode : 'all');
    setPicked(new Set(rule?.countries ?? []));
    setQ('');
  };
  return (
    <>
      <Button type="button" size="sm" variant="ghost" className="h-8 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground" onClick={() => { reset(); setOpen(true); }}>
        <Globe2 className="h-4 w-4" /> {ruleSummary(rule)}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90dvh] max-w-[calc(100vw-1.5rem)] flex-col gap-3 rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{label}: where it works</DialogTitle>
            <DialogDescription>The country comes from each visitor’s internet address. The server enforces it, so it can’t be bypassed from the app.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-1.5">
            {([['all', 'Everywhere'], ['only', 'Only these'], ['except', 'All except']] as const).map(([v, l]) => (
              <Button key={v} type="button" size="sm" variant={mode === v ? 'default' : 'outline'} onClick={() => setMode(v)}>{l}</Button>
            ))}
          </div>
          {mode !== 'all' && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {GROUPS.map(([name, test]) => (
                  <button key={name} type="button" onClick={() => setPicked((s) => new Set([...s, ...UN.filter(test)]))} className="rounded-full border px-2.5 py-1 text-xs font-semibold hover:border-primary">+ {name}</button>
                ))}
                {picked.size > 0 && <button type="button" onClick={() => setPicked(new Set())} className="rounded-full px-2.5 py-1 text-xs font-semibold text-destructive">Clear</button>}
              </div>
              <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Find a country" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border">
                {list.map((c) => (
                  <label key={c} className={cn('flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0', picked.has(c) && 'bg-primary/5')}>
                    <input type="checkbox" className="accent-primary" checked={picked.has(c)} onChange={() => toggle(c)} />
                    <span className="text-lg leading-none">{flag(c)}</span>
                    <span className="min-w-0 flex-1 truncate">{names.get(c)}</span>
                    <span className="text-xs text-muted-foreground">{c}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{picked.size} of 195 selected · {mode === 'only' ? 'works only there' : 'works everywhere except there'}</p>
            </>
          )}
          <DialogFooter>
            <Button type="button" disabled={saving || (mode !== 'all' && picked.size === 0)} onClick={async () => {
              setSaving(true);
              try {
                await onSave(mode === 'all' ? null : { mode, countries: [...picked] });
                setOpen(false);
              } finally {
                setSaving(false);
              }
            }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
