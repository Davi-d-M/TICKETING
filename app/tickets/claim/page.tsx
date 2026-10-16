import ClaimTicketAccess from './ClaimTicketAccess';

export const dynamic = 'force-dynamic';

export default async function ClaimTicketPage({
  searchParams
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = '' } = await searchParams;
  return <ClaimTicketAccess token={token} />;
}
