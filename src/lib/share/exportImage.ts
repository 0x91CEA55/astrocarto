/**
 * Client-side share render (UX-SPEC §10). Nothing leaves the browser: the SVG
 * already on screen is rasterized to a canvas and the birth-data line is
 * drawn as text, then handed back as a PNG data URL.
 *
 * The exported SVG is a detached document, not the live page — CSS custom
 * properties from the app's stylesheet (`var(--void-sea)`, etc.) do not
 * resolve there. Literal hex/rgba values are injected as an inline `<style>`
 * on the clone instead of relying on the live cascade.
 */

const EXPORT_STYLE = `
.void-sea{fill:#04050C}
.void-land{fill:rgba(120,110,180,.07);stroke:rgba(150,140,215,.15);stroke-width:.45}
.void-grat{stroke:rgba(140,130,200,.055);fill:none}
.void-limb{stroke:rgba(170,155,235,.16);fill:none}
.void-line{fill:none;stroke-linecap:round;stroke-width:1.7}
.void-heat{fill:none;stroke-linecap:round;stroke-width:28;opacity:.5}
.void-marker{fill:#EDE7FF;opacity:.9}
.void-labels text{fill:#EDE7FF;font:300 15px serif;letter-spacing:.06em}
`

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('failed to rasterize the globe SVG for export'))
    img.src = src
  })
}

export interface ShareImageOptions {
  placeLabel: string
  birthLine: string
  exportScale?: number
}

export async function exportGlobeShareImage(svgEl: SVGSVGElement, opts: ShareImageOptions): Promise<string> {
  const size = svgEl.viewBox.baseVal.width || svgEl.clientWidth || 620
  const scale = opts.exportScale ?? 2

  const clone = svgEl.cloneNode(true) as SVGSVGElement
  clone.setAttribute('width', String(size))
  clone.setAttribute('height', String(size))
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = EXPORT_STYLE
  clone.insertBefore(style, clone.firstChild)

  const svgString = new XMLSerializer().serializeToString(clone)
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)

  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = size * scale
    canvas.height = size * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d canvas context unavailable')

    ctx.fillStyle = '#020308' // --void-bg
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    ctx.textAlign = 'center'
    ctx.fillStyle = '#F6F2FF' // --ink-hi
    ctx.font = `300 ${28 * scale}px Optima, "Palatino Linotype", Palatino, serif`
    ctx.fillText(opts.placeLabel, canvas.width / 2, canvas.height - 70 * scale)

    ctx.fillStyle = '#8F87B4' // --ink-lo
    ctx.font = `300 ${14 * scale}px ui-monospace, "SF Mono", Menlo, monospace`
    ctx.fillText(opts.birthLine, canvas.width / 2, canvas.height - 42 * scale)

    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}
