export const BODY_NAMES = [
  'Sun',
  'Moon',
  'Mercury',
  'Venus',
  'Mars',
  'Jupiter',
  'Saturn',
  'Uranus',
  'Neptune',
  'Pluto',
] as const

export type BodyName = (typeof BODY_NAMES)[number]

export const ANGLES = ['AC', 'DC', 'MC', 'IC'] as const

export type AngleName = (typeof ANGLES)[number]

export const SIGN_NAMES = [
  'Aries',
  'Taurus',
  'Gemini',
  'Cancer',
  'Leo',
  'Virgo',
  'Libra',
  'Scorpio',
  'Sagittarius',
  'Capricorn',
  'Aquarius',
  'Pisces',
] as const

export type SignName = (typeof SIGN_NAMES)[number]

export type Dignity = 'domicile' | 'exalted' | 'detriment' | 'fall' | 'peregrine'

export type AspectType = 'conjunction' | 'sextile' | 'square' | 'trine' | 'opposition'

export interface Aspect {
  a: BodyName
  b: BodyName
  type: AspectType
  separationDeg: number
  orbDeg: number
}

export interface BodyPosition {
  ra: number // degrees, apparent geocentric, equator of date
  dec: number // degrees
  eclLon: number // degrees, apparent geocentric, ecliptic of date
  retrograde: boolean
  dignity: Dignity
}

export type Positions = Record<BodyName, BodyPosition>

export interface Birth {
  jdUt: number
  gstDeg: number
  utcIso: string
}

/** A single continuous segment of a line, already split at the antimeridian. */
export type LineSegment = Array<[lon: number, lat: number]>

export type LineKey = `${BodyName}-${AngleName}`

export type Lines = Record<LineKey, LineSegment[]>
