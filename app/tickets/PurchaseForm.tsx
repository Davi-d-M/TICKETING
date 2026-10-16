'use client';

import { FormEvent, useRef, useState } from 'react';

type Props = {
  eventId: string;
  ticketTypeId: string;
  name: string;
  price: string;
  currency: string;
  min: number;
  max: number;
  enabled: boolean;
};

export default function PurchaseForm({ eventId, ticketTypeId, name, price, currency, min, max, enabled }: Props) {
  const idempotencyKey = useRef<string | null>(null);
  const [quantity, setQuantity] = useState(min);
  const [buyerName, setBuyerName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || saving) return;
    setSaving(true);
    setError('');
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch('/api/ticketing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          ticketTypeId,
          quantity,
          name: buyerName,
          email,
          idempotencyKey: idempotencyKey.current
        })
      });
      const result = await response.json() as { checkoutUrl?: string; error?: string };
      if (!response.ok || !result.checkoutUrl) {
        throw new Error(result.error || 'Checkout could not be started.');
      }
      window.location.assign(result.checkoutUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Checkout could not be started.');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 border-t border-white/[0.07] pt-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-[10px] font-bold text-slate-300">
          Name
          <input required maxLength={160} value={buyerName} onChange={event => { setBuyerName(event.target.value); idempotencyKey.current = null; }} className="mt-1 min-h-10 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-orange-300" autoComplete="name" />
        </label>
        <label className="text-[10px] font-bold text-slate-300">
          Ticket delivery email
          <input required type="email" maxLength={320} value={email} onChange={event => { setEmail(event.target.value); idempotencyKey.current = null; }} className="mt-1 min-h-10 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-orange-300" autoComplete="email" />
        </label>
        <label className="text-[10px] font-bold text-slate-300">
          Quantity
          <select value={quantity} onChange={event => { setQuantity(Number(event.target.value)); idempotencyKey.current = null; }} className="mt-1 min-h-10 w-full rounded-lg border border-white/10 bg-[#17121e] px-3 text-sm text-white outline-none focus:border-orange-300">
            {Array.from({ length: max - min + 1 }, (_, index) => min + index).map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <div className="self-end text-xs text-slate-400">Total: <strong className="text-orange-100">{new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 2 }).format((Number(price) * quantity) / 100)}</strong></div>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-300/20 bg-red-950/30 p-3 text-xs text-red-100">{error}</p>}
      <button disabled={!enabled || saving} className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-orange-400 px-4 text-xs font-black text-[#170d18] transition hover:bg-orange-300 disabled:cursor-not-allowed disabled:opacity-50">
        {saving ? 'Connecting securely…' : `Continue to Paystack · ${name}`}
      </button>
      <p className="text-[10px] leading-4 text-slate-500">You’ll pay through Paystack. Tickets are issued only after server-side payment verification and sent to this email.</p>
    </form>
  );
}
