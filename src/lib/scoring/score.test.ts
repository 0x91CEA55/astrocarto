import { describe, expect, it } from 'vitest'
import { applyRankingRules, DEDUP_RADIUS_KM, NEAR_TIE_RATIO, scorePointAttributed, type CityScore, type Theme, type WeightsConfig } from './score'
import { BODY_NAMES, type Positions } from '../astro/types'
import type { City } from '../gazetteer/cities'

/** Every body at dec=0 means every AC/DC line is a fixed-longitude vertical
 * (H=90° regardless of latitude — see lines.ts) rather than a curve, which
 * makes the math trivial to reason about by hand for a synthetic test. */
function flatPositions(overrides: Partial<Positions>): Positions {
  const base = { ra: 0, dec: 0, eclLon: 0, retrograde: false, dignity: 'peregrine' as const }
  const out = {} as Positions
  for (const name of BODY_NAMES) out[name] = { ...base }
  return { ...out, ...overrides }
}

function weightsWith(theme: Theme, weights: WeightsConfig['themes'][Theme]): WeightsConfig {
  return {
    sigmaKm: 200,
    dignityMultiplier: { exalted: 1.3, domicile: 1.15, peregrine: 1.0, detriment: 0.85, fall: 0.7 },
    themes: { love: {}, career: {}, harmony: {}, [theme]: weights },
  }
}

let nextGeonameId = 1
function city(name: string, lat: number, lon: number, population: number): City {
  return { name, ascii: null, lat, lon, countryCode: 'XX', population, tz: 'UTC', geonameId: nextGeonameId++, wikiTitle: null }
}

function scored(name: string, lat: number, lon: number, population: number, score: number): CityScore {
  return { city: city(name, lat, lon, population), score, bestKey: null, bestMagnitude: 0, secondKey: null, secondMagnitude: 0 }
}

describe('applyRankingRules', () => {
  it('is a plain descending sort when scores are well separated and cities are far apart', () => {
    const input = [scored('Low', 0, 0, 1000, 1), scored('High', 40, 40, 1000, 3), scored('Mid', -40, -40, 1000, 2)]
    const out = applyRankingRules(input, 10)
    expect(out.map((c) => c.city.name)).toEqual(['High', 'Mid', 'Low'])
  })

  it('skips a candidate within DEDUP_RADIUS_KM of an already-accepted city, even if it scores higher than something farther away', () => {
    // Two Siberian towns ~60km apart (both within the radius of each other), one clear winner elsewhere.
    const input = [
      scored('Tyumen', 57.1522, 65.5272, 400_000, 3.9),
      scored('Tavda', 58.0455, 65.2712, 33_000, 3.7), // ~100km from Tyumen — inside DEDUP_RADIUS_KM
      scored('Ventura', 34.2746, -119.229, 110_000, 3.4), // a world away
    ]
    const out = applyRankingRules(input, 10)
    expect(out.map((c) => c.city.name)).toEqual(['Tyumen', 'Ventura'])
  })

  it('accepts two high scorers from the same cluster only if they are farther apart than DEDUP_RADIUS_KM', () => {
    const input = [scored('A', 0, 0, 1000, 5), scored('B', 0, 3, 1000, 4.9)] // ~333km apart at the equator — just outside 300km
    const out = applyRankingRules(input, 10)
    expect(out.map((c) => c.city.name)).toEqual(['A', 'B'])
  })

  it('prefers the larger population when two far-apart cities are within NEAR_TIE_RATIO of each other', () => {
    const input = [
      scored('Reedley', 36.5961, -119.4499, 25_000, 3.7793), // Ottawa case: Reedley area
      scored('Ventura', 34.2746, -119.229, 110_000, 3.775), // ~0.1% lower raw score, ~40km short of 300km from Reedley in this synthetic case but let's keep them far
    ]
    // Force them geographically distinct so this test isolates the tiebreak from de-dup.
    input[1].city.lat = -34.2746
    input[1].city.lon = 119.229
    const diffRatio = Math.abs(input[0].score - input[1].score) / Math.max(input[0].score, input[1].score)
    expect(diffRatio).toBeLessThan(NEAR_TIE_RATIO)

    const out = applyRankingRules(input, 10)
    expect(out.map((c) => c.city.name)).toEqual(['Ventura', 'Reedley']) // larger population wins the near-tie
  })

  it('does not apply the population tiebreak when scores differ by more than NEAR_TIE_RATIO', () => {
    const input = [scored('SmallButClearlyBetter', 10, 10, 1000, 5), scored('HugeButClearlyWorse', -10, -10, 10_000_000, 4)]
    const out = applyRankingRules(input, 10)
    expect(out.map((c) => c.city.name)).toEqual(['SmallButClearlyBetter', 'HugeButClearlyWorse'])
  })

  it('stops at topN even when more candidates would otherwise qualify', () => {
    const input = Array.from({ length: 20 }, (_, i) => scored(`C${i}`, i * 4 - 40, i * 9 - 90, 1000, 20 - i))
    expect(applyRankingRules(input, 5)).toHaveLength(5)
  })

  it('DEDUP_RADIUS_KM and NEAR_TIE_RATIO are the documented tunable values', () => {
    expect(DEDUP_RADIUS_KM).toBe(300)
    expect(NEAR_TIE_RATIO).toBe(0.01)
  })
})

describe('scorePointAttributed (paran attribution)', () => {
  // ra=90, dec=0 -> AC line longitude = wrap180(90 - 90 - gst) = wrap180(-gst).
  // With gst=0, both Venus's and Moon's AC line sit at longitude 0 for every
  // latitude, so a city at (lat, 0) sits on both at once — a stand-in for a
  // paran (two lines, comparable strength, same place) without needing real
  // ephemeris data to land two curves at the same point by coincidence.
  const positions = flatPositions({
    Venus: { ra: 90, dec: 0, eclLon: 0, retrograde: false, dignity: 'peregrine' },
    Moon: { ra: 90, dec: 0, eclLon: 0, retrograde: false, dignity: 'peregrine' },
  })

  it('reports a comparable second contributor when two lines coincide (paran-like)', () => {
    const config = weightsWith('love', { 'Venus-AC': 1.5, 'Moon-AC': 1.0 })
    const result = scorePointAttributed(0, 0, 'love', positions, 0, config)
    expect(result.bestKey).toBe('Venus-AC')
    expect(result.bestMagnitude).toBeCloseTo(1.5, 6)
    expect(result.secondKey).toBe('Moon-AC')
    expect(result.secondMagnitude).toBeCloseTo(1.0, 6)
    // The signal a caller uses to decide "paran, mention both": second is a
    // large fraction of best, not a footnote.
    expect(result.secondMagnitude / result.bestMagnitude).toBeGreaterThan(0.6)
  })

  it('reports a negligible second contributor when one line clearly dominates', () => {
    const config = weightsWith('love', { 'Venus-AC': 3.0, 'Moon-AC': 0.05 })
    const result = scorePointAttributed(0, 0, 'love', positions, 0, config)
    expect(result.bestKey).toBe('Venus-AC')
    expect(result.secondKey).toBe('Moon-AC')
    expect(result.secondMagnitude / result.bestMagnitude).toBeLessThan(0.1)
  })

  it('reports no second contributor at all when only one line has weight', () => {
    const config = weightsWith('love', { 'Venus-AC': 1.5 })
    const result = scorePointAttributed(0, 0, 'love', positions, 0, config)
    expect(result.bestKey).toBe('Venus-AC')
    expect(result.secondKey).toBeNull()
    expect(result.secondMagnitude).toBe(0)
  })
})
