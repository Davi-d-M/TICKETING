import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArrowLeft, CalendarDays, Clock3, Ghost, MapPin, Navigation, ShieldAlert, ShieldCheck, Ticket } from 'lucide-react';
import { getPublicTicketEvent } from '@/lib/ticketing/publicEvents.server';
import { isTicketingSalesReady } from '@/lib/ticketing/commerce.server';
import { getVenueMapLinks } from '@/lib/ticketing/venueLinks';
import PurchaseForm from '../PurchaseForm';
import TicketingBrand from '../TicketingBrand';

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await getPublicTicketEvent(slug);
  return {
    title: result.ok && result.event ? `${result.event.title} | Halloween Tickets` : 'Event Tickets | Midnight Society KE',
    description: result.ok && result.event
      ? `${result.event.title} tickets with Midnight Society KE Ticketing.`
      : 'Explore official Midnight Society KE event tickets.'
  };
}

function formatEventDate(value: string, timezone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date to be announced';
  return new Intl.DateTimeFormat('en-KE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
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

export default async function TicketEventPage({ params }: PageProps) {
  const { slug } = await params;
  const result = await getPublicTicketEvent(slug);
  if (result.ok && !result.event) notFound();

  if (!result.ok) {
    return (
      <>
      <TicketingBrand />
      <main className="min-h-[70vh] bg-[#0d0a12] px-4 py-16 text-white sm:px-6">
        <div className="mx-auto max-w-3xl rounded-3xl border border-white/10 bg-[#17121e] p-8 text-center">
          <Ghost className="mx-auto text-orange-300" size={30} />
          <h1 className="mt-4 text-2xl font-black">The event details are resting in the crypt</h1>
          <p className="mt-2 text-sm text-slate-400">{result.message}</p>
          <Link href="/tickets" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-orange-400 px-5 text-sm font-black text-[#170d18]">Back to events</Link>
        </div>
      </main>
      </>
    );
  }

  const { event } = result;
  if (!event) notFound();

  const now = Date.now();
  const salesReady = await isTicketingSalesReady();
  const mapLinks = getVenueMapLinks(event);
  return (
    <>
    <TicketingBrand />
    <main className="relative min-h-screen overflow-hidden bg-[#0d0a12] px-4 py-8 text-white sm:px-6 sm:py-12">
      <div aria-hidden="true" className="pointer-events-none absolute -left-36 top-24 h-96 w-96 rounded-full bg-orange-500/10 blur-[110px]" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-32 top-[34rem] h-96 w-96 rounded-full bg-violet-600/10 blur-[110px]" />
      <div className="relative mx-auto max-w-6xl space-y-6">
        <Link href="/tickets" className="inline-flex items-center gap-2 text-xs font-bold text-orange-200 transition hover:text-white"><ArrowLeft size={14} /> All events</Link>
        <header className="relative isolate overflow-hidden rounded-[2rem] border border-orange-300/15 bg-gradient-to-br from-[#39172a] via-[#261329] to-[#15101d] p-6 shadow-2xl shadow-black/30 sm:p-10 lg:p-14">
          {event.cover_image_url && <Image src={event.cover_image_url} alt="" fill sizes="(max-width: 768px) 100vw, 1200px" unoptimized className="object-cover" />}
          {event.cover_image_url && <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-br from-[#211326]/90 via-[#261329]/75 to-[#15101d]/90" />}
          <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 -z-10 h-80 w-80 rounded-full bg-orange-500/20 blur-[90px]" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 right-1/3 -z-10 h-72 w-72 rounded-full bg-violet-500/15 blur-[90px]" />
          <div className="relative z-10 max-w-4xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-300/25 bg-black/20 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-orange-100"><Ghost size={14} /> Official Midnight Society KE event</div>
            <p className="mt-7 text-[10px] font-black uppercase tracking-[0.2em] text-orange-200/75">{event.city} · After dark</p>
            <h1 className="mt-2 text-4xl font-black leading-[0.98] tracking-tight sm:text-6xl">{event.title}<span className="text-orange-400">.</span></h1>
            <p className="mt-5 max-w-2xl text-sm leading-6 text-slate-200/80 sm:text-base">{event.description || 'The details are in. Get ready for an unforgettable night.'}</p>
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              <EventDetail icon={CalendarDays} title="When" value={formatEventDate(event.starts_at, event.timezone)} />
              <EventDetail icon={MapPin} title="Where" value={`${event.venue_name}${event.venue_address ? ` · ${event.venue_address}` : ''}`} />
              {event.doors_open_at && <EventDetail icon={Clock3} title="Doors open" value={formatEventDate(event.doors_open_at, event.timezone)} />}
              {event.age_limit !== null && <EventDetail icon={ShieldCheck} title="Age requirement" value={`${event.age_limit}+`} />}
              {event.dress_code && <EventDetail icon={Ghost} title="Dress code" value={event.dress_code} />}
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <a href="#ticket-options" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-orange-400 px-5 text-xs font-black text-[#170d18] transition hover:bg-orange-300"><Ticket size={15} /> Get tickets</a>
              {mapLinks && <>
                <a href={mapLinks.map} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-black/20 px-4 text-xs font-bold text-white hover:bg-white/10"><MapPin size={15} /> View on Google Maps</a>
                <a href={mapLinks.directions} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-black/20 px-4 text-xs font-bold text-white hover:bg-white/10"><Navigation size={15} /> Get directions</a>
              </>}
              <a href="#arrival-guide" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-black/20 px-4 text-xs font-bold text-white hover:bg-white/10"><Navigation size={15} /> Find transport</a>
              <a href="#arrival-guide" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-black/20 px-4 text-xs font-bold text-white hover:bg-white/10"><MapPin size={15} /> Venue & entry guide</a>
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
          <section id="ticket-options" className="scroll-mt-5 rounded-3xl border border-white/10 bg-[#17121e] p-5 shadow-xl shadow-black/20 sm:p-7">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-300">Choose your haunt</p><h2 className="mt-1 text-2xl font-black">Ticket options</h2></div>
              <span className="text-xs text-slate-500">{event.ticket_types.length} {event.ticket_types.length === 1 ? 'ticket type' : 'ticket types'}</span>
            </div>
            <div className="mt-5 space-y-3">
              {event.ticket_types.map(ticketType => {
                const notOpen = ticketType.sales_start_at && new Date(ticketType.sales_start_at).getTime() > now;
                const closed = ticketType.sales_end_at && new Date(ticketType.sales_end_at).getTime() <= now;
                const waveWaiting = ticketType.wave_number !== null && !ticketType.wave_open;
                const schedule = notOpen
                  ? `Sales open ${formatEventDate(ticketType.sales_start_at!, event.timezone)}`
                  : closed ? 'Sales window has ended' : waveWaiting
                    ? ticketType.activation_mode === 'manual' ? 'Waiting for organizer activation'
                      : ticketType.activation_mode === 'previous_sold_out' ? 'Opens when the previous wave sells out or closes'
                        : 'Scheduled opening is pending'
                    : `${ticketType.remaining.toLocaleString('en-KE')} remaining`;
                const waveThemeClass = ticketType.wave_theme === 'crimson-black'
                  ? 'border-rose-300/25 bg-gradient-to-br from-[#241018] via-black/25 to-black/15'
                  : ticketType.wave_theme === 'electric-violet'
                    ? 'border-violet-300/25 bg-gradient-to-br from-[#17152d] via-black/25 to-black/15'
                    : 'border-amber-200/25 bg-gradient-to-br from-[#251e13] via-black/25 to-black/15';
                const waveAccentClass = ticketType.wave_theme === 'crimson-black'
                  ? 'border-rose-300/20 bg-rose-300/10 text-rose-100'
                  : ticketType.wave_theme === 'electric-violet'
                    ? 'border-violet-300/20 bg-violet-300/10 text-violet-100'
                    : 'border-amber-200/20 bg-amber-200/10 text-amber-100';
                return (
                  <article key={ticketType.id} className={`relative overflow-hidden rounded-2xl border p-4 sm:p-5 ${ticketType.wave_number !== null ? waveThemeClass : 'border-white/[0.08] bg-black/15'}`}>
                    {ticketType.wave_number !== null && <div aria-hidden="true" className={`absolute inset-x-0 top-0 h-1 ${ticketType.wave_theme === 'crimson-black' ? 'bg-gradient-to-r from-rose-500 to-red-200' : ticketType.wave_theme === 'electric-violet' ? 'bg-gradient-to-r from-blue-400 to-violet-300' : 'bg-gradient-to-r from-amber-300 to-yellow-100'}`} />}
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className={`rounded-xl border p-2.5 ${ticketType.wave_number !== null ? waveAccentClass : 'border-orange-300/15 bg-orange-300/10 text-orange-200'}`}><Ticket size={17} /></span>
                        <div className="min-w-0">
                          {ticketType.wave_number !== null && <p className={`mb-1 inline-flex rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.14em] ${waveAccentClass}`}>{ticketType.wave_label} · {ticketType.admission_type}</p>}
                          <h3 className="font-black text-white">{ticketType.wave_number !== null ? ticketType.admission_type : ticketType.name}</h3>
                          <p className="mt-1 text-xs leading-5 text-slate-400">{ticketType.description || 'Entry for one guest. Check the event details before the night.'}</p>
                          <p className="mt-2 text-[10px] text-slate-500">Limit: {ticketType.min_per_order}–{ticketType.max_per_order} per order</p>
                        </div>
                      </div>
                      <p className={`shrink-0 text-lg font-black ${ticketType.wave_number !== null ? ticketType.wave_theme === 'crimson-black' ? 'text-rose-100' : ticketType.wave_theme === 'electric-violet' ? 'text-violet-100' : 'text-amber-100' : 'text-orange-100'}`}>{formatPrice(ticketType.price_minor, ticketType.currency)}</p>
                    </div>
                    {ticketType.benefits.length > 0 && <ul className="mt-3 grid gap-1 text-xs text-slate-300 sm:grid-cols-2">{ticketType.benefits.map(benefit => <li key={benefit} className="flex items-start gap-2"><ShieldCheck size={13} className="mt-0.5 shrink-0 text-violet-200" />{benefit}</li>)}</ul>}
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-3">
                      <span className="text-[10px] font-semibold text-slate-500">{schedule}</span>
                    </div>
                    {notOpen || closed || waveWaiting || ticketType.remaining < ticketType.min_per_order ? (
                      <p className="mt-3 text-xs font-bold text-slate-400">
                        {notOpen ? 'Ticket sales have not opened.' : closed ? 'This ticket sale has ended.' : waveWaiting ? schedule : 'This ticket tier is sold out.'}
                      </p>
                    ) : salesReady ? (
                      <PurchaseForm
                        eventId={event.id}
                        ticketTypeId={ticketType.id}
                        name={ticketType.wave_number !== null ? `${ticketType.wave_label} · ${ticketType.admission_type}` : ticketType.name}
                        price={String(ticketType.price_minor)}
                        serviceFeeMinor={event.service_fee_minor}
                        currency={ticketType.currency.trim()}
                        min={ticketType.min_per_order}
                        max={Math.min(ticketType.max_per_order, ticketType.remaining, 20)}
                        enabled={salesReady}
                      />
                    ) : (
                      <p role="status" className="mt-3 rounded-xl border border-orange-300/15 bg-orange-950/20 p-3 text-xs leading-5 text-orange-100/80">
                        Checkout is paused while Paystack, secure ticket email and server secrets are being configured.
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          <aside className="space-y-4">
            <section role="status" className="rounded-3xl border border-orange-300/20 bg-gradient-to-br from-orange-950/35 to-[#1b1221] p-5 sm:p-6">
              <div className="flex items-start gap-3"><span className="rounded-xl bg-orange-300/10 p-2 text-orange-200"><ShieldAlert size={18} /></span><div><h2 className="text-sm font-black text-orange-100">{salesReady ? 'Secure Paystack checkout' : 'Purchases are not open'}</h2><p className="mt-2 text-xs leading-5 text-orange-50/70">{salesReady ? 'Payment is verified with Paystack on the server before tickets are issued. A one-time wallet link is sent to your purchase email.' : 'Ticket listings are visible, but checkout stays paused until Paystack, guest email delivery and the server-side security settings are configured.'}</p></div></div>
            </section>
            <section id="arrival-guide" className="scroll-mt-5 rounded-3xl border border-white/10 bg-[#17121e] p-5 sm:p-6">
              <h2 className="text-sm font-black text-white">Venue & arrival guide</h2>
              <p className="mt-2 text-xs leading-5 text-slate-300">{event.venue_name}{event.venue_address ? ` · ${event.venue_address}` : ''}, {event.city}</p>
              {event.entrance_instructions ? <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-slate-400"><strong className="text-slate-200">Entry:</strong> {event.entrance_instructions}</p> : <p className="mt-3 text-xs leading-5 text-slate-500">Entrance details have not been published yet.</p>}
              {event.parking_details ? <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-slate-400"><strong className="text-slate-200">Parking:</strong> {event.parking_details}</p> : <p className="mt-3 text-xs leading-5 text-slate-500">Parking information has not been published yet.</p>}
              {event.transport_guidance ? <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-slate-400"><strong className="text-slate-200">Transport & arrival:</strong> {event.transport_guidance}</p> : <p className="mt-3 text-xs leading-5 text-slate-500">Transport and arrival guidance has not been published yet. Please check back before travelling.</p>}
              {mapLinks && <div className="mt-4 flex flex-wrap gap-2"><a href={mapLinks.map} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/15 px-3 text-xs font-bold text-orange-100 hover:bg-white/5"><MapPin size={14} /> View on Google Maps</a><a href={mapLinks.directions} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/15 px-3 text-xs font-bold text-orange-100 hover:bg-white/5"><Navigation size={14} /> Get directions</a></div>}
            </section>
            <section className="rounded-3xl border border-white/10 bg-[#17121e] p-5 sm:p-6">
              <h2 className="text-sm font-black text-white">The real-ticket promise</h2>
              <ul className="mt-3 space-y-3 text-xs leading-5 text-slate-400">
                <li className="flex gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-violet-200" />We will only issue a ticket after payment is verified server-side.</li>
                <li className="flex gap-2"><Ticket size={15} className="mt-0.5 shrink-0 text-orange-200" />A screenshot or payment message is not proof of a valid ticket.</li>
                <li className="flex gap-2"><MapPin size={15} className="mt-0.5 shrink-0 text-orange-200" />Venue: {event.venue_name}, {event.city}.</li>
              </ul>
            </section>
            {event.cancellation_policy && (
              <section className="rounded-3xl border border-white/10 bg-[#17121e] p-5 sm:p-6">
                <h2 className="text-sm font-black text-white">Cancellation policy</h2>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-400">{event.cancellation_policy}</p>
              </section>
            )}
          </aside>
        </div>
        <footer className="border-t border-white/[0.08] pt-5 text-center text-[10px] text-slate-500">Midnight Society KE · No tricks, no fake confirmations.</footer>
      </div>
    </main>
    </>
  );
}

function EventDetail({ icon: Icon, title, value }: { icon: typeof Ticket; title: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 p-3.5">
      <Icon size={16} className="mt-0.5 shrink-0 text-orange-200" />
      <div><p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-400">{title}</p><p className="mt-1 text-xs leading-5 text-white/90">{value}</p></div>
    </div>
  );
}
