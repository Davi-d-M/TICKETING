import TicketingScanner from '@/app/admin/(dashboard)/ticketing/scan/TicketingScanner';

export const dynamic = 'force-dynamic';

export default function AssignedGateScannerPage() {
  return <TicketingScanner staffMode />;
}
