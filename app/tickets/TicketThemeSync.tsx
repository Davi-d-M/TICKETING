'use client';

import { useEffect } from 'react';
import { isTicketTheme } from '@/lib/ticketing/theme';

export default function TicketThemeSync() {
  useEffect(() => {
    let active = true;
    let inFlight = false;
    let didLogFailure = false;

    async function refreshTheme() {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        const response = await fetch('/api/ticketing/theme', { cache: 'no-store' });
        const result = await response.json() as { theme?: unknown; error?: string };
        if (!response.ok) throw new Error(result.error || `Ticket theme request failed (${response.status}).`);
        if (active && isTicketTheme(result.theme)) {
          document.querySelector<HTMLElement>('.ticket-theme-scope')?.setAttribute('data-ticket-theme', result.theme);
        }
      } catch (cause) {
        if (active && !didLogFailure) {
          console.warn('[TicketingTheme] Could not refresh the published customer theme.', cause);
          didLogFailure = true;
        }
      } finally {
        inFlight = false;
      }
    }

    void refreshTheme();
    const interval = window.setInterval(refreshTheme, 60_000);
    window.addEventListener('focus', refreshTheme);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshTheme);
    };
  }, []);

  return null;
}
