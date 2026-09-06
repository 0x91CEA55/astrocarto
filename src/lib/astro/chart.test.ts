import { describe, expect, it } from 'vitest'
import { aspectsOf, chartAngles, meanObliquityDeg, wholeSignHouse } from './chart'
import { wrap180 } from './lines'
import type { BodyName, Positions } from './types'

// No external oracle for ASC/MC/houses: golden.json (poc/astrocarto.py, Swiss
// Ephemeris) carries no chart-angle fields, and pyswisseph isn't installable
// in this sandbox (no network, no pip). ENGINE-SPEC §5 claims the closed-form
// is verified against Swiss to sub-arcsecond precision, but that claim isn't
// checkable here — so instead of trusting it, these tests independently
// re-derive the defining geometric conditions (MC sits on the meridian, ASC
// sits on the horizon) via standard ecliptic->equatorial conversion and check
// the closed-form solution actually satisfies them. This catches a
// transcription error (wrong sign, swapped atan2 argument) even without a
// numeric oracle.

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

function normalize360(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/** Standard ecliptic (lat=0) -> equatorial conversion, degrees. */
function equatorialOfEcliptic(lambdaDeg: number, obliquityDeg: number): { raDeg: number; decDeg: number } {
  const lambda = lambdaDeg * DEG
  const eps = obliquityDeg * DEG
  const raDeg = normalize360(Math.atan2(Math.sin(lambda) * Math.cos(eps), Math.cos(lambda)) * RAD)
  const decDeg = Math.asin(Math.sin(eps) * Math.sin(lambda)) * RAD
  return { raDeg, decDeg }
}

describe('meanObliquityDeg', () => {
  it('matches the published J2000.0 mean obliquity (23°26\'21.448")', () => {
    expect(meanObliquityDeg(2451545.0)).toBeCloseTo(23.4392911, 6)
  })
})

describe('chartAngles', () => {
  // JD arbitrary but fixed; obliquity is nearly constant over human timescales anyway.
  const jdUt = 2448307.65625 // ottawa_1991 case from golden.json

  it('MC sits on the meridian: its right ascension equals RAMC', () => {
    for (let gst = 0; gst < 360; gst += 37) {
      for (const lon of [-179, -75.7, 0, 75.7, 179]) {
        const { ramcDeg, obliquityDeg, mcDeg } = chartAngles(gst, lon, 45, jdUt)
        const { raDeg } = equatorialOfEcliptic(mcDeg, obliquityDeg)
        expect(Math.abs(wrap180(raDeg - ramcDeg))).toBeLessThan(1e-6)
      }
    }
  })

  it('ASC sits on the horizon: cos(hour angle) = -tan(dec) * tan(latitude)', () => {
    for (let gst = 0; gst < 360; gst += 41) {
      for (const lat of [-66, -45, -23.4, 0, 23.4, 45, 66]) {
        const { ramcDeg, obliquityDeg, ascDeg } = chartAngles(gst, -75.7, lat, jdUt)
        const { raDeg, decDeg } = equatorialOfEcliptic(ascDeg, obliquityDeg)
        const hourAngle = (wrap180(ramcDeg - raDeg) * DEG)
        const lhs = Math.cos(hourAngle)
        const rhs = -Math.tan(decDeg * DEG) * Math.tan(lat * DEG)
        expect(lhs).toBeCloseTo(rhs, 6)
      }
    }
  })

  it('ASC is on the ascending (eastern) side, not the descendant, 180° away', () => {
    // Rising means the hour angle is negative (east of the meridian, moving toward it).
    for (let gst = 0; gst < 360; gst += 53) {
      const { ramcDeg, obliquityDeg, ascDeg } = chartAngles(gst, -75.7, 45, jdUt)
      const { raDeg } = equatorialOfEcliptic(ascDeg, obliquityDeg)
      const hourAngle = wrap180(ramcDeg - raDeg)
      expect(hourAngle).toBeLessThanOrEqual(0)
    }
  })

  it('is degenerate-safe near the poles (no NaN)', () => {
    for (const lat of [-89.9, 89.9]) {
      const { ascDeg, mcDeg } = chartAngles(123, 45, lat, jdUt)
      expect(Number.isFinite(ascDeg)).toBe(true)
      expect(Number.isFinite(mcDeg)).toBe(true)
    }
  })
})

describe('wholeSignHouse', () => {
  it('places the Ascendant itself in house 1', () => {
    const ascSignIndex = 7 // Libra
    expect(wholeSignHouse(7 * 30 + 10, ascSignIndex)).toBe(1)
  })

  it('cycles 1..12 across all twelve signs from any ASC sign', () => {
    for (let ascSign = 0; ascSign < 12; ascSign++) {
      const houses = new Set<number>()
      for (let sign = 0; sign < 12; sign++) {
        houses.add(wholeSignHouse(sign * 30 + 15, ascSign))
      }
      expect(houses).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))
    }
  })

  it('the 7th house sign is exactly opposite the ASC sign', () => {
    for (let ascSign = 0; ascSign < 12; ascSign++) {
      const oppositeSign = (ascSign + 6) % 12
      expect(wholeSignHouse(oppositeSign * 30 + 1, ascSign)).toBe(7)
    }
  })
})

describe('aspectsOf', () => {
  function positionsWith(eclLons: Partial<Record<BodyName, number>>): Positions {
    const base = { ra: 0, dec: 0, retrograde: false, dignity: 'peregrine' as const }
    return Object.fromEntries(Object.entries(eclLons).map(([name, eclLon]) => [name, { ...base, eclLon }])) as Positions
  }

  it('finds an exact conjunction', () => {
    const pos = positionsWith({ Sun: 10, Moon: 12 })
    const aspects = aspectsOf(pos)
    expect(aspects).toHaveLength(1)
    expect(aspects[0]).toMatchObject({ a: 'Sun', b: 'Moon', type: 'conjunction', separationDeg: 2, orbDeg: 2 })
  })

  it('finds an exact opposition across the 0/360 seam', () => {
    const pos = positionsWith({ Sun: 350, Mars: 170 })
    const aspects = aspectsOf(pos)
    expect(aspects[0]).toMatchObject({ type: 'opposition', separationDeg: 180, orbDeg: 0 })
  })

  it('respects the tighter 6° orb for sextile/square/trine vs 8° for conjunction/opposition', () => {
    expect(aspectsOf(positionsWith({ Sun: 0, Venus: 67 }))).toHaveLength(0) // sextile, 7° off — outside 6°
    expect(aspectsOf(positionsWith({ Sun: 0, Venus: 66 }))).toHaveLength(1) // 6° off — inside
    expect(aspectsOf(positionsWith({ Sun: 0, Venus: 187 }))).toHaveLength(1) // opposition, 7° off — inside 8°
  })

  it('reports no aspect between bodies with no angular relationship in range', () => {
    const pos = positionsWith({ Sun: 0, Venus: 45 }) // between conjunction(0) and sextile(60), out of both orbs
    expect(aspectsOf(pos)).toHaveLength(0)
  })

  it('picks the closer aspect type when two orb ranges could both apply', () => {
    // 63° is 3° from sextile(60) and 27° from square(90) — sextile should win even
    // though both fall within their own generous-orb neighborhoods in principle.
    const pos = positionsWith({ Sun: 0, Venus: 63 })
    expect(aspectsOf(pos)[0]).toMatchObject({ type: 'sextile', orbDeg: 3 })
  })
})
