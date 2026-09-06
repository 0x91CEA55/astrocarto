/**
 * Wikipedia content fetch for the PLACE sheet (poc/UX-SPEC.md §7). Runtime
 * lookup is exact: it takes a `City.wikiTitle` resolved at build time
 * (scripts/resolve-wikidata.mjs), never a GeoNames name matched at runtime —
 * fuzzy name matching returns confidently wrong articles for any place whose
 * name isn't unique (see the four "Kingston" rows in the gazetteer).
 *
 * Data fetch only — no rendering. Whoever renders `extract`/`heroImageUrl`
 * MUST show attribution and a link to `canonicalUrl`: Wikipedia text and most
 * media are CC BY-SA, and that attribution is mandatory, not optional.
 *
 * Privacy note for whoever wires this into the reveal/PLACE flow: calling
 * this function reveals to Wikipedia (and any network observer) which city
 * was looked up, even though birth data itself never leaves the browser.
 * UX-SPEC §7 asks for the top-six candidate places to be prefetched at
 * reveal time specifically to blur that signal — this module doesn't do that
 * on its own, it just makes prefetching cheap (cached, no birth data passed).
 */

const REST_BASE = 'https://en.wikipedia.org/api/rest_v1/page'

export interface WikiSummary {
  title: string
  description: string | null
  extract: string
  /** ~320px, from /page/summary/ — too small for a hero image (UX-SPEC §7). */
  thumbnailUrl: string | null
  /** Larger image from /page/media-list/, when the article has one. */
  heroImageUrl: string | null
  /** Must accompany any use of the text or images above — CC BY-SA requires attribution + link. */
  canonicalUrl: string
}

interface MediaListItem {
  type: string
  original?: { source: string }
  srcset?: Array<{ src: string; scale: string }>
}

function normalizeUrl(url: string): string {
  return url.startsWith('//') ? `https:${url}` : url
}

async function fetchHeroImage(title: string): Promise<string | null> {
  try {
    const res = await fetch(`${REST_BASE}/media-list/${encodeURIComponent(title)}`)
    if (!res.ok) return null
    const json = (await res.json()) as { items?: MediaListItem[] }
    const image = json.items?.find((item) => item.type === 'image' && (item.original || item.srcset?.length))
    if (!image) return null
    const source = image.original?.source ?? image.srcset?.[image.srcset.length - 1]?.src
    return source ? normalizeUrl(source) : null
  } catch {
    // Larger image is a bonus, not a requirement — the summary thumbnail is the fallback.
    return null
  }
}

const cache = new Map<string, Promise<WikiSummary | null>>()

/**
 * Fetches (and caches, in memory, for the session) the Wikipedia summary for
 * an exact article title. Returns null if the article is gone (404) —
 * article titles can move between build time and runtime — never throws for
 * that case. Throws only on an actual network/server failure.
 */
export function fetchWikiSummary(title: string): Promise<WikiSummary | null> {
  const cached = cache.get(title)
  if (cached) return cached

  const promise = (async (): Promise<WikiSummary | null> => {
    const res = await fetch(`${REST_BASE}/summary/${encodeURIComponent(title)}`)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Wikipedia summary fetch failed for "${title}": ${res.status}`)

    const json = (await res.json()) as {
      title: string
      description?: string
      extract: string
      thumbnail?: { source: string }
      content_urls?: { desktop?: { page?: string } }
    }

    const heroImageUrl = await fetchHeroImage(title)

    return {
      title: json.title,
      description: json.description ?? null,
      extract: json.extract,
      thumbnailUrl: json.thumbnail?.source ? normalizeUrl(json.thumbnail.source) : null,
      heroImageUrl,
      canonicalUrl: json.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    }
  })()

  cache.set(title, promise)
  return promise
}
