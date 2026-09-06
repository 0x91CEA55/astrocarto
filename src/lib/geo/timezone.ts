/**
 * IANA zone for arbitrary coordinates — used for the manual lat/lon override.
 * `tz-lookup`'s data is ~70KB and only ever needed once someone actually
 * opens the manual-coordinates path, so it's dynamically imported instead of
 * bundled into the initial chunk (UX-SPEC §11: "lazy-load tz-lookup ... behind the form").
 */
export async function timezoneForCoords(lat: number, lon: number): Promise<string> {
  const { default: tzLookup } = await import('tz-lookup')
  return tzLookup(lat, lon)
}
