import { NextResponse } from 'next/server';
import { getPublishedTicketTheme } from '@/lib/ticketing/theme.server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const theme = await getPublishedTicketTheme();
    return NextResponse.json({ theme }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' }
    });
  } catch (cause) {
    console.error('[TicketingTheme] Could not serve the published theme:', cause);
    return NextResponse.json({ error: 'The published ticket theme is temporarily unavailable.' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store, max-age=0' }
    });
  }
}
