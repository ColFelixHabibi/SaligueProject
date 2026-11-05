'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Controller = {
  name: string;
  country: string;
  address: string;
  registrationNumber: string | null;
  registeredAt: string | null;
  dpoName: string;
  dpoEmail: string;
  dpoPhone: string;
  lastReview: string | null;
  registered: boolean;
};
type Payouts = { open: boolean; mode: 'partner' | 'self' | 'off'; payer: string | null; message: string | null; monthlyCap: number };
type Risk = { risk: string; level: string; measures: string[]; residual: string };
type Dpia = { title: string; version: number; reviewedAt: string | null; owner: string; scope: string; necessity: string; risks: Risk[]; measures: string[]; review: string };
type Row = { what: string; why: string; data: string; basis: string; kept: string; who: string; where: string };
type Compliance = { controller: Controller; payouts: Payouts; dpia: Dpia; processing: Row[] };

const levelClass: Record<string, string> = {
  High: 'bg-red-100 text-red-700',
  Medium: 'bg-amber-100 text-amber-800',
  Low: 'bg-emerald-100 text-emerald-700',
};

/**
 * The live part of /data-protection: who is responsible, whether the controller is registered, who sends a
 * user's money, the DPIA and the record of processing. Everything here comes from GET /api/compliance
 * (server/compliance.mjs), so the page cannot claim something the server does not do.
 */
export function ComplianceCard() {
  const [data, setData] = useState<Compliance | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api<Compliance>('/compliance').then(setData).catch(() => setFailed(true));
  }, []);

  if (failed) {
    return (
      <div className="container mx-auto max-w-3xl px-4 pt-10">
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          The live record could not load. The written policy below still applies; the details it refers to are
          also available from Help &amp; Support.
        </p>
      </div>
    );
  }
  if (!data) return <div className="container mx-auto max-w-3xl px-4 pt-10" aria-busy="true" />;

  const { controller, payouts, dpia, processing } = data;

  return (
    <div className="container mx-auto max-w-3xl px-4 pt-10">
      <section className="rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-bold">Who is responsible for your information</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Controller</dt><dd className="font-medium">{controller.name}</dd></div>
          <div><dt className="text-muted-foreground">Country</dt><dd className="font-medium">{controller.country}</dd></div>
          <div className="sm:col-span-2"><dt className="text-muted-foreground">Address</dt><dd className="font-medium">{controller.address}</dd></div>
          {controller.registered ? (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Data controller registration</dt>
              <dd className="font-medium">
                {controller.registrationNumber}
                {controller.registeredAt ? ` · registered ${controller.registeredAt}` : ''}
              </dd>
            </div>
          ) : (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Data controller registration</dt>
              <dd className="font-medium">Registration with the authority is in progress; the number is published here as soon as it is issued.</dd>
            </div>
          )}
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Questions about your information</dt>
            <dd className="font-medium">
              {controller.dpoName || 'The Saligue team'}
              {controller.dpoEmail ? ` · ${controller.dpoEmail}` : ''}
              {controller.dpoPhone ? ` · ${controller.dpoPhone}` : ''}
              {!controller.dpoEmail && !controller.dpoPhone ? ' · use Help & Support' : ''}
            </dd>
          </div>
          {dpia.reviewedAt && (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Last data protection review</dt>
              <dd className="font-medium">{dpia.reviewedAt}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="mt-4 rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-bold">Who sends money to people who earn</h2>
        <p className="mt-2 text-sm text-foreground/85">
          {payouts.open
            ? `Payouts are open. Saligue does not hand out cash itself: the money for tips, share & earn rewards and creator earnings is sent through ${payouts.payer ?? 'a licensed payment partner'} to the Mobile Money number on the account. Settling a shop for its own delivered sales is the shop’s own money, paid once.`
            : payouts.message ?? 'Payouts are paused for now.'}
        </p>
        {payouts.monthlyCap > 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            Each person is paid at most ${payouts.monthlyCap.toFixed(2)} a month. Anything above that stays on the
            account and waits for the next month.
          </p>
        )}
      </section>

      <section className="mt-4 rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-bold">Before we built the AI try-on: {dpia.title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Assessment {dpia.version} · owner {dpia.owner}
          {dpia.reviewedAt ? ` · reviewed ${dpia.reviewedAt}` : ''}
        </p>
        <p className="mt-3 text-sm text-foreground/85"><strong className="font-semibold">What it covers.</strong> {dpia.scope}</p>
        <p className="mt-2 text-sm text-foreground/85"><strong className="font-semibold">Why it is needed.</strong> {dpia.necessity}</p>
        <h3 className="mt-5 text-sm font-bold uppercase tracking-wide text-muted-foreground">Risks and what answers them</h3>
        <ul className="mt-2 space-y-4">
          {dpia.risks.map((r) => (
            <li key={r.risk} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${levelClass[r.level] ?? 'bg-muted text-foreground'}`}>
                  {r.level}
                </span>
                <span className="text-sm font-semibold">{r.risk}</span>
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground/85">
                {r.measures.map((m) => <li key={m}>{m}</li>)}
              </ul>
              <p className="mt-2 text-sm"><strong className="font-semibold">Risk left after this:</strong> {r.residual}</p>
            </li>
          ))}
        </ul>
        <h3 className="mt-5 text-sm font-bold uppercase tracking-wide text-muted-foreground">Standing measures</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground/85">
          {dpia.measures.map((m) => <li key={m}>{m}</li>)}
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">{dpia.review}</p>
      </section>

      <section className="mt-4 rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-bold">Record of processing</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every purpose Saligue processes information for, generated from the server’s own description
          (server/compliance.mjs) so it cannot drift from what the program does. The last column names where it
          lives, so anyone can check it.
        </p>
        <ul className="mt-3 space-y-3">
          {processing.map((row) => (
            <li key={row.what} className="rounded-xl border p-4 text-sm">
              <p className="font-semibold">{row.what}</p>
              <dl className="mt-2 space-y-1 text-foreground/85">
                <div><dt className="inline font-medium text-muted-foreground">Why: </dt><dd className="inline">{row.why}</dd></div>
                <div><dt className="inline font-medium text-muted-foreground">What: </dt><dd className="inline">{row.data}</dd></div>
                <div><dt className="inline font-medium text-muted-foreground">Basis: </dt><dd className="inline">{row.basis}</dd></div>
                <div><dt className="inline font-medium text-muted-foreground">Kept: </dt><dd className="inline">{row.kept}</dd></div>
                <div><dt className="inline font-medium text-muted-foreground">Who sees it: </dt><dd className="inline">{row.who}</dd></div>
                <div><dt className="inline font-medium text-muted-foreground">Where: </dt><dd className="inline font-mono text-xs">{row.where}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
