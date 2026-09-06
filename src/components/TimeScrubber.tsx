import { BODY_NAMES, findCuspWarning, SIGN_NAMES, type Chart } from '../lib/astro'
import { signIndex } from '../lib/astro/dignity'
import { degreeInSignLabel, signOf } from '../lib/theme/copy'
import type { BirthInput } from '../lib/share'

const SCRUB_RANGE_MINUTES = 90

interface TimeScrubberProps {
  birth: BirthInput
  baseUtc: Date
  baseChart: Chart
  activeChart: Chart
  minutes: number
  onMinutesChange: (minutes: number) => void
}

/**
 * Ported from poc/reference/time-scrubber.html, computed live via the actual
 * engine instead of the reference's precomputed frame table — UX-SPEC §11
 * measured line recomputation as free, so there's nothing to precompute.
 *
 * Whole-sign houses only. The reference file's Whole-sign/Placidus toggle is
 * deliberately not ported — ENGINE-SPEC §5 rules out a second house system
 * outright (Placidus fails above ~66.5° latitude; whole-sign doesn't). The
 * house table below instead highlights what moved between the recorded time
 * and the scrubbed one, which is the same lesson without a second system.
 */
export function TimeScrubber({ birth, baseUtc, baseChart, activeChart, minutes, onMinutesChange }: TimeScrubberProps) {
  const [hh, mm] = birth.time.split(':').map(Number)
  const totalMinutes = (((hh * 60 + mm + minutes) % 1440) + 1440) % 1440
  const clock = `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
  const deltaLabel = minutes === 0 ? 'as recorded' : `${minutes > 0 ? '+' : '−'}${Math.abs(minutes)} minute${Math.abs(minutes) === 1 ? '' : 's'}`

  const ascSignIdx = signIndex(activeChart.angles.ascDeg)
  const baseAscSignIdx = signIndex(baseChart.angles.ascDeg)

  const cusp = findCuspWarning(baseUtc, minutes, birth.lat, birth.lon, ascSignIdx)

  const movedHouses = BODY_NAMES.filter((b) => activeChart.housesOf[b] !== baseChart.housesOf[b])

  return (
    <>
      <h2>What birth time decides</h2>
      <div className="void-cc">drag to change the birth time · everything below follows from it</div>

      <div className="void-scrub-idcard">
        {(
          [
            ['Sun', activeChart.positions.Sun.eclLon, baseChart.positions.Sun.eclLon],
            ['Moon', activeChart.positions.Moon.eclLon, baseChart.positions.Moon.eclLon],
            ['Rising', activeChart.angles.ascDeg, baseChart.angles.ascDeg],
          ] as const
        ).map(([label, eclLon, baseEclLon]) => {
          const changed = signIndex(eclLon) !== signIndex(baseEclLon)
          return (
            <div className="void-scrub-cell" key={label}>
              <div className="void-k">{label.toUpperCase()}</div>
              <div className={changed ? 'void-scrub-v warn' : 'void-scrub-v'}>{signOf(eclLon)}</div>
              <div className="void-scrub-d">{degreeInSignLabel(eclLon)}</div>
            </div>
          )
        })}
      </div>

      {cusp && (
        <p className="void-scrub-flip">
          {cusp.minutesAway} minute{cusp.minutesAway === 1 ? '' : 's'} {cusp.direction} and the rising sign is {cusp.sign}.
        </p>
      )}

      <div className="void-scrub-dock">
        <div className="void-scrub-clock">{clock}</div>
        <div className="void-faint">{deltaLabel}</div>
        <input
          type="range"
          min={-SCRUB_RANGE_MINUTES}
          max={SCRUB_RANGE_MINUTES}
          step={1}
          value={minutes}
          onChange={(e) => onMinutesChange(Number(e.target.value))}
          aria-label="Adjust birth time in minutes"
        />
        {minutes !== 0 && (
          <button type="button" className="void-link" onClick={() => onMinutesChange(0)}>
            reset to {birth.time}
          </button>
        )}
      </div>

      <div className="void-near">
        <div className="void-k">WHOLE-SIGN HOUSE, AT THIS OFFSET</div>
        <div className="void-ro">
          {BODY_NAMES.map((b) => (
            <div key={b} className={activeChart.housesOf[b] !== baseChart.housesOf[b] ? 'void-scrub-house-moved' : undefined}>
              <span className="void-b">{b}</span>
              <span>{activeChart.housesOf[b]}</span>
            </div>
          ))}
        </div>
        <p className="void-faint" style={{ marginTop: 10 }}>
          {movedHouses.length === 0
            ? 'No planet has moved to a different house at this offset.'
            : `${movedHouses.length} of 10 planets sit in a different house than at the recorded time.`}
        </p>
      </div>

      {ascSignIdx !== baseAscSignIdx && (
        <p className="void-prov">
          The rising sign has changed from {SIGN_NAMES[baseAscSignIdx]} to {SIGN_NAMES[ascSignIdx]} at this offset — every
          whole-sign house above shifts with it.
        </p>
      )}
    </>
  )
}
