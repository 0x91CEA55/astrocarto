import { DateTime } from 'luxon'

/**
 * Free-text date/time parsing for BirthField — native `<input type="date">`/
 * `type="time">` force a browser/OS picker UI that doesn't match the rest of
 * the Void aesthetic and is annoying to use for a birth date decades in the
 * past (most date pickers default to today and require many clicks back).
 * `poc/reference/void-components.html` uses plain text inputs with
 * placeholders ("19 Feb 1991", "22:45") for exactly this reason.
 *
 * Deliberately does NOT accept bare numeric formats like "2/3/1991" — that's
 * genuinely ambiguous (2 March vs 3 February) and silently parsing it one way
 * is worse than asking for a month name or ISO order.
 */

const DATE_FORMATS = ['yyyy-MM-dd', 'd MMM yyyy', 'd MMMM yyyy', 'MMM d, yyyy', 'MMMM d, yyyy', 'MMM d yyyy', 'MMMM d yyyy', 'd-MMM-yyyy']

const TIME_FORMATS = ['HH:mm', 'H:mm', 'h:mm a', 'h:mma', 'ha']

/** Title-cases each word so "19 feb 1991" matches Luxon's "MMM" token, which expects "Feb". */
function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Parses free-text date input, returns 'yyyy-MM-dd' or null if unparseable. */
export function parseFreeDate(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  for (const candidate of [trimmed, titleCase(trimmed)]) {
    for (const fmt of DATE_FORMATS) {
      const dt = DateTime.fromFormat(candidate, fmt, { zone: 'utc' })
      if (dt.isValid) return dt.toFormat('yyyy-MM-dd')
    }
  }
  return null
}

/** Parses free-text time input (24h or 12h with am/pm), returns 'HH:mm' (24h) or null. */
export function parseFreeTime(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  for (const candidate of [trimmed, trimmed.toUpperCase(), trimmed.toLowerCase()]) {
    for (const fmt of TIME_FORMATS) {
      const dt = DateTime.fromFormat(candidate, fmt, { zone: 'utc' })
      if (dt.isValid) return dt.toFormat('HH:mm')
    }
  }
  return null
}

/** Normalized 'yyyy-MM-dd' -> the reference placeholder style, e.g. "19 Feb 1991". */
export function formatDateForDisplay(isoDate: string): string {
  const dt = DateTime.fromFormat(isoDate, 'yyyy-MM-dd', { zone: 'utc' })
  return dt.isValid ? dt.toFormat('d MMM yyyy') : isoDate
}
