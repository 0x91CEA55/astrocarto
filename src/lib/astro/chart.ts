import { signIndex } from './dignity'
import { siderealTimeDeg } from './ephemeris'
import { utcToJulianDay } from './time'
import { SIGN_NAMES, type Aspect, type AspectType, type BodyName, type Positions } from './types'
import { wrap180 } from './lines'

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

function normalize360(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/**
 * IAU/Meeus mean obliquity of the ecliptic, degrees. T = Julian centuries
 * from J2000.0 (JD 2451545.0). No nutation term — matches Swiss Ephemeris's
 * mean-obliquity convention used by the closed-form ASC/MC below.
 */
export function meanObliquityDeg(jdUt: number): number {
  const t = (jdUt - 2451545.0) / 36525
  const arcsec = 84381.448 - 46.815 * t - 0.00059 * t * t + 0.001813 * t * t * t
  return arcsec / 3600
}

export interface ChartAngles {
  ramcDeg: number
  obliquityDeg: number
  mcDeg: number // ecliptic longitude of the Midheaven, degrees [0, 360)
  ascDeg: number // ecliptic longitude of the Ascendant, degrees [0, 360)
}

/**
 * Closed-form MC/ASC — no house library. See ENGINE-SPEC §5.
 * Convention: in-mundo RAMC (GST + terrestrial longitude east-positive).
 */
export function chartAngles(gstDeg: number, longitudeDeg: number, latitudeDeg: number, jdUt: number): ChartAngles {
  const ramcDeg = normalize360(gstDeg + longitudeDeg)
  const obliquityDeg = meanObliquityDeg(jdUt)
  const ramc = ramcDeg * DEG
  const eps = obliquityDeg * DEG
  const phi = latitudeDeg * DEG

  const mcDeg = normalize360(Math.atan2(Math.sin(ramc), Math.cos(ramc) * Math.cos(eps)) * RAD)
  let ascDeg = normalize360(
    Math.atan2(Math.cos(ramc), -(Math.sin(ramc) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps))) * RAD,
  )
  if (normalize360(ascDeg - mcDeg) > 180) ascDeg = normalize360(ascDeg + 180)

  return { ramcDeg, obliquityDeg, mcDeg, ascDeg }
}

/**
 * Whole-sign house of a point at `eclLonDeg`, given the Ascendant's sign.
 * House 1 = the ASC's whole sign; each following sign is the next house.
 */
export function wholeSignHouse(eclLonDeg: number, ascSignIndex: number): number {
  return ((signIndex(eclLonDeg) - ascSignIndex + 12) % 12) + 1
}

const ASPECT_DEFS: Array<{ type: AspectType; angle: number; orb: number }> = [
  { type: 'conjunction', angle: 0, orb: 8 },
  { type: 'sextile', angle: 60, orb: 6 },
  { type: 'square', angle: 90, orb: 6 },
  { type: 'trine', angle: 120, orb: 6 },
  { type: 'opposition', angle: 180, orb: 8 },
]

/** Arithmetic on longitudes already computed — every body pair within orb of a major aspect. */
export function aspectsOf(pos: Positions): Aspect[] {
  const names = Object.keys(pos) as BodyName[]
  const out: Aspect[] = []

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i]
      const b = names[j]
      const separationDeg = Math.abs(wrap180(pos[a].eclLon - pos[b].eclLon))

      let best: { type: AspectType; orbDeg: number } | null = null
      for (const { type, angle, orb } of ASPECT_DEFS) {
        const orbDeg = Math.abs(separationDeg - angle)
        if (orbDeg <= orb && (!best || orbDeg < best.orbDeg)) best = { type, orbDeg }
      }
      if (best) out.push({ a, b, type: best.type, separationDeg, orbDeg: best.orbDeg })
    }
  }
  return out
}

/**
 * Ascendant's sign index only — for the time-scrubber's cusp search (UX-SPEC
 * §8), which needs the rising sign at up to a dozen neighboring minute
 * offsets per tick and shouldn't pay for full body positions/lines each time.
 */
export function ascendantSignIndexAt(utc: Date, latitudeDeg: number, longitudeDeg: number): number {
  const gstDeg = siderealTimeDeg(utc)
  const jdUt = utcToJulianDay(utc)
  return signIndex(chartAngles(gstDeg, longitudeDeg, latitudeDeg, jdUt).ascDeg)
}

const CUSP_SEARCH_MINUTES = 6

export interface CuspWarning {
  minutesAway: number
  direction: 'earlier' | 'later'
  sign: string
}

/**
 * UX-SPEC §8: "whenever the rising sign is within 6 minutes of changing."
 * Searches outward minute-by-minute (later side first, matching
 * poc/reference/time-scrubber.html) from `minutes` until the rising sign
 * differs from `ascSignIndex`, or gives up at ±6 minutes.
 */
export function findCuspWarning(baseUtc: Date, minutes: number, latitudeDeg: number, longitudeDeg: number, ascSignIndex: number): CuspWarning | null {
  for (let k = 1; k <= CUSP_SEARCH_MINUTES; k++) {
    const laterSign = ascendantSignIndexAt(new Date(baseUtc.getTime() + (minutes + k) * 60_000), latitudeDeg, longitudeDeg)
    if (laterSign !== ascSignIndex) return { minutesAway: k, direction: 'later', sign: SIGN_NAMES[laterSign] }

    const earlierSign = ascendantSignIndexAt(new Date(baseUtc.getTime() + (minutes - k) * 60_000), latitudeDeg, longitudeDeg)
    if (earlierSign !== ascSignIndex) return { minutesAway: k, direction: 'earlier', sign: SIGN_NAMES[earlierSign] }
  }
  return null
}
