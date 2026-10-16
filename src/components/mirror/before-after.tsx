'use client';

import { useRef, useState } from 'react';
import { ChevronsLeftRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Drag the handle to compare the shopper's own photo (left) with them wearing the item (right). */
export function BeforeAfter({ before, after, className, labels = ['You now', 'Wearing it'] }: { before: string; after: string; className?: string; labels?: [string, string] }) {
  const [split, setSplit] = useState(50);
  const box = useRef<HTMLDivElement>(null);
  const move = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (rect) setSplit(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
  };

  return (
    <div
      ref={box}
      className={cn('relative select-none overflow-hidden bg-gradient-to-b from-muted to-background touch-none', className)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e.clientX);
      }}
      onPointerMove={(e) => e.buttons && move(e.clientX)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={after} alt={labels[1]} className="absolute inset-0 h-full w-full object-contain p-2" draggable={false} />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={before} alt={labels[0]} className="absolute inset-0 h-full w-full object-contain p-2" draggable={false} />
      </div>
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-primary shadow" style={{ left: `${split}%` }}>
        <span className="absolute top-1/2 left-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-2 ring-background">
          <ChevronsLeftRight className="h-5 w-5" />
        </span>
      </div>
      <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-semibold shadow">{labels[0]}</span>
      <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground shadow">{labels[1]}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={split}
        onChange={(e) => setSplit(Number(e.target.value))}
        aria-label="Compare before and after"
        className="absolute inset-x-0 bottom-0 h-6 w-full cursor-ew-resize opacity-0"
      />
    </div>
  );
}
