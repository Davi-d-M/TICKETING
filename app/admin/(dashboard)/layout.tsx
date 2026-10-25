import { redirect } from 'next/navigation';
import { getOnlineBarTicketingAdminUrl } from '@/lib/ticketing/adminDestination';

export const dynamic = 'force-dynamic';

export default function TicketingAdminLayout() {
  redirect(getOnlineBarTicketingAdminUrl());
}
