import VerifyTicket from './VerifyTicket';

export const dynamic = 'force-dynamic';

export default async function TicketVerificationPage({
  searchParams
}: {
  searchParams: Promise<{ reference?: string }>;
}) {
  const { reference = '' } = await searchParams;
  return <VerifyTicket initialReference={reference} />;
}
