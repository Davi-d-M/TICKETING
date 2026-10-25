'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, LocateFixed, MapPin, Search, SlidersHorizontal } from 'lucide-react';
import type { PublicTicketEvent } from '@/lib/ticketing/publicEvents.server';
import { recordTicketingDemand } from '@/lib/ticketing/demandSignals';

const TicketEventMap = dynamic(() => import('@/app/tickets/TicketEventMap'), {
  ssr: false,
  loading: () => <div className="ticket-theme-panel-muted h-[28rem] animate-pulse rounded-2xl border" />
});

type DateFilter = 'any' | 'today' | 'week' | 'month';
type SortOption = 'soonest' | 'price-low' | 'price-high' | 'nearby';
type Coordinates = { latitude: number; longitude: number };

function normalize(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function withinEditDistanceOne(left: string, right: string) {
  if (Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex++;
      rightIndex++;
      continue;
    }
    if (++edits > 1) return false;
    if (left.length > right.length) leftIndex++;
    else if (right.length > left.length) rightIndex++;
    else {
      leftIndex++;
      rightIndex++;
    }
  }
  return edits + Number(leftIndex < left.length || rightIndex < right.length) <= 1;
}

function matchesSearch(event: PublicTicketEvent, query: string) {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const text = normalize([event.title, event.description, event.venue_name, event.venue_address, event.city].join(' '));
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  return terms.every(term => text.includes(term) || words.some(word =>
    term.length >= 5 && (word.startsWith(term.slice(0, 3)) || withinEditDistanceOne(term, word))
  ));
}

function distanceInKm(origin: Coordinates, event: PublicTicketEvent) {
  if (event.venue_latitude === null || event.venue_longitude === null) return null;
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDifference = toRadians(event.venue_latitude - origin.latitude);
  const longitudeDifference = toRadians(event.venue_longitude - origin.longitude);
  const latitude1 = toRadians(origin.latitude);
  const latitude2 = toRadians(event.venue_latitude);
  const haversine = Math.sin(latitudeDifference / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDifference / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function lowestAvailablePrice(event: PublicTicketEvent) {
  const prices = event.ticket_types
    .filter(ticket => ticket.wave_open && ticket.remaining > 0)
    .map(ticket => ticket.price_minor);
  return prices.length ? Math.min(...prices) : Number.POSITIVE_INFINITY;
}

function formatPrice(amount: number, currency: string) {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: currency.trim(),
    maximumFractionDigits: 2
  }).format(amount / 100);
}

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

function EventCard({ event, origin }: { event: PublicTicketEvent; origin: Coordinates | null }) {
  const availableTicketTypes = event.ticket_types.filter(ticketType => ticketType.wave_open && ticketType.remaining > 0);
  const lowestPrice = availableTicketTypes.length
    ? Math.min(...availableTicketTypes.map(ticketType => ticketType.price_minor))
    : null;
  const distance = origin ? distanceInKm(origin, event) : null;

  return (
    <article className="ticket-theme-panel group overflow-hidden rounded-3xl border shadow-lg shadow-slate-900/5 transition duration-300 hover:-translate-y-1 hover:border-orange-300 hover:shadow-orange-900/10">
      <div
        className="ticket-theme-hero relative isolate min-h-56 overflow-hidden border-b bg-cover bg-center p-6"
        style={event.cover_image_url ? { backgroundImage: `linear-gradient(0deg, rgba(13,10,18,.82), rgba(13,10,18,.1)), url("${event.cover_image_url}")` } : undefined}
      >
        {event.age_limit !== null && (
          <span className="absolute right-6 top-6 rounded-full border border-slate-200 bg-white/90 px-3 py-1.5 text-[10px] font-black text-slate-700">
            {event.age_limit}+
          </span>
        )}
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-14 -z-10 h-56 w-56 rounded-full bg-orange-200/45 blur-[70px]" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-20 left-1/4 -z-10 h-48 w-48 rounded-full bg-violet-200/35 blur-[70px]" />
        <div className="absolute bottom-6 left-6 right-6">
          <p className="ticket-theme-accent text-[10px] font-black uppercase tracking-[0.18em]">{event.city}</p>
          <h3 className="ticket-theme-text mt-2 max-w-xl text-2xl font-black tracking-tight sm:text-3xl">{event.title}</h3>
          <p className="ticket-theme-copy mt-2 flex items-center gap-2 text-xs"><MapPin size={13} />{event.venue_name}</p>
        </div>
      </div>
      <div className="p-5 sm:p-6">
        <div className="ticket-theme-copy flex flex-wrap gap-x-5 gap-y-2 text-xs">
          <span className="inline-flex items-center gap-2"><CalendarDays size={14} className="ticket-theme-accent" />{formatEventDate(event.starts_at, event.timezone)}</span>
          {distance !== null && <span>{distance.toFixed(1)} km away</span>}
        </div>
        <p className="ticket-theme-copy mt-4 line-clamp-3 text-sm leading-6">{event.description || 'Get ready for a night out. Event details and ticket options are available here.'}</p>
        {event.ticket_types.some(ticketType => ticketType.wave_number !== null) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {event.ticket_types.filter(ticketType => ticketType.wave_number !== null).map(ticketType => (
              <span key={ticketType.id} className="ticket-theme-accent-soft rounded-full border px-3 py-1 text-[9px] font-bold">
                {ticketType.wave_label} · {ticketType.admission_type}
              </span>
            ))}
          </div>
        )}
        <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-slate-200 pt-4" style={{ borderColor: 'var(--ticket-border)' }}>
          <div>
            <p className="ticket-theme-muted text-[9px] font-black uppercase tracking-[0.15em]">{lowestPrice === null ? 'Next release' : 'Tickets from'}</p>
            <p className="ticket-theme-accent mt-1 text-lg font-black">{lowestPrice === null ? 'No wave open' : formatPrice(lowestPrice, event.ticket_types[0]?.currency || 'KES')}</p>
          </div>
          <a href={`/tickets/${encodeURIComponent(event.slug)}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-orange-400 px-4 text-xs font-black text-[#170d18] transition hover:bg-orange-300">
            Event &amp; tickets <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </article>
  );
}

export default function TicketEventDiscovery({ events }: { events: PublicTicketEvent[] }) {
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('any');
  const [maximumPrice, setMaximumPrice] = useState('');
  const [sort, setSort] = useState<SortOption>('soonest');
  const [mapVisible, setMapVisible] = useState(false);
  const [origin, setOrigin] = useState<Coordinates | null>(null);
  const [locationMessage, setLocationMessage] = useState('');

  const cities = useMemo(() => [...new Set(events.map(event => event.city).filter(Boolean))].sort(), [events]);
  const suggestions = useMemo(() => {
    const needle = normalize(query.trim());
    if (needle.length < 2) return [];
    return events
      .filter(event => [event.title, event.venue_name, event.city].some(value => normalize(value).includes(needle)))
      .slice(0, 6)
      .map(event => event.title);
  }, [events, query]);

  const filteredEvents = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dateLimits: Record<DateFilter, number> = {
      any: Number.POSITIVE_INFINITY,
      today: new Date(today.getTime() + 24 * 60 * 60 * 1000).getTime(),
      week: now.getTime() + 7 * 24 * 60 * 60 * 1000,
      month: now.getTime() + 30 * 24 * 60 * 60 * 1000
    };
    const maximumMinor = maximumPrice.trim() ? Number(maximumPrice) * 100 : Number.POSITIVE_INFINITY;
    return events
      .filter(event => matchesSearch(event, query))
      .filter(event => !city || event.city.toLowerCase() === city.toLowerCase())
      .filter(event => {
        const start = new Date(event.starts_at).getTime();
        return Number.isFinite(start) && start >= (dateFilter === 'today' ? today.getTime() : now.getTime())
          && start < dateLimits[dateFilter];
      })
      .filter(event => lowestAvailablePrice(event) <= maximumMinor)
      .sort((left, right) => {
        if (sort === 'price-low') return lowestAvailablePrice(left) - lowestAvailablePrice(right);
        if (sort === 'price-high') return lowestAvailablePrice(right) - lowestAvailablePrice(left);
        if (sort === 'nearby' && origin) {
          const leftDistance = distanceInKm(origin, left) ?? Number.POSITIVE_INFINITY;
          const rightDistance = distanceInKm(origin, right) ?? Number.POSITIVE_INFINITY;
          if (leftDistance !== rightDistance) return leftDistance - rightDistance;
        }
        return new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime();
      });
  }, [city, dateFilter, events, maximumPrice, origin, query, sort]);

  useEffect(() => {
    const search = query.trim();
    if (search.length < 2) return;
    const timeout = window.setTimeout(() => {
      recordTicketingDemand({
        type: 'event_search',
        metadata: { query: search, zeroResults: filteredEvents.length === 0, results: filteredEvents.length }
      });
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [filteredEvents.length, query]);

  useEffect(() => {
    if (!city && dateFilter === 'any' && !maximumPrice) return;
    const timeout = window.setTimeout(() => {
      recordTicketingDemand({
        type: 'filter',
        metadata: {
          city: city || null,
          dateRange: dateFilter,
          priceCeilingKes: maximumPrice ? Number(maximumPrice) : null
        }
      });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [city, dateFilter, maximumPrice]);

  function useMyLocation() {
    if (!navigator.geolocation) {
      setLocationMessage('Location is not available in this browser.');
      return;
    }
    setLocationMessage('Finding events near you…');
    navigator.geolocation.getCurrentPosition(
      position => {
        setOrigin({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setSort('nearby');
        setLocationMessage('');
      },
      error => setLocationMessage(error.code === error.PERMISSION_DENIED
        ? 'Location permission was denied. You can still search by city.'
        : 'Your location could not be determined. Try again or search by city.'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  }

  const selectClass = 'ticket-theme-panel-muted min-h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-orange-400';

  return (
    <div className="space-y-5">
      <div className="ticket-theme-panel rounded-2xl border p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1.5fr)_minmax(150px,.8fr)_minmax(145px,.75fr)_minmax(130px,.65fr)_auto]">
          <label className="relative block">
            <span className="sr-only">Search events, venues, or cities</span>
            <Search aria-hidden="true" size={17} className="ticket-theme-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              aria-label="Search events, venues, or cities"
              autoComplete="off"
              className={`ticket-theme-panel-muted min-h-11 w-full rounded-xl border pl-10 pr-3 text-sm outline-none placeholder:text-slate-500 focus:border-orange-400`}
              list="ticket-event-suggestions"
              onChange={event => setQuery(event.target.value)}
              placeholder="Artist, event, venue…"
              value={query}
            />
            <datalist id="ticket-event-suggestions">
              {suggestions.map(suggestion => <option key={suggestion} value={suggestion} />)}
            </datalist>
          </label>
          <label>
            <span className="sr-only">Filter by city</span>
            <select aria-label="Filter by city" className={selectClass} onChange={event => setCity(event.target.value)} value={city}>
              <option value="">All cities</option>
              {cities.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Filter by date</span>
            <select aria-label="Filter by date" className={selectClass} onChange={event => setDateFilter(event.target.value as DateFilter)} value={dateFilter}>
              <option value="any">Any date</option>
              <option value="today">Today</option>
              <option value="week">Next 7 days</option>
              <option value="month">Next 30 days</option>
            </select>
          </label>
          <label className="relative">
            <span className="sr-only">Maximum ticket price in KES</span>
            <span className="ticket-theme-muted absolute left-3 top-1/2 -translate-y-1/2 text-xs">KES</span>
            <input
              aria-label="Maximum ticket price in KES"
              className="ticket-theme-panel-muted min-h-11 w-full rounded-xl border pl-12 pr-3 text-sm outline-none placeholder:text-slate-500 focus:border-orange-400"
              min="0"
              onChange={event => setMaximumPrice(event.target.value)}
              placeholder="Any price"
              type="number"
              value={maximumPrice}
            />
          </label>
          <button type="button" onClick={useMyLocation} className="ticket-theme-accent-soft inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-xs font-bold transition hover:opacity-80">
            <LocateFixed size={15} /> Near me
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs">
            <SlidersHorizontal size={14} className="ticket-theme-accent" />
            <span className="ticket-theme-muted">Sort by</span>
            <select aria-label="Sort events" className="ticket-theme-panel-muted min-h-9 rounded-lg border px-2 text-xs outline-none focus:border-orange-400" onChange={event => setSort(event.target.value as SortOption)} value={sort}>
              <option value="soonest">Soonest</option>
              <option value="price-low">Lowest price</option>
              <option value="price-high">Highest price</option>
              {origin && <option value="nearby">Nearest</option>}
            </select>
          </label>
          <div className="flex items-center gap-3">
            {locationMessage && <p role="status" className="ticket-theme-muted text-xs">{locationMessage}</p>}
            {origin && <span className="ticket-theme-muted text-xs">Location used only on this device</span>}
            <button type="button" aria-pressed={mapVisible} onClick={() => setMapVisible(value => !value)} className="ticket-theme-panel-muted inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-xs font-bold transition hover:border-orange-300">
              <MapPin size={14} /> {mapVisible ? 'List view' : 'Map view'}
            </button>
          </div>
        </div>
      </div>

      <p role="status" aria-live="polite" className="ticket-theme-muted text-xs">
        {filteredEvents.length} {filteredEvents.length === 1 ? 'event' : 'events'} found
      </p>

      {filteredEvents.length ? mapVisible ? (
        <TicketEventMap events={filteredEvents} origin={origin} />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredEvents.map(event => <EventCard key={event.id} event={event} origin={origin} />)}
        </div>
      ) : (
        <div className="ticket-theme-panel rounded-3xl border border-dashed px-6 py-14 text-center shadow-sm">
          <span className="ticket-theme-accent-soft mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border"><Search size={23} /></span>
          <h3 className="ticket-theme-text mt-4 text-xl font-black">No events match those filters</h3>
          <p className="ticket-theme-copy mx-auto mt-2 max-w-md text-sm leading-6">Try another search, a wider date range, or a different city or price.</p>
        </div>
      )}
    </div>
  );
}
