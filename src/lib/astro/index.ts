import { aspectsOf, chartAngles, wholeSignHouse, type ChartAngles } from './chart'
import { signIndex } from './dignity'
import { positions, siderealTimeDeg } from './ephemeris'
import { buildLines } from './lines'
import { julianDayUtc, localToUtc, utcToJulianDay } from './time'
import { BODY_NAMES, type Aspect, type Birth, type BodyName, type Lines, type Positions } from './types'

export interface Chart {
  birth: Birth
  positions: Positions
  lines: Lines
  angles: ChartAngles
  ascSignIndex: number
  /** Whole-sign house [1,12] of each body — see ENGINE-SPEC §5. */
  housesOf: Record<BodyName, number>
  /** Whole-sign house of the Midheaven — not necessarily 10; see ENGINE-SPEC §5. */
  mcHouse: number
  aspects: Aspect[]
}

export function computeChart(utc: Date, latitudeDeg: number, longitudeDeg: number): Chart {
  const pos = positions(utc)
  const gstDeg = siderealTimeDeg(utc)
  const jdUt = utcToJulianDay(utc)
  const angles = chartAngles(gstDeg, longitudeDeg, latitudeDeg, jdUt)
  const ascSignIndex = signIndex(angles.ascDeg)

  const housesOf = {} as Record<BodyName, number>
  for (const name of BODY_NAMES) housesOf[name] = wholeSignHouse(pos[name].eclLon, ascSignIndex)

  return {
    birth: { jdUt, gstDeg, utcIso: utc.toISOString() },
    positions: pos,
    lines: buildLines(pos, gstDeg),
    angles,
    ascSignIndex,
    housesOf,
    mcHouse: wholeSignHouse(angles.mcDeg, ascSignIndex),
    aspects: aspectsOf(pos),
  }
}

export { julianDayUtc, localToUtc, utcToJulianDay }
export * from './types'
export { wrap180, lineLongitude, distanceToLineKm, haversineKm } from './lines'
export { bodyPosition } from './ephemeris'
export {
  meanObliquityDeg,
  chartAngles,
  wholeSignHouse,
  aspectsOf,
  ascendantSignIndexAt,
  findCuspWarning,
  type ChartAngles,
  type CuspWarning,
} from './chart'
export { signIndex, dignityOf } from './dignity'
