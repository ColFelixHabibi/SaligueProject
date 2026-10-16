import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Read-only star rating, with half stars. */
export function Stars({ rating, className, size = 'h-4 w-4' }: { rating: number; className?: string; size?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} aria-label={`${rating.toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, rating - (i - 1)));
        return (
          <span key={i} className={cn('relative inline-block', size)}>
            <Star className={cn('absolute inset-0 text-muted-foreground/30', size)} />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star className={cn('fill-amber-400 text-amber-400', size)} />
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Stars you can tap to choose a rating. */
export function StarInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <span className="inline-flex gap-1" role="radiogroup" aria-label="Your rating">
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={`${i} star${i > 1 ? 's' : ''}`} onClick={() => onChange(i)} className="rounded p-0.5 transition hover:scale-110">
          <Star className={cn('h-7 w-7', i <= value ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')} />
        </button>
      ))}
    </span>
  );
}
