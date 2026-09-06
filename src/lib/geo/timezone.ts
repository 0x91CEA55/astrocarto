import tzLookup from 'tz-lookup'

/** IANA zone for arbitrary coordinates — used for the manual lat/lon override. */
export function timezoneForCoords(lat: number, lon: number): string {
  return tzLookup(lat, lon)
}
