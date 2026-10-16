type VenueLocation = {
  venue_maps_url?: string | null;
  venue_latitude?: number | string | null;
  venue_longitude?: number | string | null;
  venue_address?: string | null;
  venue_name?: string | null;
  city?: string | null;
};

export function isTrustedVenueMapUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (url.hostname === 'maps.app.goo.gl') return url.pathname.length > 1;
    if (url.hostname === 'goo.gl') return /^\/maps\/.+/.test(url.pathname);
    return ['google.com', 'www.google.com', 'maps.google.com'].includes(url.hostname)
      && (url.pathname.startsWith('/maps') || url.searchParams.has('q') || url.searchParams.has('query'));
  } catch {
    return false;
  }
}

export function getVenueMapLinks(venue: VenueLocation) {
  const latitude = venue.venue_latitude == null ? null : Number(venue.venue_latitude);
  const longitude = venue.venue_longitude == null ? null : Number(venue.venue_longitude);
  let destination = '';

  if (latitude !== null && longitude !== null
    && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180) {
    destination = `${latitude},${longitude}`;
  } else if (venue.venue_maps_url) {
    try {
      const url = new URL(venue.venue_maps_url);
      if (isTrustedVenueMapUrl(venue.venue_maps_url)) {
        return {
          map: url.toString(),
          directions: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(url.toString())}`
        };
      }
    } catch {
      return null;
    }
  } else if (venue.venue_address?.trim() && venue.city?.trim()) {
    destination = [venue.venue_name?.trim(), venue.venue_address.trim(), venue.city.trim()]
      .filter(Boolean)
      .join(', ');
  } else {
    return null;
  }

  const query = encodeURIComponent(destination);
  return {
    map: `https://www.google.com/maps/search/?api=1&query=${query}`,
    directions: `https://www.google.com/maps/dir/?api=1&destination=${query}`
  };
}
