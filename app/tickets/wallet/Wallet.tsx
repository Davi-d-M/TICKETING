'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import Link from 'next/link';
import Image from 'next/image';
import { getVenueMapLinks } from '@/lib/ticketing/venueLinks';

type WalletData = {
  order: { reference: string; buyerName: string; amountMinor: number | null; currency: string | null; paidAt: string | null; isTransferredTicket: boolean };
  event: {
    title: string;
    starts_at: string;
    ends_at: string;
    venue_name: string;
    venue_address: string;
    city: string;
    timezone: string;
    age_limit: number | null;
    cover_image_url: string | null;
    venue_maps_url: string;
    venue_latitude: number | null;
    venue_longitude: number | null;
    entrance_instructions: string;
    parking_details: string;
    transport_guidance: string;
    dress_code: string;
  };
  tickets: Array<{ id: string; reference: string; tier: string; status: string; issuedAt: string; checkedInAt: string | null; credential: string | null; credentialExpiresAt: number | null }>;
};

function localDate(value: string, timezone: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date to be confirmed' : date.toLocaleString('en-KE', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: timezone
  });
}

function GuestTicket({ ticket }: { ticket: WalletData['tickets'][number] }) {
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferEmail, setTransferEmail] = useState('');
  const [transferName, setTransferName] = useState('');
  const [transferMessage, setTransferMessage] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (!ticket.credential) {
      setQr('');
      return () => { active = false; };
    }
    void QRCode.toDataURL(ticket.credential, { errorCorrectionLevel: 'M', margin: 1, width: 280 })
      .then(value => { if (active) setQr(value); })
      .catch(() => { if (active) setError('Ticket QR could not be rendered on this device.'); });
    return () => { active = false; };
  }, [ticket.credential]);

  async function requestTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTransferBusy(true);
    setTransferMessage('');
    try {
      const response = await fetch('/api/ticketing/wallet/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: ticket.id, recipientEmail: transferEmail, recipientName: transferName })
      });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error || 'Transfer request could not be submitted.');
      setTransferMessage(result.message || 'Transfer request sent for owner approval.');
      setShowTransfer(false);
    } catch (cause) {
      setTransferMessage(cause instanceof Error ? cause.message : 'Transfer request could not be submitted.');
    } finally {
      setTransferBusy(false);
    }
  }

  return (
    <article className="grid gap-5 rounded-2xl border border-white/10 bg-black/15 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-200">{ticket.tier}</p>
        <h2 className="mt-2 text-lg font-black">{ticket.reference}</h2>
        <p className="mt-2 text-xs text-slate-400">Status: <span className="font-bold uppercase text-emerald-200">{ticket.status.replaceAll('_', ' ')}</span></p>
        {ticket.checkedInAt && <p className="mt-1 text-xs text-slate-400">Admitted: {new Date(ticket.checkedInAt).toLocaleString('en-KE')}</p>}
        <p className="mt-3 max-w-md text-[10px] leading-4 text-slate-500">Keep this code private. Entry is validated online, and each ticket can be admitted only once.</p>
        {ticket.credentialExpiresAt && <p className="mt-1 text-[10px] text-slate-500">This QR rotates every five minutes and refreshes automatically while this wallet is open.</p>}
        <Link href={`/tickets/verify?reference=${encodeURIComponent(ticket.reference)}`} className="mt-3 inline-block text-xs font-bold text-orange-200 hover:text-white">Check official ticket record</Link>
        {ticket.status === 'issued' && <div className="mt-4">
          {!showTransfer
            ? <button type="button" onClick={() => { setTransferMessage(''); setShowTransfer(true); }} className="min-h-9 rounded-lg border border-orange-200/20 px-3 text-xs font-bold text-orange-100 hover:bg-orange-200/5">Request owner-approved transfer</button>
            : <form onSubmit={event => void requestTransfer(event)} className="mt-3 grid max-w-md gap-2 rounded-xl border border-white/10 p-3">
              <p className="text-xs font-bold text-slate-200">The current ticket remains active until the owner approves.</p>
              <label className="text-[10px] font-bold text-slate-400">Recipient name<input required maxLength={160} value={transferName} onChange={event => setTransferName(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-xs text-white" /></label>
              <label className="text-[10px] font-bold text-slate-400">Recipient email<input required type="email" maxLength={320} value={transferEmail} onChange={event => setTransferEmail(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-xs text-white" /></label>
              <div className="flex gap-2"><button disabled={transferBusy} className="min-h-9 rounded-lg bg-orange-400 px-3 text-xs font-black text-black disabled:opacity-50">{transferBusy ? 'Sending…' : 'Send for approval'}</button><button type="button" onClick={() => setShowTransfer(false)} className="min-h-9 rounded-lg px-3 text-xs font-bold text-slate-400">Cancel</button></div>
            </form>}
          {transferMessage && <p role="status" className="mt-2 text-xs text-slate-300">{transferMessage}</p>}
        </div>}
      </div>
      <div className="mx-auto rounded-xl bg-white p-3">
        {qr ? <Image src={qr} alt={`Entry QR for ticket ${ticket.reference}`} width={190} height={190} unoptimized /> : <div className="grid h-[190px] w-[190px] place-items-center text-center text-xs text-slate-500">{ticket.credential ? error || 'Preparing QR…' : 'This ticket is no longer active. Its QR credential is unavailable.'}</div>}
      </div>
    </article>
  );
}

export default function Wallet() {
  const [data, setData] = useState<WalletData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const mapLinks = data ? getVenueMapLinks(data.event) : null;

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const response = await fetch('/api/ticketing/wallet', { cache: 'no-store' });
      const result = await response.json() as WalletData & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Ticket wallet could not be loaded.');
      setData(result);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ticket wallet could not be loaded.');
      if (silent) window.setTimeout(() => { void load(true); }, 15000);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const expirationTimes = (data?.tickets || [])
      .map(ticket => ticket.credentialExpiresAt)
      .filter((value): value is number => typeof value === 'number');
    if (!expirationTimes.length) return;
    const refreshAt = Math.min(...expirationTimes);
    const timeout = window.setTimeout(() => { void load(true); }, Math.max(250, refreshAt - Date.now() + 250));
    return () => window.clearTimeout(timeout);
  }, [data, load]);

  async function logout() {
    await fetch('/api/ticketing/wallet', { method: 'POST' });
    setData(null);
    setError('You have signed out of your ticket wallet.');
  }

  return (
    <main className="min-h-screen bg-[#0d0a12] px-4 py-8 text-white sm:px-6 sm:py-12">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-orange-300/15 bg-gradient-to-br from-[#32172a] via-[#201320] to-[#120e18] p-6 sm:p-8">
          <div><p className="text-xs font-black uppercase tracking-[0.2em] text-orange-200">MIDNIGHT SOCIETY KE · private wallet</p><h1 className="mt-3 text-3xl font-black">Your tickets</h1><p className="mt-2 text-xs text-slate-300">Only share your entry QR with gate staff.</p></div>
          {data && <button type="button" onClick={() => void logout()} className="min-h-10 rounded-xl border border-white/15 px-4 text-xs font-bold hover:bg-white/5">Sign out</button>}
        </header>
        {loading && <p role="status" className="rounded-2xl border border-white/10 bg-[#17121e] p-6 text-sm text-slate-300">Loading your secure wallet…</p>}
        {error && !loading && <div role="alert" className="rounded-2xl border border-orange-300/20 bg-[#17121e] p-6"><p className="text-sm text-slate-200">{error}</p>{!data && <Link href="/tickets/access" className="mt-4 inline-block text-xs font-bold text-orange-200">Request a fresh secure wallet link</Link>}</div>}
        {data && (
          <>
            <section className="relative isolate overflow-hidden rounded-2xl border border-orange-300/15 bg-[#17121e] p-5 sm:p-6">
              {data.event.cover_image_url && <Image src={data.event.cover_image_url} alt="" fill sizes="(max-width: 768px) 100vw, 896px" unoptimized className="object-cover opacity-20" />}
              <div className="relative z-10">
                <p className="text-xs font-black uppercase text-orange-200">{data.event.title}</p>
                <p className="mt-2 text-sm">{localDate(data.event.starts_at, data.event.timezone)}</p>
                <p className="mt-1 text-xs text-slate-300">{data.event.venue_name}{data.event.venue_address ? ` · ${data.event.venue_address}` : ''}, {data.event.city}</p>
                {data.event.dress_code && <p className="mt-2 text-xs text-slate-300">Dress code: {data.event.dress_code}</p>}
                <p className="mt-3 text-[10px] text-slate-300">{data.order.isTransferredTicket ? `Transferred ticket ${data.order.reference} · owner approval recorded` : `Order ${data.order.reference} · ${new Intl.NumberFormat('en-KE', { style: 'currency', currency: data.order.currency?.trim() || 'KES' }).format(Number(data.order.amountMinor || 0) / 100)}`}</p>
                {(data.event.entrance_instructions || data.event.parking_details || data.event.transport_guidance) && <div className="mt-4 space-y-2 border-t border-white/10 pt-3 text-xs leading-5 text-slate-200">
                  {data.event.entrance_instructions && <p><strong>Entry:</strong> {data.event.entrance_instructions}</p>}
                  {data.event.parking_details && <p><strong>Parking:</strong> {data.event.parking_details}</p>}
                  {data.event.transport_guidance && <p><strong>Transport & arrival:</strong> {data.event.transport_guidance}</p>}
                </div>}
                {mapLinks && <div className="mt-4 flex flex-wrap gap-2">
                    <a href={mapLinks.map} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center rounded-lg border border-white/15 px-3 text-[10px] font-bold text-orange-100 hover:bg-white/5">View venue on Google Maps</a>
                    <a href={mapLinks.directions} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center rounded-lg border border-white/15 px-3 text-[10px] font-bold text-orange-100 hover:bg-white/5">Get directions</a>
                  </div>}
              </div>
            </section>
            {data.tickets.length ? data.tickets.map(ticket => <GuestTicket key={ticket.id} ticket={ticket} />) : <p className="rounded-2xl border border-amber-200/20 bg-amber-950/20 p-5 text-sm text-amber-100">Payment is confirmed, but tickets are not yet available. Contact support and provide order reference {data.order.reference}.</p>}
          </>
        )}
      </div>
    </main>
  );
}
