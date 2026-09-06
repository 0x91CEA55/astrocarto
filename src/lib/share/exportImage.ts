/**
 * Client-side share render (UX-SPEC §10). Nothing leaves the browser: the
 * globe canvas already on screen is drawn onto a fresh (optionally upscaled)
 * canvas, the birth-data line is added as text, and the result is handed
 * back as a PNG data URL.
 *
 * Simpler than it used to be: the globe moved from SVG to a real `<canvas>`
 * (see Globe.tsx), so this is a direct `drawImage` from that canvas — no more
 * XMLSerializer/Blob/Image round-trip to rasterize an SVG. The small ranked-
 * city labels (DOM, not canvas — see Globe.tsx) aren't part of this image;
 * UX-SPEC §10 only calls for the globe, lines, place name, and birth-data
 * line, which is exactly what's drawn here.
 */

export interface ShareImageOptions {
  placeLabel: string
  birthLine: string
  exportScale?: number
}

export async function exportGlobeShareImage(sourceCanvas: HTMLCanvasElement, opts: ShareImageOptions): Promise<string> {
  const size = sourceCanvas.clientWidth || sourceCanvas.width || 620
  const scale = opts.exportScale ?? 2

  const canvas = document.createElement('canvas')
  canvas.width = size * scale
  canvas.height = size * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas context unavailable')

  ctx.fillStyle = '#020308' // --void-bg
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height)

  ctx.textAlign = 'center'
  ctx.fillStyle = '#F6F2FF' // --ink-hi
  ctx.font = `300 ${28 * scale}px Optima, "Palatino Linotype", Palatino, serif`
  ctx.fillText(opts.placeLabel, canvas.width / 2, canvas.height - 70 * scale)

  ctx.fillStyle = '#8F87B4' // --ink-lo
  ctx.font = `300 ${14 * scale}px ui-monospace, "SF Mono", Menlo, monospace`
  ctx.fillText(opts.birthLine, canvas.width / 2, canvas.height - 42 * scale)

  return canvas.toDataURL('image/png')
}
