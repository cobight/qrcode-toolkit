/**
 * A tiny drawing interface shared by the canvas renderer and the SVG renderer,
 * so one single drawing routine can emit both raster and vector output.
 */
export interface Painter {
  fillStyle: string
  fillRect: (x: number, y: number, width: number, height: number) => void
  beginPath: () => void
  moveTo: (x: number, y: number) => void
  lineTo: (x: number, y: number) => void
  arc: (x: number, y: number, radius: number, startAngle: number, endAngle: number) => void
  arcTo: (x1: number, y1: number, x2: number, y2: number, radius: number) => void
  closePath: () => void
  fill: () => void
}

export interface PainterOptions {
  /** Paint on a transparent surface, turning the background color into an eraser. */
  transparent?: boolean
  /** Color of the background. Shapes drawn in it will erase instead of paint when transparent. */
  backgroundColor?: string
  /** Size of one QR module, used to ignore erasing shapes that are no-op. */
  cell?: number
}

/**
 * Colors used by the generator are always hex. `#rgb`, `#rgba`, `#rrggbb` and
 * `#rrggbbaa` are all supported, alpha is split out for SVG compatibility.
 */
export function normalizeColor(color: string): { color: string, opacity: number } {
  const value = color.trim().toLowerCase()

  if (value.startsWith('#')) {
    const hex = value.slice(1)

    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a] = hex.split('')
      return {
        color: `#${r}${r}${g}${g}${b}${b}`,
        opacity: a
          ? Number.parseInt(`${a}${a}`, 16) / 255
          : 1,
      }
    }

    if (hex.length === 6 || hex.length === 8) {
      return {
        color: `#${hex.slice(0, 6)}`,
        opacity: hex.length === 8
          ? Number.parseInt(hex.slice(6), 16) / 255
          : 1,
      }
    }
  }

  return { color: value, opacity: 1 }
}

export function isSameColor(a: string, b: string) {
  return normalizeColor(a).color === normalizeColor(b).color
}

/**
 * Raster painter on top of a 2D canvas context.
 *
 * When `transparent` is enabled the background color is never painted, it is
 * erased with `destination-out` instead, which keeps the alpha channel clean
 * while producing the exact same shape as the opaque rendering.
 */
export class CanvasPainter implements Painter {
  fillStyle = '#000000'

  private readonly backgroundColor?: string
  private erasing = false

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    options: PainterOptions = {},
  ) {
    if (options.transparent && options.backgroundColor)
      this.backgroundColor = normalizeColor(options.backgroundColor).color
  }

  private get shouldErase() {
    return !!this.backgroundColor && isSameColor(this.fillStyle, this.backgroundColor)
  }

  private sync() {
    const erasing = this.shouldErase
    if (erasing !== this.erasing) {
      this.ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over'
      this.erasing = erasing
    }
    this.ctx.fillStyle = erasing ? '#000000' : this.fillStyle
  }

  fillRect(x: number, y: number, width: number, height: number) {
    this.sync()
    this.ctx.fillRect(x, y, width, height)
  }

  beginPath() {
    this.ctx.beginPath()
  }

  moveTo(x: number, y: number) {
    this.ctx.moveTo(x, y)
  }

  lineTo(x: number, y: number) {
    this.ctx.lineTo(x, y)
  }

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number) {
    this.ctx.arc(x, y, radius, startAngle, endAngle)
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number) {
    this.ctx.arcTo(x1, y1, x2, y2, radius)
  }

  closePath() {
    this.ctx.closePath()
  }

  fill() {
    this.sync()
    this.ctx.fill()
  }
}

/**
 * Replace a flat two color rendering with a transparent one: the background
 * color becomes fully transparent, the ink color stays opaque, and every
 * anti-aliased pixel in between gets a matching alpha value.
 *
 * Used when an effect (blur based) has been applied, as those need an opaque
 * surface to sample from.
 */
export function alphaKeyBackground(
  imageData: ImageData,
  backgroundColor: string,
  inkColor: string,
) {
  const bg = normalizeColor(backgroundColor)
  const ink = normalizeColor(inkColor)
  const bgRgb = hexToRgb(bg.color)
  const inkRgb = hexToRgb(ink.color)

  if (!bgRgb || !inkRgb)
    return imageData

  const delta = [
    bgRgb[0] - inkRgb[0],
    bgRgb[1] - inkRgb[1],
    bgRgb[2] - inkRgb[2],
  ]
  const deltaLength = delta[0] ** 2 + delta[1] ** 2 + delta[2] ** 2

  if (deltaLength === 0)
    return imageData

  const data = imageData.data

  for (let i = 0; i < data.length; i += 4) {
    const mix = (
      (data[i] - inkRgb[0]) * delta[0]
      + (data[i + 1] - inkRgb[1]) * delta[1]
      + (data[i + 2] - inkRgb[2]) * delta[2]
    ) / deltaLength

    const alpha = 1 - Math.min(1, Math.max(0, mix))
    data[i] = inkRgb[0]
    data[i + 1] = inkRgb[1]
    data[i + 2] = inkRgb[2]
    data[i + 3] = Math.round(alpha * (data[i + 3] / 255) * 255)
  }

  return imageData
}

function hexToRgb(color: string): [number, number, number] | undefined {
  const match = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/)
  if (!match)
    return
  return [
    Number.parseInt(match[1], 16),
    Number.parseInt(match[2], 16),
    Number.parseInt(match[3], 16),
  ]
}
