'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import TicketingBrand from '../TicketingBrand';

export default function ClaimTicketAccess({ token }: { token: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function claim() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/ticketing/wallet/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Ticket access could not be verified.');
      router.replace('/tickets/wallet');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ticket access could not be verified.');
      setLoading(false);
    }
  }

  return (
    <>
    <TicketingBrand />
    <main className="min-h-screen bg-[#0d0a12] px-4 py-16 text-white">
      <section className="mx-auto max-w-lg rounded-3xl border border-orange-300/15 bg-[#17121e] p-8 text-center">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-200">Secure guest access</p>
        <h1 className="mt-4 text-3xl font-black">Open your ticket wallet</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">This private link expires after 30 minutes and can only be used once.</p>
        {error && <p role="alert" className="mt-5 rounded-xl border border-red-300/20 bg-red-950/30 p-3 text-sm text-red-100">{error}</p>}
        <button type="button" onClick={() => void claim()} disabled={!token || loading} className="mt-6 min-h-11 w-full rounded-xl bg-orange-400 px-5 text-sm font-black text-[#170d18] disabled:opacity-50">
          {loading ? 'Verifying link…' : 'Open my tickets'}
        </button>
      </section>
    </main>
    </>
  );
}
