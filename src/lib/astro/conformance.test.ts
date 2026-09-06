import { describe, expect, it } from 'vitest'
import golden from './__fixtures__/golden.json'
import { bodyPosition } from './ephemeris'
import { lineLongitude, wrap180 } from './lines'
import { localToUtc, utcToJulianDay } from './time'
import { siderealTimeDeg } from './ephemeris'
import type { AngleName, BodyName } from './types'

// Conformance oracle: poc/astrocarto.py (Swiss Ephemeris) via poc/golden.json.
// NorthNode is excluded — golden.json used swe.TRUE_NODE (the osculating node,
// which oscillates several degrees around the mean node with a ~173-day period),
// but astronomy-engine has no node body at all, and SPEC.md's "mean node
// polynomial" fallback would miss these rows by degrees. See SPEC.md and the
// project handoff note for the full reasoning; NorthNode is dropped from v1.
const JD_TOLERANCE_DAYS = 1e-6
const RA_DEC_TOLERANCE_DEG = 0.017
const LINE_TOLERANCE_DEG = 0.05

function angleDiffDeg(a: number, b: number): number {
  return Math.abs(wrap180(a - b))
}

for (const goldenCase of golden) {
  const { case: birthCase, utc, jd_ut, gst_deg, bodies, lines } = goldenCase

  describe(birthCase.name, () => {
    const utcDate = localToUtc(birthCase.date, birthCase.time, birthCase.tz)

    it('resolves the local time to the correct UTC instant', () => {
      expect(utcDate.toISOString()).toBe(new Date(utc).toISOString())
    })

    it('computes jd_ut as pure arithmetic, independent of the ephemeris', () => {
      expect(Math.abs(utcToJulianDay(utcDate) - jd_ut)).toBeLessThan(JD_TOLERANCE_DAYS)
    })

    it('computes GST within tolerance', () => {
      expect(angleDiffDeg(siderealTimeDeg(utcDate), gst_deg)).toBeLessThan(RA_DEC_TOLERANCE_DEG)
    })

    for (const [name, expected] of Object.entries(bodies)) {
      if (name === 'NorthNode') continue
      const bodyName = name as BodyName

      it(`${bodyName}: ra/dec within 1 arcmin of the oracle`, () => {
        const p = bodyPosition(bodyName, utcDate)
        expect(angleDiffDeg(p.ra, expected.ra)).toBeLessThan(RA_DEC_TOLERANCE_DEG)
        expect(angleDiffDeg(p.dec, expected.dec)).toBeLessThan(RA_DEC_TOLERANCE_DEG)
      })
    }

    for (const [key, byLat] of Object.entries(lines)) {
      const [bodyPart, anglePart] = key.split('-')
      if (bodyPart === 'NorthNode') continue
      const bodyName = bodyPart as BodyName
      const angleName = anglePart as AngleName

      it(`${key}: line longitude within 0.05° at every sampled latitude`, () => {
        const p = bodyPosition(bodyName, utcDate)
        for (const [latStr, expectedLon] of Object.entries(byLat)) {
          const lat = Number(latStr)
          const actual = lineLongitude(p, angleName, lat, gst_deg)
          if (expectedLon === null) {
            expect(actual, `${key} @ lat ${lat} should be circumpolar (null)`).toBeNull()
          } else {
            expect(actual, `${key} @ lat ${lat}`).not.toBeNull()
            expect(angleDiffDeg(actual as number, expectedLon)).toBeLessThan(LINE_TOLERANCE_DEG)
          }
        }
      })
    }
  })
}
