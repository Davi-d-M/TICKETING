const defaultOnlineBarOrigin = 'https://onlinebar.vercel.app';

export function getOnlineBarTicketingAdminUrl() {
  const origin = process.env.ONLINE_BAR_ADMIN_ORIGIN?.trim() || defaultOnlineBarOrigin;
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('ONLINE_BAR_ADMIN_ORIGIN must be an HTTPS origin without credentials.');
  }
  return new URL('/lord/ticketing', url.origin).toString();
}
