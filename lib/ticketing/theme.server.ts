import 'server-only';

import { createServerSupabaseClient } from '@/lib/serverSupabase';
import { defaultTicketTheme, isTicketTheme, type TicketTheme } from '@/lib/ticketing/theme';

export async function getPublishedTicketTheme(): Promise<TicketTheme> {
  const database = createServerSupabaseClient();
  if (!database) throw new Error('Ticket theme storage is not configured.');

  const { data, error } = await database
    .from('settings')
    .select('value')
    .eq('key', 'ticketing_theme')
    .eq('is_published', true)
    .maybeSingle();

  if (error) {
    console.error('[TicketingTheme] Could not load the published theme:', error);
    throw new Error('The published ticket theme could not be loaded.');
  }

  const configuredTheme = data?.value && typeof data.value === 'object' && 'theme' in data.value
    ? data.value.theme
    : null;
  return isTicketTheme(configuredTheme) ? configuredTheme : defaultTicketTheme;
}
