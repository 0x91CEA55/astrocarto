import { describe, expect, it } from 'vitest'
import { degreeInSignLabel } from './copy'

describe('degreeInSignLabel', () => {
  it('formats an ordinary degree/minute pair', () => {
    expect(degreeInSignLabel(37.6668801)).toBe('7°40′') // Moon, ottawa_1991 case: 37.67 - 30 = 7.67deg -> 7deg 40min
  })

  // Found via a live Playwright run of the app (precision sheet showed "Sun 0°60′"):
  // rounding minutes independently of the degree can carry a 59.5+ minute
  // fraction up to 60 without rolling into the next degree.
  it('carries a rounded 60 minutes into the next degree instead of printing 0°60′', () => {
    expect(degreeInSignLabel(0.9995)).toBe('1°00′')
  })

  it('wraps the degree carry across a sign boundary (29.999 -> next sign at 0°00′)', () => {
    expect(degreeInSignLabel(29.9995)).toBe('0°00′')
  })

  it('handles a longitude already past 360 or negative, via the same modulo normalization used elsewhere', () => {
    expect(degreeInSignLabel(390)).toBe(degreeInSignLabel(30))
    expect(degreeInSignLabel(-1)).toBe(degreeInSignLabel(29))
  })
})
