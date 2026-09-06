# NEW-FEATURE.md

Draft. High-level only — scoped from a conversation, not yet a build-ready
spec. Companion to ENGINE-SPEC.md (owns scoring) and UX-SPEC.md (owns
presentation); this feature touches both and should eventually be folded
into them rather than live here permanently.

---

## 1. What it is

De-dup (`rankCities`, `DEDUP_RADIUS_KM=300`) collapses geographically close,
similarly-scoring cities into one representative per cluster, chosen by
score with a population tiebreak on near-ties. That representative is
correct by the score, but "highest score × population" is not the same
signal as "the name a human would recognize" — Oxnard (pop. 202k, scores
highest in its cluster) beats Santa Barbara (pop. 88k, world-famous) purely
because Oxnard is closer to the actual line and bigger. The chosen label
undersells the cluster.

Three pieces, independent of each other:

1. A **recognizability signal** (Wikipedia pageviews) that picks which
   city's *name* represents a cluster — never the score itself.
2. **Cluster disclosure** in the PLACE sheet: when a marker represents a
   merged cluster, list what got merged and each member's distance.
3. **Zoom-and-scatter**: tapping a cluster pin zooms the globe in on that
   region and separates the merged cities into their own visible markers,
   each showing its own distance to the line.

The honest framing driving all three: for a case like this, the answer
isn't a city, it's a stretch of coast (Ventura/Oxnard/Santa Barbara/Goleta
are one result on one line). Picking a single name is a display
convention, not a finding — the product should be able to say so.

---

## 2. Why — the concrete case

Ottawa 19 Feb 1991 22:45 chart, Love theme, Venus-DC line. Distance from
the actual line (verified independently, this session):

| city | pop. | km from line | notes |
|---|---|---|---|
| Ventura | 96,769 | 5.2 | |
| Oxnard | 207,254 | 15.5 | current label — highest score×population in cluster |
| Santa Barbara | ~88,000–91,842 (source figures disagree) | 31.2 | ~6x farther from the line than Ventura |
| Goleta | ~32,690 (reported, unverified) | ~43 (reported, unverified) | also inside the cluster |

All four fall within a de-dup cluster. Santa Barbara isn't dropped by a
bug — it's a real, if modest, quality gap on the actual astrocartography
(see prior turn's analysis), *and* it's inside the de-dup radius regardless.
Both reasons point the same way: correct math, unhelpful label.

**Unverified, reported by another session (Claude Desktop), not confirmed
here — validate before relying on these:**
- 2025 Wikipedia pageview counts: Oxnard 193,244; Ventura 195,554; Santa
  Barbara 468,721; Goleta 69,691; Reno 627,693.
- A claim that the de-dup radius is 120km — **wrong**, the actual value in
  `src/lib/scoring/score.ts` is `DEDUP_RADIUS_KM = 300`. Don't carry this
  number forward without re-deriving it from the real constant.

---

## 3. Scope for v1

### 3a. Recognizability signal, label selection only

- Fetch Wikipedia pageviews in the same build-time step that already
  resolves Wikidata QIDs (`scripts/resolve-wikidata.mjs`) — keyless API,
  zero runtime cost, one more number baked into the gazetteer tuple.
- **Never enters the score.** Score stays astrology × distance
  (ENGINE-SPEC §6), full stop — mixing in fame would let a place "win" for
  being well-known rather than well-aspected, which defeats the entire
  premise of the engine.
- Proposed selection rule (needs validation against real clusters before
  it's trusted): within a cluster, take every city within ~5% of the
  cluster's best score, then label with whichever of *those* has the
  highest pageviews. The 5% pre-filter is what stops a low-scoring but
  famous city (the fragment's example: "Reedley labelled Fresno") from
  winning the label just for being famous — it still has to be a real
  contender on the astrology first.

### 3b. PLACE sheet cluster disclosure

- When a marker/label represents a merged cluster (not just one isolated
  city), the sheet should list the other cluster members with their
  distance (to the line, and/or to the labeled city).
- Requires *keeping* the cluster membership that `applyRankingRules`
  currently computes and discards during the de-dup skip — the skipped
  candidates need to be retained per accepted city, not just dropped.

### 3c. Zoom-and-scatter interaction

- Tapping a cluster pin zooms the orthographic globe in on that region
  (scale the projection radius up around the target) and separates the
  cluster's members into their own visible, individually-labeled markers.
- Cheap in principle: cluster membership is already computed by 3b's data,
  each member already has (or can cheaply compute) its own distance to the
  line, and orthographic zoom is just a radius/scale change on the existing
  projection — no new projection math.
- **Known blocker:** `world-atlas` at 110m resolution is too coarse for a
  ~100km-radius view — a coastline like Santa Barbara's would render as
  2-3 straight segments, breaking the illusion at exactly the moment the
  feature is trying to teach something. Two options, undecided: accept the
  abstraction (arguably defensible in Void's aesthetic, which already
  favors abstraction over photorealism), or conditionally fetch a finer
  (50m) coastline dataset only once zoomed past some threshold.

---

## 4. Out of scope for v1

- Recognizability/pageviews influencing the score in any way.
- Changing `DEDUP_RADIUS_KM` or the near-tie population rule themselves —
  this feature is about what's *displayed* once de-dup has already run,
  not about re-tuning de-dup.
- A general "fame" ranking system beyond the single label-selection rule
  above.

---

## 5. Open questions before this becomes a real spec

- Does the "top 5% of cluster's best score" band actually produce sensible
  labels across a range of real charts/themes, or does it need tuning?
  Untested — the only case examined so far is this one Love/Venus-DC
  cluster.
- Exact UI for zoom-and-scatter: does it replace FIELD, layer over it as a
  sheet, or become a new state? Not designed.
- Confirm the pageview numbers and API endpoint independently before
  building against them — they're relayed from another session, not
  verified here.
