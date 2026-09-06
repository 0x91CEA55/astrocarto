# poc/reference/

Working demos. Not built, not imported. Open directly in a browser.

| file | what it is for |
|---|---|
| `void-components.html` | **primary.** Full state machine: ENTRY birth input, reveal, FIELD, PLACE sheet with live Wikipedia, DERIVATION, precision drawer. Aesthetic and component layout. |
| `time-scrubber.html` | Live recomputation, rising-sign cusp warning, whole-sign houses, bloom-off-while-scrubbing. |
| `style-exploration.html` | Rejected directions, kept for contrast only. v3 Void was chosen; v2 and v4 were not. |

All three hand-roll the orthographic projection because they have no bundler.
**The app must use `d3-geo`** — see UX-SPEC §4.

## Interaction bugs these files already solve

Three failure modes, all of which look like "nothing happened" rather than an
error. Ported code should keep the fixes.

1. **Full-bleed overlay eats clicks.** The overlay layer is `pointer-events:
   none` so drags reach the globe. Any container inside it that fills the
   viewport must stay `none` too — only interactive leaves opt back in. Giving
   a full-height flex/grid wrapper `pointer-events: auto` silently swallows
   every click meant for the globe.

2. **`setPointerCapture` on pointerdown kills child clicks.** Capturing on the
   SVG root retargets the synthesised `click` to the root, so `onclick` on a
   label never fires. Capture only after movement passes a threshold.

3. **Redrawing on pointerup detaches the click target.** A full SVG teardown
   between `pointerdown` and `click` removes the node the click was heading
   for. Only redraw if the pointer actually moved.

Add a click test for every control that sits over the sphere.
