'use client';

import Link from 'next/link';
import Image from 'next/image';
import { FormEvent, useState } from 'react';
import { Ghost, KeyRound, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';

export default function TicketingLoginPage() {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [provisioningQr, setProvisioningQr] = useState('');
  const [provisioningSecret, setProvisioningSecret] = useState('');
  const [code, setCode] = useState('');

  async function beginSetup() {
    const response = await fetch('/api/admin/mfa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setup' })
    });
    const result = await response.json().catch(() => ({})) as { error?: string; provisioningUri?: string; secret?: string };
    if (!response.ok || !result.provisioningUri || !result.secret) {
      throw new Error(result.error || `Authenticator setup failed (${response.status}).`);
    }
    setProvisioningQr(await QRCode.toDataURL(result.provisioningUri, { errorCorrectionLevel: 'M', margin: 1, width: 240 }));
    setProvisioningSecret(result.secret);
  }

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
      const result = await response.json().catch(() => ({})) as { error?: string; mfaRequired?: boolean; setupRequired?: boolean };
      if (!response.ok) throw new Error(result.error || `Sign-in failed (${response.status}).`);
      setMfaRequired(result.mfaRequired === true);
      setSetupRequired(result.setupRequired === true);
      if (result.setupRequired) await beginSetup();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in could not be completed.');
      setSubmitting(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const response = await fetch('/api/admin/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', code })
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || `Authenticator verification failed (${response.status}).`);
      window.location.assign('/admin/ticketing');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Authenticator verification could not be completed.');
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0d0a12] px-4 py-10 text-white">
      <div aria-hidden="true" className="pointer-events-none absolute -left-32 top-10 h-80 w-80 rounded-full bg-orange-500/10 blur-[100px]" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-violet-600/10 blur-[100px]" />
      <section className="relative w-full max-w-md rounded-3xl border border-orange-300/15 bg-gradient-to-br from-[#251523] via-[#1b1221] to-[#120e18] p-6 shadow-2xl shadow-black/30 sm:p-9">
        <Link href="/tickets" className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-orange-200"><Ghost size={14} /> MIDNIGHT SOCIETY KE · Ticketing</Link>
        <div className="mt-8 flex h-12 w-12 items-center justify-center rounded-2xl border border-violet-300/20 bg-violet-300/10 text-violet-200"><KeyRound size={21} /></div>
        <h1 className="mt-5 text-3xl font-black tracking-tight">Admin access<span className="text-orange-400">.</span></h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">Sign in to manage Ticketing events and review operational records.</p>
        {!mfaRequired ? <form onSubmit={submit} className="mt-7 space-y-4">
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
        </form> : <form onSubmit={verify} className="mt-7 space-y-4">
          <div className="rounded-xl border border-violet-300/15 bg-violet-300/5 p-4">
            <p className="text-sm font-bold text-white">{setupRequired ? 'Set up your authenticator app' : 'Verify your authenticator'}</p>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              {setupRequired
                ? 'Scan this QR code with an authenticator app, then enter the six-digit code it generates.'
                : 'Enter the current six-digit code from your enrolled authenticator app.'}
            </p>
          </div>
          {setupRequired && provisioningQr && <div className="flex flex-col items-center gap-3 rounded-xl bg-white p-4">
            <Image src={provisioningQr} alt="Authenticator enrollment QR code" width={200} height={200} unoptimized />
            <p className="break-all text-center font-mono text-xs text-slate-900">{provisioningSecret}</p>
          </div>}
          {setupRequired && !provisioningQr && <button type="button" disabled={submitting} onClick={() => {
            setSubmitting(true);
            setError('');
            void beginSetup().catch(cause => setError(cause instanceof Error ? cause.message : 'Authenticator setup failed.')).finally(() => setSubmitting(false));
          }} className="min-h-10 w-full rounded-xl border border-white/10 text-xs font-bold text-slate-200 disabled:opacity-50">Retry authenticator setup</button>}
          <label className="block text-xs font-bold text-slate-300">
            Six-digit authenticator code
            <input className="mt-1.5 min-h-12 w-full rounded-xl border border-white/10 bg-[#100d17] px-3 text-center font-mono text-lg tracking-[0.4em] text-white outline-none focus:border-orange-400" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required />
          </label>
          {error && <p role="alert" className="rounded-xl border border-red-300/20 bg-red-950/30 p-3 text-xs text-red-100">{error}</p>}
          <button disabled={submitting || code.length !== 6 || (setupRequired && !provisioningQr)} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-400 px-4 text-sm font-black text-[#170d18] transition hover:bg-orange-300 disabled:opacity-50">
            <ShieldCheck size={16} /> {submitting ? 'Verifying…' : setupRequired ? 'Activate authenticator' : 'Verify and continue'}
          </button>
        </form>}
        <p className="mt-5 text-[10px] leading-5 text-slate-500">Admin access requires both your password and an authenticator code. Ticket sales remain subject to the separate release controls.</p>
      </section>
    </main>
  );
}
