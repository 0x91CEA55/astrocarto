import { haversineKm, lineLongitude, wrap180 } from '../astro/lines'
import { ANGLES, type BodyName, type BodyPosition, type Dignity, type LineKey, type Positions } from '../astro/types'
import type { City } from '../gazetteer/cities'
import { macroRegion } from './continents'

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

/** Cap on how many suppressed candidates one accepted city discloses. */
const MAX_CLUSTER_MEMBERS = 8

/**
 * At most this many results from one macro-region, when a genuinely
 * different region has any viable candidate at all. A fixed count, not a
 * fraction of topN — the globe only ever shows the first 4 as labels
 * (LABEL_MAX_COUNT), so a share-of-10 cap (e.g. 40% => 4) can satisfy itself
 * entirely within positions 1-4 and never change what's actually visible.
 * Verified live: exactly this happened before this was a fixed count —
 * positions 5-10 gained real diversity, the labels on the globe didn't
 * change at all. Tune here.
 */
export const MAX_PER_REGION = 3

/**
 * Sorts already-scored cities (score, with a population tiebreak on near-ties
 * — see NEAR_TIE_RATIO), de-duplicates spatially (DEDUP_RADIUS_KM — a
 * candidate near an already-accepted city is folded into its
 * `clusterMembers` instead of shown on its own), groups the survivors by
 * macro-region (continent, via `macroRegion` — see continents.ts), then
 * fills `topN` slots **round-robin across regions** rather than by raw
 * global score. Without de-dup, the list is five towns near the same strong
 * paran. Without region grouping at all, it can legitimately be ten
 * distinct, properly-spaced cities still all on one continent when the
 * line's geometry favors it — verified on a real chart (Love, Venus-DC): all
 * ten top results were China/Vietnam/Malaysia, nothing else on Earth scored
 * competitively, and every one was >300km from the others, so de-dup alone
 * had nothing to do.
 *
 * Region membership is a *static* classification by country code, not a
 * distance-based cluster. An earlier version grouped candidates
 * dynamically (transitive/single-linkage on great-circle distance, radius
 * ~5000km) specifically so one continent-spanning curve's extremes
 * (Kuantan-to-Baicheng, both East Asia, 5019km apart) wouldn't be miscounted
 * as separate regions. That radius, applied over a dense-enough candidate
 * set, has a fatal flaw: verified empirically on a real chart, all 1007
 * de-duped candidates spanning the *entire inhabited world* (China to
 * Argentina to Ghana to Canada) chained into ONE single-linkage group —
 * islands and coastlines bridge every landmass within a few-thousand-km hop.
 * That silently made the region cap a no-op (capping "the one region" is
 * just plain global score order again — precisely the bug this exists to
 * prevent). A static per-country classification can't chain, since a city's
 * region never depends on which other candidates happen to exist.
 *
 * Round-robin, not "cap the dominant region and fill the rest by score": an
 * earlier version did the latter (accept in score order, defer once a
 * region hit MAX_PER_REGION), which guarantees a *second* region gets in
 * but nothing stronger — the globally-best region still claims its entire
 * quota before any other region gets even one slot, so with several
 * comparably-scoring world regions (verified live: North America alone
 * splits into 8+ distinct >300km-separated swaths for one real chart), only
 * one of them shows up. Round-robin instead takes each region's best
 * remaining candidate in turn (regions visited best-score-first each round),
 * up to MAX_PER_REGION per region, so multiple regions share the list
 * instead of one hogging it — reported live: "I see Fort McMurray for that
 * example, but there are many options in NA that are just skipped."
 *
 * Candidates beyond a region's cap are deferred, not discarded, and
 * backfilled by score once every region has been exhausted or capped and
 * `topN` still isn't full — a genuinely single-region chart (or the water
 * case) still returns a full list rather than an artificially short one for
 * the sake of a diversity rule nothing else can satisfy.
 *
 * Scans the *entire* sorted list, not a truncated prefix. An earlier version
 * capped this scan at 200 candidates as a premature optimization (haversine
 * against up to `topN` accepted cities is cheap — tens of milliseconds for
 * the full ~34k-city gazetteer, verified live). That cap was a real
 * correctness bug, not just a performance one: when one region dominates
 * the raw scores, the next genuinely different region can rank well past
 * 200 — verified at rank 257 for one real chart — so the scan silently
 * never got there.
 *
 * Separated from `rankCities` so this list-shaping logic is testable against
 * hand-built scores, without needing real astronomy to land on exact numbers.
 */
export function applyRankingRules(scored: CityScore[], topN: number): CityScore[] {
  const sorted = [...scored].sort(compareCityScores)

  // Latitude-only distance is a cheap lower bound on the true great-circle
  // distance (adding a longitude difference can only lengthen it) — reject
  // obviously-too-far candidates with a subtraction before paying for a full
  // haversine call. Scanning the whole gazetteer (see above) makes this
  // pre-filter worth having: most candidates are nowhere near any accepted
  // city, and this turns that check from trig into arithmetic for them.
  const maxLatDiffDeg = DEDUP_RADIUS_KM / 111.32
  const maxPerRegion = Math.min(topN, MAX_PER_REGION)

  // Step 1: spatial de-dup into "bucket leaders", independent of any region
  // or topN accounting — a candidate within DEDUP_RADIUS_KM of an
  // already-seen leader is folded into that leader's clusterMembers, capped
  // at MAX_CLUSTER_MEMBERS, rather than becoming a leader itself.
  const leaders: CityScore[] = []
  for (const candidate of sorted) {
    const nearby = leaders.find(
      (a) => Math.abs(a.city.lat - candidate.city.lat) <= maxLatDiffDeg && haversineKm(a.city.lat, a.city.lon, candidate.city.lat, candidate.city.lon) < DEDUP_RADIUS_KM,
    )
    if (nearby) {
      if (nearby.clusterMembers.length < MAX_CLUSTER_MEMBERS) nearby.clusterMembers.push(candidate)
    } else {
      leaders.push(candidate)
    }
  }

  // Step 2: group leaders by macro-region (continent). Static classification
  // by country code — see the fatal single-linkage chaining flaw documented
  // above for why this replaced distance-based clustering.
  const groupByRegion = new Map<string, CityScore[]>()
  for (const leader of leaders) {
    const region = macroRegion(leader.city.countryCode, leader.city.lon)
    const group = groupByRegion.get(region)
    if (group) group.push(leader)
    else groupByRegion.set(region, [leader])
  }
  const regionGroups = [...groupByRegion.values()]
  for (const group of regionGroups) group.sort(compareCityScores)

  // Step 3: fill topN round-robin across regions, strongest region first
  // each round, instead of letting the single best-scoring region claim its
  // full MAX_PER_REGION quota before any other region gets a slot.
  const groupOrder = [...regionGroups].sort((a, b) => compareCityScores(a[0], b[0]))
  const accepted: CityScore[] = []
  for (let round = 0; round < maxPerRegion && accepted.length < topN; round++) {
    let addedThisRound = false
    for (const group of groupOrder) {
      if (accepted.length >= topN) break
      if (round < group.length) {
        accepted.push(group[round])
        addedThisRound = true
      }
    }
    if (!addedThisRound) break
  }

  // Backfill beyond each region's cap, in score order, ignoring the quota —
  // only reached when every region was exhausted or capped and topN still
  // isn't full (a genuinely single/few-region chart, or the water case).
  if (accepted.length < topN) {
    const deferred: CityScore[] = []
    for (const group of regionGroups) {
      for (let i = maxPerRegion; i < group.length; i++) deferred.push(group[i])
    }
    deferred.sort(compareCityScores)
    for (const candidate of deferred) {
      if (accepted.length >= topN) break
      accepted.push(candidate)
    }
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
