import { useEffect, useMemo, useState } from 'react'
import interpretations from '../data/interpretations.json'
import { loadCities, type City } from '../lib/gazetteer/cities'
import type { Positions } from '../lib/astro/types'
import { buildRaster, loadWeights, rankCities, type RasterCell, type Theme, type WeightsConfig } from '../lib/scoring/score'

const THEMES: Theme[] = ['love', 'career', 'harmony']
const THEME_LABEL: Record<Theme, string> = { love: 'Love', career: 'Career', harmony: 'Harmony' }
const INTERPRETATIONS = interpretations as Record<string, string>

interface ThemePanelProps {
  positions: Positions
  gstDeg: number
  onRasterChange: (raster: RasterCell[] | undefined) => void
}

export function ThemePanel({ positions, gstDeg, onRasterChange }: ThemePanelProps) {
  const [theme, setTheme] = useState<Theme | null>(null)
  const [showHeat, setShowHeat] = useState(true)
  const [cities, setCities] = useState<City[]>([])
  const [config, setConfig] = useState<WeightsConfig | null>(null)

  useEffect(() => {
    loadCities().then(setCities)
    loadWeights().then(setConfig)
  }, [])

  const topCities = useMemo(() => {
    if (!theme || !config || cities.length === 0) return []
    return rankCities(cities, theme, positions, gstDeg, config, 10)
  }, [theme, config, cities, positions, gstDeg])

  // The raster feeds the sibling WorldMap via App state — an external system
  // from this component's point of view, so it belongs in an effect.
  useEffect(() => {
    if (!theme || !config || !showHeat) {
      onRasterChange(undefined)
      return
    }
    onRasterChange(buildRaster(theme, positions, gstDeg, config))
  }, [theme, config, positions, gstDeg, showHeat, onRasterChange])

  return (
    <section className="theme-panel">
      <div className="theme-buttons">
        {THEMES.map((t) => (
          <button key={t} type="button" className={t === theme ? 'theme-button active' : 'theme-button'} onClick={() => setTheme(t === theme ? null : t)}>
            {THEME_LABEL[t]}
          </button>
        ))}
        {theme && (
          <label className="heat-toggle">
            <input type="checkbox" checked={showHeat} onChange={(e) => setShowHeat(e.target.checked)} />
            Heat overlay
          </label>
        )}
      </div>

      {theme && (
        <ol className="city-list">
          {topCities.map(({ city, score, bestKey }) => (
            <li key={`${city.name}-${city.lat}-${city.lon}`}>
              <div className="city-list-row">
                <span className="city-name">
                  {city.name}, {city.countryCode}
                </span>
                <span className="city-score">{score.toFixed(2)}</span>
              </div>
              {bestKey && INTERPRETATIONS[bestKey] && (
                <p className="city-interpretation">
                  <strong>{bestKey.replace('-', ' ')}</strong> — {INTERPRETATIONS[bestKey]}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
