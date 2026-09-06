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
export const LABEL_MIN_GAP_PX = 17
export const LABEL_MAX_COUNT = 4

export function createGlobeProjection(size: number): GeoProjection {
  return geoOrthographic()
    .clipAngle(90)
    .scale(size / 2.5)
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
 */
export function flyToTarget(from: Rotation, targetLat: number, targetLon: number): { lambda: number; phi: number } {
  const desiredLambda = -targetLon
  const delta = ((desiredLambda - from.lambda + 540) % 360) - 180
  return { lambda: from.lambda + delta, phi: targetLat * 0.6 }
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
