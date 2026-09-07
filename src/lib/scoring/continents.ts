/**
 * Static ISO-3166-1 alpha-2 country code -> macro-region lookup, used by
 * `applyRankingRules`'s region-diversity quota (score.ts).
 *
 * This exists because the earlier approach — dynamically clustering nearby
 * candidates by great-circle distance (single-linkage/transitive, so one
 * continent-spanning astrocartography curve wouldn't be miscounted as
 * several regions) — has a fatal flaw at world scale: with a radius wide
 * enough to hold one curve's continent-spanning extremes together (~5000km),
 * and a dense-enough set of candidates (one per ~300km bucket across the
 * whole ~34k-city gazetteer, ~1000 of them), single-linkage chaining welds
 * the *entire inhabited world* into one region. Verified empirically: every
 * one of 1007 de-duped candidates for a real chart, from China to Argentina
 * to Ghana to Canada, ended up in one single group — islands and coastlines
 * bridge every landmass within a few-thousand-km hop. That silently made the
 * region cap a no-op (capping "the one region" just reduces to plain global
 * score order, which is the exact bug this was built to prevent).
 *
 * A static classification has no such failure mode: a city's region doesn't
 * depend on which other candidates happen to exist for this chart, so it
 * can't chain. Precision at fuzzy transcontinental borders (Russia, Turkey,
 * the Americas' land bridge) doesn't matter for this purpose — the goal is
 * "don't let one broad swath of the world monopolize the list," not a
 * geopolitically precise atlas.
 */
export type MacroRegion = 'Africa' | 'Asia' | 'Europe' | 'North America' | 'South America' | 'Oceania' | 'Antarctica' | 'Other'

const AFRICA: readonly string[] = [
  'DZ', 'AO', 'BJ', 'BW', 'IO', 'BF', 'BI', 'CV', 'CM', 'CF', 'TD', 'KM', 'CG', 'CD', 'CI', 'DJ', 'EG', 'GQ', 'ER',
  'SZ', 'ET', 'GA', 'GM', 'GH', 'GN', 'GW', 'KE', 'LS', 'LR', 'LY', 'MG', 'MW', 'ML', 'MR', 'MU', 'YT', 'MA', 'MZ',
  'NA', 'NE', 'NG', 'RE', 'RW', 'SH', 'ST', 'SN', 'SC', 'SL', 'SO', 'ZA', 'SS', 'SD', 'TZ', 'TG', 'TN', 'UG', 'EH',
  'ZM', 'ZW',
]

const ASIA: readonly string[] = [
  'AF', 'AM', 'AZ', 'BH', 'BD', 'BT', 'BN', 'KH', 'CN', 'CY', 'GE', 'HK', 'IN', 'ID', 'IR', 'IQ', 'IL', 'JP', 'JO',
  'KZ', 'KP', 'KR', 'KW', 'KG', 'LA', 'LB', 'MO', 'MY', 'MV', 'MN', 'MM', 'NP', 'OM', 'PK', 'PS', 'PH', 'QA', 'SA',
  'SG', 'LK', 'SY', 'TW', 'TJ', 'TH', 'TL', 'TR', 'TM', 'AE', 'UZ', 'VN', 'YE',
]

const EUROPE: readonly string[] = [
  'AL', 'AD', 'AT', 'BY', 'BE', 'BA', 'BG', 'HR', 'CZ', 'DK', 'EE', 'FO', 'FI', 'FR', 'DE', 'GI', 'GR', 'GG', 'VA',
  'HU', 'IS', 'IE', 'IM', 'IT', 'JE', 'XK', 'LV', 'LI', 'LT', 'LU', 'MT', 'MD', 'MC', 'ME', 'NL', 'MK', 'NO', 'PL',
  'PT', 'RO', 'RU', 'SM', 'RS', 'SK', 'SI', 'ES', 'SJ', 'SE', 'CH', 'UA', 'GB', 'AX',
]

const NORTH_AMERICA: readonly string[] = [
  'AI', 'AG', 'AW', 'BS', 'BB', 'BZ', 'BM', 'BQ', 'VG', 'CA', 'KY', 'CR', 'CU', 'CW', 'DM', 'DO', 'SV', 'GL', 'GD',
  'GP', 'GT', 'HT', 'HN', 'JM', 'MQ', 'MX', 'MS', 'NI', 'PA', 'PR', 'BL', 'KN', 'LC', 'MF', 'PM', 'VC', 'SX', 'TT',
  'TC', 'US', 'VI',
]

const SOUTH_AMERICA: readonly string[] = ['AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'FK', 'GF', 'GY', 'PY', 'PE', 'SR', 'UY', 'VE']

const OCEANIA: readonly string[] = [
  'AS', 'AU', 'CC', 'CX', 'CK', 'FJ', 'PF', 'GU', 'KI', 'MH', 'FM', 'NR', 'NC', 'NZ', 'NU', 'NF', 'MP', 'PW', 'PG',
  'PN', 'WS', 'SB', 'TK', 'TO', 'TV', 'VU', 'WF',
]

const ANTARCTICA: readonly string[] = ['AQ', 'TF', 'GS', 'BV', 'HM']

const CONTINENT_BY_COUNTRY: Record<string, MacroRegion> = {}
for (const code of AFRICA) CONTINENT_BY_COUNTRY[code] = 'Africa'
for (const code of ASIA) CONTINENT_BY_COUNTRY[code] = 'Asia'
for (const code of EUROPE) CONTINENT_BY_COUNTRY[code] = 'Europe'
for (const code of NORTH_AMERICA) CONTINENT_BY_COUNTRY[code] = 'North America'
for (const code of SOUTH_AMERICA) CONTINENT_BY_COUNTRY[code] = 'South America'
for (const code of OCEANIA) CONTINENT_BY_COUNTRY[code] = 'Oceania'
for (const code of ANTARCTICA) CONTINENT_BY_COUNTRY[code] = 'Antarctica'

/**
 * Falls back to 'Other' for an unrecognized/territory code rather than
 * throwing — still a valid, stable bucket for grouping purposes.
 *
 * Russia gets a longitude split at the Urals (~60°E, the conventional
 * Europe/Asia divide) instead of one blanket label. Without it, a Far-East
 * Siberian city (Amur Oblast, genuinely ~2000km from China — the same East
 * Asian swath a line crosses) would count as a *different* macro-region from
 * China purely on a political label, undermining the reason this
 * classification exists in the first place — verified live: two Amur Oblast
 * cities sat right alongside Jinan/Changsha in one real chart's top 10, and
 * a blanket "Russia = Europe" label would have let them masquerade as a
 * second, distinct region instead of the same swath China already occupies.
 */
export function macroRegion(countryCode: string, lon?: number): MacroRegion {
  if (countryCode === 'RU' && lon !== undefined) return lon < 60 ? 'Europe' : 'Asia'
  return CONTINENT_BY_COUNTRY[countryCode] ?? 'Other'
}
