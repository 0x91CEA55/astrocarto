# poc/

Reference material. Not built, not imported by the app.

| file | owns |
|---|---|
| `ENGINE-SPEC.md` | computation — ephemeris, lines, chart, houses, scoring, conformance |
| `UX-SPEC.md` | presentation — Void aesthetic, states, components, copy rules |
| `astrocarto.py` | Python reference implementation (Swiss Ephemeris); oracle for `golden.json` |
| `golden.json` | conformance fixture — 6 births x 44 lines x 9 latitudes |
| `golden-chart.json` | second conformance fixture (pyswisseph) — ASC/MC longitude+sign+house, per-body sign/house/retrograde/signed speed. Joined to `golden.json` by case name for birth lat/lon/tz; carries no location fields of its own. |
| `reference/` | working HTML demos; see its own README |

The two specs do not overlap. Decisions that span both are stated once and
cross-referenced: the whole-sign house choice lives in ENGINE §5, its
consequence for copy in UX §13.

Reference HTML hand-rolls the orthographic projection because it has no
bundler. **The app uses `d3-geo`** — UX §4.

## Open

- **Voice typeface** — UX §3. Reference files use Optima, which is proprietary;
  most users see the heavier Palatino fallback. Not blocking; not yet resolved.

## Resolved

- **Mobile layout** — UX §12. No scroll on any viewport; lines capped to the
  active theme's top 8 by weight. Verified at 380×780 with a live browser run.
- **Retrograde detection** — ENGINE §3. Was a 0.5-day finite difference sitting
  below the ephemeris's own error bound (it read noise, not motion) — now an
  analytic ecliptic-longitude rate from the geocentric state vector. Verified
  against `golden-chart.json`'s per-body `speedDegPerDay`, including
  `sydney_2001`'s Jupiter, a real station at −0.000339°/day — the one case
  where a sign or unit error in the analytic method would actually show.
  `src/lib/astro/conformance-chart.test.ts`.
