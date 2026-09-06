import type { Chart } from '../astro'
import { signIndex } from '../astro/dignity'
import { SIGN_NAMES, type AngleName, type BodyName, type Dignity, type LineKey } from '../astro/types'
import interpretations from '../../data/interpretations.json'
import type { Theme, WeightsConfig } from '../scoring/score'

const INTERPRETATIONS = interpretations as Partial<Record<LineKey, string>>

export const THEME_LABEL: Record<Theme, string> = { love: 'Love', career: 'Career', harmony: 'Harmony' }

export const THEME_HEADLINE: Record<Theme, string> = {
  love: 'Where you would meet someone',
  career: 'Where the work opens up',
  harmony: "Where you'd feel at home",
}

export const THEME_ACCENT_BODY: Record<Theme, BodyName> = { love: 'Venus', career: 'Jupiter', harmony: 'Moon' }

// Voice §13: never route MC copy through "the tenth house" — under whole-sign
// the MC lands there only ~68% of the time. One voice for everyone, no branch.
const ANGLE_VOICE: Record<AngleName, string> = {
  MC: 'the midheaven',
  IC: 'the fourth angle',
  AC: 'the ascendant',
  DC: 'the descendant',
}

/**
 * Top-N lines by |weight| for a theme — which lines actually draw on the
 * globe. Derived from the scoring config (auditable JSON, ENGINE-SPEC §6),
 * not a hardcoded per-chart list — poc/reference/void-components.html
 * hardcodes its `TH[theme].keys` because it only ever renders one example
 * chart; the real weights config must generalize to any birth.
 */
export function topKeysForTheme(config: WeightsConfig, theme: Theme, n = 8): LineKey[] {
  return (Object.entries(config.themes[theme]) as Array<[LineKey, number]>)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, n)
    .map(([key]) => key)
}

export function degreeInSignLabel(eclLonDeg: number): string {
  const within = ((eclLonDeg % 30) + 30) % 30
  let deg = Math.floor(within)
  let min = Math.round((within - deg) * 60)
  if (min === 60) {
    min = 0
    deg = (deg + 1) % 30
  }
  return `${deg}°${String(min).padStart(2, '0')}′`
}

export function signOf(eclLonDeg: number): string {
  return SIGN_NAMES[signIndex(eclLonDeg)]
}

export interface FieldCopy {
  headline: string
  /** The clickable clause — tapping it opens DERIVATION for `derivationBody`. */
  leadPrefix: string
  derivationBody: BodyName | null
  leadSuffix: string
}

/**
 * Headline + lead paragraph for FIELD, generated from the actual computed
 * chart's top contributor (ENGINE-SPEC §6's "largest-magnitude contributor"),
 * not hardcoded per-example copy.
 */
export function buildFieldCopy(theme: Theme, chart: Chart, bestKey: LineKey | null): FieldCopy {
  const headline = THEME_HEADLINE[theme]

  if (!bestKey) {
    // The water case — UX-SPEC §9. No line to lead with; the sheet below carries the real content.
    return {
      headline,
      leadPrefix: '',
      derivationBody: null,
      leadSuffix: 'The strongest lines for this theme fall over open water here — see the nearest land crossings below.',
    }
  }

  const [bodyPart, anglePart] = bestKey.split('-') as [BodyName, AngleName]
  const p = chart.positions[bodyPart]
  const sign = signOf(p.eclLon)
  const angleVoice = ANGLE_VOICE[anglePart]

  const dignityClause =
    p.dignity === 'exalted'
      ? `${bodyPart} is exalted in ${sign}`
      : p.dignity === 'domicile'
        ? `${bodyPart} is at home in ${sign}`
        : `${bodyPart} is in ${sign}`

  const interp = INTERPRETATIONS[bestKey] ?? ''

  return {
    headline,
    leadPrefix: dignityClause,
    derivationBody: bodyPart,
    leadSuffix: ` and sits on ${angleVoice} here. ${interp}`,
  }
}

const ANGLE_FORMULA: Record<AngleName, string> = {
  MC: 'λ = α − GST',
  IC: 'λ = α + 180 − GST',
  AC: 'λ = α − H − GST',
  DC: 'λ = α + H − GST',
}

export interface DerivationInfo {
  body: BodyName
  sign: string
  degreeInSign: string
  house: number
  dignity: Dignity
  retrograde: boolean
  ra: number
  dec: number
  gstDeg: number
  angleFormulas: Record<AngleName, string>
}

/** Everything DERIVATION needs to show for one body — see UX-SPEC §8. */
export function describeDerivation(body: BodyName, chart: Chart): DerivationInfo {
  const p = chart.positions[body]
  return {
    body,
    sign: signOf(p.eclLon),
    degreeInSign: degreeInSignLabel(p.eclLon),
    house: chart.housesOf[body],
    dignity: p.dignity,
    retrograde: p.retrograde,
    ra: p.ra,
    dec: p.dec,
    gstDeg: chart.birth.gstDeg,
    angleFormulas: ANGLE_FORMULA,
  }
}
