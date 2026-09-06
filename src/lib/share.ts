export interface BirthInput {
  date: string // YYYY-MM-DD, local
  time: string // HH:MM, local, 24h
  lat: number
  lon: number
  tz: string
  place?: string
}

/**
 * Birth data lives in the URL fragment, never a query string — fragments never
 * reach a server log, query strings do (see SPEC.md).
 */
export function encodeBirthToFragment(input: BirthInput): string {
  const params = new URLSearchParams({
    date: input.date,
    time: input.time,
    lat: String(input.lat),
    lon: String(input.lon),
    tz: input.tz,
  })
  if (input.place) params.set('place', input.place)
  return `#${params.toString()}`
}

export function decodeBirthFromFragment(hash: string): BirthInput | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) return null

  const params = new URLSearchParams(raw)
  const date = params.get('date')
  const time = params.get('time')
  const lat = params.get('lat')
  const lon = params.get('lon')
  const tz = params.get('tz')
  if (!date || !time || !lat || !lon || !tz) return null

  return { date, time, lat: Number(lat), lon: Number(lon), tz, place: params.get('place') ?? undefined }
}
