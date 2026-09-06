import { ANGLES, type AngleName, type BodyName, type BodyPosition, type LineKey, type Lines, type Positions } from './types'

export function wrap180(x: number): number {
  return ((x + 180) % 360 + 360) % 360 - 180
}

const LAT_MIN = -75
const LAT_MAX = 75
const LAT_STEP = 0.25

/**
 * Terrestrial longitude at which `p` sits on `angle`, at latitude `phi`.
 * In-mundo convention (the physical body on the horizon/meridian) — a spec
 * choice, not a fact; see SPEC.md.
 */
export function lineLongitude(p: BodyPosition, angle: AngleName, phi: number, gstDeg: number): number | null {
  const { ra, dec } = p
  if (angle === 'MC') return wrap180(ra - gstDeg)
  if (angle === 'IC') return wrap180(ra + 180 - gstDeg)

  const c = -Math.tan((phi * Math.PI) / 180) * Math.tan((dec * Math.PI) / 180)
  if (Math.abs(c) > 1) return null // circumpolar: body never rises/sets at this latitude

  const hDeg = (Math.acos(c) * 180) / Math.PI
  return angle === 'AC' ? wrap180(ra - hDeg - gstDeg) : wrap180(ra + hDeg - gstDeg)
}

/** All body x angle lines as lists of [lon, lat] points, split at the antimeridian. */
export function buildLines(pos: Positions, gstDeg: number): Lines {
  const lats: number[] = []
  for (let phi = LAT_MIN; phi <= LAT_MAX + 1e-9; phi += LAT_STEP) {
    lats.push(Math.round(phi * 1000) / 1000)
  }

  const lines = {} as Lines
  for (const [name, p] of Object.entries(pos) as Array<[BodyName, BodyPosition]>) {
    for (const angle of ANGLES) {
      const sample = angle === 'MC' || angle === 'IC' ? [-89, 89] : lats
      const segments: Array<Array<[number, number]>> = []
      let current: Array<[number, number]> = []

      for (const phi of sample) {
        const lon = lineLongitude(p, angle, phi, gstDeg)
        if (lon === null) {
          if (current.length) segments.push(current)
          current = []
          continue
        }
        if (current.length && Math.abs(lon - current[current.length - 1][0]) > 180) {
          segments.push(current)
          current = []
        }
        current.push([lon, phi])
      }
      if (current.length) segments.push(current)

      const key: LineKey = `${name}-${angle}`
      lines[key] = segments.filter((s) => s.length > 1)
    }
  }
  return lines
}

const EARTH_RADIUS_KM = 6371.0088

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const p1 = toRad(lat1)
  const p2 = toRad(lat2)
  const dp = p2 - p1
  const dl = toRad(wrap180(lon2 - lon1))
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Shortest distance from a point to a line, measured along the point's latitude. */
export function distanceToLineKm(p: BodyPosition, angle: AngleName, gstDeg: number, lat: number, lon: number): number {
  const lineLon = lineLongitude(p, angle, lat, gstDeg)
  if (lineLon === null) return Infinity
  return haversineKm(lat, lon, lat, lineLon)
}
