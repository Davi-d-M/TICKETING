import Link from 'next/link';
import type { Metadata } from 'next';
import { Ghost, ShieldCheck, Ticket } from 'lucide-react';
import { getPublicTicketEvents } from '@/lib/ticketing/publicEvents.server';
import { isTicketingGuestAccessReady, isTicketingSalesReady } from '@/lib/ticketing/commerce.server';
import TicketingBrand from './TicketingBrand';
import TicketEventDiscovery from './TicketEventDiscovery';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Halloween Tickets | Midnight Society KE',
  description: 'Find your next after-dark event with Midnight Society KE Ticketing.'
};

export default async function TicketDiscoveryPage() {
  const [result, salesReady, guestAccessReady] = await Promise.all([
    getPublicTicketEvents(),
    isTicketingSalesReady(),
    isTicketingGuestAccessReady()
  ]);

  return (
    <>
      <TicketingBrand />
      <main className="ticket-theme-page relative min-h-screen overflow-hidden px-4 py-8 sm:px-6 sm:py-12">
        <div aria-hidden="true" className="pointer-events-none absolute -left-40 top-24 h-[28rem] w-[28rem] rounded-full bg-orange-200/35 blur-[120px]" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 top-[38rem] h-[28rem] w-[28rem] rounded-full bg-violet-200/25 blur-[120px]" />
        <div className="relative mx-auto max-w-7xl space-y-8">
          <header className="ticket-theme-hero relative isolate overflow-hidden rounded-[2rem] border p-6 shadow-xl shadow-slate-900/5 sm:p-10 lg:p-14">
            <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-28 -z-10 h-96 w-96 rounded-full bg-orange-100/80 blur-[100px]" />
            <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 right-1/3 -z-10 h-80 w-80 rounded-full bg-violet-100/70 blur-[90px]" />
            <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
              <div className="max-w-3xl">
                <div className="ticket-theme-accent-soft inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.22em]"><Ghost size={14} /> Midnight Society KE · Official events</div>
                <p className="ticket-theme-accent mt-6 text-[10px] font-black uppercase tracking-[0.25em]">The night is yours</p>
                <h1 className="ticket-theme-text mt-2 text-4xl font-black leading-[0.98] tracking-tight sm:text-6xl lg:text-7xl">Find your<br />after-dark<span className="ticket-theme-accent">.</span></h1>
                <p className="ticket-theme-copy mt-5 max-w-xl text-sm leading-6 sm:text-base">Discover events worth staying up for. Choose your night, check the details, and find ticket options in one spooky little corner of Midnight Society KE.</p>
              </div>
              <div className="ticket-theme-panel-muted w-fit rounded-2xl border p-4">
                <div className="flex items-center gap-3"><span className="ticket-theme-accent-soft rounded-xl border p-2.5"><Ticket size={20} /></span><div><p className="ticket-theme-text text-xl font-black">{result.ok ? result.events.length : '—'}</p><p className="ticket-theme-muted text-[9px] font-black uppercase tracking-[0.15em]">Events on sale</p></div></div>
              </div>
            </div>
          </header>

          <section role="status" className="ticket-theme-accent-soft flex items-start gap-3 rounded-2xl border p-4">
            <ShieldCheck className="mt-0.5 shrink-0" size={18} />
            <div>
              <p className="ticket-theme-text text-sm font-black">{salesReady ? 'Official checkout safeguards are configured' : 'Ticket checkout is temporarily unavailable'}</p>
              <p className="ticket-theme-copy mt-1 text-xs leading-5">
                {salesReady
                  ? result.ok && result.events.length
                    ? guestAccessReady
                      ? 'Only events opened for sale in Online Bar Admin are listed. Paystack payments are checked server-side before tickets are issued.'
                      : 'Payments are verified by Paystack and recorded in Online Bar Admin. Wallet-email delivery is not configured yet; keep your order reference for ticket access.'
                    : 'Payment checks pass, but no approved events are open for sale in Online Bar Admin right now.'
                  : 'Events are listed only when approved and opened for sale in Online Bar Admin. Checkout requires valid payment configuration, ticket security and database checks.'}
              </p>
            </div>
          </section>

          <section className="space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><p className="ticket-theme-accent text-[10px] font-black uppercase tracking-[0.2em]">Enter if you dare</p><h2 className="ticket-theme-text mt-1 text-2xl font-black tracking-tight sm:text-3xl">Events on the list</h2></div>
              <span className="ticket-theme-muted text-xs">Official Midnight Society KE ticket listings</span>
            </div>
            {!result.ok ? (
              <div role="alert" className="ticket-theme-panel rounded-2xl border p-7 text-sm leading-6 shadow-sm">{result.message}</div>
            ) : result.events.length ? (
              <TicketEventDiscovery events={result.events} />
            ) : (
              <div className="ticket-theme-panel rounded-3xl border border-dashed px-6 py-14 text-center shadow-sm">
                <span className="ticket-theme-accent-soft mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border"><Ghost size={25} /></span>
                <h3 className="ticket-theme-text mt-4 text-xl font-black">No events on sale just yet</h3>
                <p className="ticket-theme-copy mx-auto mt-2 max-w-md text-sm leading-6">Approved events will appear here when they are officially opened for sale.</p>
              </div>
            )}
          </section>

          <footer className="ticket-theme-muted flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-[10px]" style={{ borderColor: 'var(--ticket-border)' }}>
            <span>Midnight Society KE · Your night. Your ticket. No tricks.</span>
            <Link href="/" className="ticket-theme-accent font-bold transition hover:opacity-75">Home</Link>
          </footer>
        </div>
      </main>
    </>
  );
}
