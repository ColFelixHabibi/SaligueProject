
'use client';

import { Button } from '@/components/ui/button';
import { Link2, Mail, MessageCircle, Phone } from 'lucide-react';
import { contactLinks } from '@/lib/contact';
import { cn } from '@/lib/utils';

const ICONS = { call: Phone, whatsapp: MessageCircle, email: Mail, link: Link2 };

export function ContactButtons({ contact, email, className }: { contact?: string; email?: string; className?: string }) {
  const links = contactLinks(contact, email);
  if (links.length === 0) {
    return contact ? <p className={cn('text-sm text-muted-foreground', className)}>{contact}</p> : null;
  }
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {links.map((link) => {
        const Icon = ICONS[link.kind];
        return (
          <Button key={link.href} variant="outline" size="sm" className="h-8 max-w-full" asChild>
            <a href={link.href} target={link.kind === 'call' || link.kind === 'email' ? undefined : '_blank'} rel="noopener noreferrer">
              <Icon className="mr-1.5 h-4 w-4 shrink-0" />
              <span className="truncate">{link.label}</span>
            </a>
          </Button>
        );
      })}
    </div>
  );
}
