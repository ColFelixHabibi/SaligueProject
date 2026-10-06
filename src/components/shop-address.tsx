
import { Clock, ExternalLink, MapPin, Store } from 'lucide-react';
import { ContactButtons } from '@/components/contact-buttons';
import { shopAddressLines, type Shop } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Shop name, full address, opening hours and contact buttons. */
export function ShopAddress({ shop, email, compact, className }: { shop: Shop; email?: string; compact?: boolean; className?: string }) {
  const lines = shopAddressLines(shop);
  const mapHref = shop.mapUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([shop.name, ...lines].join(', '))}`;
  const contact = [shop.phone, shop.whatsapp && shop.whatsapp !== shop.phone ? shop.whatsapp : ''].filter(Boolean).join(' ');
  return (
    <div className={cn('space-y-2 text-sm', className)}>
      <div className="flex items-center gap-2 font-semibold">
        <Store className="h-4 w-4 shrink-0 text-primary" /> {shop.name}
      </div>
      <a href={mapHref} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 text-muted-foreground hover:text-foreground">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {(compact ? lines.slice(0, 2) : lines).join(' · ')}
          <ExternalLink className="ml-1 inline h-3 w-3" />
        </span>
      </a>
      {!compact && shop.hours && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock className="h-4 w-4 shrink-0" /> {shop.hours}
        </div>
      )}
      <ContactButtons contact={contact} email={email} />
    </div>
  );
}
