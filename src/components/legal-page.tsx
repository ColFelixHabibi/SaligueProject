import Link from 'next/link';

export type LegalSection = { heading: string; paragraphs: string[] };

/** Layout for the Terms of Service and Privacy Policy. */
export function LegalPage({ title, updated, intro, sections }: { title: string; updated: string; intro: string; sections: LegalSection[] }) {
  return (
    <article className="container mx-auto max-w-3xl px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">Saligue by INDECIANA</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Last updated {updated}</p>
      <p className="mt-6 leading-relaxed">{intro}</p>
      <ol className="mt-8 space-y-8">
        {sections.map((s, i) => (
          <li key={s.heading}>
            <h2 className="text-xl font-bold">{i + 1}. {s.heading}</h2>
            {s.paragraphs.map((p) => (
              <p key={p} className="mt-2 leading-relaxed text-foreground/85">{p}</p>
            ))}
          </li>
        ))}
      </ol>
      <p className="mt-10 border-t pt-6 text-sm text-muted-foreground">
        Questions? Write to us from <Link href="/my-account/support" className="text-primary hover:underline">Help &amp; Support</Link>.
        See also the <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link> and the{' '}
        <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
      </p>
    </article>
  );
}
