import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type TicketingTable = {
  Row: { id: string; event_id: string; [column: string]: unknown };
  Insert: { [column: string]: unknown };
  Update: { [column: string]: unknown };
  Relationships: [];
};

type TicketingDatabase = {
  __InternalSupabase: { PostgrestVersion: '12.2.3' };
  public: {
    Tables: Record<string, TicketingTable>;
    Views: Record<string, never>;
    Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

let cachedClient: SupabaseClient<TicketingDatabase> | null = null;
let cachedConfiguration = '';

export function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return null;

  const configuration = `${url}:${serviceKey}`;
  if (cachedClient && cachedConfiguration === configuration) return cachedClient;

  cachedClient = createClient<TicketingDatabase>(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    },
    global: {
      headers: { 'X-Client-Info': 'onlinebar-ticketing-server' }
    }
  });
  cachedConfiguration = configuration;
  return cachedClient;
}
