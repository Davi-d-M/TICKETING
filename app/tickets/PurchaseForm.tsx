'use client';

import { FormEvent, useRef, useState } from 'react';
import { recordTicketingDemand } from '@/lib/ticketing/demandSignals';

type Props = {
  eventId: string;
  ticketTypeId: string;
  name: string;
  price: string;
  serviceFeeMinor: number;
  currency: string;
  min: number;
  max: number;
  enabled: boolean;
};

type Quote = {
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  promotionCode: string;
  subtotalMinor: number;
  feesMinor: number;
  discountMinor: number;
  totalMinor: number;
};

export default function PurchaseForm({ eventId, ticketTypeId, name, price, serviceFeeMinor, currency, min, max, enabled }: Props) {
  const idempotencyKey = useRef<string | null>(null);
  const [quantity, setQuantity] = useState(min);
  const [buyerName, setBuyerName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [promotionCode, setPromotionCode] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const unitPrice = Number(price);
  const subtotal = unitPrice * quantity;
  const baseFees = serviceFeeMinor * quantity;
  const appliedQuote = quote?.eventId === eventId && quote.ticketTypeId === ticketTypeId
    && quote.quantity === quantity && quote.promotionCode === promotionCode.trim().toUpperCase()
    ? quote : null;
  const total = appliedQuote?.totalMinor ?? subtotal + baseFees;
  const formatMoney = (minor: number) => new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2
  }).format(minor / 100);

  async function applyPromotion() {
    setQuoting(true);
    setQuoteError('');
    setQuote(null);
    try {
      const response = await fetch('/api/ticketing/checkout/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          ticketTypeId,
          quantity,
          promotionCode
        })
      });
      const result = await response.json() as Quote & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Discount code could not be checked.');
      setQuote(result);
    } catch (cause) {
      setQuoteError(cause instanceof Error ? cause.message : 'Discount code could not be checked.');
    } finally {
      setQuoting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || saving) return;
    if (promotionCode.trim() && !appliedQuote) {
      setError('Apply your discount code to confirm the total before checkout.');
      return;
    }
    setSaving(true);
    setError('');
    recordTicketingDemand({ type: 'checkout_intent', eventId, metadata: { quantity } });
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
          promotionCode: promotionCode.trim().toUpperCase(),
          expectedTotalMinor: Math.round(total),
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
          <select value={quantity} onChange={event => { setQuantity(Number(event.target.value)); setQuote(null); setQuoteError(''); idempotencyKey.current = null; }} className="mt-1 min-h-10 w-full rounded-lg border border-white/10 bg-[#17121e] px-3 text-sm text-white outline-none focus:border-orange-300">
            {Array.from({ length: max - min + 1 }, (_, index) => min + index).map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="text-[10px] font-bold text-slate-300">
          Discount code (optional)
          <input value={promotionCode} onChange={event => { setPromotionCode(event.target.value.toUpperCase()); setQuote(null); setQuoteError(''); idempotencyKey.current = null; }} maxLength={40} autoCapitalize="characters" className="mt-1 min-h-10 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-orange-300" placeholder="Enter code" />
        </label>
        <button type="button" onClick={() => void applyPromotion()} disabled={!promotionCode.trim() || quoting || !enabled} className="self-end min-h-10 rounded-lg border border-orange-200/20 px-3 text-xs font-bold text-orange-100 hover:bg-orange-200/5 disabled:cursor-not-allowed disabled:opacity-40">
          {quoting ? 'Checking…' : 'Apply code'}
        </button>
      </div>
      <div className="space-y-1 rounded-xl border border-white/[0.08] bg-black/15 p-3 text-xs">
        <p className="flex justify-between gap-3 text-slate-400"><span>{quantity} × {name}</span><span>{formatMoney(subtotal)}</span></p>
        <p className="flex justify-between gap-3 text-slate-400"><span>Service fee ({formatMoney(serviceFeeMinor)} × {quantity})</span><span>{formatMoney(appliedQuote?.feesMinor ?? baseFees)}</span></p>
        {appliedQuote && <p className="flex justify-between gap-3 text-emerald-200"><span>Discount · {appliedQuote.promotionCode}</span><span>−{formatMoney(appliedQuote.discountMinor)}</span></p>}
        <p className="flex justify-between gap-3 border-t border-white/10 pt-2 font-black text-white"><span>Total due</span><span className="text-orange-100">{formatMoney(total)}</span></p>
        {!appliedQuote && <p className="pt-1 text-[10px] leading-4 text-slate-500">The displayed total includes all event service fees. Any discount is revalidated before payment.</p>}
      </div>
      {quoteError && <p role="alert" className="rounded-lg border border-amber-300/20 bg-amber-950/20 p-3 text-xs text-amber-100">{quoteError}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-300/20 bg-red-950/30 p-3 text-xs text-red-100">{error}</p>}
      <button disabled={!enabled || saving} className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-orange-400 px-4 text-xs font-black text-[#170d18] transition hover:bg-orange-300 disabled:cursor-not-allowed disabled:opacity-50">
        {saving ? 'Connecting securely…' : 'Continue to secure checkout'}
      </button>
      <p className="text-[10px] leading-4 text-slate-500">You’ll see this full amount at Paystack. The server rechecks the price, service fee, discount and inventory before payment. Tickets are issued only after server-side payment verification and sent to this email.</p>
    </form>
  );
}
