'use client';

import { FormEvent, useState } from 'react';

type Verification = {
  verified: boolean;
  admission_status?: 'available' | 'already_used' | 'not_admissible';
  event?: string;
  ticket_type?: string;
  masked_reference?: string;
};

export default function VerifyTicket({ initialReference = '' }: { initialReference?: string }) {
  const [reference, setReference] = useState(initialReference);
  const [result, setResult] = useState<Verification | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    setError('');
    try {
      const response = await fetch('/api/ticketing/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference })
      });
      const data = await response.json() as { verification?: Verification; verified?: boolean; error?: string };
      if (!response.ok) throw new Error(data.error || 'Ticket verification is unavailable.');
      setResult(data.verification || { verified: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ticket verification is unavailable.');
    } finally {
      setBusy(false);
    }
  }

  const entryState = result?.admission_status === 'available'
    ? { label: 'ENTRY AVAILABLE', style: 'border-emerald-300/20 bg-emerald-950/30 text-emerald-100' }
    : result?.admission_status === 'already_used'
      ? { label: 'ALREADY USED', style: 'border-amber-300/20 bg-amber-950/30 text-amber-100' }
      : { label: 'NOT ADMISSIBLE', style: 'border-red-300/20 bg-red-950/30 text-red-100' };

  return (
    <main className="min-h-screen bg-[#0d0a12] px-4 py-14 text-white sm:px-6">
      <section className="mx-auto max-w-xl rounded-3xl border border-orange-300/15 bg-[#17121e] p-7 shadow-2xl sm:p-10">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-200">MIDNIGHT SOCIETY KE</p>
        <h1 className="mt-3 text-3xl font-black">Official ticket verification</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">Check a ticket reference against the live ticket system. Verification never displays personal details or the private QR credential.</p>
        <form onSubmit={submit} className="mt-6 space-y-3">
          <label className="block text-xs font-bold text-slate-300">Ticket reference<input required maxLength={32} autoComplete="off" value={reference} onChange={event => setReference(event.target.value)} placeholder="OBT-XXXXXXXXXXXX" className="mt-1.5 min-h-12 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-orange-300" /></label>
          <button disabled={busy} className="min-h-11 w-full rounded-xl bg-orange-400 px-4 text-sm font-black text-[#170d18] disabled:opacity-50">{busy ? 'Checking official record…' : 'Verify ticket'}</button>
        </form>
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-300/20 bg-red-950/30 p-3 text-sm text-red-100">{error}</p>}
        {result && (
          result.verified ? (
            <section aria-live="polite" className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-black">Ticket verified</h2><span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-[10px] font-black uppercase text-emerald-100">Official record found</span></div>
              <p className="mt-2 text-xs text-slate-400">This ticket is recorded by the official ticketing system. Authenticity is separate from entry eligibility.</p>
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <p><span className="block text-[10px] font-black uppercase text-slate-500">Event</span>{result.event}</p>
                <p><span className="block text-[10px] font-black uppercase text-slate-500">Ticket type</span>{result.ticket_type}</p>
                <p><span className="block text-[10px] font-black uppercase text-slate-500">Reference</span>{result.masked_reference}</p>
              </div>
              <p className={`mt-5 rounded-xl border p-4 text-center text-sm font-black ${entryState.style}`}>{entryState.label}</p>
              <p className="mt-3 text-[10px] leading-4 text-slate-500">Only the gate scanner can grant entry. Final admission requires an online server check and a successful first-entry claim.</p>
            </section>
          ) : <p role="status" className="mt-5 rounded-xl border border-red-300/20 bg-red-950/30 p-4 text-sm text-red-100">No paid ticket record matches that reference. This does not alone establish fraud.</p>
        )}
      </section>
    </main>
  );
}
