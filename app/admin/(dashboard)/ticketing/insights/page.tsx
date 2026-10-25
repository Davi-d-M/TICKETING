'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowLeft, BarChart3, CalendarDays, MapPin, RefreshCw, Search, SlidersHorizontal, Ticket, Users, Wallet } from 'lucide-react';

type Summary = {
  views: number;
  searches: number;
  zero_result_searches: number;
  filter_uses: number;
  checkout_intents: number;
  visitors: number;
  paid_orders: number;
  revenue_minor: number;
};

type EventInsight = {
  id: string;
  title: string;
  city: string;
  views: number;
  checkout_intents: number;
  visitors: number;
  paid_orders: number;
  revenue_minor: number;
};

type DailyInsight = {
  day: string;
  views: number;
  searches: number;
  zero_result_searches: number;
  checkout_intents: number;
  paid_orders: number;
  revenue_minor: number;
};

type RankedInsight = { query?: string; city?: string; count: number };
type Insights = {
  days: number;
  sampledAt: string;
  summary: Summary;
  events: EventInsight[];
  daily: DailyInsight[];
  unmetSearches: RankedInsight[];
  popularCities: RankedInsight[];
};

function number(value: number | undefined) {
  return (value || 0).toLocaleString('en-KE');
}

function money(value: number | undefined) {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 0
  }).format((value || 0) / 100);
}

export default function TicketDemandInsightsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/ticketing/insights?days=${days}`, { cache: 'no-store' });
      const result = await response.json() as Insights & { error?: string };
      if (!response.ok) throw new Error(result.error || `Demand report failed (${response.status}).`);
      setData(result);
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : 'Ticketing demand insights could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const cards = [
    { label: 'Event detail views', value: data?.summary.views, icon: Ticket },
    { label: 'Anonymous sessions', value: data?.summary.visitors, icon: Users },
    { label: 'Event searches', value: data?.summary.searches, icon: Search },
    { label: 'Zero-result searches', value: data?.summary.zero_result_searches, icon: Search },
    { label: 'Filter selections', value: data?.summary.filter_uses, icon: SlidersHorizontal },
    { label: 'Checkout starts', value: data?.summary.checkout_intents, icon: Wallet },
    { label: 'Verified paid orders', value: data?.summary.paid_orders, icon: Activity },
    { label: 'Paid ticket revenue', value: data ? money(data.summary.revenue_minor) : undefined, icon: BarChart3 }
  ];

  return (
    <main className="min-h-screen bg-[#0d0a12] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-orange-300/15 bg-gradient-to-br from-[#281626] via-[#1b1221] to-[#120e18] p-6 sm:p-9">
          <Link href="/admin/ticketing" className="inline-flex items-center gap-2 text-xs font-bold text-orange-100 hover:text-white"><ArrowLeft size={14} /> Ticketing admin</Link>
          <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-orange-200"><BarChart3 size={14} /> Demand intelligence</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">What the audience wants<span className="text-orange-400">.</span></h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Consent-based anonymous views, searches, filters and checkout starts alongside verified paid orders. This is descriptive reporting, not an ML forecast.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="sr-only" htmlFor="demand-window">Report period</label>
              <select id="demand-window" value={days} onChange={event => setDays(Number(event.target.value))} className="min-h-10 rounded-xl border border-white/15 bg-[#17121e] px-3 text-xs font-bold text-white">
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
              <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/15 px-3 text-xs font-bold hover:bg-white/5 disabled:opacity-50"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
            </div>
          </div>
        </header>

        {error && <div role="alert" className="rounded-2xl border border-red-300/25 bg-red-950/25 p-4 text-sm text-red-100">{error}</div>}

        <section aria-label="Demand metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map(card => {
            const Icon = card.icon;
            return (
              <article key={card.label} className="rounded-2xl border border-white/10 bg-[#17121e] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">{card.label}</p>
                  <Icon size={16} className="text-orange-200" />
                </div>
                <p className="mt-3 text-2xl font-black">{loading && !data ? '—' : card.value}</p>
              </article>
            );
          })}
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-[#17121e] p-5">
            <h2 className="flex items-center gap-2 text-sm font-black"><Search size={15} className="text-orange-200" /> Unmet search demand</h2>
            <p className="mt-1 text-xs leading-5 text-slate-400">Searches with no matching events. Contact-like search strings are excluded at collection.</p>
            {data?.unmetSearches.length ? (
              <ol className="mt-4 divide-y divide-white/10">
                {data.unmetSearches.map(item => <li key={item.query} className="flex justify-between gap-3 py-2.5 text-sm"><span className="min-w-0 break-words">{item.query}</span><span className="shrink-0 text-xs text-slate-400">{number(item.count)} searches</span></li>)}
              </ol>
            ) : <p className="mt-4 text-xs text-slate-500">{loading ? 'Loading report…' : 'No zero-result searches recorded in this period.'}</p>}
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#17121e] p-5">
            <h2 className="flex items-center gap-2 text-sm font-black"><MapPin size={15} className="text-orange-200" /> Popular city filters</h2>
            <p className="mt-1 text-xs leading-5 text-slate-400">Cities visitors actively selected in event discovery.</p>
            {data?.popularCities.length ? (
              <ol className="mt-4 divide-y divide-white/10">
                {data.popularCities.map(item => <li key={item.city} className="flex justify-between gap-3 py-2.5 text-sm"><span>{item.city}</span><span className="text-xs text-slate-400">{number(item.count)} selections</span></li>)}
              </ol>
            ) : <p className="mt-4 text-xs text-slate-500">{loading ? 'Loading report…' : 'No city filters recorded in this period.'}</p>}
          </section>
        </div>

        <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#17121e]">
          <div className="border-b border-white/10 p-5">
            <h2 className="text-sm font-black">Event demand and sales</h2>
            <p className="mt-1 text-xs text-slate-400">Event views and checkout starts are anonymous and consent based. Sales totals use paid ticket orders.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="bg-white/[0.03] text-[9px] uppercase tracking-wider text-slate-400">
                <tr><th className="px-4 py-3">Event</th><th className="px-4 py-3">City</th><th className="px-4 py-3">Detail views</th><th className="px-4 py-3">Anonymous sessions</th><th className="px-4 py-3">Checkout starts</th><th className="px-4 py-3">Paid orders</th><th className="px-4 py-3">Paid revenue</th></tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {data?.events.map(event => (
                  <tr key={event.id} className="text-slate-200">
                    <td className="max-w-[260px] truncate px-4 py-3 font-bold">{event.title}</td><td className="px-4 py-3">{event.city}</td><td className="px-4 py-3">{number(event.views)}</td><td className="px-4 py-3">{number(event.visitors)}</td><td className="px-4 py-3">{number(event.checkout_intents)}</td><td className="px-4 py-3">{number(event.paid_orders)}</td><td className="px-4 py-3">{money(event.revenue_minor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && !data?.events.length && <p className="p-5 text-xs text-slate-500">No event demand or paid ticket activity is available for this period.</p>}
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#17121e] p-5">
          <h2 className="flex items-center gap-2 text-sm font-black"><CalendarDays size={15} className="text-orange-200" /> Daily activity</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="text-[9px] uppercase tracking-wider text-slate-400"><tr><th className="px-3 py-2">Day</th><th className="px-3 py-2">Views</th><th className="px-3 py-2">Searches</th><th className="px-3 py-2">No results</th><th className="px-3 py-2">Checkout starts</th><th className="px-3 py-2">Paid orders</th><th className="px-3 py-2">Revenue</th></tr></thead>
              <tbody className="divide-y divide-white/10">
                {data?.daily.slice().reverse().map(day => <tr key={day.day}><td className="px-3 py-2.5 text-slate-300">{new Date(`${day.day}T00:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}</td><td className="px-3 py-2.5">{number(day.views)}</td><td className="px-3 py-2.5">{number(day.searches)}</td><td className="px-3 py-2.5">{number(day.zero_result_searches)}</td><td className="px-3 py-2.5">{number(day.checkout_intents)}</td><td className="px-3 py-2.5">{number(day.paid_orders)}</td><td className="px-3 py-2.5">{money(day.revenue_minor)}</td></tr>)}
              </tbody>
            </table>
          </div>
        </section>

        {data?.sampledAt && <p className="text-right text-[10px] text-slate-500">Report generated {new Date(data.sampledAt).toLocaleString('en-KE')}</p>}
      </div>
    </main>
  );
}
