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
signal as "the name a human would recognize."

Three pieces, independent of each other:

1. A **recognizability signal** (Wikipedia pageviews) that picks which
   city's *name* represents a cluster — never the score itself.
2. **Cluster disclosure** in the PLACE sheet: when a marker represents a
   merged cluster, list what got merged and each member's distance. **Built
   and shipped** — commit `2150a44`.
3. **Zoom-and-scatter**: tapping a cluster pin zooms the globe in on that
   region and separates the merged cities into their own visible markers,
   each showing its own distance to the line. Not started.

The honest framing driving all three: for a case like this, the answer
isn't a city, it's a stretch of coast. Picking a single name is a display
convention, not a finding — the product should be able to say so.

---

## 2. Why — two real clusters checked, not one

**Ottawa 19 Feb 1991 22:45, Love theme, Venus-DC.** The Oxnard cluster is
bigger and stranger than it first looked. Once `clusterMembers` (3b) exposed
real numbers instead of the four coastal-city framing from the conversation
this was scoped from, it turned out the actual top-8-by-score within 300km
of Oxnard are: Visalia, Fresno, Clovis, Ventura, Tulare, Hanford, Delano,
Wasco — all Central Valley towns roughly 99–100% of Oxnard's score. **Santa
Barbara didn't make that list at all.** Checked directly: Santa Barbara
scores ~98.3% of Oxnard's — inside a reasonable "close contender" band in
isolation, but there are 8 *other* real towns in the same cluster that score
higher still. It isn't "third-best in a coastal foursome"; it's something
like ninth-or-worse in a Central-Valley-plus-coast cluster of a dozen-plus
towns, on this specific chart. The original four-city framing was wrong, not
just imprecise.

**Kamloops cluster (also Love/Venus-DC, a different part of the same line).**
Checked as a second, independent case rather than re-testing the one the
rule was designed around:

| city | score (% of Kamloops) | pageviews, Jan–Apr 2025 |
|---|---|---|
| Kamloops | 100% (3.3664) | 51,591 |
| Brocklehurst | 100.3% | 345 |
| Penticton | 92.3% | 27,621 |
| West Kelowna | 91.6% | 7,194 |
| **Kelowna** | **89.6%** | **96,449** |
| Okanagan Mission | 89.7% | — |
| Vernon | 84.0% | 28,511 |

Kelowna has ~1.9x Kamloops' pageviews but only 89.6% of its score. A rule
that only looked at pageviews would mislabel the cluster "Kelowna." A 5%
score band (95–105% of the top score) correctly excludes it — only
Brocklehurst qualifies alongside Kamloops, and Kamloops wins that pair on
pageviews trivially. **The 5% band concept holds up on a case it wasn't
designed around.**

**The real implementation gotcha, found by combining both cases:** in the
Oxnard cluster, Santa Barbara's ~98.3% *is* inside a 5% band — but the
current `clusterMembers` list is capped at `MAX_CLUSTER_MEMBERS=8` for
*display* purposes, and 8 other real candidates outscore it, so it never
appears in the capped list at all. If 3a's label rule were built directly on
top of 3b's disclosed member list, it would silently miss a legitimate
band-qualifying candidate whenever a cluster has more than 8 comparably-
scoring towns. **The label-selection candidate pool must be computed
separately from (and before) the display cap** — evaluate the score-band
filter over the full scanned set, then cap only what gets shown in the UI.

**Pageviews API — verified working, this session:**
`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/{article}/monthly/{start}/{end}`
— keyless, real, tested directly. Monthly granularity, article title must
match the Wikipedia page title exactly (already resolved at build time via
`wikiTitle` — see `scripts/resolve-wikidata.mjs`). The pageview *counts*
reported in the conversation this doc was scoped from (Santa Barbara
468,721, etc.) do not match what this endpoint returns for a similar window
(Santa Barbara: 163,204 for Jan–Apr 2025) — different absolute numbers,
likely a different date range or access-type filter upstream. The *relative
ordering* (Santa Barbara notably ahead of Oxnard/Ventura, matching the
originally reported ~2.4x) reproduced closely. Use this session's numbers
and this exact endpoint going forward; don't carry the old absolute figures
into an implementation.

---

## 3. Scope for v1

### 3a. Recognizability signal, label selection only — design updated

- Fetch pageviews at build time (same step as Wikidata QID resolution),
  bake one number into the gazetteer tuple. Confirmed feasible — see §2.
- **Never enters the score.** Unchanged from the original framing.
- **Revised selection rule** (the original version had the gap described in
  §2): compute the score-band candidate set — every city within 5% of the
  cluster's top score — over the *full* scanned candidate list (the same
  `CANDIDATE_SCAN_LIMIT`-bounded set `applyRankingRules` already sorts
  through), not over the capped `clusterMembers` display list. Label with
  whichever member of that band has the highest pageviews. `clusterMembers`
  itself can stay capped at 8 for the sheet — this is purely about which
  candidates are *eligible to win the label*, a separate, larger pool.
- Still needs: a decision on what happens when pageview data is missing for
  every candidate in the band (fall back to the current score×population
  choice, presumably) — not designed yet.

### 3b. PLACE sheet cluster disclosure — done

Shipped in commit `2150a44`. `applyRankingRules` retains suppressed
candidates as `clusterMembers` on the winning `CityScore` (capped at 8,
scanned within the existing 200-candidate limit). `PlaceSheet` shows an
"ALSO NEARBY" section listing them with distance from the labeled city,
each tappable to reopen the sheet on that city. Verified live against the
real Kamloops cluster.

### 3c. Zoom-and-scatter interaction — not started

Unchanged from the original scoping:

- Tapping a cluster pin zooms the orthographic globe in on that region and
  separates the cluster's members into their own visible, individually-
  labeled markers.
- Cheap in principle: `clusterMembers` now exists (3b), each member has its
  city coordinates already, and orthographic zoom is a radius/scale change
  on the existing projection.
- **Known blocker, still unresolved:** `world-atlas` at 110m resolution is
  too coarse for a ~100km-radius view. Accept the abstraction, or fetch a
  finer (50m) coastline conditionally past a zoom threshold — undecided.

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

- **Resolved:** the pageviews API is real and working (§2). The 5% band
  concept survived a second, independently-chosen test cluster (Kamloops).
- **Resolved, and changed the design:** label-selection must run over the
  full scanned candidate pool, not the capped `clusterMembers` list — see
  §2's Oxnard/Santa Barbara finding and §3a's revised rule.
- **Still open, needs a decision:** zoom-and-scatter's exact UI placement —
  does it replace FIELD, layer as a sheet, or become a new state? Not
  designed.
- **Still open, needs a decision:** the `world-atlas` 110m coastline problem
  at zoom (§3c) — accept the abstraction, or fetch 50m data conditionally?
- **Not yet designed:** the missing-pageview-data fallback for 3a.
