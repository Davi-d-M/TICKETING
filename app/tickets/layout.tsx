import type { ReactNode } from 'react';
import { getPublishedTicketTheme } from '@/lib/ticketing/theme.server';
import TicketThemeSync from './TicketThemeSync';

export const dynamic = 'force-dynamic';

export default async function TicketingLayout({ children }: { children: ReactNode }) {
  let theme = 'midnight';
  try {
    theme = await getPublishedTicketTheme();
  } catch (cause) {
    console.error('[TicketingTheme] Could not render the last published theme; using the default ticket palette.', cause);
  }

  return (
    <div className="ticket-theme-scope" data-ticket-theme={theme}>
      <TicketThemeSync />
      {children}
    </div>
  );
}
