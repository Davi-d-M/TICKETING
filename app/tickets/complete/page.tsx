import CompletePayment from './CompletePayment';

export const dynamic = 'force-dynamic';

export default async function TicketCheckoutCompletePage({
  searchParams
}: {
  searchParams: Promise<{ reference?: string }>;
}) {
  const { reference = '' } = await searchParams;
  return <CompletePayment reference={reference} />;
}
