import { describe, expect, it } from 'vitest'
import { applyRankingRules, DEDUP_RADIUS_KM, MAX_PER_REGION, NEAR_TIE_RATIO, nearbyScored, REGION_RADIUS_KM, scorePointAttributed, type CityScore, type Theme, type WeightsConfig } from './score'
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
  return { city: city(name, lat, lon, population), score, bestKey: null, bestMagnitude: 0, secondKey: null, secondMagnitude: 0, clusterMembers: [] }
}

describe('applyRankingRules', () => {
  it('is a plain descending sort when scores are well separated and cities are far apart', () => {
    const input = [scored('Low', 0, 0, 1000, 1), scored('High', 40, 40, 1000, 3), scored('Mid', -40, -40, 1000, 2)]
    const out = applyRankingRules(input, 10)
    expect(out.map((c) => c.city.name)).toEqual(['High', 'Mid', 'Low'])
  })

  it('discloses a suppressed candidate as a cluster member instead of just dropping it (poc/NEW-FEATURE.md §3b)', () => {
    const input = [
      scored('Tyumen', 57.1522, 65.5272, 400_000, 3.9),
      scored('Tavda', 58.0455, 65.2712, 33_000, 3.7), // ~100km from Tyumen
      scored('Ventura', 34.2746, -119.229, 110_000, 3.4),
    ]
    const out = applyRankingRules(input, 10)
    const tyumen = out.find((c) => c.city.name === 'Tyumen')!
    expect(tyumen.clusterMembers.map((c) => c.city.name)).toEqual(['Tavda'])
    expect(out.find((c) => c.city.name === 'Ventura')!.clusterMembers).toEqual([])
    // The suppressed member itself doesn't carry its own membership list.
    expect(tyumen.clusterMembers[0].clusterMembers).toEqual([])
  })

  it('caps disclosed cluster members at MAX_CLUSTER_MEMBERS rather than growing unbounded', () => {
    const winner = scored('Winner', 0, 0, 1_000_000, 10)
    const suppressed = Array.from({ length: 15 }, (_, i) => scored(`S${i}`, 0.01 * i, 0.01 * i, 1000, 9 - i * 0.01))
    const out = applyRankingRules([winner, ...suppressed], 10)
    expect(out).toHaveLength(1)
    expect(out[0].clusterMembers.length).toBeLessThanOrEqual(8)
  })

  it('reaches a genuinely different region far down the sorted list instead of under-filling topN', () => {
    // Regression: an earlier version capped the scan at the first 200
    // sorted-by-score candidates. When one region dominates raw scores (a
    // line crossing it much closer than anywhere else), the next distinct
    // region can rank arbitrarily far down -- verified at rank 257 for a
    // real chart. 300 near-duplicate candidates from one region, all
    // clustered together (so only one of them can ever be accepted),
    // plus one genuinely distant city ranked last: the distant city must
    // still be found and accepted as the 2nd result, not dropped.
    const dominant = Array.from({ length: 300 }, (_, i) => scored(`Dominant${i}`, 40 + i * 0.001, -100 + i * 0.001, 1000, 100 - i * 0.01))
    const distant = scored('FarAway', -30, 140, 1000, 1) // Australia-ish, ranks dead last
    const out = applyRankingRules([...dominant, distant], 2)
    expect(out).toHaveLength(2)
    expect(out.map((c) => c.city.name)).toContain('FarAway')
  })

  it('reserves list slots for a genuinely different region instead of letting one continent-scale swath fill every slot (reported live: an all-East-Asia Love result with zero North America)', () => {
    // 8 candidates ~334km apart (so none are DEDUP_RADIUS_KM near-duplicates
    // of each other) but all within ~2335km of each other (so all one
    // REGION_RADIUS_KM macro-region), scored strictly descending -- plus two
    // other single-candidate regions, each far from A and from each other,
    // scoring lower than every A. MAX_PER_REGION=3 caps region A at exactly
    // 3, and with topN=5 there are exactly enough real alternatives
    // (3 + 1 + 1 = 5) to fill the list without backfilling into region A
    // beyond its quota -- so unlike the backfill test below, the cap must
    // actually hold here, not just avoid under-filling.
    //
    // This also regression-tests the original live bug directly: the cap is
    // a *fixed count*, not a fraction of topN. A share-based cap (e.g. 40%
    // of 10 = 4) satisfies itself entirely within the globe's 4 visible
    // labels and never changes what's actually on screen -- verified live
    // before this was a fixed constant.
    const regionA = Array.from({ length: 8 }, (_, i) => scored(`A${i}`, i * 3, 0, 1000, 10 - i))
    const distant1 = scored('Distant1', 0, 180, 1000, 2)
    const distant2 = scored('Distant2', -60, -90, 1000, 1)
    const out = applyRankingRules([...regionA, distant1, distant2], 5)

    expect(out.map((c) => c.city.name)).toEqual(expect.arrayContaining(['Distant1', 'Distant2']))
    const fromRegionA = out.filter((c) => c.city.name.startsWith('A'))
    expect(fromRegionA.length).toBeLessThanOrEqual(MAX_PER_REGION)
  })

  it('groups a region transitively across a bridging member, instead of undercounting a candidate that only touches part of the group directly (the real Jinan/Changsha/Kuantan-via-bridge bug)', () => {
    // Chain of 3, each ~3336km / ~6672km from the next, along one meridian:
    // ChainA(lat 0) -- 3336km -- ChainB(lat 30) -- 3336km -- ChainC(lat 60).
    // ChainA-to-ChainC is ~6672km: OUTSIDE REGION_RADIUS_KM (5000) on its own,
    // but the three still form one group because ChainB bridges them
    // (single-linkage, not "near every member"). That group reaches
    // MAX_PER_REGION=3 from ChainA/B/C alone.
    //
    // ChainD (lat 85) sits ~2780km from ChainC (near) but ~9452km from
    // ChainA and ~6116km from ChainB (both far) -- i.e. it only touches ONE
    // member of the group directly. A pairwise-count implementation (count
    // how many *already-accepted individual cities* are within radius of the
    // candidate) sees just 1 match (ChainC) and wrongly admits it under a
    // cap of 3. The real bug this documents: a fourth same-swath city
    // (Baicheng) slipped past a cap of 3 exactly this way, by being far from
    // one specific already-accepted member of its own swath (Kuantan) while
    // still obviously part of it. Group-total accounting must see ChainD as
    // touching a group already at size 3 and defer it -- leaving room for
    // Distant, a real alternative from elsewhere, to fill the last slot.
    const chainA = scored('ChainA', 0, 0, 1000, 10)
    const chainB = scored('ChainB', 30, 0, 1000, 9)
    const chainC = scored('ChainC', 60, 0, 1000, 8)
    const chainD = scored('ChainD', 85, 0, 1000, 7)
    const distant = scored('Distant', -40, 170, 1000, 6)

    const out = applyRankingRules([chainA, chainB, chainC, chainD, distant], 4)

    expect(out.map((c) => c.city.name)).toEqual(['ChainA', 'ChainB', 'ChainC', 'Distant'])
  })

  it('backfills from the capped region when no other region has any viable candidate, rather than under-filling topN', () => {
    // Same single region, but nothing else exists anywhere -- the quota
    // must not cost results that have nowhere else to come from.
    const regionA = Array.from({ length: 8 }, (_, i) => scored(`A${i}`, i * 3, 0, 1000, 10 - i))
    const out = applyRankingRules(regionA, 8)
    expect(out).toHaveLength(8)
  })

  it('REGION_RADIUS_KM and MAX_PER_REGION are the documented tunable values', () => {
    expect(REGION_RADIUS_KM).toBe(5000)
    expect(MAX_PER_REGION).toBe(3)
  })

  it('a cheap latitude pre-filter does not change de-dup correctness (still catches a same-latitude-band nearby city, still misses a same-latitude-but-far-away one)', () => {
    const input = [
      scored('Base', 45, 0, 1000, 10),
      scored('SameLatNearby', 45, 1, 1000, 9), // ~79km away at this latitude -- inside DEDUP_RADIUS_KM
      scored('SameLatFar', 45, 100, 1000, 8), // same latitude, ~7800km away -- outside DEDUP_RADIUS_KM
    ]
    const out = applyRankingRules(input, 10)
    expect(out.map((c) => c.city.name)).toEqual(['Base', 'SameLatFar'])
    expect(out[0].clusterMembers.map((c) => c.city.name)).toEqual(['SameLatNearby'])
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

describe('nearbyScored (cluster zoom, poc/NEW-FEATURE.md §3c)', () => {
  // ra=90, dec=0 -> AC line longitude = wrap180(-gst) = 0 at gst=0, for
  // every latitude (see the paran describe block above for why).
  const positions = flatPositions({ Venus: { ra: 90, dec: 0, eclLon: 0, retrograde: false, dignity: 'peregrine' } })
  const config = weightsWith('love', { 'Venus-AC': 1.0 })

  it('only includes cities within radiusKm of the center point', () => {
    const cities = [
      city('Near', 0, 0.5, 1000), // ~55km from (0,0)
      city('Mid', 0, 2, 1000), // ~222km
      city('Far', 0, 10, 1000), // ~1113km
    ]
    const result = nearbyScored(cities, 0, 0, 300, 'love', positions, 0, config)
    expect(result.map((r) => r.city.name).sort()).toEqual(['Mid', 'Near'])
  })

  it('sorts by score descending, independent of input order', () => {
    const cities = [city('B', 0, 2, 1000), city('A', 0, 0.1, 1000), city('C', 0, 1, 1000)]
    const result = nearbyScored(cities, 0, 0, 300, 'love', positions, 0, config)
    // Closer to the line (smaller |lon|) means higher score under this synthetic config.
    expect(result.map((r) => r.city.name)).toEqual(['A', 'C', 'B'])
  })

  it('respects the limit', () => {
    const cities = Array.from({ length: 10 }, (_, i) => city(`C${i}`, 0, i * 0.1, 1000))
    expect(nearbyScored(cities, 0, 0, 300, 'love', positions, 0, config, 3)).toHaveLength(3)
  })

  it('returns full attribution per city, same shape as rankCities', () => {
    const result = nearbyScored([city('Solo', 0, 0, 1000)], 0, 0, 300, 'love', positions, 0, config)
    expect(result[0]).toMatchObject({ bestKey: 'Venus-AC', clusterMembers: [] })
  })
})
