'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BadgeAlert,
  Check,
  Clock3,
  FileClock,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  Ticket,
  WalletCards
} from 'lucide-react';

type Severity = 'critical' | 'high' | 'medium' | 'low';
type CaseStatus = 'open' | 'investigating' | 'contained' | 'resolved' | 'false_positive';

type SecurityCase = {
  id: string;
  reference: string;
  severity: Severity;
  category: string;
  title: string;
  description: string;
  status: CaseStatus;
  related_entity_type: string | null;
  related_entity_reference: string | null;
  assigned_to_email: string;
  reported_by_email: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

type SecurityEvent = {
  id: number;
  case_id: string | null;
  event_type: string;
  severity: Severity;
  summary: string;
  actor_email: string;
  entity_type: string | null;
  entity_reference: string | null;
  created_at: string;
};

type CaseActivity = {
  id: number;
  case_id: string;
  actor_email: string;
  action: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown>;
  created_at: string;
};

type ReadinessControl = {
  id: string;
  state: string;
  ready: boolean;
  description: string;
};

type SecurityData = {
  cases: SecurityCase[];
  events: SecurityEvent[];
  activity: CaseActivity[];
  counts: Record<CaseStatus, number>;
  canManageCases: boolean;
  monitoring: { source: string; automatedDetection: boolean };
  controls: ReadinessControl[];
};

const selectClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-white/10 bg-[#17121e] px-3 text-sm text-white outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/15';
const inputClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-white/10 bg-[#17121e] px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/15';
const labelClass = 'block text-xs font-bold text-slate-300';

const severityStyle: Record<Severity, string> = {
  critical: 'border-red-300/25 bg-red-300/10 text-red-200',
  high: 'border-orange-300/25 bg-orange-300/10 text-orange-200',
  medium: 'border-amber-300/25 bg-amber-300/10 text-amber-100',
  low: 'border-slate-300/15 bg-slate-300/5 text-slate-300'
};

const statusLabels: Record<CaseStatus, string> = {
  open: 'Open',
  investigating: 'Investigating',
  contained: 'Contained',
  resolved: 'Resolved',
  false_positive: 'False positive'
};

const categoryLabels: Record<string, string> = {
  account_access: 'Account access',
  database_access: 'Database access',
  payment_integrity: 'Payment integrity',
  ticket_fraud: 'Ticket fraud',
  admin_activity: 'Admin activity',
  attack_monitoring: 'Attack monitoring',
  data_exposure: 'Data exposure',
  other: 'Other'
};

const releaseControls = [
  { id: 'mfa', icon: KeyRound, title: 'Privileged MFA & sessions' },
  { id: 'wallet', icon: LockKeyhole, title: 'Customer wallet isolation' },
  { id: 'paystack', icon: WalletCards, title: 'Paystack payment integrity' },
  { id: 'rotating-qr', icon: Ticket, title: 'Rotating ticket credentials' },
  { id: 'scanner', icon: ScanLine, title: 'Authorized gate scanning' },
  { id: 'incident', icon: FileClock, title: 'Protected incident evidence' },
  { id: 'backup', icon: Fingerprint, title: 'Recovery & backup drills' },
  { id: 'release', icon: ShieldCheck, title: 'Production release gate' }
];

async function readResponse<T>(response: Response): Promise<T> {
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(result.error || `Security request failed (${response.status}).`);
  return result as T;
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString('en-KE', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function titleCase(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase());
}

export default function TicketingSecurityPage() {
  const [data, setData] = useState<SecurityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await readResponse<SecurityData>(await fetch('/api/admin/ticketing/security', { cache: 'no-store' })));
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : 'Security records could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true);
    setFormError('');
    setNotice('');
    const formData = new FormData(form);
    try {
      await readResponse(await fetch('/api/admin/ticketing/security', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_case',
          severity: formData.get('severity'),
          category: formData.get('category'),
          title: formData.get('title'),
          description: formData.get('description'),
          relatedEntityType: formData.get('relatedEntityType'),
          relatedEntityReference: formData.get('relatedEntityReference')
        })
      }));
      form.reset();
      setNotice('Security case recorded. Its creation is in the append-only activity log.');
      await load();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'The security case could not be recorded.');
    } finally {
      setSaving(false);
    }
  }

  async function updateCase(caseId: string, status: CaseStatus, assignedToEmail: string, reason: string) {
    setNotice('');
    const result = await readResponse<{ case: SecurityCase }>(await fetch('/api/admin/ticketing/security', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_case', caseId, status, assignedToEmail, reason })
    }));
    await load();
    setNotice(`${result.case.reference} updated; the change was preserved in the activity log.`);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0d0a12] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div aria-hidden="true" className="pointer-events-none absolute -left-36 top-10 h-96 w-96 rounded-full bg-orange-500/10 blur-[110px]" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-32 top-[38rem] h-96 w-96 rounded-full bg-violet-600/10 blur-[110px]" />
      <div className="relative mx-auto max-w-7xl space-y-6">
        <header className="relative overflow-hidden rounded-3xl border border-orange-300/15 bg-gradient-to-br from-[#281626] via-[#1b1221] to-[#120e18] p-6 shadow-2xl shadow-black/30 sm:p-9">
          <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-20 h-72 w-72 rounded-full bg-orange-500/15 blur-[75px]" />
          <div className="relative">
            <Link href="/admin/ticketing" className="inline-flex items-center gap-2 text-xs font-bold text-orange-200 transition hover:text-white">
              <ArrowLeft size={14} /> Back to Ticketing
            </Link>
            <div className="mt-6 flex flex-wrap items-start justify-between gap-5">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-orange-300/25 bg-orange-300/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-orange-200"><ShieldAlert size={14} /> Midnight Society KE · Ticketing Trust</div>
                <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-5xl">Security command<span className="text-orange-400">.</span></h1>
                <p className="mt-3 text-sm leading-6 text-slate-300">Ticketing-only incident handling, evidence history and honest release readiness. Security records do not show payment activity or threat detections unless those systems are actually connected.</p>
              </div>
              <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.03] px-4 text-sm font-bold text-white transition hover:bg-white/10 disabled:opacity-50">
                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
            <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <CountCard label="Open cases" count={data?.counts.open} tint="orange" />
              <CountCard label="Investigating" count={data?.counts.investigating} tint="violet" />
              <CountCard label="Contained" count={data?.counts.contained} tint="amber" />
              <CountCard label="Resolved" count={data?.counts.resolved} tint="slate" />
            </div>
          </div>
        </header>

        <section role="status" className="flex items-start gap-3 rounded-2xl border border-amber-300/20 bg-amber-950/25 p-4">
          <AlertTriangle className="mt-0.5 shrink-0 text-amber-200" size={18} />
          <div>
            <p className="text-sm font-black text-amber-100">This is case management, not a live attack detector</p>
            <p className="mt-1 text-xs leading-5 text-amber-50/70">The feed below contains only ticketing security cases and case actions. It does not ingest login attempts, provider callbacks, WAF signals, database denials, customer data exports or backup status. Never paste passwords, payment secrets, access tokens or unnecessary personal data into a case.</p>
          </div>
        </section>

        {notice && <p role="status" className="rounded-xl border border-emerald-300/20 bg-emerald-950/30 p-3 text-sm text-emerald-200">{notice}</p>}
        {error && <div role="alert" className="rounded-2xl border border-red-300/20 bg-red-950/30 p-4 text-sm text-red-200">{error}<button type="button" onClick={() => void load()} className="ml-2 font-black underline">Try again</button></div>}
        {loading && !data && <div className="rounded-2xl border border-white/10 bg-[#17121e] p-8 text-center text-sm text-slate-400">Opening the incident room…</div>}

        <section aria-labelledby="readiness-heading" className="overflow-hidden rounded-3xl border border-violet-300/15 bg-gradient-to-br from-[#1a1421] to-[#120f18] p-5 shadow-xl shadow-black/20 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-violet-200"><ShieldCheck size={14} /> Launch readiness</p>
              <h2 id="readiness-heading" className="mt-2 text-xl font-black tracking-tight sm:text-2xl">What Ticketing can actually protect today</h2>
              <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-400">Status is checked from server configuration and Ticketing database schema. Provider-side backup and restore status remains manual until independently verified.</p>
            </div>
            <span className="rounded-full border border-red-300/20 bg-red-300/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-red-200">{data?.controls.find(control => control.id === 'release')?.state || 'Checking release'}</span>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {releaseControls.map(control => {
              const readiness = data?.controls.find(item => item.id === control.id);
              return <article key={control.id} className="rounded-2xl border border-white/[0.08] bg-black/20 p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-xl bg-violet-300/10 p-2 text-violet-200"><control.icon size={17} /></span>
                  <span className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${readiness?.ready ? 'border-emerald-300/20 bg-emerald-300/10 text-emerald-200' : 'border-orange-300/20 bg-orange-300/10 text-orange-200'}`}>{readiness?.state || 'Checking'}</span>
                </div>
                <h3 className="mt-3 text-sm font-black text-white">{control.title}</h3>
                <p className="mt-1.5 text-[11px] leading-5 text-slate-400">{readiness?.description || 'Live readiness data is not available yet.'}</p>
              </article>
            })}
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <form onSubmit={createCase} className="rounded-3xl border border-orange-300/15 bg-[#17121e] p-5 shadow-xl shadow-black/20 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-orange-300/10 p-2 text-orange-200"><BadgeAlert size={18} /></span>
              <div><h2 className="text-lg font-black text-white">Open an incident case</h2><p className="mt-1 text-xs leading-5 text-slate-400">Record a suspected security issue for authorized admins to investigate. Evidence is retained in an append-only case history.</p></div>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className={labelClass}>Severity
                <select className={selectClass} name="severity" defaultValue="medium">
                  <option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                </select>
              </label>
              <label className={labelClass}>Category
                <select className={selectClass} name="category" defaultValue="other">
                  <option value="account_access">Account access</option><option value="database_access">Database access</option><option value="payment_integrity">Payment integrity</option><option value="ticket_fraud">Ticket fraud</option><option value="admin_activity">Admin activity</option><option value="attack_monitoring">Attack monitoring</option><option value="data_exposure">Data exposure</option><option value="other">Other</option>
                </select>
              </label>
              <label className={`${labelClass} sm:col-span-2`}>Short summary
                <input className={inputClass} name="title" minLength={5} maxLength={160} required placeholder="Example: unexpected ticket status change" />
              </label>
              <label className={`${labelClass} sm:col-span-2`}>What happened? (avoid secrets and unnecessary personal data)
                <textarea className={`${inputClass} min-h-28 py-3`} name="description" minLength={5} maxLength={5000} required placeholder="Describe observed facts, when they occurred, and immediate containment steps." />
              </label>
              <label className={labelClass}>Related record type (optional)
                <input className={inputClass} name="relatedEntityType" maxLength={40} placeholder="event, order, ticket" />
              </label>
              <label className={labelClass}>Reference (optional)
                <input className={inputClass} name="relatedEntityReference" maxLength={160} placeholder="Internal reference only" />
              </label>
            </div>
            {formError && <p role="alert" className="mt-4 rounded-xl border border-red-300/20 bg-red-950/30 p-3 text-sm text-red-200">{formError}</p>}
            <button disabled={saving} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-orange-400 px-5 text-sm font-black text-[#170d18] transition hover:bg-orange-300 disabled:opacity-50">
              <BadgeAlert size={16} /> {saving ? 'Recording case…' : 'Record security case'}
            </button>
          </form>

          <div className="rounded-3xl border border-white/10 bg-[#17121e] p-5 shadow-xl shadow-black/20 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-orange-200"><Clock3 size={14} /> Investigation queue</p><h2 className="mt-2 text-lg font-black text-white">Security cases</h2><p className="mt-1 text-xs text-slate-400">Status and assignment changes are recorded; evidence cannot be edited or deleted here.</p></div>
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[10px] font-bold text-slate-300">{data?.cases.length ?? 0} latest</span>
            </div>
            {data && data.cases.length > 0 ? (
              <div className="mt-5 space-y-3">
                {data.cases.map(item => <CaseCard key={item.id} item={item} canManage={data.canManageCases} onUpdate={updateCase} />)}
              </div>
            ) : !loading && !error ? (
              <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-black/10 px-5 py-10 text-center">
                <ShieldCheck size={26} className="mx-auto text-violet-200" />
                <p className="mt-3 text-sm font-bold text-white">No ticketing security cases recorded</p>
                <p className="mt-1 text-xs text-slate-400">This means no cases are in this store—not that automated monitoring found no threats.</p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <RecordList title="Append-only security events" subtitle="Case lifecycle events recorded by the security API." empty="No security case events are recorded yet." items={data?.events || []} render={(item: SecurityEvent) => (
            <div key={item.id} className="flex items-start gap-3 rounded-xl border border-white/[0.07] bg-black/15 p-3">
              <span className={`mt-0.5 rounded-full border px-2 py-1 text-[9px] font-black uppercase ${severityStyle[item.severity]}`}>{item.severity}</span>
              <div className="min-w-0 flex-1"><p className="text-xs font-bold text-white">{item.summary}</p><p className="mt-1 text-[10px] text-slate-500">{item.event_type} · {item.actor_email || 'Unknown actor'}</p></div>
              <time className="shrink-0 text-[10px] text-slate-500">{dateTime(item.created_at)}</time>
            </div>
          )} />
          <RecordList title="Case activity trail" subtitle="Before-and-after status and assignment snapshots." empty="No case actions are recorded yet." items={data?.activity || []} render={(item: CaseActivity) => (
            <div key={item.id} className="flex items-start gap-3 rounded-xl border border-white/[0.07] bg-black/15 p-3">
              <span className="mt-0.5 rounded-lg bg-violet-300/10 p-1.5 text-violet-200"><Check size={13} /></span>
              <div className="min-w-0 flex-1"><p className="text-xs font-bold text-white">{titleCase(item.action)}</p><p className="mt-1 text-[10px] text-slate-500">Case {item.case_id.slice(0, 8)} · {item.actor_email || 'Unknown actor'}</p></div>
              <time className="shrink-0 text-[10px] text-slate-500">{dateTime(item.created_at)}</time>
            </div>
          )} />
        </section>

        <footer className="rounded-2xl border border-white/10 bg-[#17121e] p-4 text-[11px] leading-5 text-slate-400">
          Ticketing case records are not a substitute for a protected external log destination, production alerting, payment reconciliation, verified backups or an incident-response exercise. The database migration has to be reviewed and applied before this case workflow can run.
        </footer>
      </div>
    </main>
  );
}

function CountCard({ label, count, tint }: { label: string; count?: number; tint: 'orange' | 'violet' | 'amber' | 'slate' }) {
  const tints = {
    orange: 'text-orange-200',
    violet: 'text-violet-200',
    amber: 'text-amber-100',
    slate: 'text-slate-300'
  };
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between"><p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">{label}</p><BadgeAlert size={15} className={tints[tint]} /></div>
      <p className="mt-2 text-2xl font-black text-white">{count === undefined ? '—' : count.toLocaleString('en-KE')}</p>
    </div>
  );
}

function CaseCard({ item, canManage, onUpdate }: { item: SecurityCase; canManage: boolean; onUpdate: (caseId: string, status: CaseStatus, assignedToEmail: string, reason: string) => Promise<void> }) {
  const [status, setStatus] = useState(item.status);
  const [assignee, setAssignee] = useState(item.assigned_to_email);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onUpdate(item.id, status, assignee, reason);
      setReason('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The case update failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="rounded-2xl border border-white/[0.08] bg-black/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase ${severityStyle[item.severity]}`}>{item.severity}</span><span className="text-[10px] font-bold text-slate-500">{item.reference}</span><span className="text-[10px] text-slate-500">{categoryLabels[item.category] || titleCase(item.category)}</span></div>
          <h3 className="mt-2 text-sm font-black text-white">{item.title}</h3>
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-slate-400">{item.description}</p>
          <p className="mt-2 text-[10px] text-slate-500">Reported by {item.reported_by_email || 'Unknown actor'} · {dateTime(item.created_at)}</p>
          {(item.related_entity_type || item.related_entity_reference) && <p className="mt-1 text-[10px] text-violet-200/80">Related {item.related_entity_type || 'record'} · {item.related_entity_reference || 'reference not supplied'}</p>}
        </div>
        <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-slate-300">{statusLabels[item.status]}</span>
      </div>
      {canManage ? <form onSubmit={submit} className="mt-4 grid gap-3 border-t border-white/[0.07] pt-4 sm:grid-cols-2 sm:items-end">
        <label className={labelClass}>Case status
          <select className={selectClass} value={status} onChange={event => setStatus(event.target.value as CaseStatus)}>
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className={labelClass}>Assign to email
          <input className={inputClass} type="email" maxLength={320} value={assignee} onChange={event => setAssignee(event.target.value)} placeholder="investigator@example.com" />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>Reason for this change (required)
          <input className={inputClass} minLength={5} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Why is this case being updated?" />
        </label>
        <button disabled={saving || reason.trim().length < 5 || (status === item.status && assignee === item.assigned_to_email)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-xs font-black text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />} Save
        </button>
      </form> : <p className="mt-4 border-t border-white/[0.07] pt-4 text-[10px] text-slate-500">Only the platform owner can assign, contain or resolve cases. Your case report is retained for owner review.</p>}
      {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
    </article>
  );
}

function RecordList<T>({ title, subtitle, empty, items, render }: { title: string; subtitle: string; empty: string; items: T[]; render: (item: T) => React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-[#17121e] p-5 shadow-xl shadow-black/20 sm:p-6">
      <div><h2 className="text-sm font-black text-white">{title}</h2><p className="mt-1 text-xs text-slate-400">{subtitle}</p></div>
      <div className="mt-4 max-h-[26rem] space-y-2 overflow-y-auto pr-1">
        {items.length ? items.map(render) : <p className="rounded-xl border border-dashed border-white/10 px-4 py-7 text-center text-xs text-slate-500">{empty}</p>}
      </div>
    </section>
  );
}
