import { describe, expect, it } from 'vitest'
import type { Chart } from '../astro'
import { BODY_NAMES, type Positions } from '../astro/types'
import type { CityScore } from '../scoring/score'
import { buildFieldCopy, degreeInSignLabel } from './copy'

function fakeChart(overrides: Partial<Positions>): Chart {
  const base = { ra: 0, dec: 0, eclLon: 0, retrograde: false, dignity: 'peregrine' as const }
  const positions = {} as Positions
  for (const name of BODY_NAMES) positions[name] = { ...base }
  Object.assign(positions, overrides)
  return {
    birth: { jdUt: 0, gstDeg: 0, utcIso: '2000-01-01T00:00:00.000Z' },
    positions,
    lines: {} as Chart['lines'],
    angles: { ramcDeg: 0, obliquityDeg: 23.4, mcDeg: 0, ascDeg: 0 },
    ascSignIndex: 0,
    housesOf: Object.fromEntries(BODY_NAMES.map((b) => [b, 1])) as Chart['housesOf'],
    mcHouse: 1,
    aspects: [],
  }
}

function topScore(bestKey: CityScore['bestKey'], bestMagnitude: number, secondKey: CityScore['secondKey'], secondMagnitude: number): CityScore {
  return {
    city: { name: 'Test', ascii: null, lat: 0, lon: 0, countryCode: 'XX', population: 0, tz: 'UTC', geonameId: 1, wikiTitle: null },
    score: bestMagnitude,
    bestKey,
    bestMagnitude,
    secondKey,
    secondMagnitude,
    clusterMembers: [],
  }
}

describe('degreeInSignLabel', () => {
  it('formats an ordinary degree/minute pair', () => {
    expect(degreeInSignLabel(37.6668801)).toBe('7°40′') // Moon, ottawa_1991 case: 37.67 - 30 = 7.67deg -> 7deg 40min
  })

  // Found via a live Playwright run of the app (precision sheet showed "Sun 0°60′"):
  // rounding minutes independently of the degree can carry a 59.5+ minute
  // fraction up to 60 without rolling into the next degree.
  it('carries a rounded 60 minutes into the next degree instead of printing 0°60′', () => {
    expect(degreeInSignLabel(0.9995)).toBe('1°00′')
  })

  it('wraps the degree carry across a sign boundary (29.999 -> next sign at 0°00′)', () => {
    expect(degreeInSignLabel(29.9995)).toBe('0°00′')
  })

  it('handles a longitude already past 360 or negative, via the same modulo normalization used elsewhere', () => {
    expect(degreeInSignLabel(390)).toBe(degreeInSignLabel(30))
    expect(degreeInSignLabel(-1)).toBe(degreeInSignLabel(29))
  })
})

describe('buildFieldCopy (paran surfacing)', () => {
  const chart = fakeChart({
    Venus: { ra: 0, dec: 0, eclLon: 355, retrograde: false, dignity: 'exalted' }, // Pisces
    Moon: { ra: 0, dec: 0, eclLon: 35, retrograde: false, dignity: 'peregrine' }, // Taurus
  })

  it('attributes to a single line when there is no comparable second contributor', () => {
    const copy = buildFieldCopy('love', chart, topScore('Venus-DC', 2.6, 'Moon-AC', 0.3))
    expect(copy.leadPrefix).toBe('Venus is exalted in Pisces')
    expect(copy.leadSuffix).not.toContain('two lines cross')
    expect(copy.derivationBody).toBe('Venus')
  })

  it('names both lines when the second contributor is within PARAN_RATIO of the first', () => {
    const copy = buildFieldCopy('love', chart, topScore('Venus-DC', 2.6, 'Moon-AC', 2.0))
    expect(copy.leadPrefix).toBe('Venus is exalted in Pisces on the descendant')
    expect(copy.leadSuffix).toContain('Moon is in Taurus')
    expect(copy.leadSuffix).toContain('two lines cross here, not one')
  })

  it('still returns the water-case copy when there is no bestKey at all', () => {
    const copy = buildFieldCopy('love', chart, null)
    expect(copy.derivationBody).toBeNull()
    expect(copy.leadSuffix).toContain('open water')
  })

  it('does not tack on generic magazine-style filler after the dignity clause', () => {
    const copy = buildFieldCopy('love', chart, topScore('Venus-DC', 2.6, 'Moon-AC', 0.3))
    // The old interpretations.json sentence used to appear here; it's been
    // dropped in favor of the chart-specific clause alone (plus retrograde,
    // covered separately below).
    expect(copy.leadSuffix).toBe(' and sits on the descendant here.')
  })
})

describe('buildFieldCopy (retrograde)', () => {
  it('folds retrograde into the dignity clause for a peregrine body, matching the reference voice', () => {
    const chart = fakeChart({ Jupiter: { ra: 0, dec: 0, eclLon: 125, retrograde: true, dignity: 'peregrine' } }) // Leo
    const copy = buildFieldCopy('career', chart, topScore('Jupiter-MC', 2.4, null, 0))
    expect(copy.leadPrefix).toBe('Jupiter is retrograde in Leo')
    expect(copy.leadSuffix).toBe(' and sits on the midheaven here. It favours returning to something over starting cold.')
  })

  it('adds retrograde as a caveat, not an override, when dignity is strong', () => {
    const chart = fakeChart({ Venus: { ra: 0, dec: 0, eclLon: 355, retrograde: true, dignity: 'exalted' } }) // Pisces
    const copy = buildFieldCopy('love', chart, topScore('Venus-DC', 2.6, null, 0))
    expect(copy.leadPrefix).toBe('Venus is exalted in Pisces, though retrograde')
  })

  it('says nothing extra about motion when the body is not retrograde', () => {
    const chart = fakeChart({ Jupiter: { ra: 0, dec: 0, eclLon: 125, retrograde: false, dignity: 'peregrine' } })
    const copy = buildFieldCopy('career', chart, topScore('Jupiter-MC', 2.4, null, 0))
    expect(copy.leadPrefix).toBe('Jupiter is in Leo')
    expect(copy.leadSuffix).not.toContain('returning')
  })

  it('marks retrograde per body in a paran, independently of the other body', () => {
    const chart = fakeChart({
      Venus: { ra: 0, dec: 0, eclLon: 355, retrograde: false, dignity: 'exalted' },
      Moon: { ra: 0, dec: 0, eclLon: 35, retrograde: true, dignity: 'peregrine' },
    })
    const copy = buildFieldCopy('love', chart, topScore('Venus-DC', 2.6, 'Moon-AC', 2.0))
    expect(copy.leadPrefix).toBe('Venus is exalted in Pisces on the descendant')
    expect(copy.leadSuffix).toContain('Moon is retrograde in Taurus')
  })
})
