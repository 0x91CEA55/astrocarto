import type { BodyName } from '../astro/types'

/**
 * Planet identity — constant everywhere, export included. UX-SPEC §3: "Never
 * re-map per theme." Values copied verbatim from the spec's token table.
 */
export const BODY_COLOR: Record<BodyName, string> = {
  Sun: '#F0C244',
  Moon: '#8FC7E8',
  Mercury: '#B07FD4',
  Venus: '#E8628F',
  Mars: '#D9553D',
  Jupiter: '#C87A2E',
  Saturn: '#7C8AA6',
  Uranus: '#4FB8A8',
  Neptune: '#4A7FD4',
  Pluto: '#9A6BB0',
}
