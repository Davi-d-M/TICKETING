'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Fingerprint,
  Ghost,
  KeyRound,
  MapPin,
  Plus,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  Ticket,
  Users,
  Wallet
} from 'lucide-react';

type TicketType = {
  id: string;
  event_id: string;
  name: string;
  description: string;
  price_minor: number;
  currency: string;
  capacity: number;
  min_per_order: number;
  max_per_order: number;
  sales_start_at: string | null;
  sales_end_at: string | null;
  status: string;
};

type TicketEvent = {
  id: string;
  title: string;
  slug: string;
  description: string;
  venue_name: string;
  venue_address: string;
  city: string;
  timezone: string;
  starts_at: string;
  ends_at: string;
  age_limit: number | null;
  capacity: number | null;
  status: string;
  created_at: string;
  ticket_types: TicketType[];
};

type DashboardData = {
  events: TicketEvent[];
  totals: { events: number; tickets: number; orders: number };
  salesReady: boolean;
  canPublish: boolean;
};

const inputClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-white/10 bg-[#17121e] px-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/15';
const labelClass = 'block text-xs font-bold text-slate-300';

function money(minor: number, currency = 'KES') {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 2 }).format(minor / 100);
}

function eventDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date to be confirmed' : date.toLocaleString('en-KE', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function statusLabel(status: string) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase());
}

async function readResponse(response: Response) {
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(result.error || `Ticketing request failed (${response.status}).`);
  return result;
}

function EventForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(formData: FormData) {
    setSaving(true);
    setError('');
    try {
      await readResponse(await fetch('/api/admin/ticketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_event',
          title: formData.get('title'),
          description: formData.get('description'),
          venueName: formData.get('venueName'),
          venueAddress: formData.get('venueAddress'),
          city: formData.get('city'),
          startsAt: formData.get('startsAt'),
          endsAt: formData.get('endsAt'),
          doorsOpenAt: formData.get('doorsOpenAt'),
          capacity: formData.get('capacity'),
          ageLimit: formData.get('ageLimit'),
          cancellationPolicy: formData.get('cancellationPolicy')
        })
      }));
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The event could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form action={submit} className="rounded-2xl border border-orange-400/20 bg-[#17121e] p-5 shadow-xl shadow-black/20 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-white">Create an event draft</h2>
          <p className="mt-1 text-sm text-slate-400">Drafts are private and cannot accept ticket sales.</p>
        </div>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-xs font-bold text-slate-400 hover:bg-white/5">Close</button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={`${labelClass} sm:col-span-2`}>Event name<input className={inputClass} name="title" required minLength={3} maxLength={160} placeholder="Midnight Society KE" /></label>
        <label className={labelClass}>Venue<input className={inputClass} name="venueName" required minLength={2} maxLength={180} placeholder="Venue name" /></label>
        <label className={labelClass}>City<input className={inputClass} name="city" required minLength={2} maxLength={100} defaultValue="Nairobi" /></label>
        <label className={`${labelClass} sm:col-span-2`}>Venue address<input className={inputClass} name="venueAddress" maxLength={500} placeholder="Street, area, directions" /></label>
        <label className={labelClass}>Event starts<input className={inputClass} name="startsAt" type="datetime-local" required /></label>
        <label className={labelClass}>Event ends<input className={inputClass} name="endsAt" type="datetime-local" required /></label>
        <label className={labelClass}>Doors open (optional)<input className={inputClass} name="doorsOpenAt" type="datetime-local" /></label>
        <label className={labelClass}>Capacity (optional)<input className={inputClass} name="capacity" type="number" min="1" max="1000000" placeholder="Set venue limit" /></label>
        <label className={labelClass}>Minimum age (optional)<input className={inputClass} name="ageLimit" type="number" min="0" max="120" placeholder="No restriction" /></label>
        <label className={`${labelClass} sm:col-span-2`}>Event description<textarea className={`${inputClass} min-h-24 py-3`} name="description" maxLength={10000} placeholder="Tell guests what the event is about." /></label>
        <label className={`${labelClass} sm:col-span-2`}>Cancellation policy<textarea className={`${inputClass} min-h-20 py-3`} name="cancellationPolicy" maxLength={5000} placeholder="Add the event refund and cancellation terms before publishing." /></label>
      </div>
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <div className="mt-5 flex flex-wrap gap-3">
        <button disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-orange-400 px-5 text-sm font-black text-[#170d18] hover:bg-orange-300 disabled:opacity-50">
          <CheckCircle2 size={16} /> {saving ? 'Saving draft…' : 'Save event draft'}
        </button>
        <p className="self-center text-xs text-slate-400">Sales stay closed until the platform owner approves the release gates and opens a ready event.</p>
      </div>
    </form>
  );
}

function TierForm({ event, onCreated, onCancel }: { event: TicketEvent; onCreated: () => void; onCancel: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(formData: FormData) {
    setSaving(true);
    setError('');
    try {
      await readResponse(await fetch('/api/admin/ticketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_ticket_type',
          eventId: event.id,
          name: formData.get('name'),
          description: formData.get('description'),
          price: formData.get('price'),
          capacity: formData.get('capacity'),
          minPerOrder: formData.get('minPerOrder'),
          maxPerOrder: formData.get('maxPerOrder'),
          salesStartAt: formData.get('salesStartAt'),
          salesEndAt: formData.get('salesEndAt')
        })
      }));
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The ticket tier could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form action={submit} className="mt-4 rounded-xl border border-white/10 bg-[#100d17] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h4 className="text-sm font-black text-white">Add ticket tier</h4>
        <button type="button" onClick={onCancel} className="text-xs font-bold text-slate-400">Cancel</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className={labelClass}>Tier name<input className={inputClass} name="name" required maxLength={100} placeholder="Early Bird" /></label>
        <label className={labelClass}>Price (KES)<input className={inputClass} name="price" required type="number" min="0" max="999999999" step="0.01" placeholder="2500.00" /></label>
        <label className={labelClass}>Allocation<input className={inputClass} name="capacity" required type="number" min="1" max="1000000" placeholder="100" /></label>
        <label className={`${labelClass} sm:col-span-2 lg:col-span-3`}>Description<input className={inputClass} name="description" maxLength={2000} placeholder="What's included with this tier?" /></label>
        <label className={labelClass}>Minimum per order<input className={inputClass} name="minPerOrder" required type="number" min="1" max="100" defaultValue="1" /></label>
        <label className={labelClass}>Maximum per order<input className={inputClass} name="maxPerOrder" required type="number" min="1" max="100" defaultValue="10" /></label>
        <label className={labelClass}>Sales open<input className={inputClass} name="salesStartAt" type="datetime-local" /></label>
        <label className={labelClass}>Sales close<input className={inputClass} name="salesEndAt" type="datetime-local" /></label>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <button disabled={saving} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg bg-orange-400 px-4 text-sm font-black text-[#170d18] hover:bg-orange-300 disabled:opacity-50">
        <Plus size={15} /> {saving ? 'Saving tier…' : 'Save ticket tier'}
      </button>
    </form>
  );
}

function EventCard({ event, onRefresh, salesReady, canPublish }: {
  event: TicketEvent;
  onRefresh: () => void;
  salesReady: boolean;
  canPublish: boolean;
}) {
  const [addingTier, setAddingTier] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState('');
  const allocated = event.ticket_types.reduce((total, tier) => total + tier.capacity, 0);
  async function setStatus(status: 'scheduled' | 'on_sale') {
    setStatusSaving(true);
    setStatusError('');
    try {
      const response = await fetch('/api/admin/ticketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_event_status', eventId: event.id, status })
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'The event status could not be updated.');
      onRefresh();
    } catch (cause) {
      setStatusError(cause instanceof Error ? cause.message : 'The event status could not be updated.');
    } finally {
      setStatusSaving(false);
    }
  }
  return (
    <article className="overflow-hidden rounded-2xl border border-white/10 bg-[#17121e] shadow-xl shadow-black/20">
      <div className="border-b border-white/10 bg-gradient-to-r from-[#211326] via-[#251526] to-[#17121e] p-5 text-white sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-orange-300/30 bg-orange-300/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-orange-200">{statusLabel(event.status)}</span>
              {event.age_limit !== null && <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold text-white/80">{event.age_limit}+</span>}
            </div>
            <h3 className="text-xl font-black tracking-tight sm:text-2xl">{event.title}</h3>
            <p className="mt-2 flex items-center gap-2 text-sm text-white/70"><MapPin size={14} />{event.venue_name} · {event.city}</p>
            <p className="mt-1 flex items-center gap-2 text-xs text-white/60"><CalendarDays size={13} />{eventDate(event.starts_at)}</p>
          </div>
          <div className="rounded-xl border border-orange-300/15 bg-orange-300/5 px-4 py-3 text-right">
            <p className="text-2xl font-black">{event.ticket_types.length}</p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-orange-100/60">Ticket tiers</p>
          </div>
        </div>
        {event.description && <p className="mt-4 max-w-3xl text-sm leading-6 text-white/75">{event.description}</p>}
      </div>
      <div className="p-5 sm:p-6">
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/5 bg-white/[0.035] p-3"><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Event capacity</p><p className="mt-1 text-sm font-black text-white">{event.capacity ? event.capacity.toLocaleString('en-KE') : 'Not set'}</p></div>
          <div className="rounded-xl border border-white/5 bg-white/[0.035] p-3"><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Tier allocation</p><p className="mt-1 text-sm font-black text-white">{allocated.toLocaleString('en-KE')}{event.capacity ? ` / ${event.capacity.toLocaleString('en-KE')}` : ''}</p></div>
          <div className="rounded-xl border border-white/5 bg-white/[0.035] p-3"><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Event ends</p><p className="mt-1 text-sm font-black text-white">{eventDate(event.ends_at)}</p></div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-black text-white">Ticket tiers</h4>
            <p className="mt-1 text-xs text-slate-400">Price snapshots and allocations are isolated from Online Bar product inventory.</p>
          </div>
          {event.status === 'draft' || event.status === 'scheduled' ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setAddingTier(value => !value)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-black text-orange-100 hover:bg-white/5">
                <Plus size={14} /> Add tier
              </button>
              {canPublish && <button type="button" onClick={() => void setStatus('on_sale')} disabled={!salesReady || statusSaving || event.ticket_types.length === 0} title={!salesReady ? 'Release gates are not configured.' : event.ticket_types.length === 0 ? 'Add a ticket tier before opening sales.' : ''} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-orange-400 px-3 text-xs font-black text-[#170d18] hover:bg-orange-300 disabled:cursor-not-allowed disabled:opacity-40">{statusSaving ? 'Updating…' : 'Open sales'}</button>}
            </div>
          ) : <span className="text-xs font-semibold text-slate-500">Tiers locked for this event state</span>}
        </div>
        {event.status === 'on_sale' && <button type="button" onClick={() => void setStatus('scheduled')} disabled={statusSaving} className="mt-3 min-h-9 rounded-lg border border-amber-200/20 px-3 text-xs font-bold text-amber-100 hover:bg-amber-100/5 disabled:opacity-50">{statusSaving ? 'Updating…' : 'Pause ticket sales'}</button>}
        {statusError && <p role="alert" className="mt-3 text-xs text-red-200">{statusError}</p>}
        {event.ticket_types.length > 0 ? (
          <div className="mt-4 divide-y divide-white/10 rounded-xl border border-white/10">
            {event.ticket_types.map(tier => (
              <div key={tier.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 rounded-lg bg-orange-400/10 p-2 text-orange-300"><Ticket size={15} /></span>
                  <div className="min-w-0"><p className="truncate text-sm font-black text-white">{tier.name}</p><p className="mt-1 text-xs text-slate-400">{tier.description || 'No tier description'} · {tier.min_per_order}–{tier.max_per_order} per order</p></div>
                </div>
                <div className="text-right"><p className="text-sm font-black text-orange-100">{money(tier.price_minor, tier.currency)}</p><p className="mt-1 text-xs text-slate-400">{tier.capacity.toLocaleString('en-KE')} allocated · {statusLabel(tier.status)}</p></div>
              </div>
            ))}
          </div>
        ) : <p className="mt-4 rounded-xl border border-dashed border-white/15 p-4 text-sm text-slate-400">No ticket tiers yet. Add tiers before moving this event toward review.</p>}
        {addingTier && <TierForm event={event} onCancel={() => setAddingTier(false)} onCreated={() => { setAddingTier(false); onRefresh(); }} />}
      </div>
    </article>
  );
}

export default function TicketingPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addingEvent, setAddingEvent] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await readResponse(await fetch('/api/admin/ticketing', { cache: 'no-store' })) as DashboardData);
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : 'Ticketing could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visibleEvents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return data?.events || [];
    return (data?.events || []).filter(event => `${event.title} ${event.venue_name} ${event.city}`.toLowerCase().includes(normalized));
  }, [data, query]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0d0a12] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div aria-hidden="true" className="pointer-events-none absolute -left-36 top-20 h-96 w-96 rounded-full bg-orange-500/10 blur-[110px]" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-32 top-[34rem] h-96 w-96 rounded-full bg-violet-600/10 blur-[110px]" />
      <div className="relative mx-auto max-w-7xl space-y-6">
        <header className="relative isolate overflow-hidden rounded-3xl border border-orange-300/15 bg-gradient-to-br from-[#281626] via-[#1b1221] to-[#120e18] p-6 shadow-2xl shadow-black/30 sm:p-9">
          <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-24 -z-10 h-72 w-72 rounded-full bg-orange-500/15 blur-[75px]" />
          <div aria-hidden="true" className="pointer-events-none absolute bottom-[-8rem] right-1/3 -z-10 h-64 w-64 rounded-full bg-violet-500/10 blur-[80px]" />
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-orange-300/25 bg-orange-300/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-orange-200"><Ghost size={14} /> Halloween night shift <span className="text-orange-100/40">/</span> Ticketing</div>
              <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-5xl">Tickets after dark<span className="text-orange-400">.</span></h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">A haunted-by-design command centre for your events, ticket tiers and trust controls. Event ticket data stays isolated from drink orders, product stock and existing payouts.</p>
            </div>
            <div className="flex gap-2">
              <Link href="/admin/ticketing/scan" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-orange-300/20 bg-orange-300/5 px-4 text-sm font-bold text-orange-100 transition hover:bg-orange-300/10"><ScanLine size={15} /> Gate scanner</Link>
              <Link href="/admin/ticketing/transfers" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-300/20 bg-amber-300/5 px-4 text-sm font-bold text-amber-100 transition hover:bg-amber-300/10"><Users size={15} /> Transfer review</Link>
              <Link href="/admin/ticketing/security" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-300/20 bg-violet-300/5 px-4 text-sm font-bold text-violet-100 transition hover:bg-violet-300/10"><ShieldAlert size={15} /> Trust centre</Link>
              <Link href="/admin/ticketing/live" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-300/5 px-4 text-sm font-bold text-emerald-100 transition hover:bg-emerald-300/10"><ScanLine size={15} /> Live operations</Link>
              <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.03] px-4 text-sm font-bold text-white transition hover:border-white/25 hover:bg-white/10 disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh</button>
              <button type="button" onClick={() => setAddingEvent(value => !value)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-orange-400 px-4 text-sm font-black text-[#170d18] shadow-lg shadow-orange-950/30 transition hover:bg-orange-300"><Plus size={16} /> New event</button>
            </div>
          </div>
          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <Metric icon={CalendarDays} label="Events in system" value={data?.totals.events} />
            <Metric icon={Ticket} label="Tickets issued" value={data?.totals.tickets} />
            <Metric icon={Wallet} label="Orders recorded" value={data?.totals.orders} />
          </div>
        </header>

        <section role="status" className="relative overflow-hidden rounded-2xl border border-orange-400/25 bg-gradient-to-r from-orange-950/50 via-[#20131f] to-[#171220] p-4 sm:p-5">
          <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-16 h-40 w-40 rounded-full bg-orange-400/10 blur-3xl" />
          <div className="relative flex items-start gap-3">
            <span className="rounded-xl border border-orange-300/20 bg-orange-300/10 p-2 text-orange-300"><AlertTriangle size={18} /></span>
            <div className="flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-black text-orange-100">{data?.salesReady ? 'Sandbox checkout release gate is configured' : 'Sales are locked for now'}</p><span className="rounded-full border border-orange-300/20 bg-orange-300/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-orange-200">{data?.salesReady ? 'Owner approval required' : 'No checkout enabled'}</span></div><p className="mt-1 text-xs leading-5 text-orange-50/70">Paystack checkout verifies payment server-side, then issues encrypted tickets and emails a one-time wallet link. Gate staff use individually authenticated, event-and-gate-assigned scanner accounts. Open sales only after applying all five migrations, configuring provider, email, guest and gate secrets, and completing end-to-end acceptance tests.</p></div>
          </div>
        </section>

        <section aria-labelledby="trust-heading" className="overflow-hidden rounded-3xl border border-violet-300/15 bg-gradient-to-br from-[#1a1421] to-[#120f18] p-5 shadow-xl shadow-black/20 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-violet-200"><ShieldAlert size={14} /> Trust & security centre</div>
              <h2 id="trust-heading" className="mt-2 text-xl font-black tracking-tight text-white sm:text-2xl">Keep the tricks out. Keep the tickets real.</h2>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-400">A clear view of the controls in the attached security blueprint. Readiness labels reflect this build; this panel is not a live fraud-monitoring feed.</p>
            </div>
            <span className="rounded-full border border-violet-300/20 bg-violet-300/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-violet-200">Foundation phase</span>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SecurityControl icon={BadgeCheck} title="Verified purchase" state="Foundation" body="Paystack signed webhooks and server verification confirm exact KES order amounts; unmatched payments are flagged for reconciliation." />
            <SecurityControl icon={KeyRound} title="Authentic ticket" state="Foundation" body="Tickets issue only after verified payment; credentials are encrypted at rest and delivered through one-time guest wallet links." />
            <SecurityControl icon={ScanLine} title="Gate admission" state="Foundation" body="Online scans require platform-admin access or an authenticated, assigned staff account. First entry is atomically claimed; retries are idempotent. Offline mode is not enabled." />
            <SecurityControl icon={Fingerprint} title="Staff & oversight" state="Foundation" body="Draft and tier writes create audit entries; MFA, dual approval and a security case feed are not live." />
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-white/5 bg-black/20 p-3 text-[11px] leading-5 text-slate-400">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-violet-300" />
            <p>QR screenshots and payment messages are not proof of a valid ticket. Keep the release gate off until sandbox callbacks, guest email delivery, scanner behavior and database migrations have been exercised end-to-end.</p>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <Feature icon={ShieldCheck} title="Isolated ticket records" body="Ticketing uses its own event, tier, reservation, payment, ticket, refund and check-in data." />
          <Feature icon={Clock3} title="Inventory and payment tracking" body="Short inventory holds, Paystack payment attempts and ticket issuance are tracked in isolated ticketing tables and the live operations feed." />
          <Feature icon={Users} title="Admin-only workspace" body="Ticket administration is restricted to platform owners and admins." />
        </section>

        {addingEvent && <EventForm onCancel={() => setAddingEvent(false)} onCreated={() => { setAddingEvent(false); void load(); }} />}

        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><div className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-300">Event vault</div><h2 className="mt-1 text-xl font-black tracking-tight text-white">Your events</h2><p className="mt-1 text-sm text-slate-400">Create private drafts, then add ticket tiers and allocations.</p></div>
            <label className="relative block w-full sm:w-72"><span className="sr-only">Search events</span><input value={query} onChange={event => setQuery(event.target.value)} className={inputClass} placeholder="Search events, venues or cities" /></label>
          </div>
          {error && <div role="alert" className="rounded-2xl border border-red-300/20 bg-red-950/30 p-4 text-sm text-red-200">{error}<button type="button" onClick={() => void load()} className="ml-2 font-black underline">Try again</button></div>}
          {loading && !data && <div className="rounded-2xl border border-white/10 bg-[#17121e] p-10 text-center text-sm text-slate-400">Opening the event vault…</div>}
          {!loading && !error && visibleEvents.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/15 bg-[#17121e]/80 p-10 text-center">
              <CalendarDays className="mx-auto text-orange-300" size={30} />
              <h3 className="mt-3 text-lg font-black text-white">{query ? 'No matching events' : 'The vault is waiting for its first event'}</h3>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-400">{query ? 'Try another event name, venue or city.' : 'Create a private event draft, add ticket tiers, then complete payment and security setup before opening sales.'}</p>
              {!query && <button type="button" onClick={() => setAddingEvent(true)} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-orange-400 px-5 text-sm font-black text-[#170d18] hover:bg-orange-300"><Plus size={16} /> Create event draft</button>}
            </div>
          )}
          {visibleEvents.map(event => <EventCard key={event.id} event={event} onRefresh={() => void load()} salesReady={data?.salesReady || false} canPublish={data?.canPublish || false} />)}
        </section>

        <footer className="rounded-2xl border border-orange-300/15 bg-[#17121e] p-5">
          <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-orange-300" size={19} /><div><p className="text-sm font-black text-white">Release gate: not cleared</p><p className="mt-1 text-xs leading-5 text-slate-400">Do not publish or accept customer payments until server-verified provider callbacks, atomic reservation expiry, idempotent ticket issuance, customer ownership checks, refund reconciliation and online gate validation are implemented and tested.</p></div><ArrowUpRight className="ml-auto hidden text-slate-500 sm:block" size={16} /></div>
        </footer>
      </div>
    </main>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Ticket; label: string; value?: number }) {
  return <div className="rounded-2xl border border-white/10 bg-black/20 p-4 backdrop-blur-sm"><div className="flex items-center justify-between text-slate-300"><p className="text-[10px] font-black uppercase tracking-[0.15em]">{label}</p><Icon size={16} className="text-orange-300" /></div><p className="mt-2 text-2xl font-black">{value === undefined ? '—' : value.toLocaleString('en-KE')}</p></div>;
}

function Feature({ icon: Icon, title, body }: { icon: typeof Ticket; title: string; body: string }) {
  return <article className="rounded-2xl border border-white/10 bg-[#17121e] p-4 shadow-lg shadow-black/10"><div className="flex items-center gap-2 text-orange-300"><Icon size={16} /><h3 className="text-xs font-black uppercase tracking-wide text-slate-200">{title}</h3></div><p className="mt-2 text-xs leading-5 text-slate-400">{body}</p></article>;
}

function SecurityControl({ icon: Icon, title, state, body }: { icon: typeof Ticket; title: string; state: 'Not live' | 'Foundation'; body: string }) {
  const isFoundation = state === 'Foundation';
  return (
    <article className="rounded-2xl border border-white/[0.08] bg-black/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <span className={`rounded-xl p-2 ${isFoundation ? 'bg-violet-300/10 text-violet-200' : 'bg-orange-300/10 text-orange-200'}`}><Icon size={17} /></span>
        <span className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${isFoundation ? 'border-violet-300/20 bg-violet-300/10 text-violet-200' : 'border-orange-300/20 bg-orange-300/10 text-orange-200'}`}>{state}</span>
      </div>
      <h3 className="mt-3 text-sm font-black text-white">{title}</h3>
      <p className="mt-1.5 text-[11px] leading-5 text-slate-400">{body}</p>
    </article>
  );
}
