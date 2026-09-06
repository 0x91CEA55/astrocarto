#!/usr/bin/env python3
"""
astrocarto.py - deterministic astrocartography line computation.

Given birth date/time/place, emits planetary AC/DC/MC/IC lines as GeoJSON,
ranks a city gazetteer by proximity to those lines, and finds paran crossings.

Everything here is closed-form: same input -> byte-identical output.
The ONLY judgement calls are the config constants at the top (orb, bodies,
line definition). Interpretation is explicitly out of scope.

Requires: pyswisseph
Optional: matplotlib (for --map)
"""
from __future__ import annotations
import argparse, json, math, sys, itertools
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta, timezone

import swisseph as swe

# ---------------------------------------------------------------- config
BODIES = {
    "Sun": swe.SUN, "Moon": swe.MOON, "Mercury": swe.MERCURY, "Venus": swe.VENUS,
    "Mars": swe.MARS, "Jupiter": swe.JUPITER, "Saturn": swe.SATURN,
    "Uranus": swe.URANUS, "Neptune": swe.NEPTUNE, "Pluto": swe.PLUTO,
    "NorthNode": swe.TRUE_NODE,
}
ANGLES = ("AC", "DC", "MC", "IC")
LAT_MIN, LAT_MAX, LAT_STEP = -75.0, 75.0, 0.25   # sampling for curved lines
SIGNS = ["Ari","Tau","Gem","Can","Leo","Vir","Lib","Sco","Sag","Cap","Aqu","Pis"]

# Essential dignity table -- used only to flag line strength, not to interpret.
DIGNITY = {
    "Sun":     {"domicile": [4],        "exalt": [0],  "detriment": [10], "fall": [6]},
    "Moon":    {"domicile": [3],        "exalt": [1],  "detriment": [9],  "fall": [7]},
    "Mercury": {"domicile": [2, 5],     "exalt": [5],  "detriment": [8, 11], "fall": [11]},
    "Venus":   {"domicile": [1, 6],     "exalt": [11], "detriment": [0, 7],  "fall": [5]},
    "Mars":    {"domicile": [0, 7],     "exalt": [9],  "detriment": [1, 6],  "fall": [3]},
    "Jupiter": {"domicile": [8, 11],    "exalt": [3],  "detriment": [2, 5],  "fall": [9]},
    "Saturn":  {"domicile": [9, 10],    "exalt": [6],  "detriment": [3, 4],  "fall": [0]},
}

# ---------------------------------------------------------------- helpers
def wrap180(x: float) -> float:
    return (x + 180.0) % 360.0 - 180.0


def dms(lon_ecl: float) -> str:
    s = int(lon_ecl // 30) % 12
    d = lon_ecl - 30 * (lon_ecl // 30)
    return f"{int(d):02d}\u00b0{SIGNS[s]}{int((d % 1) * 60):02d}'"


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    R = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(wrap180(lon2 - lon1))
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(min(1.0, math.sqrt(a)))


# ---------------------------------------------------------------- core
@dataclass
class Birth:
    jd_ut: float
    gst_deg: float
    lat: float
    lon: float
    utc_iso: str


def make_birth(date_str: str, time_str: str, lat: float, lon: float,
               tz: str | None, utc_offset: float | None) -> Birth:
    """Build the UT anchor. Timezone handling is the #1 source of wrong charts."""
    y, mo, d = (int(v) for v in date_str.split("-"))
    hh, mm = (int(v) for v in time_str.split(":"))
    naive = datetime(y, mo, d, hh, mm)

    if utc_offset is not None:
        aware = naive.replace(tzinfo=timezone(timedelta(hours=utc_offset)))
    elif tz:
        from zoneinfo import ZoneInfo          # historical DST rules from tzdata
        aware = naive.replace(tzinfo=ZoneInfo(tz))
    else:
        raise SystemExit("need --tz or --utc-offset; do not guess")

    u = aware.astimezone(timezone.utc)
    jd = swe.julday(u.year, u.month, u.day, u.hour + u.minute / 60 + u.second / 3600)
    return Birth(jd, swe.sidtime(jd) * 15.0, lat, lon, u.isoformat())


def positions(b: Birth) -> dict:
    """Equatorial + ecliptic coords for every body. Deterministic."""
    out = {}
    for name, pid in BODIES.items():
        try:
            ecl = swe.calc_ut(b.jd_ut, pid, swe.FLG_SWIEPH | swe.FLG_SPEED)[0]
            eq = swe.calc_ut(b.jd_ut, pid, swe.FLG_SWIEPH | swe.FLG_EQUATORIAL)[0]
        except Exception as e:
            print(f"  ! skipping {name}: {e}", file=sys.stderr)
            continue
        sign = int(ecl[0] // 30) % 12
        dg = DIGNITY.get(name, {})
        state = ("exalted" if sign in dg.get("exalt", []) else
                 "domicile" if sign in dg.get("domicile", []) else
                 "fall" if sign in dg.get("fall", []) else
                 "detriment" if sign in dg.get("detriment", []) else "peregrine")
        out[name] = {"ra": eq[0], "dec": eq[1], "ecl_lon": ecl[0],
                     "speed": ecl[3], "retrograde": ecl[3] < 0,
                     "pos": dms(ecl[0]), "dignity": state}
    return out


def line_longitude(p: dict, angle: str, phi: float, gst: float) -> float | None:
    """Terrestrial longitude at which `p` sits on `angle`, at latitude phi.

    In-mundo definition: the physical body on the horizon / meridian.
    (Zodiacal-ASC variants exist and give slightly different curves --
    see the note in --help. This is a spec choice, not a fact.)
    """
    ra, dec = p["ra"], p["dec"]
    if angle == "MC":
        return wrap180(ra - gst)
    if angle == "IC":
        return wrap180(ra + 180.0 - gst)
    c = -math.tan(math.radians(phi)) * math.tan(math.radians(dec))
    if abs(c) > 1.0:
        return None                       # circumpolar: never rises or sets here
    H = math.degrees(math.acos(c))
    return wrap180(ra - H - gst) if angle == "AC" else wrap180(ra + H - gst)


def build_lines(pos: dict, gst: float) -> dict:
    """All 4*N lines as lists of (lon, lat), split at the antimeridian."""
    lines = {}
    lats = [LAT_MIN + i * LAT_STEP
            for i in range(int((LAT_MAX - LAT_MIN) / LAT_STEP) + 1)]
    for name, p in pos.items():
        for ang in ANGLES:
            sample = [-89.0, 89.0] if ang in ("MC", "IC") else lats
            segs, cur = [], []
            for phi in sample:
                L = line_longitude(p, ang, phi, gst)
                if L is None:
                    if cur: segs.append(cur); cur = []
                    continue
                if cur and abs(L - cur[-1][0]) > 180:   # dateline wrap
                    segs.append(cur); cur = []
                cur.append((L, phi))
            if cur: segs.append(cur)
            lines[f"{name}-{ang}"] = [s for s in segs if len(s) > 1]
    return lines


def distance_to_line(pos_p: dict, angle: str, gst: float,
                     lat: float, lon: float) -> float:
    """Shortest distance from a point to a line, measured along its latitude."""
    L = line_longitude(pos_p, angle, lat, gst)
    if L is None:
        return float("inf")
    return haversine_km(lat, lon, lat, L)


def rank_cities(pos: dict, gst: float, gazetteer: dict,
                orb_km: float) -> list[tuple]:
    hits = []
    for city, (la, lo) in gazetteer.items():
        for name, p in pos.items():
            for ang in ANGLES:
                d = distance_to_line(p, ang, gst, la, lo)
                if d <= orb_km:
                    hits.append((round(d, 1), city, f"{name}-{ang}",
                                 p["dignity"], p["retrograde"]))
    return sorted(hits)


def parans(pos: dict, gst: float, bodies: list[str] | None = None) -> list[dict]:
    """Latitudes where two lines cross (both planets angular simultaneously)."""
    names = bodies or list(pos.keys())
    out = []
    lats = [LAT_MIN + i * LAT_STEP
            for i in range(int((LAT_MAX - LAT_MIN) / LAT_STEP) + 1)]
    for a, b in itertools.combinations(names, 2):
        for ka in ANGLES:
            for kb in ANGLES:
                prev = None
                for phi in lats:
                    la = line_longitude(pos[a], ka, phi, gst)
                    lb = line_longitude(pos[b], kb, phi, gst)
                    if la is None or lb is None:
                        prev = None; continue
                    d = wrap180(la - lb)
                    if prev and prev[1] * d < 0 and abs(prev[1] - d) < 180:
                        mid = (prev[0] + phi) / 2
                        out.append({"pair": f"{a}-{ka} x {b}-{kb}",
                                    "lat": round(mid, 2),
                                    "lon": round(line_longitude(pos[a], ka, mid, gst), 2)})
                    prev = (phi, d)
    return out


def to_geojson(lines: dict) -> dict:
    feats = []
    for key, segs in lines.items():
        if not segs: continue
        body, ang = key.split("-")
        feats.append({
            "type": "Feature",
            "properties": {"body": body, "angle": ang, "id": key},
            "geometry": {"type": "MultiLineString",
                         "coordinates": [[[round(x, 4), round(y, 4)] for x, y in s]
                                         for s in segs]},
        })
    return {"type": "FeatureCollection", "features": feats}


DEFAULT_GAZETTEER = {
    "London": (51.51, -0.13), "Paris": (48.86, 2.35), "Berlin": (52.52, 13.40),
    "Turin": (45.07, 7.69), "Zurich": (47.37, 8.54), "Rome": (41.90, 12.50),
    "Madrid": (40.42, -3.70), "Lisbon": (38.72, -9.14), "Athens": (37.98, 23.73),
    "Istanbul": (41.01, 28.98), "Stockholm": (59.33, 18.07), "Dublin": (53.35, -6.26),
    "New York": (40.71, -74.01), "Toronto": (43.65, -79.38), "Ottawa": (45.42, -75.70),
    "Vancouver": (49.28, -123.12), "Chicago": (41.88, -87.63), "Denver": (39.74, -104.99),
    "Los Angeles": (34.05, -118.24), "San Francisco": (37.77, -122.42),
    "Seattle": (47.61, -122.33), "Austin": (30.27, -97.74), "Miami": (25.76, -80.19),
    "Washington DC": (38.90, -77.04), "Mexico City": (19.43, -99.13),
    "Bogota": (4.71, -74.07), "Lima": (-12.05, -77.04), "Santiago": (-33.45, -70.67),
    "Buenos Aires": (-34.60, -58.38), "Sao Paulo": (-23.55, -46.63), "Rio": (-22.91, -43.17),
    "Cairo": (30.04, 31.24), "Lagos": (6.52, 3.38), "Nairobi": (-1.29, 36.82),
    "Cape Town": (-33.92, 18.42), "Dubai": (25.20, 55.27), "Tel Aviv": (32.08, 34.78),
    "Delhi": (28.61, 77.21), "Mumbai": (19.08, 72.88), "Bangkok": (13.76, 100.50),
    "Singapore": (1.35, 103.82), "Hong Kong": (22.32, 114.17), "Shanghai": (31.23, 121.47),
    "Beijing": (39.90, 116.41), "Seoul": (37.57, 126.98), "Tokyo": (35.68, 139.65),
    "Jakarta": (-6.21, 106.85), "Bali": (-8.65, 115.22), "Manila": (14.60, 120.98),
    "Sydney": (-33.87, 151.21), "Melbourne": (-37.81, 144.96), "Brisbane": (-27.47, 153.03),
    "Perth": (-31.95, 115.86), "Auckland": (-36.85, 174.76), "Honolulu": (21.31, -157.86),
}


def render_map(lines: dict, world_geojson: str, out_png: str, title: str):
    import matplotlib; matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.lines import Line2D
    palette = ["#ff5fa2", "#ffb020", "#7fd4ff", "#ffe45c", "#9d7bff",
               "#5cffa8", "#ff7a5c", "#7f8ea3", "#c98bff", "#5cd0ff", "#b0b8c8"]
    colors = {b: palette[i % len(palette)] for i, b in enumerate(BODIES)}

    fig, ax = plt.subplots(figsize=(17, 9), dpi=130)
    fig.patch.set_facecolor("#0f1117"); ax.set_facecolor("#0f1117")
    world = json.load(open(world_geojson))
    for feat in world["features"]:
        g = feat["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for poly in polys:
            for ring in poly:
                xs = [c[0] for c in ring]; ys = [c[1] for c in ring]
                ax.fill(xs, ys, color="#232838", zorder=0)
                ax.plot(xs, ys, color="#59637d", lw=0.6, zorder=1)

    for key, segs in lines.items():
        body, ang = key.split("-")
        style = "-" if ang in ("AC", "DC") else "--"
        for s in segs:
            ax.plot([p[0] for p in s], [p[1] for p in s], style,
                    color=colors[body], lw=1.8, alpha=0.95, zorder=3)
        if segs:
            mid = segs[0][len(segs[0]) // 2]
            ax.text(mid[0], mid[1], f" {body[:3]} {ang}", color=colors[body],
                    fontsize=7, fontweight="bold", zorder=4)

    ax.set_xlim(-180, 180); ax.set_ylim(-60, 80); ax.set_aspect(1.25)
    ax.set_xticks([]); ax.set_yticks([])
    for sp in ax.spines.values(): sp.set_visible(False)
    ax.set_title(title, color="white", fontsize=12, pad=12)
    ax.legend(handles=[Line2D([], [], color=c, lw=2, label=b)
                       for b, c in colors.items()],
              loc="lower left", facecolor="#161923", edgecolor="#3a4152",
              labelcolor="white", fontsize=8, ncol=2)
    plt.tight_layout(); plt.savefig(out_png, facecolor=fig.get_facecolor())


def main():
    ap = argparse.ArgumentParser(
        description="Deterministic astrocartography lines from birth data.",
        epilog="NOTE: AC/DC lines use the in-mundo definition (body physically on "
               "the horizon). Some software uses zodiacal ASC instead; curves differ "
               "by a few degrees at high latitude. Neither is 'correct' -- it is a "
               "spec choice. MC/IC are unambiguous.")
    ap.add_argument("--date", required=True, help="YYYY-MM-DD (local)")
    ap.add_argument("--time", required=True, help="HH:MM 24h (local)")
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True, help="east positive")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--tz", help="IANA zone, e.g. America/Toronto (uses historical DST)")
    g.add_argument("--utc-offset", type=float, help="e.g. -5 for EST")
    ap.add_argument("--orb-km", type=float, default=250.0)
    ap.add_argument("--geojson", help="write line GeoJSON here")
    ap.add_argument("--map", dest="map_png", help="write PNG map here")
    ap.add_argument("--world", default="world.json", help="Natural Earth GeoJSON")
    ap.add_argument("--parans", action="store_true")
    ap.add_argument("--json", action="store_true", help="machine-readable stdout")
    a = ap.parse_args()

    b = make_birth(a.date, a.time, a.lat, a.lon, a.tz, a.utc_offset)
    pos = positions(b)
    lines = build_lines(pos, b.gst_deg)
    hits = rank_cities(pos, b.gst_deg, DEFAULT_GAZETTEER, a.orb_km)
    par = parans(pos, b.gst_deg, ["Sun", "Moon", "Venus", "Jupiter"]) if a.parans else []

    if a.json:
        print(json.dumps({"birth": asdict(b), "positions": pos,
                          "city_hits": hits, "parans": par}, indent=2))
    else:
        print(f"UT anchor : {b.utc_iso}   JD {b.jd_ut:.6f}   GST {b.gst_deg:.4f}\u00b0\n")
        print(f"{'BODY':<10} {'POSITION':<12} {'RA':>9} {'DEC':>8}  DIGNITY")
        for n, p in pos.items():
            r = " R" if p["retrograde"] else ""
            print(f"{n:<10} {p['pos']:<12} {p['ra']:9.4f} {p['dec']:8.4f}  "
                  f"{p['dignity']}{r}")
        print(f"\nCITIES WITHIN {a.orb_km:.0f} km OF A LINE")
        for d, city, key, dig, retro in hits:
            flag = f"  [{dig}{', R' if retro else ''}]" if dig != "peregrine" else ""
            print(f"  {d:7.1f} km  {city:<16} {key}{flag}")
        if par:
            print("\nPARAN CROSSINGS (Sun/Moon/Venus/Jupiter)")
            for p in par:
                print(f"  {p['pair']:<28} lat {p['lat']:7.2f}  lon {p['lon']:8.2f}")

    if a.geojson:
        json.dump(to_geojson(lines), open(a.geojson, "w"))
        print(f"\nwrote {a.geojson}", file=sys.stderr)
    if a.map_png:
        render_map(lines, a.world, a.map_png,
                   f"Astrocartography \u2014 {a.date} {a.time} @ {a.lat:.2f},{a.lon:.2f}")
        print(f"wrote {a.map_png}", file=sys.stderr)


if __name__ == "__main__":
    main()
