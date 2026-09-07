import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { BirthField } from './components/BirthField'
import { Globe, type GlobeFocus, type GlobeLabel } from './components/Globe'
import { sphericalCentroid } from './lib/map/globe'
import { DerivationSheet, PlaceSheet, PrecisionSheet } from './components/SheetContent'
import { Sheet } from './components/Sheet'
import { TimeScrubber } from './components/TimeScrubber'
import { computeChart, localToUtc, type BodyName, type Chart } from './lib/astro'
import { loadCities, type City } from './lib/gazetteer/cities'
import { BODY_COLOR } from './lib/map/palette'
import { DEDUP_RADIUS_KM, loadWeights, nearbyScored, rankCities, type CityScore, type Theme, type WeightsConfig } from './lib/scoring/score'
import { decodeBirthFromFragment, encodeBirthToFragment, type BirthInput } from './lib/share'
import { exportGlobeShareImage } from './lib/share/exportImage'
import { buildFieldCopy, describeDerivation, THEME_ACCENT_BODY, THEME_LABEL, topKeysForTheme } from './lib/theme/copy'

/** Scale multiplier for cluster zoom — enough for a DEDUP_RADIUS_KM circle to fill most of the frame (poc/NEW-FEATURE.md §3c). */
const CLUSTER_ZOOM = 18
const CLUSTER_SCATTER_LIMIT = 15
const CLUSTER_MAX_LABELS = 10

type Stage = 'entry' | 'resolving' | 'field' | 'cluster'
type SheetState =
  | { kind: 'place'; cityScore: CityScore }
  | { kind: 'derivation'; body: BodyName }
  | { kind: 'precision' }
  | { kind: 'scrubber' }
  | { kind: 'share'; dataUrl: string }
  | null

const THEMES: Theme[] = ['love', 'career', 'harmony']
const SESSION_REVEALED_KEY = 'astrocarto:revealed'

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

function computeChartResult(birth: BirthInput | null): { chart: Chart | null; error: string | null } {
  if (!birth) return { chart: null, error: null }
  try {
    return { chart: computeChart(localToUtc(birth.date, birth.time, birth.tz), birth.lat, birth.lon), error: null }
  } catch (e) {
    return { chart: null, error: e instanceof Error ? e.message : String(e) }
  }
}

function App() {
  const [birth, setBirth] = useState<BirthInput | null>(() => decodeBirthFromFragment(window.location.hash))
  const [stage, setStage] = useState<Stage>(birth ? 'field' : 'entry')
  const [theme, setTheme] = useState<Theme>('love')
  const [cities, setCities] = useState<City[]>([])
  const [config, setConfig] = useState<WeightsConfig | null>(null)
  const [sheet, setSheet] = useState<SheetState>(null)
  const [previewMarker, setPreviewMarker] = useState<{ lat: number; lon: number } | null>(birth ? { lat: birth.lat, lon: birth.lon } : null)
  const [hasInteracted, setHasInteracted] = useState(false)
  const [showLines, setShowLines] = useState(stage === 'field')
  const [revealing, setRevealing] = useState(false)
  const [heatVisible, setHeatVisible] = useState(stage === 'field')
  const [labelsVisible, setLabelsVisible] = useState(stage === 'field')
  const [headlineVisible, setHeadlineVisible] = useState(stage === 'field')
  const [canFlyToTop, setCanFlyToTop] = useState(stage === 'field')
  const [reopenBirth, setReopenBirth] = useState(false)
  const [scrubMinutes, setScrubMinutes] = useState(0)
  const [clusterCenter, setClusterCenter] = useState<CityScore | null>(null)
  const [clusterScatter, setClusterScatter] = useState<CityScore[]>([])

  const globeRef = useRef<HTMLCanvasElement>(null)

  const { chart, error } = useMemo(() => computeChartResult(birth), [birth])

  const baseUtc = useMemo(() => (chart ? new Date(chart.birth.utcIso) : null), [chart])
  const scrubbedChart = useMemo(() => {
    if (!chart || !birth || !baseUtc || scrubMinutes === 0) return null
    return computeChart(new Date(baseUtc.getTime() + scrubMinutes * 60_000), birth.lat, birth.lon)
  }, [chart, birth, baseUtc, scrubMinutes])
  const scrubberOpen = sheet?.kind === 'scrubber'
  const activeChart = scrubberOpen ? (scrubbedChart ?? chart) : chart

  useEffect(() => {
    loadCities().then(setCities)
    loadWeights().then(setConfig)
  }, [])

  useEffect(() => {
    if (!birth) return
    window.history.replaceState(null, '', encodeBirthToFragment(birth))
  }, [birth])

  const topCities: CityScore[] = useMemo(() => {
    if (!chart || !config || cities.length === 0) return []
    return rankCities(cities, theme, chart.positions, chart.birth.gstDeg, config, 10)
  }, [chart, config, cities, theme])
  const topCitiesRef = useRef(topCities)
  topCitiesRef.current = topCities

  const themeKeys = useMemo(() => (config ? topKeysForTheme(config, theme) : []), [config, theme])
  const topScore = topCities[0] ?? null
  const leadKey = topScore?.bestKey ?? null
  const fieldCopy = useMemo(() => (chart ? buildFieldCopy(theme, chart, topScore) : null), [chart, theme, topScore])
  const accentColor = BODY_COLOR[THEME_ACCENT_BODY[theme]]

  // A city's dot/label is colored by ITS OWN best-contributing line, not a
  // uniform theme accent — a city whose score actually comes from Jupiter's
  // line (e.g. bestKey "Jupiter-DC") drawn in Love's Venus-pink accent looks
  // like it's "on" the Venus line when it visually sits on Jupiter's line
  // instead. Verified live (reported: "pink dots on unrelated love lines"):
  // Kelo and Voronezh's bestKey was Jupiter-DC, yet both rendered pink
  // (Love's Venus accent) while sitting on the visibly orange Jupiter line.
  const lineBodyColor = useCallback(
    (key: string | null): string => {
      if (!key) return accentColor
      const body = key.split('-')[0] as BodyName
      return BODY_COLOR[body] ?? accentColor
    },
    [accentColor],
  )

  const labels: GlobeLabel[] = useMemo(
    () => topCities.slice(0, 4).map((c) => ({ id: String(c.city.geonameId), lat: c.city.lat, lon: c.city.lon, name: c.city.name, color: lineBodyColor(c.bestKey) })),
    [topCities, lineBodyColor],
  )
  const clusterLabels: GlobeLabel[] = useMemo(
    () => clusterScatter.map((c) => ({ id: String(c.city.geonameId), lat: c.city.lat, lon: c.city.lon, name: c.city.name, color: lineBodyColor(c.bestKey) })),
    [clusterScatter, lineBodyColor],
  )

  // Reveal choreography — UX-SPEC §5. Computation is ~50ms; the 3.2s gap is
  // deliberate. Cuts to a fast cross-fade on repeat within a session, and to
  // a flat 200ms fade under prefers-reduced-motion (never a slower sequence).
  function startReveal() {
    setStage('resolving')
    setHasInteracted(true)

    if (reducedMotion()) {
      setShowLines(true)
      setHeatVisible(true)
      setLabelsVisible(true)
      setHeadlineVisible(true)
      setCanFlyToTop(true)
      setStage('field')
      sessionStorage.setItem(SESSION_REVEALED_KEY, '1')
      return
    }

    const repeat = sessionStorage.getItem(SESSION_REVEALED_KEY) === '1'
    const scale = repeat ? 1200 / 3200 : 1
    const t = (ms: number) => ms * scale
    const timers: number[] = []

    timers.push(window.setTimeout(() => setRevealing(true), t(800)))
    timers.push(window.setTimeout(() => setShowLines(true), t(800)))
    timers.push(window.setTimeout(() => setRevealing(false), t(2400)))
    timers.push(window.setTimeout(() => setHeatVisible(true), t(1600)))
    timers.push(
      window.setTimeout(() => {
        setStage('field')
        setCanFlyToTop(true)
      }, t(2400)),
    )
    timers.push(window.setTimeout(() => setLabelsVisible(true), t(2900)))
    timers.push(
      window.setTimeout(() => {
        setHeadlineVisible(true)
        sessionStorage.setItem(SESSION_REVEALED_KEY, '1')
      }, t(3200)),
    )

    return () => timers.forEach((id) => clearTimeout(id))
  }

  const focus: GlobeFocus | null = useMemo(() => {
    if (stage === 'entry') return previewMarker ? { lat: previewMarker.lat, lon: previewMarker.lon, ms: 850 } : null
    if (stage === 'cluster' && clusterCenter) return { lat: clusterCenter.city.lat, lon: clusterCenter.city.lon, zoom: CLUSTER_ZOOM, ms: 900, exact: true }
    if (!canFlyToTop || !topScore) return null
    // Fly to the spherical centroid of the visible labels, not literally the
    // #1 result — with genuinely diverse, multi-continent results (the point
    // of the region-diversity feature), centering on #1 specifically often
    // left only 1-2 of the top 4 on the visible hemisphere at once, needing
    // a manual rotation to see the rest. Reported live: "such minimal
    // zoomed out results?"
    const center = labels.length > 0 ? sphericalCentroid(labels) : topScore.city
    return { lat: center.lat, lon: center.lon, zoom: 1, ms: 900 }
  }, [stage, previewMarker, canFlyToTop, topScore, clusterCenter, labels])

  const handlePlacePreview = useCallback((lat: number, lon: number) => {
    setPreviewMarker({ lat, lon })
  }, [])

  const handleBirthSubmit = useCallback((input: BirthInput) => {
    setBirth(input)
    setReopenBirth(false)
    startReveal()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleThemeChange(next: Theme) {
    setTheme(next)
    setSheet(null)
  }

  function enterCluster(center: CityScore) {
    if (!chart || !config) return
    const scatter = nearbyScored(cities, center.city.lat, center.city.lon, DEDUP_RADIUS_KM, theme, chart.positions, chart.birth.gstDeg, config, CLUSTER_SCATTER_LIMIT)
    setClusterCenter(center)
    setClusterScatter(scatter)
    setStage('cluster')
  }

  function exitCluster() {
    setStage('field')
    setClusterCenter(null)
    setClusterScatter([])
  }

  function handleLabelClick(id: string) {
    if (stage === 'cluster') {
      const found = clusterScatter.find((c) => String(c.city.geonameId) === id)
      if (found) setSheet({ kind: 'place', cityScore: found })
      return
    }
    const found = topCitiesRef.current.find((c) => String(c.city.geonameId) === id)
    if (!found) return
    if (found.clusterMembers.length > 0) {
      enterCluster(found)
    } else {
      setSheet({ kind: 'place', cityScore: found })
    }
  }

  // From the PLACE sheet's "ALSO NEARBY" list — stays within the sheet
  // paradigm (detail-to-detail) rather than kicking into the full-screen
  // zoom transition, which is reserved for tapping a globe label directly.
  function handleClusterMemberClick(member: CityScore) {
    setSheet({ kind: 'place', cityScore: member })
  }

  async function handleShare() {
    const canvas = globeRef.current
    if (!canvas || !chart || !birth) return
    const placeLabel = birth.place ?? `${birth.lat.toFixed(2)}, ${birth.lon.toFixed(2)}`
    const birthLine = `${birth.date} · ${birth.time} · ${birth.tz}`
    const dataUrl = await exportGlobeShareImage(canvas, { placeLabel, birthLine })
    setSheet({ kind: 'share', dataUrl })
  }

  const derivationInfo = sheet?.kind === 'derivation' && chart ? describeDerivation(sheet.body, chart) : null

  return (
    <main className={`void-root stage-${stage}`}>
      <div className="void-vign" />
      <div className={reopenBirth ? 'void-globe-box dimmed' : 'void-globe-box'}>
        <Globe
          ref={globeRef}
          lines={activeChart?.lines ?? ({} as Chart['lines'])}
          visibleKeys={showLines ? themeKeys : []}
          leadKey={heatVisible ? leadKey : null}
          accentColor={accentColor}
          labels={stage === 'cluster' ? clusterLabels : labelsVisible ? labels : []}
          maxLabels={stage === 'cluster' ? CLUSTER_MAX_LABELS : undefined}
          marker={stage === 'entry' ? previewMarker : null}
          focus={focus}
          drift={stage === 'entry' && !hasInteracted}
          onInteractionStart={() => setHasInteracted(true)}
          revealing={revealing}
          onLabelClick={handleLabelClick}
          suspendBloom={scrubberOpen}
        />
      </div>
      <div className="void-scrim" />

      <div className="void-layer">
        {stage === 'entry' && !reopenBirth && <BirthField initial={birth} onPlacePreview={handlePlacePreview} onSubmit={handleBirthSubmit} />}

        {stage === 'field' && reopenBirth && (
          <div className="void-reopen">
            <BirthField initial={birth} onPlacePreview={handlePlacePreview} onSubmit={handleBirthSubmit} />
          </div>
        )}

        {stage === 'field' && !reopenBirth && chart && fieldCopy && (
          <div id="field" className={headlineVisible ? 'on' : ''}>
            <div />
            <div className="void-headline">
              <div className="void-ttl">{fieldCopy.headline}</div>
              <div className="void-lead">
                {fieldCopy.leadPrefix && (
                  <b onClick={() => fieldCopy.derivationBody && setSheet({ kind: 'derivation', body: fieldCopy.derivationBody })}>{fieldCopy.leadPrefix}</b>
                )}
                {fieldCopy.leadSuffix}
              </div>
            </div>
            <div className="void-bottom">
              <div className="void-themes">
                {THEMES.map((t) => (
                  <button key={t} type="button" aria-pressed={t === theme} onClick={() => handleThemeChange(t)}>
                    {THEME_LABEL[t]}
                  </button>
                ))}
              </div>
              <button type="button" className="void-summary" onClick={() => setReopenBirth(true)}>
                {birth?.place ?? `${birth?.lat.toFixed(2)}, ${birth?.lon.toFixed(2)}`} · {birth?.date} · {birth?.time}
              </button>
            </div>
          </div>
        )}

        {stage === 'cluster' && clusterCenter && (
          <div className="void-cluster-overlay">
            <button type="button" className="void-cluster-back" onClick={exitCluster}>
              ← Back to results
            </button>
            <p className="void-cluster-caption">
              {clusterScatter.length} places score comparably near {clusterCenter.city.name} — this is one result, not several. Tap any to explore.
            </p>
          </div>
        )}
      </div>

      {stage === 'field' && !reopenBirth && (
        <>
          <button type="button" className="void-precision" onClick={() => setSheet({ kind: 'precision' })}>
            PRECISION
          </button>
          <button type="button" className="void-share" onClick={handleShare}>
            SHARE
          </button>
        </>
      )}

      {error && <p className="void-error">{error}</p>}

      <Sheet
        open={sheet !== null}
        onClose={() => {
          setSheet(null)
          setScrubMinutes(0)
        }}
      >
        {sheet?.kind === 'place' && chart && (
          <PlaceSheet key={sheet.cityScore.city.geonameId} cityScore={sheet.cityScore} chart={chart} accentColor={accentColor} onSelectClusterMember={handleClusterMemberClick} />
        )}
        {sheet?.kind === 'derivation' && derivationInfo && <DerivationSheet info={derivationInfo} />}
        {sheet?.kind === 'precision' && chart && birth && (
          <>
            <PrecisionSheet chart={chart} placeLabel={`${birth.place ?? ''} ${birth.lat.toFixed(2)}N ${birth.lon.toFixed(2)}E`.trim()} />
            <button type="button" className="void-link" onClick={() => setSheet({ kind: 'scrubber' })}>
              Not sure of the exact minute? Explore what the birth time decides →
            </button>
          </>
        )}
        {sheet?.kind === 'scrubber' && chart && birth && baseUtc && (
          <TimeScrubber birth={birth} baseUtc={baseUtc} baseChart={chart} activeChart={activeChart ?? chart} minutes={scrubMinutes} onMinutesChange={setScrubMinutes} />
        )}
        {sheet?.kind === 'share' && (
          <>
            <h2>Share</h2>
            <div className="void-cc">client-side render — nothing leaves your browser</div>
            <img alt="Shareable chart render" src={sheet.dataUrl} style={{ width: '100%' }} />
            <a className="void-link" href={sheet.dataUrl} download="astrocarto.png">
              Save image
            </a>
          </>
        )}
      </Sheet>
    </main>
  )
}

export default App
