export interface City {
  name: string
  ascii: string | null
  lat: number
  lon: number
  countryCode: string
  population: number
  tz: string
}

type CityTuple = [string, string | null, number, number, string, number, string]

let citiesPromise: Promise<City[]> | null = null

/** Fetches the bundled GeoNames cities15000 gazetteer (loaded once, cached). */
export function loadCities(): Promise<City[]> {
  citiesPromise ??= fetch(`${import.meta.env.BASE_URL}data/cities.json`)
    .then((res) => res.json() as Promise<CityTuple[]>)
    .then((rows) =>
      rows.map(
        ([name, ascii, lat, lon, countryCode, population, tz]): City => ({
          name,
          ascii,
          lat,
          lon,
          countryCode,
          population,
          tz,
        }),
      ),
    )
  return citiesPromise
}

/**
 * Prefix matches first (cities are population-sorted, so results read as
 * "biggest city starting with what you typed"), then substring matches to
 * fill out the list.
 */
export function searchCities(cities: City[], query: string, limit = 8): City[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const starts: City[] = []
  const contains: City[] = []
  for (const c of cities) {
    if (starts.length >= limit && contains.length >= limit) break
    const key = (c.ascii ?? c.name).toLowerCase()
    if (key.startsWith(q)) {
      if (starts.length < limit) starts.push(c)
    } else if (contains.length < limit && key.includes(q)) {
      contains.push(c)
    }
  }
  return [...starts, ...contains].slice(0, limit)
}
