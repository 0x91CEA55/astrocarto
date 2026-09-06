import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { BirthField } from './components/BirthField'
import { Globe, type GlobeFocus, type GlobeLabel } from './components/Globe'
import { DerivationSheet, PlaceSheet, PrecisionSheet } from './components/SheetContent'
import { Sheet } from './components/Sheet'
import { computeChart, localToUtc, type BodyName, type Chart } from './lib/astro'
import { loadCities, type City } from './lib/gazetteer/cities'
import { BODY_COLOR } from './lib/map/palette'
import { loadWeights, rankCities, type CityScore, type Theme, type WeightsConfig } from './lib/scoring/score'
import { decodeBirthFromFragment, encodeBirthToFragment, type BirthInput } from './lib/share'
import { exportGlobeShareImage } from './lib/share/exportImage'
import { buildFieldCopy, describeDerivation, THEME_ACCENT_BODY, THEME_LABEL, topKeysForTheme } from './lib/theme/copy'

type Stage = 'entry' | 'resolving' | 'field'
type SheetState = { kind: 'place'; city: City } | { kind: 'derivation'; body: BodyName } | { kind: 'precision' } | { kind: 'share'; dataUrl: string } | null

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

  const globeRef = useRef<SVGSVGElement>(null)

  const { chart, error } = useMemo(() => computeChartResult(birth), [birth])

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
  const fieldCopy = useMemo(() => (chart ? buildFieldCopy(theme, chart, leadKey) : null), [chart, theme, leadKey])
  const accentColor = BODY_COLOR[THEME_ACCENT_BODY[theme]]

  const labels: GlobeLabel[] = useMemo(
    () => topCities.slice(0, 4).map((c) => ({ id: String(c.city.geonameId), lat: c.city.lat, lon: c.city.lon, name: c.city.name })),
    [topCities],
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
    if (!canFlyToTop || !topScore) return null
    return { lat: topScore.city.lat, lon: topScore.city.lon, ms: 900 }
  }, [stage, previewMarker, canFlyToTop, topScore])

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

  function handleLabelClick(id: string) {
    const found = topCitiesRef.current.find((c) => String(c.city.geonameId) === id)
    if (found) setSheet({ kind: 'place', city: found.city })
  }

  async function handleShare() {
    const svg = globeRef.current
    if (!svg || !chart || !birth) return
    const placeLabel = birth.place ?? `${birth.lat.toFixed(2)}, ${birth.lon.toFixed(2)}`
    const birthLine = `${birth.date} · ${birth.time} · ${birth.tz}`
    const dataUrl = await exportGlobeShareImage(svg, { placeLabel, birthLine })
    setSheet({ kind: 'share', dataUrl })
  }

  const derivationInfo = sheet?.kind === 'derivation' && chart ? describeDerivation(sheet.body, chart) : null

  return (
    <main className={`void-root stage-${stage}`}>
      <div className="void-vign" />
      <div className={reopenBirth ? 'void-globe-box dimmed' : 'void-globe-box'}>
        <Globe
          ref={globeRef}
          lines={chart?.lines ?? ({} as Chart['lines'])}
          visibleKeys={showLines ? themeKeys : []}
          leadKey={heatVisible ? leadKey : null}
          accentColor={accentColor}
          labels={labelsVisible ? labels : []}
          marker={stage === 'entry' ? previewMarker : null}
          focus={focus}
          drift={stage === 'entry' && !hasInteracted}
          onInteractionStart={() => setHasInteracted(true)}
          revealing={revealing}
          onLabelClick={handleLabelClick}
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

      <Sheet open={sheet !== null} onClose={() => setSheet(null)}>
        {sheet?.kind === 'place' && chart && <PlaceSheet key={sheet.city.geonameId} city={sheet.city} chart={chart} accentColor={accentColor} />}
        {sheet?.kind === 'derivation' && derivationInfo && <DerivationSheet info={derivationInfo} />}
        {sheet?.kind === 'precision' && chart && birth && (
          <PrecisionSheet chart={chart} placeLabel={`${birth.place ?? ''} ${birth.lat.toFixed(2)}N ${birth.lon.toFixed(2)}E`.trim()} />
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
