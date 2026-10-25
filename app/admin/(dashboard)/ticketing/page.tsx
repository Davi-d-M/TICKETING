'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Fingerprint,
  Ghost,
  ImagePlus,
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
  benefits: string[];
  min_per_order: number;
  max_per_order: number;
  sales_start_at: string | null;
  sales_end_at: string | null;
  status: string;
  wave_number: number | null;
  admission_type: string;
  wave_label: string;
  activation_mode: 'scheduled' | 'previous_sold_out' | 'manual';
  wave_theme: 'obsidian-gold' | 'crimson-black' | 'electric-violet';
  wave_manual_open: boolean;
};

type TicketPromotion = {
  id: string;
  event_id: string;
  code: string;
  discount_type: 'fixed' | 'percentage';
  discount_value: number;
  currency: string;
  max_redemptions: number | null;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
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
  cover_image_url: string | null;
  venue_maps_url: string;
  venue_latitude: number | null;
  venue_longitude: number | null;
  entrance_instructions: string;
  parking_details: string;
  transport_guidance: string;
  dress_code: string;
  service_fee_minor: number;
  status: string;
  created_at: string;
  ticket_types: TicketType[];
  promotions: TicketPromotion[];
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

function dateTimeInput(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function statusLabel(status: string) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase());
}

async function readResponse(response: Response) {
  const result = await response.json().catch(() => ({})) as { error?: string; event?: { id?: string } };
  if (!response.ok) throw new Error(result.error || `Ticketing request failed (${response.status}).`);
  return result;
}

function EventForm({ onCreated, onCancel }: { onCreated: (notice?: string) => void; onCancel: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(formData: FormData) {
    setSaving(true);
    setError('');
    try {
      const created = await readResponse(await fetch('/api/admin/ticketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_event',
          title: formData.get('title'),
          description: formData.get('description'),
          venueName: formData.get('venueName'),
          venueAddress: formData.get('venueAddress'),
          city: formData.get('city'),
          venueMapsUrl: formData.get('venueMapsUrl'),
          venueLatitude: formData.get('venueLatitude'),
          venueLongitude: formData.get('venueLongitude'),
          entranceInstructions: formData.get('entranceInstructions'),
          parkingDetails: formData.get('parkingDetails'),
          transportGuidance: formData.get('transportGuidance'),
          dressCode: formData.get('dressCode'),
          serviceFee: formData.get('serviceFee'),
          startsAt: formData.get('startsAt'),
          endsAt: formData.get('endsAt'),
          doorsOpenAt: formData.get('doorsOpenAt'),
          capacity: formData.get('capacity'),
          ageLimit: formData.get('ageLimit'),
          cancellationPolicy: formData.get('cancellationPolicy')
        })
      }));
      const photo = formData.get('coverImage');
      if (photo instanceof File && photo.size > 0) {
        if (!created.event?.id) {
          onCreated('Event draft created, but its photo could not be attached. Retry from the event card.');
          return;
        }
        const upload = new FormData();
        upload.set('photo', photo);
        try {
          await readResponse(await fetch(`/api/admin/ticketing/events/${created.event.id}/image`, {
            method: 'POST',
            body: upload
          }));
        } catch (cause) {
          onCreated(`Event draft created, but its photo was not uploaded. Retry from the event card. ${cause instanceof Error ? cause.message : ''}`);
          return;
        }
      }
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
        <label className={labelClass}>Venue<input className={inputClass} name="venueName" required minLength={2} maxLength={180} defaultValue="Edgewood Country Place" /></label>
        <label className={labelClass}>Town / city<input className={inputClass} name="city" required minLength={2} maxLength={100} placeholder="Enter the confirmed town or city" /></label>
        <label className={`${labelClass} sm:col-span-2`}>Venue address<input className={inputClass} name="venueAddress" maxLength={500} placeholder="Street, area, directions" /></label>
        <label className={`${labelClass} sm:col-span-2`}>Verified Google Maps link (optional)<input className={inputClass} name="venueMapsUrl" type="url" placeholder="https://maps.google.com/..." /><span className="mt-1 block text-[10px] font-normal text-slate-500">Map buttons stay hidden until a verified link, coordinates or full address is provided.</span></label>
        <label className={labelClass}>Venue latitude (optional)<input className={inputClass} name="venueLatitude" type="number" min="-90" max="90" step="any" placeholder="-1.234567" /></label>
        <label className={labelClass}>Venue longitude (optional)<input className={inputClass} name="venueLongitude" type="number" min="-180" max="180" step="any" placeholder="36.123456" /></label>
        <label className={labelClass}>Entrance / entry pin instructions<textarea className={`${inputClass} min-h-20 py-3`} name="entranceInstructions" maxLength={2000} placeholder="Confirmed gate, entrance and arrival instructions" /></label>
        <label className={labelClass}>Parking information<textarea className={`${inputClass} min-h-20 py-3`} name="parkingDetails" maxLength={2000} placeholder="Confirmed parking arrangements" /></label>
        <label className={`${labelClass} sm:col-span-2`}>Transport & arrival guidance<textarea className={`${inputClass} min-h-20 py-3`} name="transportGuidance" maxLength={3000} placeholder="Only publish confirmed pickup points and public transport guidance" /></label>
        <label className={labelClass}>Dress code (optional)<input className={inputClass} name="dressCode" maxLength={500} placeholder="Dress code" /></label>
        <label className={labelClass}>Service fee per ticket (KES)<input className={inputClass} name="serviceFee" type="number" min="0" max="1000000" step="0.01" defaultValue="0" /></label>
        <label className={labelClass}>Event starts<input className={inputClass} name="startsAt" type="datetime-local" required /></label>
        <label className={labelClass}>Event ends<input className={inputClass} name="endsAt" type="datetime-local" required /></label>
        <label className={labelClass}>Doors open (optional)<input className={inputClass} name="doorsOpenAt" type="datetime-local" /></label>
        <label className={labelClass}>Capacity (optional)<input className={inputClass} name="capacity" type="number" min="1" max="1000000" placeholder="Set venue limit" /></label>
        <label className={labelClass}>Minimum age (optional)<input className={inputClass} name="ageLimit" type="number" min="0" max="120" placeholder="No restriction" /></label>
        <label className={`${labelClass} sm:col-span-2`}>Event photo (optional)<input className={inputClass} name="coverImage" type="file" accept="image/jpeg,image/png,image/webp" /><span className="mt-1 block text-[10px] font-normal text-slate-500">JPEG, PNG or WebP, up to 4 MB. Shown on the public event listing.</span></label>
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
          benefits: String(formData.get('benefits') || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean),
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
        <label className={`${labelClass} sm:col-span-2 lg:col-span-3`}>Included benefits (one per line)<textarea className={`${inputClass} min-h-20 py-3`} name="benefits" maxLength={4000} placeholder={'Priority entry\nReserved section\nWelcome drink'} /><span className="mt-1 block text-[10px] font-normal text-slate-500">List only benefits your event team can deliver. Up to 20 lines.</span></label>
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

const waveNames = ['Wave I — The Awakening', 'Wave II — The Summoning', 'Wave III — The Final Call'];

function WaveForm({ event, onCreated, onCancel }: { event: TicketEvent; onCreated: () => void; onCancel: () => void }) {
  const [admissionType, setAdmissionType] = useState('General Admission');
  const [waveNumber, setWaveNumber] = useState(1);
  const [waveLabel, setWaveLabel] = useState(waveNames[0]);
  const [activationMode, setActivationMode] = useState<'scheduled' | 'previous_sold_out' | 'manual'>('scheduled');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const existingWaveNumbers = useMemo(() => new Set(event.ticket_types
    .filter(tier => tier.wave_number !== null && tier.admission_type === admissionType)
    .map(tier => tier.wave_number)), [admissionType, event.ticket_types]);
  const availableWaveNumbers = useMemo(() => [1, 2, 3].filter(number => !existingWaveNumbers.has(number)), [existingWaveNumbers]);
  const hasPreviousWave = waveNumber === 1 || existingWaveNumbers.has(waveNumber - 1);

  useEffect(() => {
    if (availableWaveNumbers.length === 0 || availableWaveNumbers.includes(waveNumber)) return;
    const nextWave = availableWaveNumbers[0];
    setWaveNumber(nextWave);
    setWaveLabel(waveNames[nextWave - 1]);
    setActivationMode(nextWave === 1 ? 'scheduled' : 'previous_sold_out');
  }, [admissionType, availableWaveNumbers, waveNumber]);

  async function submit(formData: FormData) {
    setSaving(true);
    setError('');
    try {
      await readResponse(await fetch('/api/admin/ticketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_ticket_wave',
          eventId: event.id,
          admissionType,
          waveNumber,
          waveLabel: formData.get('waveLabel'),
          price: formData.get('price'),
          capacity: formData.get('capacity'),
          minPerOrder: formData.get('minPerOrder'),
          maxPerOrder: formData.get('maxPerOrder'),
          activationMode,
          waveTheme: formData.get('waveTheme'),
          salesStartAt: formData.get('salesStartAt'),
          salesEndAt: formData.get('salesEndAt'),
          description: formData.get('description'),
          benefits: String(formData.get('benefits') || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean)
        })
      }));
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ticket wave could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form action={submit} className="mt-4 rounded-xl border border-orange-300/20 bg-[#100d17] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div><h4 className="text-sm font-black text-white">Configure a ticket wave</h4><p className="mt-1 text-[10px] text-slate-400">Set this release&apos;s real price, allocation, opening rule, and deliverable benefits.</p></div>
        <button type="button" onClick={onCancel} className="text-xs font-bold text-slate-400">Close</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className={labelClass}>Admission type<select className={inputClass} value={admissionType} onChange={event => setAdmissionType(event.target.value)}><option>General Admission</option><option>VIP</option><option>Group Package</option><option>Backstage / Exclusive</option></select></label>
        <label className={labelClass}>Wave<select className={inputClass} value={availableWaveNumbers.includes(waveNumber) ? waveNumber : ''} onChange={event => {
          const next = Number(event.target.value);
          setWaveNumber(next);
          setWaveLabel(waveNames[next - 1]);
          setActivationMode(next === 1 ? 'scheduled' : 'previous_sold_out');
        }}>{availableWaveNumbers.length === 0 ? <option value="" disabled>All waves configured</option> : availableWaveNumbers.map(number => <option key={number} value={number}>Wave {['I', 'II', 'III'][number - 1]}</option>)}</select></label>
        <label className={labelClass}>Ticket appearance<select className={inputClass} name="waveTheme" defaultValue="obsidian-gold"><option value="obsidian-gold">Obsidian Black & Antique Gold</option><option value="crimson-black">Midnight Crimson & Black</option><option value="electric-violet">Electric Blue & Violet</option></select></label>
        <label className={`${labelClass} sm:col-span-2`}>Wave edition label<input className={inputClass} name="waveLabel" required minLength={2} maxLength={100} value={waveLabel} onChange={event => setWaveLabel(event.target.value)} /></label>
        <label className={labelClass}>Price (KES)<input className={inputClass} name="price" required type="number" min="0.01" max="999999999.99" step="0.01" placeholder="Set confirmed price" /></label>
        <label className={labelClass}>Wave allocation<input className={inputClass} name="capacity" required type="number" min="1" max="1000000" placeholder="Set confirmed allocation" /></label>
        <label className={labelClass}>Opens when<select className={inputClass} value={activationMode} onChange={event => setActivationMode(event.target.value as typeof activationMode)}><option value="scheduled">At a scheduled time</option><option value="previous_sold_out" disabled={waveNumber === 1 || !hasPreviousWave}>When previous wave sells out / closes</option><option value="manual">Only when I activate it</option></select></label>
        {activationMode === 'scheduled' && <label className={labelClass}>Sales open<input className={inputClass} name="salesStartAt" type="datetime-local" required /></label>}
        {activationMode !== 'scheduled' && <input type="hidden" name="salesStartAt" value="" />}
        <label className={labelClass}>Sales close (optional)<input className={inputClass} name="salesEndAt" type="datetime-local" /></label>
        {!hasPreviousWave && waveNumber > 1 && <p className="text-xs text-amber-200 sm:col-span-2 lg:col-span-3">Create the preceding wave for {admissionType} before selecting automatic sell-out activation.</p>}
        <label className={`${labelClass} sm:col-span-2 lg:col-span-3`}>Description<input className={inputClass} name="description" maxLength={2000} placeholder="Tell guests what this release includes." /></label>
        <label className={`${labelClass} sm:col-span-2 lg:col-span-3`}>Benefits (one per line)<textarea className={`${inputClass} min-h-20 py-3`} name="benefits" maxLength={4000} placeholder={'Event admission\nDigital QR ticket\nEvent updates'} /></label>
        <label className={labelClass}>Minimum per order<input className={inputClass} name="minPerOrder" type="number" min="1" max="100" defaultValue="1" /></label>
        <label className={labelClass}>Maximum per order<input className={inputClass} name="maxPerOrder" type="number" min="1" max="100" defaultValue="10" /></label>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <button disabled={saving || availableWaveNumbers.length === 0 || (activationMode === 'previous_sold_out' && !hasPreviousWave)} className="mt-4 min-h-10 rounded-lg bg-orange-400 px-4 text-xs font-black text-[#170d18] hover:bg-orange-300 disabled:opacity-50">{saving ? 'Saving wave…' : 'Save ticket wave'}</button>
    </form>
  );
}

function EventExperienceForm({ event, onSaved, onCancel }: { event: TicketEvent; onSaved: () => void; onCancel: () => void }) {
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
          action: 'update_event_experience',
          eventId: event.id,
          venueName: formData.get('venueName'),
          venueAddress: formData.get('venueAddress'),
          city: formData.get('city'),
          venueMapsUrl: formData.get('venueMapsUrl'),
          venueLatitude: formData.get('venueLatitude'),
          venueLongitude: formData.get('venueLongitude'),
          entranceInstructions: formData.get('entranceInstructions'),
          parkingDetails: formData.get('parkingDetails'),
          transportGuidance: formData.get('transportGuidance'),
          dressCode: formData.get('dressCode'),
          serviceFee: formData.get('serviceFee'),
          eventCapacity: formData.get('eventCapacity')
        })
      }));
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Event details could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form action={submit} className="mt-4 rounded-xl border border-orange-300/15 bg-[#100d17] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div><h4 className="text-sm font-black text-white">Venue, arrival & pricing</h4><p className="mt-1 text-[10px] text-slate-400">Only confirmed details are shown to guests. Fees are fixed per ticket.</p></div>
        <button type="button" onClick={onCancel} className="text-xs font-bold text-slate-400">Close</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>Venue<input className={inputClass} name="venueName" required minLength={2} maxLength={180} defaultValue={event.venue_name} /></label>
        <label className={labelClass}>Town / city<input className={inputClass} name="city" required minLength={2} maxLength={100} defaultValue={event.city} /></label>
        <label className={`${labelClass} sm:col-span-2`}>Full address<input className={inputClass} name="venueAddress" maxLength={500} defaultValue={event.venue_address} placeholder="Confirmed street and area" /></label>
        <label className={`${labelClass} sm:col-span-2`}>Verified Google Maps link<input className={inputClass} name="venueMapsUrl" type="url" defaultValue={event.venue_maps_url} placeholder="https://maps.google.com/..." /></label>
        <label className={labelClass}>Latitude<input className={inputClass} name="venueLatitude" type="number" min="-90" max="90" step="any" defaultValue={event.venue_latitude ?? ''} /></label>
        <label className={labelClass}>Longitude<input className={inputClass} name="venueLongitude" type="number" min="-180" max="180" step="any" defaultValue={event.venue_longitude ?? ''} /></label>
        <label className={labelClass}>Entrance / entry pin<textarea className={`${inputClass} min-h-20 py-3`} name="entranceInstructions" maxLength={2000} defaultValue={event.entrance_instructions} placeholder="Confirmed gate and entrance" /></label>
        <label className={labelClass}>Parking<textarea className={`${inputClass} min-h-20 py-3`} name="parkingDetails" maxLength={2000} defaultValue={event.parking_details} placeholder="Confirmed parking information" /></label>
        <label className={`${labelClass} sm:col-span-2`}>Transport & arrival<textarea className={`${inputClass} min-h-20 py-3`} name="transportGuidance" maxLength={3000} defaultValue={event.transport_guidance} placeholder="Confirmed transport and arrival details only" /></label>
        <label className={labelClass}>Dress code<input className={inputClass} name="dressCode" maxLength={500} defaultValue={event.dress_code} placeholder="Optional" /></label>
        <label className={labelClass}>Service fee per ticket (KES)<input className={inputClass} name="serviceFee" required type="number" min="0" max="1000000" step="0.01" defaultValue={(event.service_fee_minor / 100).toFixed(2)} /></label>
        <label className={labelClass}>Total event capacity (optional)<input className={inputClass} name="eventCapacity" type="number" min="1" max="1000000" defaultValue={event.capacity ?? ''} placeholder="No event-wide limit" /><span className="mt-1 block text-[10px] font-normal text-slate-500">Must be at least the sum of ticket-tier allocations.</span></label>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <button disabled={saving} className="mt-4 min-h-10 rounded-lg bg-orange-400 px-4 text-xs font-black text-[#170d18] hover:bg-orange-300 disabled:opacity-50">{saving ? 'Saving…' : 'Save event details'}</button>
    </form>
  );
}

function ServiceFeeForm({ eventId, serviceFeeMinor, onSaved, onCancel }: {
  eventId: string;
  serviceFeeMinor: number;
  onSaved: () => void;
  onCancel: () => void;
}) {
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
          action: 'update_event_service_fee',
          eventId,
          serviceFee: formData.get('serviceFee')
        })
      }));
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The service fee could not be updated.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form action={submit} className="mb-5 rounded-xl border border-orange-300/15 bg-[#100d17] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-black text-white">Control service fee</h4>
          <p className="mt-1 text-[10px] leading-4 text-slate-400">This fixed fee applies to each new ticket checkout. Existing orders keep the amount they were quoted and paid.</p>
        </div>
        <button type="button" onClick={onCancel} className="text-xs font-bold text-slate-400">Close</button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className={`${labelClass} min-w-52 flex-1`}>Service fee per ticket (KES)
          <input className={inputClass} name="serviceFee" required type="number" min="0" max="1000000" step="0.01" defaultValue={(serviceFeeMinor / 100).toFixed(2)} />
        </label>
        <button disabled={saving} className="min-h-11 rounded-xl bg-orange-400 px-5 text-xs font-black text-[#170d18] hover:bg-orange-300 disabled:opacity-50">{saving ? 'Saving…' : 'Save service fee'}</button>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    </form>
  );
}

function EditTierForm({ event, tier, onSaved, onCancel }: {
  event: TicketEvent;
  tier: TicketType;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [waveActivationMode, setWaveActivationMode] = useState(tier.activation_mode);
  const [salesStartAt, setSalesStartAt] = useState(dateTimeInput(tier.sales_start_at));

  async function submit(formData: FormData) {
    setSaving(true);
    setError('');
    try {
      const isWave = tier.wave_number !== null;
      await readResponse(await fetch('/api/admin/ticketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: isWave ? 'update_ticket_wave' : 'update_ticket_type',
          eventId: event.id,
          ticketTypeId: tier.id,
          name: formData.get('name'),
          waveLabel: formData.get('waveLabel'),
          description: formData.get('description'),
          price: formData.get('price'),
          capacity: formData.get('capacity'),
          waveTheme: formData.get('waveTheme'),
          activationMode: formData.get('activationMode'),
          benefits: String(formData.get('benefits') || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean),
          minPerOrder: formData.get('minPerOrder'),
          maxPerOrder: formData.get('maxPerOrder'),
          salesStartAt: formData.get('salesStartAt'),
          salesEndAt: formData.get('salesEndAt')
        })
      }));
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The ticket tier could not be updated.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form action={submit} className="mt-3 rounded-xl border border-orange-300/15 bg-[#100d17] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h4 className="text-sm font-black text-white">Edit {tier.name}</h4>
        <button type="button" onClick={onCancel} className="text-xs font-bold text-slate-400">Cancel</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tier.wave_number !== null
          ? <><label className={labelClass}>Admission type<input className={inputClass} value={tier.admission_type} readOnly /></label><label className={labelClass}>Wave edition label<input className={inputClass} name="waveLabel" required minLength={2} maxLength={100} defaultValue={tier.wave_label} /></label><label className={labelClass}>Ticket appearance<select className={inputClass} name="waveTheme" defaultValue={tier.wave_theme}><option value="obsidian-gold">Obsidian Black & Antique Gold</option><option value="crimson-black">Midnight Crimson & Black</option><option value="electric-violet">Electric Blue & Violet</option></select></label></>
          : <label className={labelClass}>Tier name<input className={inputClass} name="name" required minLength={2} maxLength={100} defaultValue={tier.name} /></label>}
        <label className={labelClass}>Price (KES)<input className={inputClass} name="price" required type="number" min="0.01" max="999999999.99" step="0.01" defaultValue={(tier.price_minor / 100).toFixed(2)} /></label>
        <label className={labelClass}>Allocation<input className={inputClass} name="capacity" required type="number" min="1" max="1000000" defaultValue={tier.capacity} /></label>
        <label className={`${labelClass} sm:col-span-2 lg:col-span-3`}>Description<input className={inputClass} name="description" maxLength={2000} defaultValue={tier.description} /></label>
        <label className={`${labelClass} sm:col-span-2 lg:col-span-3`}>Included benefits (one per line)<textarea className={`${inputClass} min-h-20 py-3`} name="benefits" maxLength={4000} defaultValue={tier.benefits.join('\n')} /></label>
        <label className={labelClass}>Minimum per order<input className={inputClass} name="minPerOrder" required type="number" min="1" max="100" defaultValue={tier.min_per_order} /></label>
        <label className={labelClass}>Maximum per order<input className={inputClass} name="maxPerOrder" required type="number" min="1" max="100" defaultValue={tier.max_per_order} /></label>
        {tier.wave_number !== null && <label className={labelClass}>Opens when<select className={inputClass} name="activationMode" value={waveActivationMode} onChange={change => {
          const nextMode = change.target.value as typeof waveActivationMode;
          setWaveActivationMode(nextMode);
          if (nextMode !== 'scheduled') setSalesStartAt('');
        }}><option value="scheduled">At a scheduled time</option><option value="previous_sold_out" disabled={tier.wave_number === 1 || !event.ticket_types.some(other => other.admission_type === tier.admission_type && other.wave_number === tier.wave_number! - 1)}>When previous wave sells out / closes</option><option value="manual">Only when I activate it</option></select></label>}
        <label className={labelClass}>Sales open<input className={inputClass} name="salesStartAt" type="datetime-local" required={tier.wave_number !== null && waveActivationMode === 'scheduled'} value={salesStartAt} onChange={change => setSalesStartAt(change.target.value)} /></label>
        <label className={labelClass}>Sales close<input className={inputClass} name="salesEndAt" type="datetime-local" defaultValue={dateTimeInput(tier.sales_end_at)} /></label>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <button disabled={saving} className="mt-4 min-h-10 rounded-lg bg-orange-400 px-4 text-sm font-black text-[#170d18] hover:bg-orange-300 disabled:opacity-50">{saving ? 'Saving changes…' : 'Save tier changes'}</button>
      <p className="mt-2 text-[10px] text-slate-500">Ticket terms and wave configuration lock as soon as an order exists or event sales open.</p>
    </form>
  );
}

function PromotionForm({ eventId, onSaved, onCancel }: { eventId: string; onSaved: () => void; onCancel: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [discountType, setDiscountType] = useState<'fixed' | 'percentage'>('percentage');

  async function submit(formData: FormData) {
    setSaving(true);
    setError('');
    try {
      await readResponse(await fetch('/api/admin/ticketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_promotion',
          eventId,
          code: formData.get('code'),
          discountType,
          discountValue: formData.get('discountValue'),
          maxRedemptions: formData.get('maxRedemptions'),
          startsAt: formData.get('startsAt'),
          endsAt: formData.get('endsAt')
        })
      }));
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The discount could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form action={submit} className="mt-4 rounded-xl border border-violet-300/15 bg-[#100d17] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div><h4 className="text-sm font-black text-white">Create discount code</h4><p className="mt-1 text-[10px] text-slate-400">Discount applies to ticket subtotal. The per-ticket service fee is not discounted.</p></div>
        <button type="button" onClick={onCancel} className="text-xs font-bold text-slate-400">Close</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className={labelClass}>Code<input className={inputClass} name="code" required minLength={2} maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,39}" autoCapitalize="characters" placeholder="EARLYBIRD" /></label>
        <label className={labelClass}>Discount type<select className={inputClass} value={discountType} onChange={change => setDiscountType(change.target.value as 'fixed' | 'percentage')}><option value="percentage">Percentage</option><option value="fixed">Fixed KSh amount</option></select></label>
        <label className={labelClass}>{discountType === 'percentage' ? 'Percent off (1–100)' : 'KSh off per order'}<input className={inputClass} name="discountValue" required type="number" min={discountType === 'percentage' ? 1 : 0.01} max={discountType === 'percentage' ? 100 : 9999999} step={discountType === 'percentage' ? 1 : 0.01} placeholder={discountType === 'percentage' ? '10' : '500.00'} /></label>
        <label className={labelClass}>Maximum redemptions (optional)<input className={inputClass} name="maxRedemptions" type="number" min="1" max="1000000" placeholder="Unlimited" /></label>
        <label className={labelClass}>Code starts (optional)<input className={inputClass} name="startsAt" type="datetime-local" /></label>
        <label className={labelClass}>Code ends (optional)<input className={inputClass} name="endsAt" type="datetime-local" /></label>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <button disabled={saving} className="mt-4 min-h-10 rounded-lg bg-violet-300 px-4 text-xs font-black text-[#170d18] hover:bg-violet-200 disabled:opacity-50">{saving ? 'Saving code…' : 'Create discount code'}</button>
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
  const [editingTierId, setEditingTierId] = useState<string | null>(null);
  const [editingExperience, setEditingExperience] = useState(false);
  const [editingServiceFee, setEditingServiceFee] = useState(false);
  const [addingPromotion, setAddingPromotion] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [addingWave, setAddingWave] = useState(false);
  const [waveSavingId, setWaveSavingId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState('');
  const [photoSaving, setPhotoSaving] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [promotionError, setPromotionError] = useState('');
  const allocated = event.ticket_types.reduce((total, tier) => total + tier.capacity, 0);
  async function setWaveStatus(tier: TicketType, status: 'active' | 'paused') {
    setWaveSavingId(tier.id);
    setStatusError('');
    try {
      await readResponse(await fetch('/api/admin/ticketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: tier.activation_mode === 'manual' && status === 'active' ? 'set_manual_ticket_wave_open' : 'set_ticket_wave_status',
          eventId: event.id,
          ticketTypeId: tier.id,
          status,
          open: status === 'active'
        })
      }));
      onRefresh();
    } catch (cause) {
      setStatusError(cause instanceof Error ? cause.message : 'Ticket wave status could not be changed.');
    } finally {
      setWaveSavingId(null);
    }
  }

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
  async function uploadPhoto(file: File) {
    setPhotoSaving(true);
    setPhotoError('');
    try {
      const form = new FormData();
      form.set('photo', file);
      await readResponse(await fetch(`/api/admin/ticketing/events/${event.id}/image`, {
        method: 'POST',
        body: form
      }));
      onRefresh();
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : 'Event photo could not be uploaded.');
    } finally {
      setPhotoSaving(false);
    }
  }
  async function setPromotionActive(promotion: TicketPromotion) {
    setPromotionError('');
    try {
      await readResponse(await fetch('/api/admin/ticketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_promotion_active', promotionId: promotion.id, active: !promotion.active })
      }));
      onRefresh();
    } catch (cause) {
      setPromotionError(cause instanceof Error ? cause.message : 'Discount status could not be updated.');
    }
  }
  return (
    <article className="overflow-hidden rounded-2xl border border-white/10 bg-[#17121e] shadow-xl shadow-black/20">
      <div className="relative isolate overflow-hidden border-b border-white/10 bg-gradient-to-r from-[#211326] via-[#251526] to-[#17121e] p-5 text-white sm:p-6">
        {event.cover_image_url && <Image src={event.cover_image_url} alt="" fill sizes="(max-width: 768px) 100vw, 1200px" unoptimized className="object-cover opacity-25" />}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#17121e]/90 via-[#211326]/75 to-[#17121e]/70" />
        <div className="relative z-10">
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
          <label className="mt-4 inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-orange-200/20 bg-black/20 px-3 text-xs font-bold text-orange-100 hover:bg-black/30">
            <ImagePlus size={14} />{photoSaving ? 'Uploading photo…' : event.cover_image_url ? 'Replace event photo' : 'Upload event photo'}
            <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={photoSaving} onChange={change => {
              const file = change.currentTarget.files?.[0];
              change.currentTarget.value = '';
              if (file) void uploadPhoto(file);
            }} />
          </label>
          {photoError && <p role="alert" className="mt-2 text-xs text-red-200">{photoError}</p>}
        </div>
      </div>
      <div className="p-5 sm:p-6">
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/5 bg-white/[0.035] p-3"><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Event capacity</p><p className="mt-1 text-sm font-black text-white">{event.capacity ? event.capacity.toLocaleString('en-KE') : 'Not set'}</p></div>
          <div className="rounded-xl border border-white/5 bg-white/[0.035] p-3"><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Tier allocation</p><p className="mt-1 text-sm font-black text-white">{allocated.toLocaleString('en-KE')}{event.capacity ? ` / ${event.capacity.toLocaleString('en-KE')}` : ''}</p></div>
          <div className="rounded-xl border border-white/5 bg-white/[0.035] p-3"><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Event ends</p><p className="mt-1 text-sm font-black text-white">{eventDate(event.ends_at)}</p></div>
        </div>
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-white/5 bg-white/[0.025] p-3">
          <p className="mr-auto text-xs text-slate-300">Service fee: <strong className="text-white">{money(event.service_fee_minor)} per ticket</strong></p>
          {(['draft', 'scheduled'].includes(event.status) || (event.status === 'on_sale' && canPublish)) && <button type="button" onClick={() => setEditingServiceFee(value => !value)} className="min-h-9 rounded-lg border border-orange-200/20 px-3 text-xs font-bold text-orange-100 hover:bg-orange-100/5">{editingServiceFee ? 'Close fee control' : 'Control service fee'}</button>}
          {['draft', 'scheduled'].includes(event.status) && <button type="button" onClick={() => { setEditingExperience(value => !value); setAddingPromotion(false); }} className="min-h-9 rounded-lg border border-white/10 px-3 text-xs font-bold text-orange-100 hover:bg-white/5">{editingExperience ? 'Close event details' : 'Edit venue, arrival & fee'}</button>}
          {['draft', 'scheduled'].includes(event.status) && <button type="button" onClick={() => { setAddingPromotion(value => !value); setEditingExperience(false); }} className="min-h-9 rounded-lg border border-violet-200/20 px-3 text-xs font-bold text-violet-100 hover:bg-violet-100/5">{addingPromotion ? 'Close discount form' : `Discounts (${event.promotions.length})`}</button>}
        </div>
        {editingServiceFee && <ServiceFeeForm eventId={event.id} serviceFeeMinor={event.service_fee_minor} onCancel={() => setEditingServiceFee(false)} onSaved={() => { setEditingServiceFee(false); onRefresh(); }} />}
        {editingExperience && <EventExperienceForm event={event} onCancel={() => setEditingExperience(false)} onSaved={() => { setEditingExperience(false); onRefresh(); }} />}
        {addingPromotion && <PromotionForm eventId={event.id} onCancel={() => setAddingPromotion(false)} onSaved={() => { setAddingPromotion(false); onRefresh(); }} />}
        {event.promotions.length > 0 && (
          <div className="mb-5 rounded-xl border border-violet-200/10 bg-black/10 p-4">
            <h4 className="text-xs font-black uppercase tracking-wide text-violet-100">Discount codes</h4>
            <div className="mt-3 space-y-2">
              {event.promotions.map(promotion => (
                <div key={promotion.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.025] p-3">
                  <div><p className="text-sm font-black text-white">{promotion.code} <span className={`ml-2 text-[9px] uppercase ${promotion.active ? 'text-emerald-200' : 'text-slate-500'}`}>{promotion.active ? 'Active' : 'Paused'}</span></p><p className="mt-1 text-[10px] text-slate-400">{promotion.discount_type === 'percentage' ? `${promotion.discount_value}% off` : `${money(promotion.discount_value)} off`} · {promotion.max_redemptions ? `${promotion.max_redemptions} redemptions max` : 'No redemption cap'}</p></div>
                  <button type="button" onClick={() => void setPromotionActive(promotion)} className="min-h-8 rounded-md border border-white/10 px-2.5 text-[10px] font-bold text-slate-200 hover:bg-white/5">{promotion.active ? 'Pause code' : 'Reactivate'}</button>
                </div>
              ))}
            </div>
            {promotionError && <p role="alert" className="mt-2 text-xs text-red-200">{promotionError}</p>}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-black text-white">Ticket tiers</h4>
            <p className="mt-1 text-xs text-slate-400">Price snapshots and allocations are isolated from bar product inventory.</p>
          </div>
          {event.status === 'draft' || event.status === 'scheduled' ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setAddingTier(value => !value)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-black text-orange-100 hover:bg-white/5">
                <Plus size={14} /> Add tier
              </button>
              <button type="button" onClick={() => setAddingWave(value => !value)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-orange-300/25 px-3 text-xs font-black text-orange-100 hover:bg-orange-300/5">
                <Ticket size={14} /> Configure ticket waves
              </button>
              {canPublish && <button type="button" onClick={() => void setStatus('on_sale')} disabled={!salesReady || statusSaving || event.ticket_types.length === 0} title={!salesReady ? 'Release gates are not configured.' : event.ticket_types.length === 0 ? 'Add a ticket tier before opening sales.' : ''} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-orange-400 px-3 text-xs font-black text-[#170d18] hover:bg-orange-300 disabled:cursor-not-allowed disabled:opacity-40">{statusSaving ? 'Updating…' : 'Open sales'}</button>}
            </div>
          ) : <span className="text-xs font-semibold text-slate-500">Tiers locked for this event state</span>}
        </div>
        {event.status === 'on_sale' && <button type="button" onClick={() => void setStatus('scheduled')} disabled={statusSaving} className="mt-3 min-h-9 rounded-lg border border-amber-200/20 px-3 text-xs font-bold text-amber-100 hover:bg-amber-100/5 disabled:opacity-50">{statusSaving ? 'Updating…' : 'Pause ticket sales'}</button>}
        {statusError && <p role="alert" className="mt-3 text-xs text-red-200">{statusError}</p>}
        {addingWave && <WaveForm event={event} onCancel={() => setAddingWave(false)} onCreated={() => { setAddingWave(false); onRefresh(); }} />}
        {event.ticket_types.length > 0 ? (
          <div className="mt-4 divide-y divide-white/10 rounded-xl border border-white/10">
            {event.ticket_types.map(tier => (
              <div key={tier.id}>
                <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 rounded-lg bg-orange-400/10 p-2 text-orange-300"><Ticket size={15} /></span>
                    <div className="min-w-0">
                      {tier.wave_number !== null && <p className="mb-1 text-[9px] font-black uppercase tracking-[0.16em] text-orange-200">{tier.wave_label} · {tier.admission_type}</p>}
                      <p className="truncate text-sm font-black text-white">{tier.name}</p>
                      <p className="mt-1 text-xs text-slate-400">{tier.description || 'No tier description'} · {tier.min_per_order}–{tier.max_per_order} per order</p>
                      {tier.wave_number !== null && <p className="mt-1 text-[10px] text-slate-500">Opens {tier.activation_mode === 'scheduled' ? 'on schedule' : tier.activation_mode === 'previous_sold_out' ? 'after prior wave sells out or closes' : tier.wave_manual_open && tier.status === 'active' ? 'manually activated' : 'when you activate it'} · {tier.wave_theme.replaceAll('-', ' & ')}</p>}
                      {tier.benefits.length > 0 && <p className="mt-1 text-[10px] text-violet-200">{tier.benefits.join(' · ')}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right"><p className="text-sm font-black text-orange-100">{money(tier.price_minor, tier.currency)}</p><p className="mt-1 text-xs text-slate-400">{tier.capacity.toLocaleString('en-KE')} allocated · {statusLabel(tier.status)}</p></div>
                    {tier.wave_number !== null && canPublish && <button type="button" onClick={() => {
                      const isClosed = tier.status === 'paused' || (tier.activation_mode === 'manual' && !tier.wave_manual_open);
                      void setWaveStatus(tier, isClosed ? 'active' : 'paused');
                    }} disabled={waveSavingId === tier.id} className="min-h-9 rounded-lg border border-white/10 px-3 text-xs font-bold text-amber-100 hover:bg-white/5 disabled:opacity-50">{waveSavingId === tier.id ? 'Saving…' : tier.status === 'paused' || (tier.activation_mode === 'manual' && !tier.wave_manual_open) ? 'Activate wave' : 'Pause wave'}</button>}
                    {['draft', 'scheduled'].includes(event.status) && tier.status !== 'archived' && <button type="button" onClick={() => setEditingTierId(value => value === tier.id ? null : tier.id)} className="min-h-9 rounded-lg border border-white/10 px-3 text-xs font-bold text-orange-100 hover:bg-white/5">{editingTierId === tier.id ? 'Close' : 'Edit'}</button>}
                  </div>
                </div>
                {editingTierId === tier.id && <div className="px-4 pb-4"><EditTierForm event={event} tier={tier} onCancel={() => setEditingTierId(null)} onSaved={() => { setEditingTierId(null); onRefresh(); }} /></div>}
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
  const [notice, setNotice] = useState('');
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
              <Link href="/admin/ticketing/insights" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-sky-300/20 bg-sky-300/5 px-4 text-sm font-bold text-sky-100 transition hover:bg-sky-300/10"><BarChart3 size={15} /> Demand insights</Link>
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

        <section aria-labelledby="ticketing-quick-start" className="rounded-2xl border border-white/10 bg-[#17121e] p-5 sm:p-6">
          <div className="mb-4">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-200">Quick start</p>
            <h2 id="ticketing-quick-start" className="mt-1 text-lg font-black text-white">Run ticketing in four steps</h2>
            <p className="mt-1 text-xs text-slate-400">Ticket orders, payment records and guest ticket delivery stay separate from shop orders.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <button type="button" onClick={() => setAddingEvent(true)} className="rounded-xl border border-white/10 bg-white/[0.025] p-4 text-left transition hover:border-orange-200/25 hover:bg-white/[0.05]">
              <span className="text-[10px] font-black uppercase tracking-wider text-orange-200">1 · Event</span>
              <span className="mt-1 block text-sm font-black text-white">{data?.totals.events ? `Review ${data.totals.events} event${data.totals.events === 1 ? '' : 's'}` : 'Create your event'}</span>
              <span className="mt-1 block text-xs leading-5 text-slate-400">Save the confirmed date, venue and event details as a private draft.</span>
            </button>
            <button type="button" onClick={() => document.getElementById('ticket-event-vault')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="rounded-xl border border-white/10 bg-white/[0.025] p-4 text-left transition hover:border-orange-200/25 hover:bg-white/[0.05]">
              <span className="text-[10px] font-black uppercase tracking-wider text-orange-200">2 · Tickets</span>
              <span className="mt-1 block text-sm font-black text-white">Set price &amp; ticket waves</span>
              <span className="mt-1 block text-xs leading-5 text-slate-400">Choose admission, KES price, allocation, benefits and sales-open time.</span>
            </button>
            <Link href="/admin/ticketing/scan" className="rounded-xl border border-white/10 bg-white/[0.025] p-4 transition hover:border-orange-200/25 hover:bg-white/[0.05]">
              <span className="text-[10px] font-black uppercase tracking-wider text-orange-200">3 · Gate team</span>
              <span className="mt-1 block text-sm font-black text-white">Assign staff &amp; gates</span>
              <span className="mt-1 block text-xs leading-5 text-slate-400">Create named staff access and scope each scanner to its event and gate.</span>
            </Link>
            <Link href="/admin/ticketing/live" className="rounded-xl border border-white/10 bg-white/[0.025] p-4 transition hover:border-orange-200/25 hover:bg-white/[0.05]">
              <span className="text-[10px] font-black uppercase tracking-wider text-orange-200">4 · Orders &amp; entry</span>
              <span className="mt-1 block text-sm font-black text-white">Monitor payments &amp; scans</span>
              <span className="mt-1 block text-xs leading-5 text-slate-400">Follow verified orders, ticket issuance, guest-wallet delivery and gate check-ins.</span>
            </Link>
          </div>
        </section>

        <section role="status" className="relative overflow-hidden rounded-2xl border border-orange-400/25 bg-gradient-to-r from-orange-950/50 via-[#20131f] to-[#171220] p-4 sm:p-5">
          <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-16 h-40 w-40 rounded-full bg-orange-400/10 blur-3xl" />
          <div className="relative flex items-start gap-3">
            <span className="rounded-xl border border-orange-300/20 bg-orange-300/10 p-2 text-orange-300"><AlertTriangle size={18} /></span>
            <div className="flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-black text-orange-100">{data?.salesReady ? 'Checkout configuration passes its release checks' : 'Sales are locked for now'}</p><span className="rounded-full border border-orange-300/20 bg-orange-300/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-orange-200">{data?.salesReady ? 'Sandbox rehearsal still required' : 'Configuration required'}</span></div><p className="mt-1 text-xs leading-5 text-orange-50/70">The implemented order flow reserves inventory, initializes Paystack, verifies payment server-side, issues encrypted tickets and emails one-time wallet access. Gate staff scan online with event-and-gate-scoped accounts. Keep both release switches off until all nine migrations, sandbox credentials, email delivery, admin MFA and the full payment-to-wallet-to-gate rehearsal are verified. See the Trust Centre for live schema and configuration checks.</p><Link href="/admin/ticketing/security" className="mt-2 inline-flex text-xs font-black text-orange-100 underline underline-offset-2">Open Trust Centre readiness checks</Link></div>
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

        {notice && <p role="status" className="rounded-xl border border-orange-300/20 bg-orange-300/10 p-3 text-sm text-orange-100">{notice}</p>}
        {addingEvent && <EventForm onCancel={() => setAddingEvent(false)} onCreated={message => { setAddingEvent(false); setNotice(message || 'Event draft created.'); void load(); }} />}

        <section id="ticket-event-vault" className="scroll-mt-6 space-y-4">
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
          <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-orange-300" size={19} /><div><p className="text-sm font-black text-white">Release gate: acceptance test still outstanding</p><p className="mt-1 text-xs leading-5 text-slate-400">The server-side payment, reservation, wallet and online scanner flows are implemented. Before live sales, verify the full journey in Paystack test mode: successful and failed callback, ticket in the guest wallet, email access, first gate scan and duplicate-scan rejection. Also verify refund and reconciliation handling. Do not test with live payment keys.</p></div><ArrowUpRight className="ml-auto hidden text-slate-500 sm:block" size={16} /></div>
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
