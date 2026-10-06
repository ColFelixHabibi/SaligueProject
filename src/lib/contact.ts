
export type ContactLink = { kind: 'call' | 'whatsapp' | 'email' | 'link'; label: string; href: string };

// Turns a seller's free-text contact info (and email) into tappable links.
export function contactLinks(contact?: string, email?: string): ContactLink[] {
  const links: ContactLink[] = [];
  const text = contact ?? '';

  const phone = text.match(/\+?\d[\d\s().-]{6,}\d/)?.[0];
  if (phone) {
    const digits = phone.replace(/[^\d+]/g, '');
    links.push({ kind: 'call', label: phone.trim(), href: `tel:${digits}` });
    links.push({ kind: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/${digits.replace(/^\+/, '')}` });
  }

  const emails = new Set<string>();
  const textEmail = text.match(/[^\s@]+@[^\s@]+\.[^\s@]+/)?.[0];
  if (textEmail) emails.add(textEmail);
  if (email) emails.add(email);
  emails.forEach((e) => links.push({ kind: 'email', label: e, href: `mailto:${e}` }));

  const url = text.match(/https?:\/\/\S+/)?.[0];
  if (url) links.push({ kind: 'link', label: url.replace(/^https?:\/\//, ''), href: url });

  return links;
}
