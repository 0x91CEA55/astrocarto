import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { loadCities, searchCities, type City } from '../lib/gazetteer/cities'
import { timezoneForCoords } from '../lib/geo/timezone'
import type { BirthInput } from '../lib/share'

interface BirthFieldProps {
  initial?: BirthInput | null
  /** Fired the moment a place is chosen — before date/time exist — so the globe can fly there and drop a marker (UX-SPEC §6: "payoff before submit"). */
  onPlacePreview: (lat: number, lon: number) => void
  onSubmit: (input: BirthInput) => void
}

/**
 * Progressive birth input: place, then date, then time — live on the globe,
 * not a modal or a tab (UX-SPEC §6). Each field only lights up once the
 * previous one is filled, teaching that time is what locks the chart.
 *
 * Manual lat/lon/tz stays available as a fallback (UX-SPEC §9: "location not
 * found — manual lat/lon/tz, never a dead end"), even though the reference
 * component build doesn't show it — the spec's empty-states section requires it.
 */
export function BirthField({ initial, onPlacePreview, onSubmit }: BirthFieldProps) {
  const [date, setDate] = useState(initial?.date ?? '')
  const [time, setTime] = useState(initial?.time ?? '')
  const [query, setQuery] = useState(initial?.place ?? '')
  const [cities, setCities] = useState<City[]>([])
  const [selected, setSelected] = useState<{ lat: number; lon: number; tz: string; place: string } | null>(
    initial ? { lat: initial.lat, lon: initial.lon, tz: initial.tz, place: initial.place ?? '' } : null,
  )
  const [manual, setManual] = useState(false)
  const [manualLat, setManualLat] = useState(initial ? String(initial.lat) : '')
  const [manualLon, setManualLon] = useState(initial ? String(initial.lon) : '')
  const [manualTz, setManualTz] = useState(initial?.tz ?? '')
  const [tzEditedByUser, setTzEditedByUser] = useState(false)

  useEffect(() => {
    loadCities().then(setCities)
  }, [])

  const results = useMemo(() => (manual || !query || selected ? [] : searchCities(cities, query)), [cities, query, manual, selected])

  // Derived purely from coordinates, never written into state on blur — a
  // per-field blur handler used to fire while the other field was still
  // empty (Tab from lat -> lon read lon as 0 mid-edit) and silently lock in
  // a wrong zone. See git history for the incident this replaced.
  const suggestedTz = useMemo(() => {
    const lat = Number(manualLat)
    const lon = Number(manualLon)
    if (manualLat.trim() === '' || manualLon.trim() === '' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
    return timezoneForCoords(lat, lon)
  }, [manualLat, manualLon])
  const effectiveTz = tzEditedByUser ? manualTz : (suggestedTz ?? manualTz)

  function pick(city: City) {
    setSelected({ lat: city.lat, lon: city.lon, tz: city.tz, place: `${city.name}, ${city.countryCode}` })
    setQuery(`${city.name}, ${city.countryCode}`)
    onPlacePreview(city.lat, city.lon)
  }

  useEffect(() => {
    if (!manual) return
    const lat = Number(manualLat)
    const lon = Number(manualLon)
    if (Number.isFinite(lat) && Number.isFinite(lon) && manualLat.trim() !== '' && manualLon.trim() !== '') {
      onPlacePreview(lat, lon)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manual, manualLat, manualLon])

  const placeReady = manual ? Number.isFinite(Number(manualLat)) && Number.isFinite(Number(manualLon)) && !!effectiveTz : !!selected
  const dateReady = placeReady && date.length > 0
  const timeReady = dateReady && time.length > 0

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!date || !time) return

    if (manual) {
      const lat = Number(manualLat)
      const lon = Number(manualLon)
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !effectiveTz) return
      onSubmit({ date, time, lat, lon, tz: effectiveTz })
      return
    }

    if (!selected) return
    onSubmit({ date, time, lat: selected.lat, lon: selected.lon, tz: selected.tz, place: selected.place })
  }

  return (
    <form className="void-entry" onSubmit={handleSubmit}>
      <h1>Where your chart touches the world</h1>
      <p className="void-sub">Three things. Your birth data never leaves this browser.</p>

      {!manual && (
        <div className="void-field live">
          <div className="void-lab">PLACE OF BIRTH</div>
          <input
            type="text"
            value={query}
            placeholder="start typing a city"
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(null)
            }}
          />
          {results.length > 0 && (
            <div className="void-suggest">
              {results.map((c) => (
                <button type="button" key={`${c.geonameId}`} onClick={() => pick(c)}>
                  {c.name}, {c.countryCode}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {manual && (
        <div className="void-field live void-manual-row">
          <div>
            <div className="void-lab">LATITUDE</div>
            <input type="number" step="any" value={manualLat} onChange={(e) => setManualLat(e.target.value)} />
          </div>
          <div>
            <div className="void-lab">LONGITUDE</div>
            <input type="number" step="any" value={manualLon} onChange={(e) => setManualLon(e.target.value)} />
          </div>
          <div>
            <div className="void-lab">TIMEZONE</div>
            <input
              type="text"
              value={effectiveTz}
              placeholder="e.g. America/Toronto"
              onChange={(e) => {
                setManualTz(e.target.value)
                setTzEditedByUser(true)
              }}
            />
          </div>
        </div>
      )}

      <div className={placeReady ? 'void-field live' : 'void-field'}>
        <div className="void-lab">DATE</div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!placeReady} />
      </div>

      <div className={dateReady ? 'void-field live' : 'void-field'}>
        <div className="void-lab">TIME</div>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!dateReady} />
      </div>

      <button type="submit" className={timeReady ? 'void-go live' : 'void-go'} disabled={!timeReady}>
        Show me the map
      </button>

      <button type="button" className="void-link" onClick={() => setManual((m) => !m)}>
        {manual ? 'Search for a city instead' : "Don't see your city? Enter coordinates manually"}
      </button>
    </form>
  )
}
