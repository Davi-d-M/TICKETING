import { redirect } from 'next/navigation';
import { getOnlineBarTicketingAdminUrl } from '@/lib/ticketing/adminDestination';

export default function TicketingLoginPage() {
  redirect(getOnlineBarTicketingAdminUrl());
}
