'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import TicketingBrand from '../TicketingBrand';

type Result = { success?: boolean; email?: string; orderReference?: string; emailSent?: boolean; error?: string };

export default function CompletePayment({ reference }: { reference: string }) {
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(Boolean(reference));
  const [sendingLink, setSendingLink] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!reference) {
      setLoading(false);
      setResult({ error: 'The Paystack reference is missing.' });
      return;
    }
    let active = true;
    void fetch('/api/ticketing/checkout/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference })
    }).then(async response => {
      const data = await response.json() as Result;
      if (!response.ok) throw new Error(data.error || 'Payment verification is still pending.');
      if (active) setResult(data);
    }).catch(cause => {
      if (active) setResult({ error: cause instanceof Error ? cause.message : 'Payment verification is still pending.' });
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [reference]);

  async function requestAccessLink() {
    setSendingLink(true);
    setMessage('');
    try {
      const response = await fetch('/api/ticketing/wallet/send-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderReference: result?.orderReference, email: result?.email })
      });
      const data = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not request ticket access.');
      setMessage(data.message || 'Check your inbox for a secure access link.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not request ticket access.');
    } finally {
      setSendingLink(false);
    }
  }

  return (
    <>
    <TicketingBrand />
    <main className="min-h-screen bg-[#0d0a12] px-4 py-16 text-white">
      <section className="mx-auto max-w-xl rounded-3xl border border-orange-300/15 bg-[#17121e] p-7 text-center shadow-2xl sm:p-10">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-200">Midnight Society KE Ticketing</p>
        <h1 className="mt-4 text-3xl font-black">{loading ? 'Verifying payment…' : result?.success ? 'Your payment is verified' : 'Payment not confirmed yet'}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          {loading ? 'We’re checking the transaction directly with Paystack. Please keep this page open.' :
            result?.success ? result.emailSent === false
              ? `Payment is verified. We could not send the wallet email to ${result.email}; request another link below.`
              : `We sent a one-time ticket-wallet link to ${result.email}.` :
              result?.error || 'Please try verification again shortly.'}
        </p>
        {result?.success && (
          <button type="button" onClick={() => void requestAccessLink()} disabled={sendingLink || !result.orderReference || !result.email} className="mt-6 min-h-11 rounded-xl bg-orange-400 px-5 text-sm font-black text-[#170d18] disabled:opacity-50">
            {sendingLink ? 'Sending secure link…' : 'Resend ticket access link'}
          </button>
        )}
        {message && <p role="status" className="mt-4 text-xs text-slate-300">{message}</p>}
        {!loading && !result?.success && (
          <button type="button" onClick={() => window.location.reload()} className="mt-6 min-h-11 rounded-xl border border-white/15 px-5 text-sm font-bold hover:bg-white/5">Check payment again</button>
        )}
        <div className="mt-7"><Link href="/tickets" className="text-xs font-bold text-orange-200 hover:text-white">Back to events</Link></div>
      </section>
    </main>
    </>
  );
}
