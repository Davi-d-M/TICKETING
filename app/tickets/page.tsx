import Link from 'next/link';
import type { Metadata } from 'next';
import { CalendarDays, ChevronRight, Clock3, Ghost, MapPin, ShieldCheck, Ticket } from 'lucide-react';
import { getPublicTicketEvents, type PublicTicketEvent } from '@/lib/ticketing/publicEvents.server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Halloween Tickets | Midnight Society KE',
  description: 'Find your next after-dark event with Midnight Society KE Ticketing.'
};

function formatEventDate(value: string, timezone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date to be announced';
  return new Intl.DateTimeFormat('en-KE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone
  }).format(date);
}

function formatPrice(amount: number, currency: string) {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: currency.trim(),
    maximumFractionDigits: 2
  }).format(amount / 100);
}

function EventCard({ event }: { event: PublicTicketEvent }) {
  const prices = event.ticket_types.map(ticketType => ticketType.price_minor);
  const lowestPrice = Math.min(...prices);

  return (
    <article className="group overflow-hidden rounded-3xl border border-white/10 bg-[#17121e] shadow-xl shadow-black/20 transition duration-300 hover:-translate-y-1 hover:border-orange-300/30 hover:shadow-orange-950/20">
      <div className="relative isolate min-h-56 overflow-hidden bg-gradient-to-br from-[#39172a] via-[#261329] to-[#15101d] p-6">
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-14 -z-10 h-56 w-56 rounded-full bg-orange-500/20 blur-[70px]" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-20 left-1/4 -z-10 h-48 w-48 rounded-full bg-violet-500/15 blur-[70px]" />
        <div className="flex items-start justify-between gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-orange-300/20 bg-black/20 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-orange-100"><Ghost size={13} /> After dark</span>
          {event.age_limit !== null && <span className="rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-[10px] font-black text-white/80">{event.age_limit}+</span>}
        </div>
        <div className="absolute bottom-6 left-6 right-6">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-200/75">{event.city}</p>
          <h2 className="mt-2 max-w-xl text-2xl font-black tracking-tight text-white sm:text-3xl">{event.title}</h2>
          <p className="mt-2 flex items-center gap-2 text-xs text-white/65"><MapPin size={13} />{event.venue_name}</p>
        </div>
      </div>
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-300">
          <span className="inline-flex items-center gap-2"><CalendarDays size={14} className="text-orange-300" />{formatEventDate(event.starts_at, event.timezone)}</span>
          {event.doors_open_at && <span className="inline-flex items-center gap-2"><Clock3 size={14} className="text-orange-300" />Doors {formatEventDate(event.doors_open_at, event.timezone)}</span>}
        </div>
        <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-400">{event.description || 'Get ready for a night out. Event details and ticket options are available here.'}</p>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-white/[0.08] pt-4">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">Tickets from</p>
            <p className="mt-1 text-lg font-black text-orange-100">{formatPrice(lowestPrice, event.ticket_types[0]?.currency || 'KES')}</p>
          </div>
          <Link href={`/tickets/${encodeURIComponent(event.slug)}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-orange-400 px-4 text-xs font-black text-[#170d18] transition hover:bg-orange-300">
            Event & tickets <ChevronRight size={15} />
          </Link>
        </div>
      </div>
    </article>
  );
}

export default async function TicketDiscoveryPage() {
  const result = await getPublicTicketEvents();

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0d0a12] px-4 py-8 text-white sm:px-6 sm:py-12">
      <div aria-hidden="true" className="pointer-events-none absolute -left-40 top-24 h-[28rem] w-[28rem] rounded-full bg-orange-500/10 blur-[120px]" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-40 top-[38rem] h-[28rem] w-[28rem] rounded-full bg-violet-600/10 blur-[120px]" />
      <div className="relative mx-auto max-w-7xl space-y-8">
        <header className="relative isolate overflow-hidden rounded-[2rem] border border-orange-300/15 bg-gradient-to-br from-[#32172a] via-[#201320] to-[#120e18] p-6 shadow-2xl shadow-black/30 sm:p-10 lg:p-14">
          <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-28 -z-10 h-96 w-96 rounded-full bg-orange-500/20 blur-[100px]" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 right-1/3 -z-10 h-80 w-80 rounded-full bg-violet-500/15 blur-[90px]" />
          <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-orange-300/25 bg-orange-300/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-orange-100"><Ghost size={14} /> MIDNIGHT SOCIETY KE · Halloween nights</div>
              <p className="mt-6 text-[10px] font-black uppercase tracking-[0.25em] text-violet-200">The night is yours</p>
              <h1 className="mt-2 text-4xl font-black leading-[0.98] tracking-tight text-white sm:text-6xl lg:text-7xl">Find your<br />after-dark<span className="text-orange-400">.</span></h1>
              <p className="mt-5 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">Discover events worth staying up for. Choose your night, check the details, and find ticket options in one spooky little corner of Midnight Society KE.</p>
            </div>
            <div className="w-fit rounded-2xl border border-white/10 bg-black/20 p-4 backdrop-blur">
              <div className="flex items-center gap-3"><span className="rounded-xl bg-orange-300/10 p-2.5 text-orange-200"><Ticket size={20} /></span><div><p className="text-xl font-black">{result.ok ? result.events.length : '—'}</p><p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-400">Events on sale</p></div></div>
            </div>
          </div>
        </header>

        <section role="status" className="flex items-start gap-3 rounded-2xl border border-orange-300/20 bg-orange-950/25 p-4">
          <ShieldCheck className="mt-0.5 shrink-0 text-orange-200" size={18} />
          <div><p className="text-sm font-black text-orange-100">Checkout is still being secured</p><p className="mt-1 text-xs leading-5 text-orange-50/70">This page only lists approved-organizer events marked on sale. Online checkout and verified M-Pesa payment are not live yet, so ticket purchases cannot be completed here.</p></div>
        </section>

        <section className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-300">Enter if you dare</p><h2 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">Events on the list</h2></div>
            <span className="text-xs text-slate-500">Official Midnight Society KE ticket listings</span>
          </div>
          {!result.ok ? (
            <div role="alert" className="rounded-2xl border border-white/10 bg-[#17121e] p-7 text-sm leading-6 text-slate-300">{result.message}</div>
          ) : result.events.length ? (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{result.events.map(event => <EventCard key={event.id} event={event} />)}</div>
          ) : (
            <div className="rounded-3xl border border-dashed border-white/15 bg-[#17121e]/70 px-6 py-14 text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-orange-300/15 bg-orange-300/5 text-orange-200"><Ghost size={25} /></span>
              <h3 className="mt-4 text-xl font-black text-white">No events on sale just yet</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">The crypt is quiet for now. Approved events will appear here when they are officially opened for sale.</p>
            </div>
          )}
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] pt-5 text-[10px] text-slate-500">
          <span>Midnight Society KE · Your night. Your ticket. No tricks.</span>
          <Link href="/" className="font-bold text-orange-200 transition hover:text-white">Home</Link>
        </footer>
      </div>
    </main>
  );
}
