import 'server-only';

import { createHmac } from 'node:crypto';
import { createServerSupabaseClient } from '@/lib/serverSupabase';

export async function consumeTicketingRateLimit(request: Request, scope: string, limit: number, windowSeconds: number) {
  const secret = process.env.TICKETING_GUEST_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error('Ticketing rate-limit key is not configured.');
  const forwarded = request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
  const bucketHash = createHmac('sha256', secret).update(`${scope}:${forwarded}`).digest('hex');
  const database = createServerSupabaseClient();
  if (!database) throw new Error('Ticketing storage is not configured.');
  const { data, error } = await database.rpc('ticketing_consume_rate_limit', {
    p_bucket_hash: bucketHash,
    p_max_attempts: limit,
    p_window_seconds: windowSeconds
  });
  if (error) throw error;
  return data === true;
}
