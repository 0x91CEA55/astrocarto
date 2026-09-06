import { DateTime } from 'luxon'

/**
 * Julian Day (UT) via the standard Meeus algorithm, proleptic Gregorian.
 * Deliberately independent of any ephemeris library so a jd_ut mismatch in
 * conformance tests can only mean a timezone bug, never an ephemeris bug.
 */
export function julianDayUtc(year: number, month: number, day: number, hourUtc: number): number {
  let y = year
  let m = month
  if (m <= 2) {
    y -= 1
    m += 12
  }
  const a = Math.floor(y / 100)
  const b = 2 - a + Math.floor(a / 4)
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5 + hourUtc / 24
}

/**
 * Local wall-clock date/time in an IANA zone -> UTC instant.
 * Delegates historical DST rules to Luxon (backed by full tzdata), since
 * hand-rolled offset tables are the #1 source of wrong charts (see SPEC.md).
 */
export function localToUtc(dateStr: string, timeStr: string, tz: string): Date {
  const dt = DateTime.fromISO(`${dateStr}T${timeStr}:00`, { zone: tz })
  if (!dt.isValid) {
    throw new Error(`invalid local time "${dateStr} ${timeStr}" in zone "${tz}": ${dt.invalidReason} — ${dt.invalidExplanation}`)
  }
  return dt.toJSDate()
}

export function utcToJulianDay(utc: Date): number {
  return julianDayUtc(
    utc.getUTCFullYear(),
    utc.getUTCMonth() + 1,
    utc.getUTCDate(),
    utc.getUTCHours() + utc.getUTCMinutes() / 60 + utc.getUTCSeconds() / 3600,
  )
}
