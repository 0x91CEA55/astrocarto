/**
 * Orthographic globe geometry — projection setup, fly-to easing, drag, and
 * label placement. Framework-agnostic so it's testable without mounting a
 * component. UX-SPEC §4: use d3-geo (`geoOrthographic().rotate().clipAngle(90)`),
 * not a hand-rolled projection — the reference HTML only hand-rolls because it
 * runs over `file://` with no bundler.
 */
import { geoOrthographic, type GeoProjection } from 'd3-geo'

export const DRAG_DEG_PER_PX = 0.35
export const PITCH_CLAMP_DEG = 80
export const FLY_TO_MS = 900
/**
 * UX-SPEC §4 specifies 17px, sized for the reference build's plain SVG
 * `<text>` baseline positioning. This app renders labels as padded DOM
 * `<button>`s instead (bigger, more accessible tap targets) — measured live
 * at ~26px tall with `transform: translateY(-50%)` centering each on its
 * anchor, so two boxes need their centers at least 26px apart to avoid
 * touching at all. Found via a live mobile Playwright run: at 17px, adjacent
 * labels overlapped by ~9px and one intercepted clicks meant for the other.
 */
export const LABEL_MIN_GAP_PX = 28
export const LABEL_MAX_COUNT = 4

/** `zoom` is a multiplier on the base scale — 1 is the normal FIELD view, >1 is a cluster zoom-in (poc/NEW-FEATURE.md §3c). */
export function createGlobeProjection(size: number, zoom = 1): GeoProjection {
  return geoOrthographic()
    .clipAngle(90)
    .scale((size / 2.5) * zoom)
    .translate([size / 2, size / 2])
}

/** Cubic in-out. Reference: `k<0.5 ? 4k^3 : 1-(-2k+2)^3/2`. */
export function easeCubicInOut(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2
}

export interface Rotation {
  lambda: number // degrees, negative of geographic longitude
  phi: number // degrees, pitch
}

/**
 * Shortest-way longitude delta to a target, plus the fly-to pitch convention:
 * target pitch = lat * 0.6, NOT lat (UX-SPEC §4 — flattens the apparent
 * pitch swing so consecutive fly-tos don't feel like a rollercoaster).
 *
 * `exact: true` skips that flattening and centers on the true latitude —
 * required for a zoomed-in cluster view (poc/NEW-FEATURE.md §3c): the 0.6
 * factor is a ~2000km error at mid-latitudes, invisible when a whole
 * hemisphere is on screen but far outside a few-hundred-km zoomed frame.
 */
export function flyToTarget(from: Rotation, targetLat: number, targetLon: number, exact = false): { lambda: number; phi: number } {
  const desiredLambda = -targetLon
  const delta = ((desiredLambda - from.lambda + 540) % 360) - 180
  return { lambda: from.lambda + delta, phi: exact ? targetLat : targetLat * 0.6 }
}

/**
 * Spherical (vector) mean of a set of lat/lon points — the point whose
 * direction best represents the group as a whole, used to fly the camera
 * somewhere that shows as much of the top results as possible instead of
 * literally centering on the #1 result and leaving the others on the far
 * side of the globe. Reported live: with genuinely diverse, multi-continent
 * results (the point of the region-diversity feature), centering on #1
 * specifically often left only 1-2 of the top 4 visible without manually
 * rotating — "such minimal zoomed out results?"
 *
 * Plain lat/lon averaging breaks down near the antimeridian and poles (e.g.
 * two points at lon ±179° average to lon 0°, the wrong side of the globe) —
 * averaging as 3D unit vectors and converting back avoids that.
 */
export function sphericalCentroid(points: Array<{ lat: number; lon: number }>): { lat: number; lon: number } {
  let x = 0
  let y = 0
  let z = 0
  for (const p of points) {
    const latRad = (p.lat * Math.PI) / 180
    const lonRad = (p.lon * Math.PI) / 180
    x += Math.cos(latRad) * Math.cos(lonRad)
    y += Math.cos(latRad) * Math.sin(lonRad)
    z += Math.sin(latRad)
  }
  const n = points.length
  x /= n
  y /= n
  z /= n
  const lon = Math.atan2(y, x) * (180 / Math.PI)
  const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * (180 / Math.PI)
  return { lat, lon }
}

export function clampPitch(phi: number): number {
  return Math.max(-PITCH_CLAMP_DEG, Math.min(PITCH_CLAMP_DEG, phi))
}

/**
 * Apply a `Rotation` (our convention: lambda = -centerLon, phi = +effective
 * centerLat) to a d3 projection, whose own `.rotate([lambda, phi])` convention
 * is the *negative* of the geographic center on the phi axis (see UX-SPEC §4's
 * own example, `.rotate([-lon, -lat])`). Centralized here so the sign flip is
 * written exactly once instead of re-derived at every call site.
 */
export function applyRotation(projection: GeoProjection, rotation: Rotation): void {
  projection.rotate([rotation.lambda, -rotation.phi])
}

export interface LabelPoint {
  id: string
  x: number
  y: number
}

export interface DodgedLabel extends LabelPoint {
  labelY: number
  hasLeader: boolean
}

/**
 * Sort by y, push apart to a minimum gap, flag a leader line when a label
 * moved off its true point. UX-SPEC §4: max 4 labels, 17px minimum gap.
 */
export function dodgeLabels(points: LabelPoint[]): DodgedLabel[] {
  const sorted = [...points].sort((a, b) => a.y - b.y).map((p) => ({ ...p, labelY: p.y, hasLeader: false }))
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].labelY - sorted[i - 1].labelY < LABEL_MIN_GAP_PX) {
      sorted[i].labelY = sorted[i - 1].labelY + LABEL_MIN_GAP_PX
    }
  }
  for (const p of sorted) p.hasLeader = Math.abs(p.labelY - p.y) > 1
  return sorted
}

/** Is the point on the visible hemisphere of the given rotation? */
export function isVisible(lat: number, lon: number, rotation: Rotation): boolean {
  const p = (lat * Math.PI) / 180
  const l = (lon * Math.PI) / 180 + (rotation.lambda * Math.PI) / 180
  const p0 = (rotation.phi * Math.PI) / 180
  return Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l) >= 0
}
