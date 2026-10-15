'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Clock3,
  Ghost,
  Radio,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Ticket,
  Wallet
} from 'lucide-react';

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

type LiveEvent = {
  id: number;
  event_id: string | null;
  source_table: string;
  operation: string;
  event_type: string;
  severity: Severity;
  summary: string;
  entity_type: string;
  entity_reference: string;
  status: string;
  occurred_at: string;
};

type Metrics = {
  onSaleEvents: number;
  validTickets: number;
  admittedTickets: number;
  paidOrders: number;
  unresolvedPayments: number;
  activeReservations: number;
  successfulScans: number;
  rejectedScans: number;
  pendingRefunds: number;
};

type LiveResponse = {
  events: LiveEvent[];
  nextCursor: string | null;
  sampledAt: string;
  metrics?: Metrics;
  error?: string;
};

const severityStyles: Record<Severity, string> = {
  critical: 'border-red-300/30 bg-red-300/10 text-red-200',
  high: 'border-orange-300/30 bg-orange-300/10 text-orange-200',
  medium: 'border-amber-300/25 bg-amber-300/10 text-amber-100',
  low: 'border-slate-300/20 bg-slate-300/5 text-slate-300',
  info: 'border-violet-300/20 bg-violet-300/5 text-violet-200'
};

function number(value: number | undefined) {
  return (value ?? 0).toLocaleString('en-KE');
}

function timestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString('en-KE', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function MetricCard({ icon: Icon, label, value, hint, tone = 'orange' }: {
  icon: typeof Ticket;
  label: string;
  value: number | undefined;
  hint: string;
  tone?: 'orange' | 'violet' | 'red';
}) {
  const tones = {
    orange: 'border-orange-300/15 bg-orange-300/[0.06] text-orange-200',
    violet: 'border-violet-300/15 bg-violet-300/[0.06] text-violet-200',
    red: 'border-red-300/15 bg-red-300/[0.06] text-red-200'
  };
  return (
    <article className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">{label}</span>
        <Icon size={17} />
      </div>
      <p className="mt-3 text-3xl font-black text-white">{number(value)}</p>
      <p className="mt-1 text-[11px] text-slate-400">{hint}</p>
    </article>
  );
}

async function readLiveData(url: string): Promise<LiveResponse> {
  const response = await fetch(url, { cache: 'no-store' });
  const result = await response.json().catch(() => ({})) as LiveResponse;
  if (!response.ok) throw new Error(result.error || `Live operations request failed (${response.status}).`);
  return result;
}

export default function TicketingLivePage() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [lastUpdated, setLastUpdated] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const cursor = useRef<string | null>(null);
  const knownIds = useRef(new Set<string>());
  const inFlight = useRef(false);

  const poll = useCallback(async (includeMetrics = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const params = new URLSearchParams();
    if (cursor.current) params.set('after', cursor.current);
    if (!includeMetrics) params.set('feedOnly', '1');
    try {
      const data = await readLiveData(`/api/admin/ticketing/live?${params.toString()}`);
      const newEvents = data.events.filter(event => !knownIds.current.has(String(event.id)));
      for (const event of newEvents) {
        knownIds.current.add(String(event.id));
        if (knownIds.current.size > 500) {
          const oldestId = knownIds.current.values().next().value;
          if (oldestId) knownIds.current.delete(oldestId);
        }
      }
      if (newEvents.length) {
        setEvents(current => [...newEvents].reverse().concat(current).slice(0, 100));
      }
      cursor.current = data.nextCursor;
      if (data.metrics) setMetrics(data.metrics);
      setLastUpdated(data.sampledAt);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ticketing operations could not be refreshed.');
    } finally {
      setLoading(false);
      setRefreshing(false);
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void poll(true);
    const feedTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void poll(false);
    }, 5000);
    const metricsTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void poll(true);
    }, 30000);
    const onFocus = () => { if (document.visibilityState === 'visible') void poll(true); };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(feedTimer);
      window.clearInterval(metricsTimer);
      window.removeEventListener('focus', onFocus);
    };
  }, [poll]);

  function refreshNow() {
    setRefreshing(true);
    void poll(true);
  }

  const cards = [
    { icon: CalendarDays, label: 'Events on sale', value: metrics?.onSaleEvents, hint: 'Currently marked on sale' },
    { icon: Ticket, label: 'Valid tickets', value: metrics?.validTickets, hint: 'Issued and not refunded/revoked' },
    { icon: Wallet, label: 'Paid orders', value: metrics?.paidOrders, hint: 'Order state verified as paid', tone: 'violet' as const },
    { icon: ScanLine, label: 'Successful admissions', value: metrics?.successfulScans, hint: 'Accepted gate scans', tone: 'violet' as const },
    { icon: AlertTriangle, label: 'Unresolved payments', value: metrics?.unresolvedPayments, hint: 'Pending, unknown or reconciliation', tone: 'red' as const },
    { icon: Clock3, label: 'Active reservations', value: metrics?.activeReservations, hint: 'Unexpired reserved inventory' },
    { icon: ShieldCheck, label: 'Rejected scans', value: metrics?.rejectedScans, hint: 'Duplicate or invalid scan outcomes', tone: 'red' as const },
    { icon: Activity, label: 'Refunds to review', value: metrics?.pendingRefunds, hint: 'Requested, processing or reconciliation', tone: 'violet' as const }
  ];

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0d0a12] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div aria-hidden="true" className="pointer-events-none absolute -left-36 top-20 h-96 w-96 rounded-full bg-orange-500/10 blur-[110px]" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-32 top-[34rem] h-96 w-96 rounded-full bg-violet-600/10 blur-[110px]" />
      <div className="relative mx-auto max-w-7xl space-y-6">
        <header className="overflow-hidden rounded-3xl border border-orange-300/15 bg-gradient-to-br from-[#281626] via-[#1b1221] to-[#120e18] p-6 shadow-2xl shadow-black/30 sm:p-9">
          <Link href="/admin/ticketing" className="inline-flex items-center gap-2 text-xs font-bold text-slate-400 transition hover:text-white"><ArrowLeft size={14} /> Ticketing management</Link>
          <div className="mt-5 flex flex-wrap items-start justify-between gap-5">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-orange-300/25 bg-orange-300/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-orange-200"><Ghost size={14} /> Halloween operations / Live</div>
              <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-5xl">Ticket operations<span className="text-orange-400">.</span></h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">A server-backed view of committed ticketing changes, payments, reservations, refunds and gate outcomes. Customer and credential secrets are excluded from the feed.</p>
            </div>
            <button type="button" onClick={refreshNow} disabled={loading || refreshing} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.03] px-4 text-sm font-bold text-white transition hover:border-white/25 hover:bg-white/10 disabled:opacity-50">
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <span className="inline-flex items-center gap-2 text-emerald-200"><Radio size={14} className={error ? 'text-red-300' : 'animate-pulse'} /> {error ? 'Feed disconnected' : 'Feed every 5s · metrics every 30s'}</span>
            <span className="text-slate-400">Last successful check: {lastUpdated ? timestamp(lastUpdated) : 'Waiting for first check'}</span>
            <span className="text-slate-500">Database polling, not a push/WebSocket connection</span>
          </div>
        </header>

        {error && <div role="alert" className="rounded-2xl border border-red-300/25 bg-red-300/10 p-4 text-sm text-red-100"><p className="font-bold">Operations data is unavailable</p><p className="mt-1 text-xs text-red-100/75">{error}</p></div>}

        <section aria-label="Current ticket operations metrics" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map(card => <MetricCard key={card.label} {...card} />)}
        </section>

        <section className="overflow-hidden rounded-3xl border border-violet-300/15 bg-gradient-to-br from-[#1a1421] to-[#120f18] shadow-xl shadow-black/20">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 p-5 sm:p-6">
            <div>
              <div className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-violet-200"><Activity size={14} /> Operational event journal</div>
              <h2 className="mt-2 text-xl font-black text-white">Latest activity</h2>
              <p className="mt-1 text-xs text-slate-400">New rows are recovered by database cursor after reconnect. Showing up to 100 latest events.</p>
            </div>
            <span className="rounded-full border border-violet-300/20 bg-violet-300/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-violet-200">{events.length} loaded</span>
          </div>
          {loading && events.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">Connecting to Ticketing operations…</div>
          ) : events.length ? (
            <ol className="divide-y divide-white/[0.07]">
              {events.map(event => (
                <li key={event.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${severityStyles[event.severity]}`}>{event.severity}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{event.entity_type.replaceAll('_', ' ')}</span>
                      {event.status && <span className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-bold text-slate-300">{event.status.replaceAll('_', ' ')}</span>}
                    </div>
                    <p className="mt-2 break-words text-sm font-bold text-white">{event.summary}</p>
                    <p className="mt-1 text-[10px] text-slate-500">{event.entity_reference ? `Ref ${event.entity_reference} · ` : ''}{event.event_id ? `Event ${event.event_id.slice(0, 8)} · ` : ''}{event.source_table.replace('ticketing_', '')}</p>
                  </div>
                  <time className="text-[10px] text-slate-400 sm:text-right" dateTime={event.occurred_at}>{timestamp(event.occurred_at)}</time>
                </li>
              ))}
            </ol>
          ) : (
            <div className="p-8 text-center">
              <Activity size={22} className="mx-auto text-violet-200/60" />
              <p className="mt-3 text-sm font-bold text-slate-300">No Ticketing activity recorded yet</p>
              <p className="mt-1 text-xs text-slate-500">Events appear after the live-operations migration is applied and Ticketing records change.</p>
            </div>
          )}
        </section>

        <aside className="rounded-2xl border border-orange-300/15 bg-orange-300/[0.04] p-4 text-xs leading-5 text-orange-50/70">
          <p className="font-black text-orange-100">Current release limits</p>
          <p className="mt-1">Checkout, provider-verified payment callbacks, ticket wallet/QR issuance and authorized gate scanning are not active in this build. Metrics show stored database records only; zero counts do not mean a live payment or scan system has been verified. Web browsers cannot reliably detect screenshots. Android ticket-wallet screenshot protection remains dependent on the native wallet screen, which has not been built yet.</p>
        </aside>
      </div>
    </main>
  );
}
