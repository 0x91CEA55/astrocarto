import { haversineKm, lineLongitude, wrap180 } from '../astro/lines'
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

export interface RowScore {
  total: number
  /** The single line whose contribution had the largest magnitude — "why" this point scored. */
  bestKey: LineKey | null
  bestMagnitude: number
  /** The runner-up contributor — lets a caller tell a paran (two comparable lines) from one dominant line. */
  secondKey: LineKey | null
  secondMagnitude: number
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
  let secondKey: LineKey | null = null
  let secondMagnitude = 0
  for (const entry of row) {
    if (entry.lon === null) continue
    const w = weights[entry.key]
    if (!w) continue
    const km = Math.abs(wrap180(entry.lon - lon)) * 111.32 * cosLat
    const fall = Math.exp(-((km / sigmaKm) ** 2))
    const contribution = w * fall * dignityMultiplier[positions[entry.body].dignity]
    total += contribution
    const magnitude = Math.abs(contribution)
    if (magnitude > bestMagnitude) {
      secondKey = bestKey
      secondMagnitude = bestMagnitude
      bestMagnitude = magnitude
      bestKey = entry.key
    } else if (magnitude > secondMagnitude) {
      secondMagnitude = magnitude
      secondKey = entry.key
    }
  }
  return { total, bestKey, bestMagnitude, secondKey, secondMagnitude }
}

export function scorePoint(lat: number, lon: number, theme: Theme, positions: Positions, gstDeg: number, config: WeightsConfig): number {
  return scorePointAttributed(lat, lon, theme, positions, gstDeg, config).total
}

/**
 * Same computation as `scorePoint`, but with the full attribution (best and
 * second-best contributor) instead of just the total — the input a caller
 * needs to tell a paran (two comparable lines) from one dominant line.
 */
export function scorePointAttributed(lat: number, lon: number, theme: Theme, positions: Positions, gstDeg: number, config: WeightsConfig): RowScore {
  const row = precomputeRow(positions, gstDeg, lat)
  return scoreRow(row, lat, lon, positions, config.themes[theme], config.dignityMultiplier, config.sigmaKm)
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
  bestMagnitude: number
  /** The runner-up contributor — a paran (UX-SPEC §8's "two lines crossing") shows up as secondMagnitude close to bestMagnitude. */
  secondKey: LineKey | null
  secondMagnitude: number
  /**
   * Other candidates within DEDUP_RADIUS_KM that were suppressed in favor of
   * this one (poc/NEW-FEATURE.md §3b) — kept instead of discarded, so a
   * caller can disclose what a single pin/label is actually standing in for.
   * Always `[]` on a cluster member itself; population only happens on the
   * city that survives de-dup.
   */
  clusterMembers: CityScore[]
}

/**
 * Minimum separation between two accepted top-N cities. Without this, a
 * ranked list is dominated by whichever single region happens to sit closest
 * to a strong paran — five towns in one Siberian oblast, say — rather than
 * showing the world. Tune here; it's the whole knob.
 */
export const DEDUP_RADIUS_KM = 300

/**
 * Two scores within this fraction of each other are a near-tie, broken by
 * population rather than treated as a real ranking (a 0.1% raw-score gap
 * between two towns is noise, not a signal that one is meaningfully better).
 */
export const NEAR_TIE_RATIO = 0.01

/**
 * Descending by score, except within NEAR_TIE_RATIO of each other, where the
 * larger population wins — Reedley (~25k) beating Ventura (~110k) by 0.001
 * is exactly the noise this exists to not repeat.
 */
function compareCityScores(a: CityScore, b: CityScore): number {
  const scale = Math.max(Math.abs(a.score), Math.abs(b.score), 1e-9)
  if (Math.abs(a.score - b.score) / scale < NEAR_TIE_RATIO) {
    return b.city.population - a.city.population
  }
  return b.score - a.score
}

/** How far down the sorted-by-score list to look for cluster members at all.
 * Bounds the O(topN x N) haversine scan and keeps a cluster's disclosed
 * members meaningful (candidates that were genuinely still in contention),
 * not literally every small town in the gazetteer within DEDUP_RADIUS_KM. */
const CANDIDATE_SCAN_LIMIT = 200

/** Cap on how many suppressed candidates one accepted city discloses. */
const MAX_CLUSTER_MEMBERS = 8

/**
 * Sorts already-scored cities (score, with a population tiebreak on near-ties
 * — see NEAR_TIE_RATIO), then greedily takes the top N subject to spatial
 * de-duplication: a candidate within DEDUP_RADIUS_KM of an already-accepted
 * city is folded into that city's `clusterMembers` instead of shown on its
 * own. Without this, the list is one region repeated — five towns near the
 * same strong paran — not a tour of the globe.
 *
 * Separated from `rankCities` so this list-shaping logic is testable against
 * hand-built scores, without needing real astronomy to land on exact numbers.
 */
export function applyRankingRules(scored: CityScore[], topN: number): CityScore[] {
  const sorted = [...scored].sort(compareCityScores).slice(0, CANDIDATE_SCAN_LIMIT)

  const accepted: CityScore[] = []
  for (const candidate of sorted) {
    const nearby = accepted.find((a) => haversineKm(a.city.lat, a.city.lon, candidate.city.lat, candidate.city.lon) < DEDUP_RADIUS_KM)
    if (nearby) {
      if (nearby.clusterMembers.length < MAX_CLUSTER_MEMBERS) nearby.clusterMembers.push(candidate)
      continue
    }
    if (accepted.length < topN) accepted.push(candidate)
  }
  return accepted
}

/**
 * Every gazetteer city within `radiusKm` of a point, scored and sorted —
 * not limited to a cluster's capped `clusterMembers` (poc/NEW-FEATURE.md
 * §3c "conditionally capture nearby cities based on zoom state", and §2's
 * finding that a capped list can hide a real contender). Scoring a few dozen
 * candidates on demand is cheap — ENGINE-SPEC §11's "line recomputation is
 * free" applies here just as it does to the raster and the time scrubber.
 */
export function nearbyScored(
  cities: City[],
  centerLat: number,
  centerLon: number,
  radiusKm: number,
  theme: Theme,
  positions: Positions,
  gstDeg: number,
  config: WeightsConfig,
  limit = 20,
): CityScore[] {
  const weights = config.themes[theme]
  const rowCache = new Map<number, RowEntry[]>()

  const scored: CityScore[] = cities
    .filter((city) => haversineKm(centerLat, centerLon, city.lat, city.lon) <= radiusKm)
    .map((city) => {
      const latBucket = Math.round(city.lat * 10) / 10
      let row = rowCache.get(latBucket)
      if (!row) {
        row = precomputeRow(positions, gstDeg, latBucket)
        rowCache.set(latBucket, row)
      }
      const { total, bestKey, bestMagnitude, secondKey, secondMagnitude } = scoreRow(row, latBucket, city.lon, positions, weights, config.dignityMultiplier, config.sigmaKm)
      return { city, score: total, bestKey, bestMagnitude, secondKey, secondMagnitude, clusterMembers: [] }
    })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

/** Ranks the gazetteer by theme score. Cities are bucketed to 0.1° latitude so
 * nearby cities share one precomputed row instead of each paying full trig cost.
 * The raster heat map (buildRaster) is untouched by ranking rules: the
 * continuous score field is supposed to show real clusters; it's specifically
 * the discrete top-N *list* that needs geographic spread to be useful.
 */
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
    const { total, bestKey, bestMagnitude, secondKey, secondMagnitude } = scoreRow(row, latBucket, city.lon, positions, weights, config.dignityMultiplier, config.sigmaKm)
    return { city, score: total, bestKey, bestMagnitude, secondKey, secondMagnitude, clusterMembers: [] }
  })

  return applyRankingRules(scored, topN)
}
