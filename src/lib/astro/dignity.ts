import type { BodyName, Dignity } from './types'

/** Essential dignity table. Flags line strength only — not used for interpretation. */
const DIGNITY_TABLE: Partial<Record<BodyName, { domicile: number[]; exalt: number[]; detriment: number[]; fall: number[] }>> = {
  Sun: { domicile: [4], exalt: [0], detriment: [10], fall: [6] },
  Moon: { domicile: [3], exalt: [1], detriment: [9], fall: [7] },
  Mercury: { domicile: [2, 5], exalt: [5], detriment: [8, 11], fall: [11] },
  Venus: { domicile: [1, 6], exalt: [11], detriment: [0, 7], fall: [5] },
  Mars: { domicile: [0, 7], exalt: [9], detriment: [1, 6], fall: [3] },
  Jupiter: { domicile: [8, 11], exalt: [3], detriment: [2, 5], fall: [9] },
  Saturn: { domicile: [9, 10], exalt: [6], detriment: [3, 4], fall: [0] },
}

/** Zodiac sign index [0,12) from an ecliptic longitude in degrees. */
export function signIndex(eclLonDeg: number): number {
  return Math.floor(eclLonDeg / 30) % 12
}

export function dignityOf(body: BodyName, eclLonDeg: number): Dignity {
  const dg = DIGNITY_TABLE[body]
  if (!dg) return 'peregrine'
  const sign = signIndex(eclLonDeg)
  if (dg.exalt.includes(sign)) return 'exalted'
  if (dg.domicile.includes(sign)) return 'domicile'
  if (dg.fall.includes(sign)) return 'fall'
  if (dg.detriment.includes(sign)) return 'detriment'
  return 'peregrine'
}
