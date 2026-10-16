'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';

export default function RequestAccess() {
  const [reference, setReference] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch('/api/ticketing/wallet/send-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderReference: reference.trim().toUpperCase(), email: email.trim().toLowerCase() })
      });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not request a ticket access link.');
      setMessage(result.message || 'If a paid order matches, we sent a secure link.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not request a ticket access link.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0d0a12] px-4 py-16 text-white">
      <form onSubmit={submit} className="mx-auto max-w-lg rounded-3xl border border-orange-300/15 bg-[#17121e] p-7 sm:p-9">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-200">Secure guest recovery</p>
        <h1 className="mt-4 text-3xl font-black">Find your tickets</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">Enter the order reference and email used for purchase. We’ll send a one-time wallet link if they match a paid order.</p>
        <label className="mt-6 block text-xs font-bold text-slate-300">Order reference<input required maxLength={80} value={reference} onChange={event => setReference(event.target.value)} placeholder="OBT-XXXXXXXXXXXX" className="mt-1.5 min-h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-orange-300" /></label>
        <label className="mt-4 block text-xs font-bold text-slate-300">Purchase email<input required type="email" maxLength={320} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-orange-300" /></label>
        <button disabled={loading} className="mt-5 min-h-11 w-full rounded-xl bg-orange-400 px-5 text-sm font-black text-[#170d18] disabled:opacity-50">{loading ? 'Checking…' : 'Email secure access link'}</button>
        {message && <p role="status" className="mt-4 text-xs leading-5 text-slate-300">{message}</p>}
        <Link href="/tickets" className="mt-6 inline-block text-xs font-bold text-orange-200">Back to events</Link>
      </form>
    </main>
  );
}
