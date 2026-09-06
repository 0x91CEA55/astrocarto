import { describe, expect, it } from 'vitest'
import goldenChart from './__fixtures__/golden-chart.json'
import goldenLines from './__fixtures__/golden.json'
import { chartAngles, wholeSignHouse } from './chart'
import { signIndex } from './dignity'
import { eclipticLongitudeRateDegPerDay } from './ephemeris'
import { wrap180 } from './lines'
import { localToUtc, utcToJulianDay } from './time'
import { SIGN_NAMES, type BodyName } from './types'

// Independent second oracle: golden-chart.json (pyswisseph, generated outside
// this sandbox — no network pip here to run Swiss Ephemeris directly). Unlike
// golden.json (ra/dec/line longitudes), this fixture carries chart-level
// output: ASC/MC longitude+sign+house, and per-body sign/house/retrograde/
// signed speed. It's the numeric check the self-consistency tests in
// chart.test.ts couldn't provide on their own.
//
// golden-chart.json has no birth lat/lon/tz of its own — cases are joined to
// golden.json by name for that (same six cases, same births, confirmed by name).

const ASC_MC_TOLERANCE_DEG = 0.017

function angleDiffDeg(a: number, b: number): number {
  return Math.abs(wrap180(a - b))
}

function signName(eclLonDeg: number): string {
  return SIGN_NAMES[signIndex(eclLonDeg)]
}

/** Relative tolerance with an absolute floor — a fixed absolute bound can't
 * span the Moon (~13.8°/day) down to a station (~0.0003°/day) sensibly. */
function speedTolerance(expected: number): number {
  return Math.max(0.0005, Math.abs(expected) * 0.05)
}

const linesByName = new Map(goldenLines.map((c) => [c.case.name, c.case]))

for (const c of goldenChart) {
  const birth = linesByName.get(c.case)
  if (!birth) throw new Error(`golden-chart.json case "${c.case}" has no matching golden.json birth case`)

  describe(`${c.case} (golden-chart.json)`, () => {
    const utc = localToUtc(birth.date, birth.time, birth.tz)
    const jdUt = utcToJulianDay(utc)
    const angles = chartAngles(c.gstDeg, birth.lon, birth.lat, jdUt)
    const ascSignIndex = signIndex(angles.ascDeg)

    it('ASC longitude within 0.017° of the oracle', () => {
      expect(angleDiffDeg(angles.ascDeg, c.asc.lon)).toBeLessThan(ASC_MC_TOLERANCE_DEG)
    })
    it('ASC sign matches exactly', () => {
      expect(signName(angles.ascDeg)).toBe(c.asc.sign)
    })

    it('MC longitude within 0.017° of the oracle', () => {
      expect(angleDiffDeg(angles.mcDeg, c.mc.lon)).toBeLessThan(ASC_MC_TOLERANCE_DEG)
    })
    it('MC sign matches exactly', () => {
      expect(signName(angles.mcDeg)).toBe(c.mc.sign)
    })
    it('MC whole-sign house matches exactly', () => {
      // Explicit regression target: under whole-sign the MC is not always
      // house 10 (ENGINE-SPEC §5) — berlin_1945 is a real case where it isn't.
      expect(wholeSignHouse(angles.mcDeg, ascSignIndex)).toBe(c.mc.wholeSignHouse)
    })

    for (const [bodyName, expected] of Object.entries(c.bodies) as Array<[BodyName, (typeof c.bodies)[BodyName]]>) {
      describe(bodyName, () => {
        it('sign matches exactly', () => {
          expect(signName(expected.eclLon)).toBe(expected.sign)
        })

        it('whole-sign house matches exactly', () => {
          expect(wholeSignHouse(expected.eclLon, ascSignIndex)).toBe(expected.wholeSignHouse)
        })

        it('retrograde flag matches the oracle', () => {
          const rate = eclipticLongitudeRateDegPerDay(bodyName, utc)
          expect(rate < 0).toBe(expected.retrograde)
        })

        // The explicit target: sydney_2001's Jupiter is a station at
        // −0.000339°/day — the only case in either fixture where the sign of
        // a near-zero rate is actually load-bearing. A wrong sign, a dropped
        // radians->degrees conversion, or a swapped vector component would
        // all plausibly still pass a boolean-only retrograde check by luck;
        // this is the test that would actually catch it.
        it('signed speed matches the oracle within tolerance', () => {
          const rate = eclipticLongitudeRateDegPerDay(bodyName, utc)
          expect(Math.abs(rate - expected.speedDegPerDay)).toBeLessThan(speedTolerance(expected.speedDegPerDay))
        })
      })
    }
  })
}
