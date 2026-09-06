import { lineLongitude, wrap180 } from '../astro/lines'
import { ANGLES, type BodyName, type BodyPosition, type Dignity, type LineKey, type Positions } from '../astro/types'
import type { City } from '../gazetteer/cities'

export type Theme = 'love' | 'career' | 'harmony'

export interface WeightsConfig {
  sigmaKm: number
  dignityMultiplier: Record<Dignity, number>
  themes: Record<Theme, Partial<Record<LineKey, number>>>
}

let configPromise: Promise<WeightsConfig> | null = null

export function loadWeights(): Promise<WeightsConfig> {
  configPromise ??= fetch(`${import.meta.env.BASE_URL}data/weights.json`).then((res) => res.json())
  return configPromise
}

interface RowEntry {
  key: LineKey
  body: BodyName
  lon: number | null
}

/** The expensive part (tan/acos in lineLongitude) computed once per latitude row. */
function precomputeRow(positions: Positions, gstDeg: number, lat: number): RowEntry[] {
  const row: RowEntry[] = []
  for (const [body, p] of Object.entries(positions) as Array<[BodyName, BodyPosition]>) {
    for (const angle of ANGLES) {
      row.push({ key: `${body}-${angle}`, body, lon: lineLongitude(p, angle, lat, gstDeg) })
    }
  }
  return row
}

interface RowScore {
  total: number
  /** The single line whose contribution had the largest magnitude — "why" this point scored. */
  bestKey: LineKey | null
}

function scoreRow(
  row: RowEntry[],
  lat: number,
  lon: number,
  positions: Positions,
  weights: Partial<Record<LineKey, number>>,
  dignityMultiplier: Record<Dignity, number>,
  sigmaKm: number,
): RowScore {
  const cosLat = Math.cos((lat * Math.PI) / 180)
  let total = 0
  let bestKey: LineKey | null = null
  let bestMagnitude = 0
  for (const entry of row) {
    if (entry.lon === null) continue
    const w = weights[entry.key]
    if (!w) continue
    const km = Math.abs(wrap180(entry.lon - lon)) * 111.32 * cosLat
    const fall = Math.exp(-((km / sigmaKm) ** 2))
    const contribution = w * fall * dignityMultiplier[positions[entry.body].dignity]
    total += contribution
    if (Math.abs(contribution) > bestMagnitude) {
      bestMagnitude = Math.abs(contribution)
      bestKey = entry.key
    }
  }
  return { total, bestKey }
}

export function scorePoint(lat: number, lon: number, theme: Theme, positions: Positions, gstDeg: number, config: WeightsConfig): number {
  const row = precomputeRow(positions, gstDeg, lat)
  return scoreRow(row, lat, lon, positions, config.themes[theme], config.dignityMultiplier, config.sigmaKm).total
}

export interface RasterCell {
  lat: number
  lon: number
  score: number
}

/** Coarse lat/lon score grid for the heat overlay: rows × lines, not cells × lines. */
export function buildRaster(theme: Theme, positions: Positions, gstDeg: number, config: WeightsConfig, stepDeg = 2): RasterCell[] {
  const weights = config.themes[theme]
  const cells: RasterCell[] = []
  for (let lat = -85; lat <= 85; lat += stepDeg) {
    const row = precomputeRow(positions, gstDeg, lat)
    for (let lon = -180; lon < 180; lon += stepDeg) {
      cells.push({ lat, lon, score: scoreRow(row, lat, lon, positions, weights, config.dignityMultiplier, config.sigmaKm).total })
    }
  }
  return cells
}

export interface CityScore {
  city: City
  score: number
  bestKey: LineKey | null
}

/** Ranks the gazetteer by theme score. Cities are bucketed to 0.1° latitude so
 * nearby cities share one precomputed row instead of each paying full trig cost. */
export function rankCities(cities: City[], theme: Theme, positions: Positions, gstDeg: number, config: WeightsConfig, topN = 10): CityScore[] {
  const weights = config.themes[theme]
  const rowCache = new Map<number, RowEntry[]>()

  const scored: CityScore[] = cities.map((city) => {
    const latBucket = Math.round(city.lat * 10) / 10
    let row = rowCache.get(latBucket)
    if (!row) {
      row = precomputeRow(positions, gstDeg, latBucket)
      rowCache.set(latBucket, row)
    }
    const { total, bestKey } = scoreRow(row, latBucket, city.lon, positions, weights, config.dignityMultiplier, config.sigmaKm)
    return { city, score: total, bestKey }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topN)
}
