import { describe, expect, it } from 'vitest'
import { formatDateForDisplay, parseFreeDate, parseFreeTime } from './parseDateTime'

describe('parseFreeDate', () => {
  it('parses ISO order', () => {
    expect(parseFreeDate('1991-02-19')).toBe('1991-02-19')
  })

  it('parses "19 Feb 1991" — the reference placeholder format', () => {
    expect(parseFreeDate('19 Feb 1991')).toBe('1991-02-19')
  })

  it('is case-insensitive on the month name', () => {
    expect(parseFreeDate('19 feb 1991')).toBe('1991-02-19')
    expect(parseFreeDate('19 FEB 1991')).toBe('1991-02-19')
  })

  it('parses a full month name', () => {
    expect(parseFreeDate('19 February 1991')).toBe('1991-02-19')
  })

  it('parses "Feb 19, 1991" and "Feb 19 1991"', () => {
    expect(parseFreeDate('Feb 19, 1991')).toBe('1991-02-19')
    expect(parseFreeDate('Feb 19 1991')).toBe('1991-02-19')
  })

  it('rejects an empty or garbage string rather than guessing', () => {
    expect(parseFreeDate('')).toBeNull()
    expect(parseFreeDate('   ')).toBeNull()
    expect(parseFreeDate('not a date')).toBeNull()
  })

  it('rejects ambiguous bare-numeric slash dates rather than silently picking an order', () => {
    expect(parseFreeDate('2/3/1991')).toBeNull()
  })

  it('rejects an impossible calendar date', () => {
    expect(parseFreeDate('31 Feb 1991')).toBeNull()
  })
})

describe('parseFreeTime', () => {
  it('parses 24h HH:mm', () => {
    expect(parseFreeTime('22:45')).toBe('22:45')
  })

  it('parses single-digit-hour 24h', () => {
    expect(parseFreeTime('9:05')).toBe('09:05')
  })

  it('parses 12h with AM/PM in several cases and spacings', () => {
    expect(parseFreeTime('10:45 PM')).toBe('22:45')
    expect(parseFreeTime('10:45pm')).toBe('22:45')
    expect(parseFreeTime('10:45 pm')).toBe('22:45')
    expect(parseFreeTime('12:00 AM')).toBe('00:00')
    expect(parseFreeTime('12:00 PM')).toBe('12:00')
  })

  it('rejects an out-of-range hour or minute', () => {
    expect(parseFreeTime('25:00')).toBeNull()
    expect(parseFreeTime('10:99')).toBeNull()
  })

  it('rejects garbage', () => {
    expect(parseFreeTime('')).toBeNull()
    expect(parseFreeTime('not a time')).toBeNull()
  })
})

describe('formatDateForDisplay', () => {
  it('renders the reference placeholder style', () => {
    expect(formatDateForDisplay('1991-02-19')).toBe('19 Feb 1991')
  })
})
