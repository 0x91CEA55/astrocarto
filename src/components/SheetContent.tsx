import { useEffect, useState } from 'react'
import type { Chart } from '../lib/astro'
import { ANGLES, type AngleName, BODY_NAMES, type BodyName, type LineKey } from '../lib/astro/types'
import { distanceToLineKm, haversineKm } from '../lib/astro/lines'
import interpretations from '../data/interpretations.json'
import { DEDUP_RADIUS_KM, type CityScore } from '../lib/scoring/score'
import { BODY_COLOR } from '../lib/map/palette'
import { degreeInSignLabel, signOf, type DerivationInfo } from '../lib/theme/copy'
import { fetchWikiSummary, type WikiSummary } from '../lib/wiki/summary'

const INTERPRETATIONS = interpretations as Partial<Record<LineKey, string>>

const NEAR_LINE_RADIUS_KM = 900

interface NearLine {
  key: string
  body: BodyName
  angle: AngleName
  km: number
}

function nearLines(chart: Chart, lat: number, lon: number): NearLine[] {
  const out: NearLine[] = []
  for (const body of BODY_NAMES) {
    for (const angle of ANGLES) {
      const km = distanceToLineKm(chart.positions[body], angle, chart.birth.gstDeg, lat, lon)
      if (km < NEAR_LINE_RADIUS_KM) out.push({ key: `${body}-${angle}`, body, angle, km })
    }
  }
  return out.sort((a, b) => a.km - b.km).slice(0, 6)
}

interface PlaceSheetProps {
  cityScore: CityScore
  chart: Chart
  accentColor: string
  /** A cluster member was tapped — reopen the sheet on that city instead (poc/NEW-FEATURE.md §3b). */
  onSelectClusterMember?: (member: CityScore) => void
}

/** PLACE — ranked/tapped place detail: nearby lines, Wikipedia editorial context. UX-SPEC §7. */
export function PlaceSheet({ cityScore, chart, accentColor, onSelectClusterMember }: PlaceSheetProps) {
  const { city } = cityScore
  // Keyed by city.geonameId at the call site (App.tsx) so switching places
  // remounts this component and `summary` starts fresh — no manual reset here.
  // No article at all is knowable synchronously, so it's the lazy initial
  // state rather than a setState fired from an effect on mount.
  const [summary, setSummary] = useState<WikiSummary | null | undefined>(() => (city.wikiTitle ? undefined : null))

  useEffect(() => {
    if (!city.wikiTitle) return
    let cancelled = false
    fetchWikiSummary(city.wikiTitle)
      .then((s) => {
        if (!cancelled) setSummary(s)
      })
      .catch(() => {
        if (!cancelled) setSummary(null)
      })
    return () => {
      cancelled = true
    }
  }, [city.wikiTitle])

  const near = nearLines(chart, city.lat, city.lon)

  return (
    <>
      <h2>{city.name}</h2>
      <div className="void-cc">
        {city.countryCode} · {city.lat.toFixed(2)} {city.lon.toFixed(2)}
      </div>

      {summary?.thumbnailUrl || summary?.heroImageUrl ? (
        <div className="void-duo">
          <img alt="" src={summary.heroImageUrl ?? summary.thumbnailUrl ?? ''} />
          <div className="void-duo-tint" style={{ background: accentColor }} />
          <div className="void-duo-fade" />
        </div>
      ) : (
        <div className="void-duo empty" />
      )}

      {summary === undefined && <p className="void-extract void-faint">Loading…</p>}
      {summary === null && (
        <p className="void-extract void-faint">
          No description available for this place. The no-image, no-article state is common — most of the gazetteer has no
          resolvable Wikipedia article.
        </p>
      )}
      {summary && (
        <>
          <p className="void-extract">{summary.extract}</p>
          <p className="void-attrib">
            Wikipedia, CC BY-SA ·{' '}
            <a href={summary.canonicalUrl} target="_blank" rel="noopener noreferrer">
              source
            </a>
          </p>
        </>
      )}

      <div className="void-near">
        <div className="void-k">LINES WITHIN {NEAR_LINE_RADIUS_KM} KM</div>
        {near.length === 0 && <p className="void-faint">No lines pass nearby — this is ordinary; most of the surface is far from any line.</p>}
        {near.map((n) => {
          const dignity = chart.positions[n.body].dignity
          const strong = dignity === 'exalted' || dignity === 'domicile'
          const meaning = INTERPRETATIONS[n.key as LineKey]
          return (
            <div className="void-nr-block" key={n.key}>
              <div className="void-nr">
                <i style={{ background: BODY_COLOR[n.body] }} />
                <span className="void-nm">
                  {n.body}-{n.angle}
                </span>
                {strong && <span className="void-warn">{dignity}</span>}
                <span className="void-km">{n.km < 1 ? '<1' : Math.round(n.km)} km</span>
              </div>
              {meaning && <p className="void-nr-meaning">{meaning}</p>}
            </div>
          )
        })}
      </div>

      {cityScore.clusterMembers.length > 0 && (
        <div className="void-near">
          <div className="void-k">ALSO NEARBY</div>
          <p className="void-faint" style={{ marginBottom: 10 }}>
            {city.name} is the strongest result within {DEDUP_RADIUS_KM}km — these scored close behind, on the same line(s).
          </p>
          {cityScore.clusterMembers.map((m) => (
            <button type="button" className="void-cluster-member" key={m.city.geonameId} onClick={() => onSelectClusterMember?.(m)}>
              <span className="void-nm">
                {m.city.name}, {m.city.countryCode}
              </span>
              <span className="void-km">{Math.round(haversineKm(city.lat, city.lon, m.city.lat, m.city.lon))} km away</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

interface DerivationSheetProps {
  info: DerivationInfo
}

/** DERIVATION — tapping a claim shows the geometry behind it. UX-SPEC §8. */
export function DerivationSheet({ info }: DerivationSheetProps) {
  return (
    <>
      <h2>
        {info.body} in {info.sign}
      </h2>
      <div className="void-cc">
        {info.degreeInSign} {info.sign} · WHOLE-SIGN HOUSE {info.house} · {info.dignity.toUpperCase()}
        {info.retrograde ? ' · RETROGRADE' : ''}
      </div>
      <p className="void-extract">
        A body is <em>exalted</em> where the tradition holds it acts most cleanly; <em>domicile</em> where it is most at home. It
        is a dignity table, not a measurement — the position above is exact to the arcsecond, the meaning is a convention on top
        of it.
      </p>
      <div className="void-near">
        <div className="void-k">HOW EACH LINE IS DERIVED</div>
        <div className="void-ro">
          <div>
            <span className="void-b">α</span>
            <span>{info.ra.toFixed(3)}°</span>
          </div>
          <div>
            <span className="void-b">δ</span>
            <span>{info.dec.toFixed(3)}°</span>
          </div>
          <div>
            <span className="void-b">GST</span>
            <span>{info.gstDeg.toFixed(3)}°</span>
          </div>
          {ANGLES.map((a) => (
            <div key={a}>
              <span className="void-b">λ({a})</span>
              <span>{info.angleFormulas[a]}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="void-prov">cos H = −tan φ · tan δ &nbsp;·&nbsp; |cos H| &gt; 1 → no line at that latitude (circumpolar)</p>
    </>
  )
}

interface PrecisionSheetProps {
  chart: Chart
  placeLabel: string
}

/** Precision drawer — the seams, on request. UX-SPEC §6. */
export function PrecisionSheet({ chart, placeLabel }: PrecisionSheetProps) {
  const ascSign = signOf(chart.angles.ascDeg)
  const mcSign = signOf(chart.angles.mcDeg)
  return (
    <>
      <h2>Precision</h2>
      <div className="void-cc">the seams, on request</div>
      <div className="void-ro">
        <div>
          <span className="void-b">ASC</span>
          <span>
            {degreeInSignLabel(chart.angles.ascDeg)} {ascSign}
          </span>
        </div>
        <div>
          <span className="void-b">MC</span>
          <span>
            {degreeInSignLabel(chart.angles.mcDeg)} {mcSign} · house {chart.mcHouse}
          </span>
        </div>
        <div>
          <span className="void-b">GST</span>
          <span>{chart.birth.gstDeg.toFixed(4)}°</span>
        </div>
        {BODY_NAMES.map((body) => {
          const p = chart.positions[body]
          return (
            <div key={body}>
              <span className="void-b">{body}</span>
              <span>
                {degreeInSignLabel(p.eclLon)} {signOf(p.eclLon).slice(0, 3)} · h{chart.housesOf[body]} · {p.dignity.slice(0, 3)}
                {p.retrograde ? ' ℞' : ''}
              </span>
            </div>
          )
        })}
      </div>

      {chart.aspects.length > 0 && (
        <div className="void-near">
          <div className="void-k">ASPECTS</div>
          <div className="void-ro">
            {chart.aspects.map((asp) => (
              <div key={`${asp.a}-${asp.b}`}>
                <span className="void-b">
                  {asp.a}–{asp.b}
                </span>
                <span>
                  {asp.type} ({asp.orbDeg.toFixed(1)}° orb)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="void-prov">
        ORTHOGRAPHIC · IN MUNDO · WHOLE-SIGN · {placeLabel} · {chart.birth.utcIso} UT
      </p>
    </>
  )
}
