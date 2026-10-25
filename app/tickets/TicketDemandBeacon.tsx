'use client';

import { useEffect } from 'react';
import { recordTicketingDemand } from '@/lib/ticketing/demandSignals';

export default function TicketDemandBeacon({ eventId }: { eventId: string }) {
  useEffect(() => {
    recordTicketingDemand({ type: 'event_view', eventId });
  }, [eventId]);

  return null;
}
