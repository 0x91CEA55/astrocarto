import { positions, siderealTimeDeg } from './ephemeris'
import { buildLines } from './lines'
import { julianDayUtc, localToUtc, utcToJulianDay } from './time'
import type { Birth, Lines, Positions } from './types'

export interface Chart {
  birth: Birth
  positions: Positions
  lines: Lines
}

export function computeChart(utc: Date): Chart {
  const pos = positions(utc)
  const gstDeg = siderealTimeDeg(utc)
  return {
    birth: { jdUt: utcToJulianDay(utc), gstDeg, utcIso: utc.toISOString() },
    positions: pos,
    lines: buildLines(pos, gstDeg),
  }
}

export { julianDayUtc, localToUtc, utcToJulianDay }
export * from './types'
export { wrap180, lineLongitude, distanceToLineKm, haversineKm } from './lines'
export { bodyPosition } from './ephemeris'
