import { NextResponse } from 'next/server';
import { getAdminSession, isSameOriginRequest } from '@/lib/adminAccess.server';
import { createServerSupabaseClient } from '@/lib/serverSupabase';
import { encryptTicketCredential, hashTicketCredential, sendTransferredTicketAccess } from '@/lib/ticketing/commerce.server';
import { randomBytes } from 'node:crypto';

export const dynamic = 'force-dynamic';

type TransferRow = {
  id: string;
  ticket_id: string;
  replacement_ticket_id: string | null;
  order_id: string;
  event_id: string;
  from_email: string;
  to_email: string;
  to_name: string;
  status: 'pending' | 'approved' | 'rejected';
  reason: string | null;
  requested_at: string;
  reviewed_by_email: string | null;
  reviewed_at: string | null;
};
type TicketContext = { id: string; ticket_reference: string; order_item_id: string };

async function owner() {
  const session = await getAdminSession();
  if (!session) return { session: null, status: 401 };
  if (session.role.toLowerCase() !== 'owner') return { session: null, status: 403 };
  return { session, status: 200 };
}

export async function GET() {
  const { session, status } = await owner();
  if (!session) return NextResponse.json({ error: 'Only the platform owner can review ticket transfers.' }, { status });
  const database = createServerSupabaseClient();
  if (!database) return NextResponse.json({ error: 'Ticketing storage is not configured.' }, { status: 503 });
  const { data, error } = await database.from('ticketing_transfers')
    .select('id,ticket_id,replacement_ticket_id,order_id,event_id,from_email,to_email,to_name,status,reason,requested_at,reviewed_by_email,reviewed_at')
    .order('requested_at', { ascending: false })
    .limit(100);
  if (error) {
    console.error('[TicketingTransfers] Could not load transfer reviews:', error);
    return NextResponse.json({ error: 'Ticket transfer requests could not be loaded.' }, { status: 503 });
  }
  const transfers = (data || []) as unknown as TransferRow[];
  const ticketIds = [...new Set(transfers.flatMap(item => [item.ticket_id, item.replacement_ticket_id].filter((id): id is string => Boolean(id))))];
  const eventIds = [...new Set(transfers.map(item => item.event_id))];
  const [tickets, events] = await Promise.all([
    ticketIds.length ? database.from('ticketing_tickets').select('id,ticket_reference,order_item_id').in('id', ticketIds) : { data: [], error: null },
    eventIds.length ? database.from('ticketing_events').select('id,title').in('id', eventIds) : { data: [], error: null }
  ]);
  const error2 = tickets.error || events.error;
  if (error2) {
    console.error('[TicketingTransfers] Could not load transfer context:', error2);
    return NextResponse.json({ error: 'Ticket transfer details could not be loaded.' }, { status: 503 });
  }
  const ticketRows = (tickets.data || []) as unknown as TicketContext[];
  const eventRows = (events.data || []) as unknown as Array<{ id: string; title: string }>;
  const itemIds = [...new Set(ticketRows.map(ticket => ticket.order_item_id))];
  const items = itemIds.length
    ? await database.from('ticketing_order_items').select('id,ticket_name_snapshot').in('id', itemIds)
    : { data: [], error: null };
  if (items.error) {
    console.error('[TicketingTransfers] Could not load ticket categories:', items.error);
    return NextResponse.json({ error: 'Ticket transfer details could not be loaded.' }, { status: 503 });
  }
  const itemRows = (items.data || []) as unknown as Array<{ id: string; ticket_name_snapshot: string }>;
  const ticketById = new Map(ticketRows.map(ticket => [ticket.id, ticket]));
  const eventById = new Map(eventRows.map(event => [event.id, event.title]));
  const itemById = new Map(itemRows.map(item => [item.id, item.ticket_name_snapshot]));
  return NextResponse.json({
    transfers: transfers.map(transfer => ({
      ...transfer,
      ticketReference: ticketById.get(transfer.ticket_id)?.ticket_reference || '',
      replacementReference: transfer.replacement_ticket_id ? ticketById.get(transfer.replacement_ticket_id)?.ticket_reference || '' : '',
      eventTitle: eventById.get(transfer.event_id) || 'Ticket event',
      ticketType: itemById.get(ticketById.get(transfer.ticket_id)?.order_item_id || '') || 'Admission'
    }))
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Same-origin transfer review is required.' }, { status: 403 });
  const { session, status } = await owner();
  if (!session) return NextResponse.json({ error: 'Only the platform owner can review ticket transfers.' }, { status });
  let body: { transferId?: unknown; decision?: unknown; reason?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: 'A valid transfer review is required.' }, { status: 400 });
  }
  const transferId = typeof body.transferId === 'string' ? body.transferId : '';
  const decision = typeof body.decision === 'string' ? body.decision : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(transferId)
    || !['approve', 'reject', 'resend'].includes(decision)) {
    return NextResponse.json({ error: 'Choose a valid transfer request and action.' }, { status: 400 });
  }
  const database = createServerSupabaseClient();
  if (!database) return NextResponse.json({ error: 'Ticketing storage is not configured.' }, { status: 503 });

  if (decision === 'resend') {
    const { data: transfer, error } = await database.from('ticketing_transfers')
      .select('replacement_ticket_id,to_email')
      .eq('id', transferId)
      .eq('status', 'approved')
      .maybeSingle();
    if (error) {
      console.error('[TicketingTransfers] Could not load approved transfer for email retry:', error);
      return NextResponse.json({ error: 'Transfer email could not be retried.' }, { status: 503 });
    }
    const approvedTransfer = transfer as unknown as { replacement_ticket_id: string | null; to_email: string } | null;
    if (!approvedTransfer?.replacement_ticket_id) return NextResponse.json({ error: 'An approved transfer was not found.' }, { status: 404 });
    const { data: ticket, error: ticketError } = await database.from('ticketing_tickets')
      .select('ticket_reference')
      .eq('id', approvedTransfer.replacement_ticket_id)
      .maybeSingle();
    const approvedTicket = ticket as unknown as { ticket_reference: string } | null;
    if (ticketError || !approvedTicket?.ticket_reference) {
      console.error('[TicketingTransfers] Could not load approved ticket for email retry:', ticketError);
      return NextResponse.json({ error: 'Approved ticket details could not be loaded.' }, { status: 503 });
    }
    try {
      await sendTransferredTicketAccess(approvedTicket.ticket_reference, approvedTransfer.to_email);
      return NextResponse.json({ reviewed: true, emailSent: true });
    } catch (cause) {
      console.error('[TicketingTransfers] Could not resend approved ticket access:', cause);
      return NextResponse.json({ error: 'Transfer is approved, but access email could not be delivered. The recipient can request a fresh link from the ticket access page.' }, { status: 503 });
    }
  }
  if (reason.length < 5 || reason.length > 500) {
    return NextResponse.json({ error: 'Choose a decision and provide a review reason.' }, { status: 400 });
  }

  const credential = decision === 'approve' ? randomBytes(32).toString('base64url') : '';
  let credentials = { hash: '', ciphertext: '' };
  try {
    if (credential) {
      credentials = {
        hash: hashTicketCredential(credential),
        ciphertext: encryptTicketCredential(credential)
      };
    }
  } catch (cause) {
    console.error('[TicketingTransfers] Ticket encryption is not configured:', cause);
    return NextResponse.json({ error: 'Ticket encryption must be configured before a transfer can be approved.' }, { status: 503 });
  }
  const { data, error } = await database.rpc('ticketing_review_ticket_transfer', {
    p_transfer_id: transferId,
    p_decision: decision,
    p_actor_email: session.email,
    p_reason: reason,
    p_credential_hash: credentials.hash,
    p_credential_ciphertext: credentials.ciphertext
  });
  if (error) {
    if (error.code === 'P0001') return NextResponse.json({ error: error.message }, { status: 409 });
    if (error.code === 'P0002') return NextResponse.json({ error: 'Transfer request was not found.' }, { status: 404 });
    console.error('[TicketingTransfers] Could not review transfer request:', error);
    return NextResponse.json({ error: 'Ticket transfer could not be reviewed.' }, { status: 503 });
  }

  const reviewed = data as unknown as { status?: string; ticket_id?: string; recipient_email?: string } | null;
  let emailSent: boolean | null = null;
  let replacementReference: string | null = null;
  if (decision === 'approve' && reviewed?.ticket_id && reviewed.recipient_email) {
    const { data: ticket, error: ticketError } = await database.from('ticketing_tickets')
      .select('ticket_reference')
      .eq('id', reviewed.ticket_id)
      .maybeSingle();
    const approvedTicket = ticket as unknown as { ticket_reference: string } | null;
    if (ticketError || !approvedTicket?.ticket_reference) {
      console.error('[TicketingTransfers] Approved ticket reference could not be loaded:', ticketError);
      return NextResponse.json({ reviewed: true, emailSent: false, error: 'Transfer approved, but ticket details could not be loaded. Use the transfer queue to retry email delivery.' });
    }
    replacementReference = approvedTicket.ticket_reference;
    try {
      await sendTransferredTicketAccess(replacementReference, reviewed.recipient_email);
      emailSent = true;
    } catch (cause) {
      emailSent = false;
      console.error('[TicketingTransfers] Approved ticket access email failed:', cause);
    }
  }
  return NextResponse.json({ reviewed: true, status: reviewed?.status, emailSent, replacementReference });
}
