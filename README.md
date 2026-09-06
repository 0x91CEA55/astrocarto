# astrocarto

Astrocartography SPA. Birth data → planetary lines on a world map, three
theme overlays, all computed client-side (nothing leaves the browser).
Deployed to GitHub Pages via Actions.

Spec lives in `poc/` — start there, not here. `poc/README.md` and
`poc/reference/README.md` index it. In short:

- `poc/ENGINE-SPEC.md` — computation. Owns math, houses, scoring.
- `poc/UX-SPEC.md` — presentation. Owns the "Void" globe-as-product design.
- `poc/reference/void-components.html` — primary UX reference, working code.
- `poc/reference/time-scrubber.html` — scrubber/teaching reference, working code.
- `poc/reference/style-exploration.html` — rejected direction, contrast only, do not port.
- `poc/astrocarto.py` + `poc/golden.json` — Swiss Ephemeris oracle + conformance fixture.

**The app is mid-rewrite.** What's in `src/` today predates the current
`poc/` specs (an earlier, more verbose spec generation). Do not extend the
current UI — it's being replaced. Delta as of last survey:

## Keep, don't touch

- `src/lib/astro/*` — time/ephemeris/lines/dignity core. 318/318 conformance
  tests green against `golden.json`. Extend for ASC/MC/houses; don't rewrite.
- `src/lib/gazetteer/cities.ts`, `src/lib/geo/timezone.ts` — untouched by
  either spec.
- `scripts/build-weights.mjs` + `src/lib/scoring/score.ts` — already matches
  ENGINE §6 (negative weights for malefics already present in `BASE`, e.g.
  Saturn `-0.8` in love). No restructuring needed.
- `src/lib/share.ts` — URL-fragment encode/decode is the right data format;
  only the render target changes (SVG → canvas export for SHARE state).

## Replace

- `src/lib/map/palette.ts` — wrong hex values. Copy UX §3's table verbatim
  (also present as CSS custom properties in `poc/reference/void-components.html`).
- `src/components/WorldMap.tsx` — flat `geoEquirectangular` + per-cell `<rect>`
  raster heat. UX §4 requires `geoOrthographic().rotate().clipAngle(90)`, drag
  (0.35°/px, pitch ±80°), fly-to (900ms cubic, pitch = lat×0.6), heat as one
  blurred stroke on the top line (no raster — doesn't work on a sphere),
  labels capped at 4 with collision-dodge.
- `src/App.tsx` — card/checkbox layout, everything visible at once. UX §2
  requires a single-route state machine: ENTRY → RESOLVING → FIELD ⇄
  PLACE/DERIVATION/SHARE, globe persistent, never replaced.

## Add (doesn't exist yet)

- ASC/MC closed-form + whole-sign houses + aspects (ENGINE §5 — formulas
  given, verified to Swiss to sub-arcsecond).
- Wikipedia content pipeline: build-time GeoNames → Wikidata QID resolution
  into the gazetteer tuple (not a parallel file), runtime `page/summary`
  fetch (UX §7). Never name-match at runtime.
- Precision drawer, derivation drilldown, time/latitude scrubbers (port from
  `poc/reference/time-scrubber.html`), canvas share export, bottom-pinned
  theme switcher (UX §6, §8, §10).

## Known unsound — fix, don't just port around it

- `src/lib/astro/ephemeris.ts` `isRetrograde()` — 0.5-day finite difference is
  below the ephemeris's own ±1 arcmin error bound for every outer body. Reads
  noise. Conformance suite carries `retrograde`/`dignity` in the fixture but
  doesn't assert either — that's how this survived 318 green tests. Fix
  detection or drop the flag; either way, add the assertion.

## Open, blocking — resolve before building FIELD layout

- Mobile: does the page scroll at all, or do sheets fully replace scrolling
  (UX §12)? Building FIELD twice is the cost of guessing wrong.
- Voice typeface: reference files use proprietary Optima; most users get
  Palatino fallback, heavier than the screenshots suggest (UX §3).

## Interaction bugs already solved in the reference files — keep the fixes when porting

From `poc/reference/README.md`, all three look like "nothing happened" bugs:

1. Full-bleed overlay must be `pointer-events: none`; only interactive leaves
   opt back in with `pointer-events: auto`.
2. Don't call `setPointerCapture` on `pointerdown` — it retargets the
   synthesized `click` and kills child `onclick`. Capture only after a
   movement threshold.
3. Don't redraw the SVG on `pointerup` before `click` fires — it detaches the
   click's target node. Only redraw if the pointer actually moved.

## Commands

```
npm test      # conformance suite (318 cases, golden.json oracle)
npm run dev
npm run build # tsc -b && vite build
npm run lint  # oxlint, not eslint
```
