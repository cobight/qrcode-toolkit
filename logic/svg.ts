import type { CenterIconLayout } from './icon'
import type { Painter, PainterOptions } from './painter'
import type { QRCodeGeneratorState } from './types'
import { createQrLayout, getBackgroundColor, paintQr } from './draw'
import { generateQRCode } from './generate'
import { CenterIconLimits } from './icon'
import { normalizeColor } from './painter'

export interface GenerateSVGOptions {
  /** Render the QR code on a transparent background. */
  transparent?: boolean
}

interface SvgPainterOptions extends PainterOptions {
  width: number
  height: number
}

function num(value: number) {
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0)
    ? '0'
    : String(rounded)
}

/**
 * Vector painter. Every canvas primitive is translated into an SVG path, so the
 * output stays editable and infinitely scalable.
 *
 * Erasing (transparent background) is expressed with a `<mask>`: everything
 * painted so far gets wrapped into a masked group, which reproduces the canvas
 * `destination-out` composite exactly.
 */
export class SvgPainter implements Painter {
  fillStyle = '#000000'

  private readonly width: number
  private readonly height: number
  private readonly cell?: number
  private readonly backgroundColor?: string

  private readonly defs: string[] = []
  private body: string[] = []
  private chunk: string[] = []
  private chunkColor = ''
  private commands: string[] = []
  private current: [number, number] | null = null
  private start: [number, number] | null = null
  private bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  }

  private maskCount = 0

  constructor(options: SvgPainterOptions) {
    this.width = options.width
    this.height = options.height
    this.cell = options.cell
    if (options.transparent && options.backgroundColor)
      this.backgroundColor = normalizeColor(options.backgroundColor).color
  }

  /** Flush pending shapes and return the document fragments. */
  finish() {
    this.flushChunk()
    return {
      defs: this.defs,
      content: this.body.join(''),
    }
  }

  fillRect(x: number, y: number, width: number, height: number) {
    if (this.commands.length)
      this.fill()

    this.commands.push(`M${num(x)} ${num(y)}H${num(x + width)}V${num(y + height)}H${num(x)}Z`)
    this.extend(x, y)
    this.extend(x + width, y + height)
    this.fill()
  }

  beginPath() {
    this.commands = []
    this.current = null
    this.start = null
    this.bounds = {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    }
  }

  moveTo(x: number, y: number) {
    this.commands.push(`M${num(x)} ${num(y)}`)
    this.current = [x, y]
    this.start = [x, y]
    this.extend(x, y)
  }

  lineTo(x: number, y: number) {
    if (!this.commands.length) {
      this.moveTo(x, y)
      return
    }
    this.commands.push(`L${num(x)} ${num(y)}`)
    this.current = [x, y]
    this.extend(x, y)
  }

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number) {
    const from: [number, number] = [
      x + radius * Math.cos(startAngle),
      y + radius * Math.sin(startAngle),
    ]

    if (!this.commands.length)
      this.moveTo(from[0], from[1])
    else
      this.lineTo(from[0], from[1])

    const to: [number, number] = [
      x + radius * Math.cos(endAngle),
      y + radius * Math.sin(endAngle),
    ]

    const sweep = endAngle > startAngle
      ? 1
      : 0
    const delta = Math.abs(endAngle - startAngle)

    if (delta >= Math.PI * 2 - 1e-3) {
      // a full circle cannot be expressed with a single arc segment
      const midAngle = (startAngle + endAngle) / 2
      const mid: [number, number] = [
        x + radius * Math.cos(midAngle),
        y + radius * Math.sin(midAngle),
      ]
      this.commands.push(`A${num(radius)} ${num(radius)} 0 0 ${sweep} ${num(mid[0])} ${num(mid[1])}`)
      this.commands.push(`A${num(radius)} ${num(radius)} 0 0 ${sweep} ${num(to[0])} ${num(to[1])}`)
    }
    else {
      const largeArc = delta > Math.PI
        ? 1
        : 0
      this.commands.push(`A${num(radius)} ${num(radius)} 0 ${largeArc} ${sweep} ${num(to[0])} ${num(to[1])}`)
    }

    this.extend(x - radius, y - radius)
    this.extend(x + radius, y + radius)
    this.current = to
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number) {
    const [x0, y0] = this.current ?? [x1, y1]

    if ((x0 === x1 && y0 === y1) || (x1 === x2 && y1 === y2)) {
      this.lineTo(x1, y1)
      return
    }

    const fromAngle = Math.atan2(y0 - y1, x0 - x1)
    const toAngle = Math.atan2(y2 - y1, x2 - x1)
    let delta = toAngle - fromAngle
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2

    const tanHalf = Math.tan(Math.abs(delta) / 2)

    if (!Number.isFinite(tanHalf) || tanHalf < 1e-6) {
      this.lineTo(x1, y1)
      return
    }

    const length1 = Math.hypot(x0 - x1, y0 - y1)
    const length2 = Math.hypot(x2 - x1, y2 - y1)
    const maxTangent = Math.min(length1, length2)

    let tangent = radius / tanHalf
    let arcRadius = radius
    // canvas shrinks the arc when it would not fit into the given corner
    if (tangent > maxTangent) {
      tangent = maxTangent
      arcRadius = maxTangent * tanHalf
    }

    const startPoint: [number, number] = [
      x1 + (x0 - x1) / length1 * tangent,
      y1 + (y0 - y1) / length1 * tangent,
    ]
    const endPoint: [number, number] = [
      x1 + (x2 - x1) / length2 * tangent,
      y1 + (y2 - y1) / length2 * tangent,
    ]

    this.lineTo(startPoint[0], startPoint[1])
    // The arc turns the opposite way of the ray rotation, so the sweep flag is
    // inverted compared to a plain arc() call.
    this.commands.push(`A${num(arcRadius)} ${num(arcRadius)} 0 0 ${delta > 0
      ? 0
      : 1} ${num(endPoint[0])} ${num(endPoint[1])}`)
    this.extend(endPoint[0], endPoint[1])
    this.current = endPoint
  }

  closePath() {
    if (!this.commands.length)
      return
    this.commands.push('Z')
    this.current = this.start
  }

  fill() {
    const commands = this.commands.join('')
    const bounds = this.bounds
    this.commands = []
    this.current = null
    this.start = null
    this.bounds = {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    }

    if (!commands)
      return

    const { color, opacity } = normalizeColor(this.fillStyle)

    if (this.backgroundColor && color === this.backgroundColor) {
      // Micro shapes of a single module are drawn over and over in the background
      // color. They sit on top of the background already, so erasing them is a
      // no-op and only wastes a mask in the vector output.
      const size = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
      if (this.cell && size <= this.cell * 1.05)
        return

      this.flushChunk()
      this.wrapWithMask(commands)
      return
    }

    // A single path is filled as one union, while a canvas composites every shape on
    // its own: with a translucent color the overlaps have to darken like the canvas
    // does, so each shape stays a separate path. Opaque colors are merged instead —
    // the union renders with a single antialiased edge instead of a seam per shape.
    if (opacity !== 1) {
      this.flushChunk()
      this.chunkColor = this.fillStyle
      this.chunk.push(commands)
      this.flushChunk()
      return
    }

    if (this.chunkColor !== this.fillStyle) {
      this.flushChunk()
      this.chunkColor = this.fillStyle
    }
    this.chunk.push(commands)
  }

  private extend(x: number, y: number) {
    this.bounds.minX = Math.min(this.bounds.minX, x)
    this.bounds.minY = Math.min(this.bounds.minY, y)
    this.bounds.maxX = Math.max(this.bounds.maxX, x)
    this.bounds.maxY = Math.max(this.bounds.maxY, y)
  }

  private flushChunk() {
    if (!this.chunk.length)
      return

    const { color, opacity } = normalizeColor(this.chunkColor)
    const alpha = Math.round(opacity * 1000) / 1000

    this.body.push(
      `<path d="${this.chunk.join('')}" fill="${color}"${alpha === 1
        ? ''
        : ` fill-opacity="${alpha}"`}/>`,
    )
    this.chunk = []
  }

  private wrapWithMask(commands: string) {
    const id = `qr-mask-${++this.maskCount}`
    const width = num(this.width)
    const height = num(this.height)

    this.defs.push(
      `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">`
      + `<rect x="0" y="0" width="${width}" height="${height}" fill="#fff"/>`
      + `<path d="${commands}" fill="#000"/>`
      + `</mask>`,
    )

    this.body = [`<g mask="url(#${id})">${this.body.join('')}</g>`]
  }
}

/**
 * Build an SVG document for the given state.
 *
 * Everything that only exists in pixel space (blur and perspective effects) is
 * embedded as a raster image, the rest is exported as real vector paths.
 */
export async function generateQRCodeSVG(
  state: QRCodeGeneratorState,
  options: GenerateSVGOptions = {},
) {
  const { transparent = false } = options

  if (needsRasterFallback(state))
    return generateRasterSVG(state, { transparent })

  const layout = createQrLayout(state)
  const { width, height } = layout

  const painter = new SvgPainter({
    width,
    height,
    cell: layout.cell,
    transparent,
    backgroundColor: getBackgroundColor(state),
  })

  paintQr(painter, layout, state)
  const { defs, content } = painter.finish()

  const layers: string[] = []

  const background = await createBackgroundLayer(state, width, height)
  if (background)
    layers.push(background)

  layers.push(content)

  // The icon sits on the working canvas, on top of the modules, so it belongs to
  // the same layer list (and therefore to the same transformScale group).
  const iconLayer = layout.icon
    ? await createIconLayer(layout.icon, {
        transparent,
        backgroundColor: getBackgroundColor(state),
      })
    : undefined
  if (iconLayer)
    layers.push(iconLayer.body)

  // The flat background is painted in output space, while everything drawn on
  // the working canvas (background image included) is scaled around the center.
  const { transformScale: scale } = state
  const scaled = scale === 1
    ? layers.join('')
    : `<g transform="translate(${num(width / 2)} ${num(height / 2)}) scale(${num(scale)}) translate(${num(-width / 2)} ${num(-height / 2)})">${layers.join('')}</g>`

  const body = transparent
    ? scaled
    : `${createFlatBackground(state, width, height)}${scaled}`

  return wrapDocument({
    width,
    height,
    defs: iconLayer
      ? [
          ...defs,
          ...iconLayer.defs,
        ]
      : defs,
    body,
  })
}

function createFlatBackground(state: QRCodeGeneratorState, width: number, height: number) {
  const { color, opacity } = normalizeColor(getBackgroundColor(state))
  return `<rect x="0" y="0" width="${num(width)}" height="${num(height)}" fill="${color}"${opacity === 1
    ? ''
    : ` fill-opacity="${num(opacity)}"`}/>`
}

/** Effects and perspective distortion have no vector representation. */
function needsRasterFallback(state: QRCodeGeneratorState) {
  return state.effect !== 'none'
    || state.transformPerspectiveX !== 0
    || state.transformPerspectiveY !== 0
}

async function generateRasterSVG(
  state: QRCodeGeneratorState,
  options: GenerateSVGOptions,
) {
  const canvas = document.createElement('canvas')
  await generateQRCode(canvas, state, { transparent: options.transparent })

  const png = canvas.toDataURL('image/png')

  return wrapDocument({
    width: canvas.width,
    height: canvas.height,
    defs: [],
    body: `<image href="${png}" x="0" y="0" width="${canvas.width}" height="${canvas.height}" preserveAspectRatio="none"/>`,
  })
}

async function createBackgroundLayer(state: QRCodeGeneratorState, width: number, height: number) {
  const image = state.backgroundImage
  if (!image)
    return ''

  if (image.startsWith('#')) {
    const { color, opacity } = normalizeColor(image)
    return `<rect x="0" y="0" width="${num(width)}" height="${num(height)}" fill="${color}"${opacity === 1
      ? ''
      : ` fill-opacity="${num(opacity)}"`}/>`
  }

  const element = await loadImage(image)
  if (!element)
    return ''

  const imageRatio = element.width / element.height
  const canvasRatio = width / height

  if (imageRatio < canvasRatio) {
    const imageHeight = width / imageRatio
    return `<image href="${escapeAttribute(image)}" x="0" y="${num((height - imageHeight) / 2)}" width="${num(width)}" height="${num(imageHeight)}" preserveAspectRatio="none"/>`
  }

  const imageWidth = height * imageRatio
  return `<image href="${escapeAttribute(image)}" x="${num((width - imageWidth) / 2)}" y="0" width="${num(imageWidth)}" height="${num(height)}" preserveAspectRatio="none"/>`
}

/**
 * Center icon layer: optional plate (background color filling the gap) plus the
 * bitmap itself, clipped to the rounded square. Mirrors `drawCenterIcon` in
 * `logic/icon.ts` — the plate is skipped on transparent exports, and a decode
 * failure silently drops the layer instead of failing the whole document.
 */
async function createIconLayer(
  icon: CenterIconLayout,
  options: { transparent: boolean, backgroundColor: string },
): Promise<{ defs: string[], body: string } | undefined> {
  const image = await loadImage(icon.src)
  if (!image)
    return undefined

  const { x, y, size, padding, edge, rounded, plate } = icon
  const radius = size * CenterIconLimits.cornerRadius
  const defs: string[] = []
  let clip = ''

  if (rounded) {
    defs.push(`<clipPath id="qrd-center-icon-clip"><rect x="${num(x)}" y="${num(y)}" width="${num(size)}" height="${num(size)}" rx="${num(radius)}"/></clipPath>`)
    clip = ' clip-path="url(#qrd-center-icon-clip)"'
  }

  const plateRect = plate && !options.transparent
    ? createPlateRect()
    : ''

  return {
    defs,
    body: `${plateRect}<image href="${escapeAttribute(icon.src)}" x="${num(x)}" y="${num(y)}" width="${num(size)}" height="${num(size)}" preserveAspectRatio="xMidYMid meet"${clip}/>`,
  }

  function createPlateRect() {
    const { color, opacity } = normalizeColor(options.backgroundColor)
    const r = radius + padding
    return `<rect x="${num(x - padding)}" y="${num(y - padding)}" width="${num(edge)}" height="${num(edge)}" rx="${num(r)}" fill="${color}"${opacity === 1
      ? ''
      : ` fill-opacity="${num(opacity)}"`}/>`
  }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement | undefined>((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(undefined)
    image.src = src
  })
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function wrapDocument(options: {
  width: number
  height: number
  defs: string[]
  body: string
}) {
  const { width, height, defs, body } = options
  const defsTag = defs.length
    ? `<defs>${defs.join('')}</defs>`
    : ''

  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}">${
      defsTag
    }${body
    }</svg>\n`
}
