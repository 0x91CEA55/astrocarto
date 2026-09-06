import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { BirthForm } from './components/BirthForm'
import { ThemePanel } from './components/ThemePanel'
import { WorldMap } from './components/WorldMap'
import { BODY_NAMES, computeChart, localToUtc, type BodyName, type Chart } from './lib/astro'
import { decodeBirthFromFragment, encodeBirthToFragment, type BirthInput } from './lib/share'
import type { RasterCell } from './lib/scoring/score'

function computeChartResult(birth: BirthInput | null): { chart: Chart | null; error: string | null } {
  if (!birth) return { chart: null, error: null }
  try {
    return { chart: computeChart(localToUtc(birth.date, birth.time, birth.tz)), error: null }
  } catch (e) {
    return { chart: null, error: e instanceof Error ? e.message : String(e) }
  }
}

function App() {
  const [birth, setBirth] = useState<BirthInput | null>(() => decodeBirthFromFragment(window.location.hash))
  const [visibleBodies, setVisibleBodies] = useState<Set<BodyName>>(() => new Set(BODY_NAMES))
  const [raster, setRaster] = useState<RasterCell[] | undefined>(undefined)

  const { chart, error } = useMemo(() => computeChartResult(birth), [birth])

  useEffect(() => {
    if (!birth) return
    window.history.replaceState(null, '', encodeBirthToFragment(birth))
  }, [birth])

  const toggleBody = useCallback((body: BodyName) => {
    setVisibleBodies((prev) => {
      const next = new Set(prev)
      if (next.has(body)) next.delete(body)
      else next.add(body)
      return next
    })
  }, [])

  return (
    <main>
      <header>
        <h1>astrocarto</h1>
        <p className="tagline">
          Astrocartography lines and hotspots, computed entirely in your browser — your birth data never leaves this page.
        </p>
      </header>

      <BirthForm initial={birth} onSubmit={setBirth} />

      {error && <p className="error">{error}</p>}

      {chart && (
        <>
          <div className="legend">
            {BODY_NAMES.map((body) => (
              <label key={body} className="legend-item">
                <input type="checkbox" checked={visibleBodies.has(body)} onChange={() => toggleBody(body)} />
                {body}
              </label>
            ))}
          </div>

          <div className="map-container">
            <WorldMap lines={chart.lines} visibleBodies={visibleBodies} raster={raster} />
          </div>

          <ThemePanel positions={chart.positions} gstDeg={chart.birth.gstDeg} onRasterChange={setRaster} />
        </>
      )}

      <footer>
        <p>
          City data © <a href="https://www.geonames.org/">GeoNames</a>, CC BY 4.0. In-mundo line convention — see{' '}
          <a href="https://github.com/0x91CEA55/astrocarto/blob/main/poc/SPEC.md">SPEC.md</a>.
        </p>
      </footer>
    </main>
  )
}

export default App
