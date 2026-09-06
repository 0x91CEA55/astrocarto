# UX-SPEC.md

Presentation only. Pairs with `ENGINE-SPEC.md`, which owns all computation.

Reference builds in `reference/` — working code, read before building:

| file | what to take from it |
|---|---|
| `void-components.html` | **primary.** Full state machine, birth input, place sheet with live Wikipedia, derivation, precision drawer, tokens, label dodging, fly-to |
| `time-scrubber.html` | live recomputation, cusp warning, whole-sign houses, bloom-off-while-scrubbing |
| `style-exploration.html` | rejected directions, contrast only |

`reference/README.md` lists three interaction bugs these files already solve.
All three present as "nothing happened" rather than an error.

---

## 1. Principle

The globe is the product. Present from first paint to last, never replaced,
never scrolled past. Everything else surfaces over it and dissolves.

No panels beside the globe. No cards. No dashboard. No flat map.

Counter-pressure: the differentiator is that the maths is real and tested. Void
defers precision, never hides it — always one gesture away, never in the way.

---

## 2. States

Single route.

```
ENTRY ──▶ RESOLVING ──▶ FIELD ⇄ PLACE
            ▲             │  ▲
            │             ├──┴──▶ DERIVATION
            └── edit ─────┤
                          └─────▶ SHARE
```

| state | what it is |
|---|---|
| ENTRY | globe drifting, no lines, three inputs floating over it |
| RESOLVING | the reveal (§5) |
| FIELD | lines drawn, globe centred on top-scoring place, ≤4 labels, headline + one paragraph, theme switcher |
| PLACE | a label or list row tapped → sheet with location detail |
| DERIVATION | a claim tapped → the globe explains it |
| SHARE | export render |

---

## 3. Tokens

### Ground

```
--void-bg     #020308
--void-sea    #04050C
--void-land   rgba(120,110,180,.07)
--void-coast  rgba(150,140,215,.15)
--void-grat   rgba(140,130,200,.055)
--void-limb   rgba(170,155,235,.16)
```

### Ink

```
--ink-hi     #F6F2FF   headline
--ink-mid    #B9B3D4   body
--ink-lo     #8F87B4   secondary
--ink-faint  #6F678F   inactive
--ink-warn   #F0C244   a value about to change
```

### Planet identity — constant everywhere, export included

```
Sun     #F0C244     Jupiter  #C87A2E
Moon    #8FC7E8     Saturn   #7C8AA6
Mercury #B07FD4     Uranus   #4FB8A8
Venus   #E8628F     Neptune  #4A7FD4
Mars    #D9553D     Pluto    #9A6BB0
```

Never re-map per theme. **The existing `palette.ts` does not match these** —
replace it before anything renders.

### Legibility over the sphere

Text shadow alone fails at full line density. Tested. Use both:

- `text-shadow: 0 2px 40px var(--void-bg), 0 2px 14px var(--void-bg)`
- a full-viewport vertical gradient scrim above the globe, below the type
- a radial vignette beneath the globe

See `void-aesthetic.html`.

### Type

Two roles:

- **Voice** — everything a human reads. Humanist, classical proportions, flared
  stems, no hard serifs. Light weight, large.
- **Data** — every number. Monospace, always `tabular-nums`.

Reference files use Optima, which is **proprietary**; most users get the
Palatino fallback, heavier and more ordinary than the screenshots suggest.
Unresolved — evaluate self-hosted alternatives against the real headline string.

No all-caps sentences. No single-word accents in headlines.

---

## 4. Globe

Orthographic. Use `d3-geo`: `geoOrthographic().rotate([-lon, -lat]).clipAngle(90)`
with `geoPath`. Do not hand-roll — the reference files do only because they run
over `file://` with no bundler.

`clipAngle(90)` handles hemisphere and antimeridian clipping properly.

| behaviour | value |
|---|---|
| drag | 0.35°/px, pitch clamped ±80°, `touch-action: none` |
| fly-to | 900 ms, cubic in-out; longitude takes the short way; **target pitch = lat × 0.6**, not lat |
| idle drift | ENTRY only, stops permanently on first interaction |

Heat: a single wide blurred stroke along the highest-weighted line, beneath the
crisp strokes. Not a cell raster — rect-per-cell does not work on a sphere.

**Labels**: max 4. Drop hidden ones, sort by y, push apart to a 17px minimum
gap, draw a leader line when moved. Labels *are* the ranked list — tapping
enters PLACE.

**Two things that break label taps**, both silent:

- `setPointerCapture` on `pointerdown` retargets the synthesised `click` to the
  SVG root, so a child handler never fires. Capture only after movement passes a
  threshold.
- Redrawing on `pointerup` detaches the node the click was heading for. Only
  redraw if the pointer actually moved.

---

## 5. Reveal

Computation is ~50 ms. The reveal is 3.2 s. The gap is the product.

| t | |
|---|---|
| 0.0 | inputs fade out |
| 0.4 | globe eases to a stop, graticule brightens |
| 0.8 | lines draw on over 1.6 s, staggered |
| 1.6 | heat band fades in beneath |
| 2.4 | globe flies to the top place |
| 2.9 | labels fade in, staggered |
| 3.2 | headline and paragraph rise and fade in |

No spinner, no progress bar. Cut to ~1.2 s on repeat within a session.

`prefers-reduced-motion` → 200 ms cross-fade to FIELD. Not a slower sequence.

---

## 6. Components

### Birth input

Not a modal, not a tab. A modal kills the globe; a tab implies birth data is a
destination rather than the premise.

Progressive, live on the globe:

1. **Place** — globe flies there, drops a marker. Payoff before submit.
2. **Date** — nothing moves. Honest.
3. **Time** — last; committing fires RESOLVING.

The ordering teaches that time locks the chart.

After the reveal, collapses to one tappable line in the data face
(`Ottawa · 19 Feb 1991 · 22:45`). Tapping reopens the fields **in place** —
globe dimmed, lines up. Changing a value **animates lines to new positions**
rather than tearing down. §8 depends on this.

Unknown birth time is a first-class option, not an error.

### Sheet

One component, four uses: ranked places, place detail, derivation, precision.

Rises from the bottom, ~320 ms. Height content-driven, capped ~62vh so the globe
is never fully covered. Backdrop is a gradient to `--void-bg`, not a flat scrim.
Dismiss by swipe, tap-outside, or Escape.

**Only interactive leaves get `pointer-events: auto`.** The overlay layer is
`pointer-events: none` so drags reach the globe. Any container inside it that
fills the viewport must stay `none` as well — giving a full-height wrapper
`auto` silently swallows every click meant for the sphere. Grant it to buttons,
inputs, and links, never to layout containers.

Add a click test for every control over the sphere. This class of bug looks like
nothing happened, not like a failure.

### Precision drawer

One small control, bottom-left. Opens a sheet with GST, and per body: RA, dec,
sign, whole-sign house, dignity, retrograde. Globe stays live and draggable.

Plus one provenance line:

```
ORTHOGRAPHIC · IN MUNDO · WHOLE-SIGN · OTTAWA 45.42N 75.70W · 1991-02-20 03:45 UT
```

Exists so a sceptic can find the seams. Do not style it as decoration.

### Theme switcher

Three targets pinned to the bottom edge. Switching re-scores, flies the globe to
the new top place, redraws lines.

---

## 7. Places

Sheet contents: nearby lines with distances, the score breakdown (engine exposes
the largest contributor), and editorial context.

### Content pipeline

Wikipedia REST, no key:
`https://en.wikipedia.org/api/rest_v1/page/summary/{title}` → description,
extract, thumbnail, canonical URL. Action API fallback needs `&origin=*` for
CORS.

**Do not match by name at runtime.** GeoNames name → Wikipedia title is fuzzy
and returns confidently wrong articles ("Kingston" is Jamaica, Ontario, New
York, upon-Thames). Resolve GeoNames → Wikidata QIDs **at build time**, into the
existing gazetteer tuple, not a parallel file. Runtime becomes an exact lookup.

### Constraints

- Wikipedia text is CC BY-SA. Attribution and link are mandatory.
- Thumbnails ~320px, too small for a hero — `/page/media-list/` gets larger.
  Many small towns have no image; that state is common, not an edge case.
- **Duotone every image** into the theme accent hue. Untreated stock photos
  fight Void and read as pasted on.

### Privacy

Birth data never leaves the browser. A Wikipedia fetch does reveal which city
was tapped. Copy must say "your birth data never leaves your browser," not
anything absolute. Prefetching the top six at reveal blurs the signal.

---

## 8. Teaching

No Learn section — nobody opens it. Teaching is drilldown, on the globe.

### Tappable derivations

Every assertion in the copy is a target. Tapping dims the globe, draws the
geometry, shows one short paragraph.

| claim | globe shows |
|---|---|
| "Venus exalted in Pisces" | zodiac ring, Venus's position, what exaltation is |
| "on the descendant" | horizon plane at birth, the body setting |
| "5 km from Ventura" | orb circle at true scale |
| "Scorpio rising" | eastern horizon, ascending degree marked |

### Scrubbers

`time-scrubber.html` is a working implementation.

**Time**, ±90 min. Lines, ASC, MC, houses recompute live. Sun and Moon barely
move; the rising sign can change in two minutes. That contrast is the lesson.

**Cusp warning**: whenever the rising sign is within 6 minutes of changing, turn
the value `--ink-warn` and state it — *"2 minutes earlier and the rising sign is
Libra."* Cusp charts are common; users deserve to know theirs is fragile.

**Latitude**, secondary. AC/DC curves flatten toward the equator and go
circumpolar near the poles.

### Honest frame

State somewhere readable that the geometry is exact to the arcsecond and the
meanings are a tradition. Show the line formula in DERIVATION. Nobody else in
this category does this.

---

## 9. Empty states

**The water case is the most important screen.** ~71% of Earth is ocean; for a
real share of users a theme's best line lands in open sea.

Do not show an empty list, an unnamed marker on water, or the nearest city
presented as if it scored. Hold the globe on the ocean crossing, say the lines
fall over water, offer nearest land crossings with their real, worse scores,
labelled as such.

| state | handling |
|---|---|
| unknown birth time | first-class; MC/IC unusable, AC/DC shift — say so, render what survives, mark partial, route to the time scrubber |
| rising sign near cusp | surface unprompted within 6 min |
| location not found | manual lat/lon/tz. Never a dead end |
| DST gap | name the hour that doesn't exist in that zone |

---

## 10. Share

Void render, not a light plate. Globe centred on the user's place, lines at full
bloom, place name and one birth-data line in the voice face. Client-side canvas,
nothing leaves the browser.

Birth data in the **URL fragment**, never the query string. Fragments don't
reach server logs.

---

## 11. Performance

Measured, not assumed.

- **Line recomputation per frame is free** (~40 lines × ~113 latitude samples).
  Real-time scrubbing is viable; don't precompute frames.
- **Bloom is not free.** `feGaussianBlur` + `feMerge` re-rasterises every frame
  and stutters. Disable while dragging, scrubbing, or flying; restore on settle.
- Lazy-load `tz-lookup` and the gazetteer behind the form.
- Budget: first paint < 1.5 s on mid-range mobile over 4G; 50 fps while dragging.

---

## 12. Mobile — unresolved, blocking

Two decisions before layout:

1. **Drag vs scroll.** The page likely must not scroll at all; sheets replace
   scrolling. Confirm first.
2. **Line density.** 44 lines at 380px is unreadable. Options: cap to the active
   theme (~8 lines), thin strokes below 600px, or drop malefics from display
   while keeping them in the score. Prefer the first.

Test at 380×780 before anything is called done.

---

## 13. Voice

Second person, present tense, plain verbs. The subject is charged; the prose
stays calm. State the claim and its basis together.

- Never "destiny."
- **Never route MC copy through "the tenth house."** Under whole-sign the MC is
  in house 10 only ~68% of the time. Write it as the midheaven itself — the
  culminating degree, highest and most visible at birth. One voice for everyone,
  no branch in the copy engine.
- Never assert a placement is certain when the birth time is within 6 minutes of
  a boundary.
- Buttons say what happens: "Show me the map."
- Errors say what went wrong and what to do. No apologies, no vagueness.

---

## 14. Accessibility

- Everything keyboard-reachable; `:focus-visible` 2px, 3px offset. Keep the
  scrubber a native `range`.
- Provide ranked places as a semantic list in the DOM — the map must not be the
  only route to the answer.
- Honour `prefers-reduced-motion` in reveal, fly-to, sheets, scrubber redraws.
- Check `--ink-lo` and `--ink-faint` against the sphere and the lines, not
  against `--void-bg`.

---

## 15. Out of scope for v1

Accounts. Saved charts. Relocated charts. Transits. Asteroids. Synastry. A
second house system. LLM-written interpretation (v1 ships templated
`body × angle` copy). Multiple projections. Light mode.
