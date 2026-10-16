'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Check, Mail, RefreshCw, ShieldAlert, X } from 'lucide-react';

type Transfer = {
  id: string;
  ticketReference: string;
  replacementReference: string;
  eventTitle: string;
  ticketType: string;
  from_email: string;
  to_email: string;
  to_name: string;
  status: 'pending' | 'approved' | 'rejected';
  reason: string | null;
  requested_at: string;
  reviewed_by_email: string | null;
  reviewed_at: string | null;
};

async function readResponse(response: Response) {
  const result = await response.json().catch(() => ({})) as { error?: string; transfers?: Transfer[]; emailSent?: boolean; replacementReference?: string | null };
  if (!response.ok) throw new Error(result.error || `Transfer request failed (${response.status}).`);
  return result;
}

export default function TransferReviewManager() {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [activeReview, setActiveReview] = useState<{ id: string; decision: 'approve' | 'reject' } | null>(null);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await readResponse(await fetch('/api/admin/ticketing/transfers', { cache: 'no-store' }));
      setTransfers(result.transfers || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Transfer requests could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeReview) return;
    setBusyId(activeReview.id);
    setError('');
    setNotice('');
    try {
      const result = await readResponse(await fetch('/api/admin/ticketing/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transferId: activeReview.id, decision: activeReview.decision, reason })
      }));
      setNotice(activeReview.decision === 'approve'
        ? result.emailSent
          ? 'Transfer approved, old ticket invalidated, and recipient emailed a secure wallet link.'
          : `Transfer approved and old ticket invalidated, but email delivery failed. Resend the approved ticket link below. ${result.replacementReference ? `Replacement ticket: ${result.replacementReference}.` : ''}`
        : 'Transfer rejected. The current ticket remains active.');
      setActiveReview(null);
      setReason('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Transfer review could not be recorded.');
    } finally {
      setBusyId('');
    }
  }

  async function resend(id: string) {
    setBusyId(id);
    setError('');
    setNotice('');
    try {
      await readResponse(await fetch('/api/admin/ticketing/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transferId: id, decision: 'resend' })
      }));
      setNotice('A new one-time ticket access link has been emailed to the approved recipient.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Transfer access email could not be resent.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200">Ticket controls</p>
          <h2 className="mt-1 text-2xl font-black">Transfer review</h2>
          <p className="mt-1 text-sm text-slate-400">Only the platform owner can approve or reject transfers. Approval immediately revokes the old ticket credential.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/15 px-4 text-xs font-bold hover:bg-white/5 disabled:opacity-50"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh</button>
      </div>
      {notice && <p role="status" className="rounded-xl border border-emerald-200/20 bg-emerald-950/20 p-4 text-sm text-emerald-100">{notice}</p>}
      {error && <p role="alert" className="rounded-xl border border-red-200/20 bg-red-950/20 p-4 text-sm text-red-100">{error}</p>}
      {loading && <p role="status" className="rounded-xl border border-white/10 bg-[#17121e] p-5 text-sm text-slate-300">Loading transfer requests…</p>}
      {!loading && !error && !transfers.length && <p className="rounded-xl border border-white/10 bg-[#17121e] p-5 text-sm text-slate-400">No ticket transfer requests have been recorded.</p>}
      <div className="grid gap-4">
        {transfers.map(transfer => (
          <article key={transfer.id} className="rounded-2xl border border-white/10 bg-[#17121e] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-orange-200">{transfer.eventTitle} · {transfer.ticketType}</p>
                <h3 className="mt-2 text-lg font-black">{transfer.ticketReference}</h3>
                <p className="mt-1 text-xs text-slate-400">Requested {new Date(transfer.requested_at).toLocaleString('en-KE')}</p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wider ${transfer.status === 'pending' ? 'border-amber-200/20 bg-amber-200/5 text-amber-100' : transfer.status === 'approved' ? 'border-emerald-200/20 bg-emerald-200/5 text-emerald-100' : 'border-red-200/20 bg-red-200/5 text-red-100'}`}>{transfer.status}</span>
            </div>
            <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
              <p className="rounded-xl border border-white/5 bg-black/15 p-3"><span className="block text-[10px] font-bold uppercase text-slate-500">Current holder</span><span className="mt-1 block text-slate-200">{transfer.from_email}</span></p>
              <p className="rounded-xl border border-white/5 bg-black/15 p-3"><span className="block text-[10px] font-bold uppercase text-slate-500">Requested recipient</span><span className="mt-1 block text-slate-200">{transfer.to_name || 'Ticket holder'} · {transfer.to_email}</span></p>
            </div>
            {transfer.reviewed_at && <p className="mt-3 text-xs text-slate-500">Reviewed {new Date(transfer.reviewed_at).toLocaleString('en-KE')} by {transfer.reviewed_by_email || 'platform owner'}{transfer.reason ? ` · ${transfer.reason}` : ''}</p>}
            {transfer.status === 'approved' && <p className="mt-2 text-xs text-slate-400">Replacement ticket: {transfer.replacementReference || 'Not available'}</p>}
            {transfer.status === 'pending' && activeReview?.id === transfer.id ? (
              <form onSubmit={event => void submitReview(event)} className="mt-4 rounded-xl border border-orange-200/15 bg-black/15 p-4">
                <p className="text-xs font-bold text-slate-200">You are about to {activeReview.decision} this transfer. {activeReview.decision === 'approve' ? 'The old ticket will be revoked and a fresh credential issued.' : 'The original ticket stays active.'}</p>
                <label className="mt-3 block text-xs font-bold text-slate-300">Audit reason<textarea required minLength={5} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} className="mt-1.5 min-h-20 w-full rounded-lg border border-white/10 bg-[#0d0a12] p-3 text-sm text-white" /></label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button disabled={busyId === transfer.id} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-orange-400 px-3 text-xs font-black text-[#170d18] disabled:opacity-50">{activeReview.decision === 'approve' ? <Check size={14} /> : <X size={14} />}{busyId === transfer.id ? 'Saving…' : `Confirm ${activeReview.decision}`}</button>
                  <button type="button" onClick={() => { setActiveReview(null); setReason(''); }} className="min-h-9 rounded-lg px-3 text-xs font-bold text-slate-400">Cancel</button>
                </div>
              </form>
            ) : transfer.status === 'pending' ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => { setReason(''); setActiveReview({ id: transfer.id, decision: 'approve' }); }} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-emerald-400 px-3 text-xs font-black text-[#07150f]"><Check size={14} />Approve transfer</button>
                <button type="button" onClick={() => { setReason(''); setActiveReview({ id: transfer.id, decision: 'reject' }); }} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-red-200/20 px-3 text-xs font-bold text-red-100"><ShieldAlert size={14} />Reject</button>
              </div>
            ) : transfer.status === 'approved' ? (
              <button type="button" disabled={busyId === transfer.id} onClick={() => void resend(transfer.id)} className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/15 px-3 text-xs font-bold hover:bg-white/5 disabled:opacity-50"><Mail size={14} />{busyId === transfer.id ? 'Sending…' : 'Resend recipient access link'}</button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
