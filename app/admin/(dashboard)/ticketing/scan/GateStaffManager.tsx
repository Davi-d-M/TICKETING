'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';

type StaffAccount = { email: string; active: boolean; last_login_at: string | null };
type EventOption = { id: string; title: string; status: string };
type Assignment = { event_id: string; email: string; gate_name: string; active: boolean };
type StaffData = { accounts: StaffAccount[]; assignments: Assignment[]; events: EventOption[] };

export default function GateStaffManager() {
  const [data, setData] = useState<StaffData | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [eventId, setEventId] = useState('');
  const [gateName, setGateName] = useState('Main gate');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/ticketing/gate-staff', { cache: 'no-store' });
    const result = await response.json() as StaffData & { error?: string };
    if (!response.ok) throw new Error(result.error || 'Gate staff records could not be loaded.');
    setData(result);
    setEventId(current => current || result.events[0]?.id || '');
  }, []);

  useEffect(() => {
    void load().catch(cause => setError(cause instanceof Error ? cause.message : 'Gate staff records could not be loaded.'));
  }, [load]);

  async function save(payload: Record<string, unknown>) {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/ticketing/gate-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Gate staff changes could not be saved.');
      await load();
      setMessage('Gate staff settings saved and audited.');
      setPassword('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gate staff changes could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  function createStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save({ action: 'save_account', email, password, active: true });
  }

  function assignStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save({ action: 'set_assignment', email, eventId, gateName, active: true });
  }

  return (
    <section className="space-y-4 rounded-2xl border border-violet-300/15 bg-[#17121e] p-5 sm:p-7">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-200">Owner control</p>
        <h2 className="mt-1 text-xl font-black">Gate staff and event assignments</h2>
        <p className="mt-1 text-xs leading-5 text-slate-400">Staff use their own password and can scan only an assigned event and gate. Passwords are stored as scrypt hashes; access changes are audited.</p>
      </div>
      <form onSubmit={createStaff} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <label className="text-xs font-bold text-slate-300">Staff email<input type="email" required value={email} onChange={event => setEmail(event.target.value.toLowerCase())} className="mt-1 min-h-10 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm" /></label>
        <label className="text-xs font-bold text-slate-300">Temporary staff password<input type="password" required minLength={14} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm" /></label>
        <button disabled={saving} className="self-end rounded-lg bg-violet-300 px-4 py-2.5 text-xs font-black text-[#170d18] disabled:opacity-50">{saving ? 'Saving…' : 'Save / reset account'}</button>
      </form>
      <form onSubmit={assignStaff} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <label className="text-xs font-bold text-slate-300">Staff<select required value={email} onChange={event => setEmail(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-white/10 bg-[#0d0a12] px-3 text-sm"><option value="">Select active staff</option>{data?.accounts.filter(account => account.active).map(account => <option key={account.email} value={account.email}>{account.email}</option>)}</select></label>
        <label className="text-xs font-bold text-slate-300">Event<select required value={eventId} onChange={event => setEventId(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-white/10 bg-[#0d0a12] px-3 text-sm">{data?.events.map(event => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label>
        <label className="text-xs font-bold text-slate-300">Gate name<input required maxLength={120} value={gateName} onChange={event => setGateName(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm" /></label>
        <button disabled={saving || !email || !eventId} className="self-end rounded-lg border border-violet-200/20 px-4 py-2.5 text-xs font-black text-violet-100 disabled:opacity-50">Assign gate</button>
      </form>
      {error && <p role="alert" className="text-xs text-red-200">{error}</p>}
      {message && <p role="status" className="text-xs text-emerald-200">{message}</p>}
      {data && <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 p-3">
          <h3 className="text-xs font-black text-slate-200">Accounts</h3>
          <ul className="mt-2 space-y-2">{data.accounts.map(account => <li key={account.email} className="flex items-center justify-between gap-2 text-xs"><span>{account.email} · {account.active ? 'active' : 'disabled'}</span>{account.active && <button type="button" disabled={saving} onClick={() => void save({ action: 'save_account', email: account.email, active: false })} className="text-red-200 hover:underline">Disable</button>}</li>)}</ul>
        </div>
        <div className="rounded-xl border border-white/10 p-3">
          <h3 className="text-xs font-black text-slate-200">Event assignments</h3>
          <ul className="mt-2 space-y-2">{data.assignments.map(assignment => <li key={`${assignment.event_id}:${assignment.email}`} className="flex items-center justify-between gap-2 text-xs"><span>{assignment.email} · {data.events.find(event => event.id === assignment.event_id)?.title || 'event'} · {assignment.gate_name} · {assignment.active ? 'active' : 'paused'}</span>{assignment.active && <button type="button" disabled={saving} onClick={() => void save({ action: 'set_assignment', email: assignment.email, eventId: assignment.event_id, gateName: assignment.gate_name, active: false })} className="shrink-0 text-red-200 hover:underline">Remove</button>}</li>)}</ul>
        </div>
      </div>}
      <p className="text-[10px] leading-4 text-slate-500">Share staff passwords through a secure channel. Disabling an account or assignment takes effect on the next scan. No offline admission is supported.</p>
    </section>
  );
}
