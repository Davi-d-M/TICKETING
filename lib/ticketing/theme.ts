export const ticketThemes = ['midnight', 'official-white', 'royal-violet', 'emerald'] as const;

export type TicketTheme = typeof ticketThemes[number];

export const defaultTicketTheme: TicketTheme = 'midnight';

export function isTicketTheme(value: unknown): value is TicketTheme {
  return typeof value === 'string' && ticketThemes.some(theme => theme === value);
}
