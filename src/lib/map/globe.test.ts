import { describe, expect, it } from 'vitest'
import { dodgeLabels, easeCubicInOut, flyToTarget, isVisible, LABEL_MIN_GAP_PX } from './globe'

describe('easeCubicInOut', () => {
  it('is anchored at the endpoints and the midpoint', () => {
    expect(easeCubicInOut(0)).toBe(0)
    expect(easeCubicInOut(1)).toBe(1)
    expect(easeCubicInOut(0.5)).toBeCloseTo(0.5, 10)
  })

  it('is monotonically increasing', () => {
    let prev = -Infinity
    for (let k = 0; k <= 1; k += 0.05) {
      const v = easeCubicInOut(k)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })
})

describe('flyToTarget', () => {
  it('centers directly on a target due east/north from the origin rotation', () => {
    const { lambda, phi } = flyToTarget({ lambda: 0, phi: 0 }, 45, 90)
    expect(lambda).toBeCloseTo(-90, 6)
    expect(phi).toBeCloseTo(45 * 0.6, 6) // pitch = lat * 0.6, not lat — UX-SPEC §4
  })

  it('takes the short way across the antimeridian instead of the long way around', () => {
    // From centered-on-170E, flying to 170W (a 20 deg hop) must not produce a ~340 deg delta.
    const from = { lambda: -170, phi: 0 }
    const { lambda } = flyToTarget(from, 0, -170)
    const delta = lambda - from.lambda
    expect(Math.abs(delta)).toBeLessThan(180)
  })

  it('re-targeting the same point twice is a no-op on lambda', () => {
    const first = flyToTarget({ lambda: 0, phi: 0 }, 10, 20)
    const second = flyToTarget(first, 10, 20)
    expect(second.lambda).toBeCloseTo(first.lambda, 6)
  })
})

describe('isVisible', () => {
  it('the rotation target itself is always visible (dead center)', () => {
    const rotation = flyToTarget({ lambda: 0, phi: 0 }, 30, 40)
    // phi in `rotation` is flattened (lat*0.6), so re-derive the actual centered
    // point that flyToTarget aimed at: lon = -lambda, lat = phi/0.6.
    expect(isVisible(rotation.phi / 0.6, -rotation.lambda, rotation)).toBe(true)
  })

  it('the antipodal point is never visible', () => {
    const rotation = flyToTarget({ lambda: 0, phi: 0 }, 0, 0)
    expect(isVisible(0, 180, rotation)).toBe(false)
  })

  it('a point 90 degrees around the equator from center sits on the limb (boundary-inclusive)', () => {
    const rotation = { lambda: 0, phi: 0 }
    expect(isVisible(0, 90, rotation)).toBe(true) // >= 0, limb itself counts as visible
    expect(isVisible(0, 91, rotation)).toBe(false)
  })
})

describe('dodgeLabels', () => {
  it('leaves well-separated labels untouched', () => {
    const out = dodgeLabels([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 0, y: 100 },
    ])
    expect(out.find((l) => l.id === 'a')?.labelY).toBe(0)
    expect(out.find((l) => l.id === 'b')?.labelY).toBe(100)
    expect(out.every((l) => !l.hasLeader)).toBe(true)
  })

  it('pushes overlapping labels apart to the minimum gap, in y order', () => {
    const out = dodgeLabels([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 0, y: 5 },
      { id: 'c', x: 0, y: 8 },
    ])
    const byId = Object.fromEntries(out.map((l) => [l.id, l]))
    expect(byId.a.labelY).toBe(0)
    expect(byId.b.labelY).toBe(LABEL_MIN_GAP_PX)
    expect(byId.c.labelY).toBe(LABEL_MIN_GAP_PX * 2)
    expect(byId.a.hasLeader).toBe(false)
    expect(byId.b.hasLeader).toBe(true)
    expect(byId.c.hasLeader).toBe(true)
  })
})
