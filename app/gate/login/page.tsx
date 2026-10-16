'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function GateStaffLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/ticketing/gate/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Gate staff sign-in failed.');
      router.replace('/gate/scanner');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gate staff sign-in failed.');
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#0d0a12] px-4 py-12 text-white">
      <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-orange-300/15 bg-[#17121e] p-7 sm:p-9">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-200">ONLINE BAR · Authorized gate staff</p>
        <h1 className="mt-4 text-3xl font-black">Gate sign-in</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">Use the account provided by the ticketing owner. Your scanner only shows events and gates assigned to you.</p>
        <label className="mt-6 block text-xs font-bold text-slate-300">Staff email<input required type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-orange-300" /></label>
        <label className="mt-4 block text-xs font-bold text-slate-300">Password<input required type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-orange-300" /></label>
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-300/20 bg-red-950/30 p-3 text-xs text-red-100">{error}</p>}
        <button disabled={busy} className="mt-5 min-h-11 w-full rounded-xl bg-orange-400 px-5 text-sm font-black text-[#170d18] disabled:opacity-50">{busy ? 'Signing in…' : 'Open assigned scanner'}</button>
      </form>
    </main>
  );
}
