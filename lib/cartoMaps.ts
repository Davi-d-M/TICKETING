const CARTO_VOYAGER_RASTER_URL = 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';

export function getCartoVoyagerTileUrl() {
  const apiKey = process.env.NEXT_PUBLIC_CARTO_API_KEY?.trim();
  return apiKey
    ? `${CARTO_VOYAGER_RASTER_URL}?key=${encodeURIComponent(apiKey)}`
    : CARTO_VOYAGER_RASTER_URL;
}
