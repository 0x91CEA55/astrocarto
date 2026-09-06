# Astrocartography web app — build spec

Handoff brief. Reference implementation is `astrocarto.py`; conformance oracle is
`golden.json`. Port the math, don't reinvent it.

## Goal

Static React app on GitHub Pages. User enters birth date/time/place, app renders
a world map of astrocartography lines plus scored "hotspot" overlays for
love / career / harmony themes.

**Hard constraint: no backend.** Birth data never leaves the browser. This is a
product decision, not just an architectural one — it's the differentiator versus
every other site in this category.

## Stack decisions (already made — don't relitigate without a reason)

| Concern | Choice | Why |
|---|---|---|
| Ephemeris | `astronomy-engine` (MIT, ~116 KB min) | ±1 arcmin ≈ 1.8 km line error, irrelevant vs a 250 km orb. MIT avoids the Swiss Ephemeris AGPL trap. |
| Timezone | `tz-lookup` → IANA zone; `Temporal` (or Luxon) for offset | Historical DST is the #1 correctness risk. See traps below. |
| Geocoding | Bundled GeoNames `cities15000` (CC-BY, ~1 MB gz) | Doubles as the proximity gazetteer. No API key, no rate limit. |
| Map | `d3-geo` + `world-atlas` topojson | Reference impl emits GeoJSON LineStrings; d3 projects them and handles the antimeridian. |
| Build | Vite + React + TS | — |

Swiss Ephemeris WASM is the fallback **only** if asteroid points (Juno, Chiron)
become a requirement. It pulls in AGPL-3.0/GPL-3.0. Decide before writing code,
not after.

`astronomy-engine` has no lunar node body — compute the mean node analytically
(low-order polynomial in T) or drop it from v1.

## The math contract

Everything below is closed-form and deterministic. Port it exactly.

```
UT anchor:  local datetime + IANA zone -> UTC -> Julian Day
GST:        Greenwich apparent sidereal time, in DEGREES (sidereal hours × 15)

For body with right ascension α and declination δ, at latitude φ:

  MC line:  λ = wrap180(α − GST)                    [constant — vertical]
  IC line:  λ = wrap180(α + 180 − GST)              [constant — vertical]

  c = −tan(φ)·tan(δ)
  if |c| > 1 -> no line at this latitude (circumpolar; body never rises/sets)
  H = acos(c)                                        [degrees]
  AC line:  λ = wrap180(α − H − GST)
  DC line:  λ = wrap180(α + H − GST)
```

`wrap180(x) = ((x + 180) mod 360) − 180`.

**Line definition note:** this is the *in-mundo* convention — the physical body
on the horizon. Some astrology software uses the zodiacal-ASC convention instead
(planet's ecliptic longitude equal to the rising degree); curves diverge by
several degrees at high latitude. Neither is "correct." Pick in-mundo, state it
in the UI, and don't let a bug report talk you out of it.

## Conformance testing

`golden.json` holds 6 birth cases × 44 lines × 9 sampled latitudes = 2376
reference longitudes, plus RA/Dec/ecliptic longitude per body.

Write a test that reproduces these in JS. Tolerances:

- `jd_ut` — exact to 1e-6 days (this is pure arithmetic; any drift means a
  timezone bug, not an ephemeris bug — check that first)
- `ra` / `dec` — within 0.017° (1 arcmin, astronomy-engine's stated bound)
- line longitudes — within 0.05°

The cases are chosen to be traps. Verify UTC conversion **before** blaming the
ephemeris:

| Case | Trap |
|---|---|
| `london_1969` | UK ran UTC+1 year-round 1968–71. Naive "London = GMT" gives 09:15 UTC; correct is 08:15. |
| `nyc_1954_dst` | Pre-1966 US DST was set locally, not federally. tzdata has it; hand-rolled offset tables don't. |
| `berlin_1945` | Wartime summer time, UTC+2. |
| `reykjavik_hi` | UTC+0 year-round, no DST — and high latitude, so several lines go circumpolar and must return `null`, not `NaN`. |
| `sydney_2001` | Southern-hemisphere DST; local date and UTC date differ. |

If `reykjavik_hi` produces numbers where `golden.json` has `null`, the `|c| > 1`
guard is missing. That's the most common port bug.

## Scoring layer

"Best place for love" is a scoring function over a raster, not an AI call.

Precompute per latitude row, not per cell — 180 rows × 44 lines ≈ 8k evaluations
instead of 65k × 44:

```
rows[lat] = lines.map(l => ({...l, lon: lineLongitude(l, lat, gst)}))

score(lat, lon, theme) = Σ over lines:
    w      = WEIGHTS[theme][line.key]            // 0 if absent
    km     = |wrap180(line.lon − lon)| · 111.32 · cos(lat)
    fall   = exp(−(km / SIGMA)²)                 // SIGMA ≈ 200 km
    dig    = DIGNITY_MULT[line.body]             // exalted 1.3, fall 0.7, ...
    += w · fall · dig
```

Negative weights for malefics on the same angle are what make this work — a
strong benefic with nothing hostile nearby outscores a strong benefic sitting
next to Pluto. That "clean line" judgment reads as interpretation but is just
subtraction.

Then: rank gazetteer cities by score, render top N as markers, and draw the
raster as a heat overlay.

Ship `SIGMA` and the weight tables as a single JSON config. They're conventions,
not facts, and you will want to tune them without a rebuild.

## Interpretation copy

A 44-cell `body × angle -> phrase` lookup plus templated text covers most of what
reads as insight. Build that first. Do not put an LLM behind a table lookup.

If an LLM layer is added later it is the **only** component that needs a server,
because the key can't ship in a static bundle. Keep it a thin proxy that receives
already-computed lines and returns prose — never raw birth data, never
server-side computation. A Cloudflare Worker fits better than Lambda here (no
cold start, free tier likely covers it).

## v1 scope

1. Birth input form with city autocomplete + manual lat/lon/tz override
2. Line computation + conformance tests green against `golden.json`
3. Map with all 44 lines, toggleable by body
4. Three theme overlays + top-10 city list per theme
5. Templated copy per hit
6. Shareable URL (encode birth data in the fragment, `#`, so it never hits a
   server log — query strings get logged, fragments don't)

Explicitly out of scope for v1: asteroids, relocated charts, transits, accounts.
