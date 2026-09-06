# poc/

Reference material. Not built, not imported by the app.

| file | owns |
|---|---|
| `ENGINE-SPEC.md` | computation — ephemeris, lines, chart, houses, scoring, conformance |
| `UX-SPEC.md` | presentation — Void aesthetic, states, components, copy rules |
| `astrocarto.py` | Python reference implementation (Swiss Ephemeris); oracle for `golden.json` |
| `golden.json` | conformance fixture — 6 births x 44 lines x 9 latitudes |
| `reference/` | working HTML demos; see its own README |

The two specs do not overlap. Decisions that span both are stated once and
cross-referenced: the whole-sign house choice lives in ENGINE §5, its
consequence for copy in UX §13.

Reference HTML hand-rolls the orthographic projection because it has no
bundler. **The app uses `d3-geo`** — UX §4.

## Open, blocking

- **Mobile layout** — UX §12. Decides whether the page scrolls at all and how
  line density is capped. Building FIELD before this means building it twice.
- **Voice typeface** — UX §3. Reference files use Optima, which is proprietary;
  most users see the heavier Palatino fallback.

## Known unsound

- **Retrograde detection** — ENGINE §3. A 0.5-day finite difference sits below
  the ephemeris error bound for every outer body. It reads noise. The
  conformance fixture already carries `retrograde` and `dignity`; the suite
  ignores both, which is how this survived 318 green tests.
