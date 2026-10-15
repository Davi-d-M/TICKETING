'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { Ghost, KeyRound, ShieldCheck } from 'lucide-react';

export default function TicketingLoginPage() {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    const formData = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.get('email'),
          password: formData.get('password')
        })
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || `Sign-in failed (${response.status}).`);
      window.location.assign('/admin/ticketing');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in could not be completed.');
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0d0a12] px-4 py-10 text-white">
      <div aria-hidden="true" className="pointer-events-none absolute -left-32 top-10 h-80 w-80 rounded-full bg-orange-500/10 blur-[100px]" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-violet-600/10 blur-[100px]" />
      <section className="relative w-full max-w-md rounded-3xl border border-orange-300/15 bg-gradient-to-br from-[#251523] via-[#1b1221] to-[#120e18] p-6 shadow-2xl shadow-black/30 sm:p-9">
        <Link href="/tickets" className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-orange-200"><Ghost size={14} /> ONLINE BAR · Ticketing</Link>
        <div className="mt-8 flex h-12 w-12 items-center justify-center rounded-2xl border border-violet-300/20 bg-violet-300/10 text-violet-200"><KeyRound size={21} /></div>
        <h1 className="mt-5 text-3xl font-black tracking-tight">Admin access<span className="text-orange-400">.</span></h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">Sign in to manage Ticketing events and review operational records.</p>
        <form onSubmit={submit} className="mt-7 space-y-4">
          <label className="block text-xs font-bold text-slate-300">
            Admin email
            <input className="mt-1.5 min-h-11 w-full rounded-xl border border-white/10 bg-[#100d17] px-3 text-sm text-white outline-none focus:border-orange-400" name="email" type="email" autoComplete="username" required maxLength={320} />
          </label>
          <label className="block text-xs font-bold text-slate-300">
            Password
            <input className="mt-1.5 min-h-11 w-full rounded-xl border border-white/10 bg-[#100d17] px-3 text-sm text-white outline-none focus:border-orange-400" name="password" type="password" autoComplete="current-password" required maxLength={1024} />
          </label>
          {error && <p role="alert" className="rounded-xl border border-red-300/20 bg-red-950/30 p-3 text-xs text-red-100">{error}</p>}
          <button disabled={submitting} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-400 px-4 text-sm font-black text-[#170d18] transition hover:bg-orange-300 disabled:opacity-50">
            <ShieldCheck size={16} /> {submitting ? 'Checking access…' : 'Sign in securely'}
          </button>
        </form>
        <p className="mt-5 text-[10px] leading-5 text-slate-500">Admin credentials are verified on the server. Sales and payment processing remain disabled until their release gates are implemented.</p>
      </section>
    </main>
  );
}
