import * as Astronomy from 'astronomy-engine'
import { dignityOf } from './dignity'
import { BODY_NAMES, type BodyName, type BodyPosition, type Positions } from './types'

const ENGINE_BODY: Record<BodyName, Astronomy.Body> = {
  Sun: Astronomy.Body.Sun,
  Moon: Astronomy.Body.Moon,
  Mercury: Astronomy.Body.Mercury,
  Venus: Astronomy.Body.Venus,
  Mars: Astronomy.Body.Mars,
  Jupiter: Astronomy.Body.Jupiter,
  Saturn: Astronomy.Body.Saturn,
  Uranus: Astronomy.Body.Uranus,
  Neptune: Astronomy.Body.Neptune,
  Pluto: Astronomy.Body.Pluto,
}

/**
 * Signed ecliptic-longitude rate (degrees/day) via the analytic state vector,
 * not a finite difference. A 0.5-day central difference is *below the
 * ephemeris's own error bound* for every outer body (e.g. Jupiter moves
 * ~0.000244° over that window against a ±1 arcmin ≈ 0.0167° bound) — it reads
 * noise, not motion. Instead take the geocentric state vector (position +
 * velocity), rotate it into the ecliptic plane, and compute
 * dλ/dt = (x·vy − y·vx) / (x² + y²) directly — exact, no step size to tune.
 *
 * `HelioState`'s velocity is AU/day, so the raw (x·vy−y·vx)/(x²+y²) quotient
 * comes out in radians/day — the 180/π factor below is not optional; dropping
 * it still makes the *sign* correct (retrograde only ever checked the sign),
 * which is exactly the kind of unit bug a boolean-only test would never catch.
 * See conformance-chart.test.ts, which asserts the actual magnitude against
 * golden-chart.json's `speedDegPerDay` — including sydney_2001's Jupiter, a
 * near-zero station (−0.000339°/day) where a wrong sign or scale would show.
 */
export function eclipticLongitudeRateDegPerDay(name: BodyName, date: Date): number {
  const body = ENGINE_BODY[name]
  const helioBody = Astronomy.HelioState(body, date)
  const helioEarth = Astronomy.HelioState(Astronomy.Body.Earth, date)
  const geoEqj = new Astronomy.StateVector(
    helioBody.x - helioEarth.x,
    helioBody.y - helioEarth.y,
    helioBody.z - helioEarth.z,
    helioBody.vx - helioEarth.vx,
    helioBody.vy - helioEarth.vy,
    helioBody.vz - helioEarth.vz,
    helioBody.t,
  )
  const { x, y, vx, vy } = Astronomy.RotateState(Astronomy.Rotation_EQJ_ECL(), geoEqj)
  const radPerDay = (x * vy - y * vx) / (x * x + y * y)
  return radPerDay * (180 / Math.PI)
}

/**
 * Apparent geocentric position of one body, equator-of-date + ecliptic-of-date,
 * matching Swiss Ephemeris's default (no FLG_TOPOCTR / FLG_J2000) convention.
 *
 * astronomy-engine has no direct "geocentric equatorial of date" call: `Equator()`
 * is topocentric (requires an Observer), so instead we take the raw EQJ vector from
 * `GeoVector` and rotate it to EQD ourselves before reading off RA/dec.
 */
export function bodyPosition(name: BodyName, date: Date): BodyPosition {
  const body = ENGINE_BODY[name]
  const geoVecEqj = Astronomy.GeoVector(body, date, true)
  const eqd = Astronomy.RotateVector(Astronomy.Rotation_EQJ_EQD(date), geoVecEqj)
  const equatorial = Astronomy.EquatorFromVector(eqd)
  const eclLon = Astronomy.Ecliptic(geoVecEqj).elon

  return {
    ra: equatorial.ra * 15, // hours -> degrees
    dec: equatorial.dec,
    eclLon,
    retrograde: eclipticLongitudeRateDegPerDay(name, date) < 0,
    dignity: dignityOf(name, eclLon),
  }
}

export function positions(date: Date): Positions {
  const out = {} as Positions
  for (const name of BODY_NAMES) {
    out[name] = bodyPosition(name, date)
  }
  return out
}

export function siderealTimeDeg(date: Date): number {
  return Astronomy.SiderealTime(date) * 15
}
