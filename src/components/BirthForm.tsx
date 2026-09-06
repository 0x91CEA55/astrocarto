import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { loadCities, searchCities, type City } from '../lib/gazetteer/cities'
import { timezoneForCoords } from '../lib/geo/timezone'
import type { BirthInput } from '../lib/share'

interface BirthFormProps {
  initial?: BirthInput | null
  onSubmit: (input: BirthInput) => void
}

export function BirthForm({ initial, onSubmit }: BirthFormProps) {
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

  // Suggested timezone derived purely from the coordinates — not pushed into
  // state on blur of either field individually, which used to fire while the
  // other was still empty (a natural Tab from lat -> lon reads lon as 0
  // mid-edit and would lock in a wrong zone). Overridden once the user edits
  // the timezone field directly.
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
  }

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
    <form className="birth-form" onSubmit={handleSubmit}>
      <div className="field-row">
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          Time (24h, local)
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </label>
      </div>

      {!manual && (
        <div className="field-row city-search">
          <label>
            Birth city
            <input
              type="text"
              value={query}
              placeholder="Start typing a city…"
              onChange={(e) => {
                setQuery(e.target.value)
                setSelected(null)
              }}
              autoComplete="off"
              required
            />
          </label>
          {results.length > 0 && (
            <ul className="autocomplete">
              {results.map((c) => (
                <li key={`${c.name}-${c.lat}-${c.lon}`}>
                  <button type="button" onClick={() => pick(c)}>
                    {c.name}, {c.countryCode}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {manual && (
        <div className="field-row">
          <label>
            Latitude
            <input type="number" step="any" value={manualLat} onChange={(e) => setManualLat(e.target.value)} required />
          </label>
          <label>
            Longitude
            <input type="number" step="any" value={manualLon} onChange={(e) => setManualLon(e.target.value)} required />
          </label>
          <label>
            IANA timezone
            <input
              type="text"
              value={effectiveTz}
              onChange={(e) => {
                setManualTz(e.target.value)
                setTzEditedByUser(true)
              }}
              placeholder="e.g. America/Toronto"
              required
            />
          </label>
        </div>
      )}

      <button type="button" className="link-button" onClick={() => setManual((m) => !m)}>
        {manual ? 'Search for a city instead' : "Don't see your city? Enter coordinates manually"}
      </button>

      <button type="submit" className="primary">
        Compute chart
      </button>
    </form>
  )
}
