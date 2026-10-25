'use client';

export type DemandSignal = {
  type: 'event_view' | 'event_search' | 'filter' | 'checkout_intent';
  eventId?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
};

const consentKey = 'ticketing-demand-consent';
const visitorKey = 'ticketing-demand-visitor';

function getVisitorId() {
  try {
    const existing = window.sessionStorage.getItem(visitorKey);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const visitorId = crypto.randomUUID();
    window.sessionStorage.setItem(visitorKey, visitorId);
    return visitorId;
  } catch {
    return null;
  }
}

export function recordTicketingDemand(signal: DemandSignal) {
  if (typeof window === 'undefined') return;
  try {
    if (window.localStorage.getItem(consentKey) !== 'accepted') return;
  } catch {
    return;
  }
  if (signal.type === 'event_search') {
    const query = signal.metadata?.query;
    if (typeof query !== 'string' || query.trim().length < 2
      || /(?:[^\s@]+@[^\s@]+\.[^\s@]+|\+?\d[\d\s().-]{6,}\d)/.test(query)) return;
  }
  const visitorId = getVisitorId();
  if (!visitorId) return;

  void fetch('/api/ticketing/demand', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...signal, visitorId }),
    keepalive: true
  }).then(response => {
    if (!response.ok) {
      console.error(`[TicketingDemand] Signal was not recorded (HTTP ${response.status}).`);
    }
  }).catch(cause => {
    console.error('[TicketingDemand] Signal could not be sent:', cause);
  });
}
