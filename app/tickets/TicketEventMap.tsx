'use client';

import { useMemo } from 'react';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import Link from 'next/link';
import { MapPin } from 'lucide-react';
import type { PublicTicketEvent } from '@/lib/ticketing/publicEvents.server';
import { getCartoVoyagerTileUrl } from '@/lib/cartoMaps';

type Coordinates = { latitude: number; longitude: number };
type MappedEvent = PublicTicketEvent & { venue_latitude: number; venue_longitude: number };

const eventIcon = L.divIcon({
  className: '',
  html: '<span style="display:block;width:22px;height:22px;border:4px solid white;border-radius:50%;background:#fb923c;box-shadow:0 2px 10px #11182780"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11]
});

export default function TicketEventMap({
  events,
  origin
}: {
  events: PublicTicketEvent[];
  origin: Coordinates | null;
}) {
  const mappedEvents = useMemo(() => events.filter((event): event is MappedEvent =>
    event.venue_latitude !== null && event.venue_longitude !== null
    && Number.isFinite(event.venue_latitude) && Number.isFinite(event.venue_longitude)
    && event.venue_latitude >= -90 && event.venue_latitude <= 90
    && event.venue_longitude >= -180 && event.venue_longitude <= 180
  ), [events]);
  const center: [number, number] = origin
    ? [origin.latitude, origin.longitude]
    : mappedEvents.length
      ? [
        mappedEvents.reduce((sum, event) => sum + (event.venue_latitude || 0), 0) / mappedEvents.length,
        mappedEvents.reduce((sum, event) => sum + (event.venue_longitude || 0), 0) / mappedEvents.length
      ]
      : [-1.286389, 36.817223];

  return (
    <section aria-label="Event map" className="ticket-theme-panel overflow-hidden rounded-2xl border">
      <div className="h-[28rem] w-full">
        <MapContainer center={center} zoom={mappedEvents.length > 1 ? 11 : 13} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
          <TileLayer attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>' url={getCartoVoyagerTileUrl()} />
          {mappedEvents.map(event => (
            <Marker key={event.id} position={[event.venue_latitude, event.venue_longitude]} icon={eventIcon}>
              <Popup>
                <div className="space-y-2 p-1">
                  <p className="font-bold">{event.title}</p>
                  <p className="flex items-center gap-1 text-xs"><MapPin size={12} />{event.venue_name}, {event.city}</p>
                  <Link className="text-xs font-bold text-orange-700" href={`/tickets/${encodeURIComponent(event.slug)}`}>View tickets</Link>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      <p className="ticket-theme-muted px-4 py-3 text-xs">
        {mappedEvents.length
          ? `${mappedEvents.length} ${mappedEvents.length === 1 ? 'event has' : 'events have'} a published venue pin.`
          : 'No matching events have published map coordinates yet. Try list view or search by city.'}
      </p>
    </section>
  );
}
