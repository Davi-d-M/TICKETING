import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/adminAccess.server';

export const dynamic = 'force-dynamic';

export default async function TicketingAdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');
  return children;
}
