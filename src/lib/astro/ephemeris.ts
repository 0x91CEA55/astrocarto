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

/** Apparent geocentric ecliptic-of-date longitude, in degrees [0, 360). */
function eclipticLongitudeOfDate(body: Astronomy.Body, date: Date): number {
  const geoVec = Astronomy.GeoVector(body, date, true)
  return Astronomy.Ecliptic(geoVec).elon
}

const RETROGRADE_HALF_STEP_DAYS = 0.5

function isRetrograde(body: Astronomy.Body, date: Date, eclLon: number): boolean {
  const before = eclipticLongitudeOfDate(body, new Date(date.getTime() - RETROGRADE_HALF_STEP_DAYS * 86_400_000))
  // wrap180-style signed delta so the 0/360 seam never looks like a direction flip
  const delta = ((eclLon - before + 180) % 360 + 360) % 360 - 180
  return delta < 0
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
    retrograde: isRetrograde(body, date, eclLon),
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
