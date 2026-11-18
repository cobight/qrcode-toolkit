import type { QRCodeGeneratorState } from './types'

/**
 * 中心图（logo）的几何解析、图片缓存与画布贴图。
 *
 * 依赖方向：`draw.ts` → `icon.ts` → `types.ts`。
 * 本模块**不得** import `./draw`（否则形成循环依赖），顶层也**不得**触碰
 * window / document / Image，保证 `resolveCenterIconLayout` 能在纯 Node 下运行。
 */

export const CenterIconLimits = {
  minSize: 8,
  maxSize: 18,
  minPadding: 0,
  maxPadding: 10,
  cornerRadius: 0.14,
  maxStoredPixels: 256,
} as const

export interface CenterIconLayout {
  src: string
  /** 图标方框左上角，工作画布坐标系（未施加 transformScale） */
  x: number
  y: number
  /** 图标方框边长 */
  size: number
  /** 每侧间隙宽度 */
  padding: number
  /** 间隙方框边长 = size + 2 * padding */
  edge: number
  rounded: boolean
  plate: boolean
  /** 需要从矩阵中挖掉的模块范围（模块坐标，半开区间） */
  cutout: { left: number, top: number, width: number, height: number }
}

function num(value: number | undefined, fallback: number) {
  return Number.isFinite(value)
    ? value as number
    : fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/**
 * 解析中心图几何。无图标 / 非 data URL 时返回 undefined。
 *
 * 纯函数：不碰 DOM，可被 canvas 与 SVG 两条渲染路径共用，也方便脚本断言。
 */
export function resolveCenterIconLayout(
  state: QRCodeGeneratorState,
  options: {
    cell: number
    qrSize: number
    margin: { top: number, right: number, bottom: number, left: number }
  },
): CenterIconLayout | undefined {
  const src = state.centerIcon
  if (!src || !src.startsWith('data:image/'))
    return undefined

  const { cell, qrSize, margin } = options
  if (!Number.isFinite(cell) || cell <= 0 || !Number.isFinite(qrSize) || qrSize <= 0)
    return undefined

  // 几何：以二维码内容方形（不含 margin）为准，居中而不是画布居中
  const qrEdge = qrSize * cell
  const centerX = (margin.left + qrSize / 2) * cell
  const centerY = (margin.top + qrSize / 2) * cell

  const sizePct = clamp(num(state.centerIconSize, 16), CenterIconLimits.minSize, CenterIconLimits.maxSize)
  const padPct = clamp(num(state.centerIconPadding, 8), CenterIconLimits.minPadding, CenterIconLimits.maxPadding)

  const size = qrEdge * sizePct / 100
  const padding = size * padPct / 100
  const edge = size + padding * 2
  const x = centerX - size / 2
  const y = centerY - size / 2

  // 挖洞范围换算成模块坐标（原点 = 二维码内容左上角），半开区间上限用 ceil
  const left = clamp(Math.floor((x - padding - margin.left * cell) / cell), 0, qrSize)
  const top = clamp(Math.floor((y - padding - margin.top * cell) / cell), 0, qrSize)
  const right = clamp(Math.ceil((x + size + padding - margin.left * cell) / cell), 0, qrSize)
  const bottom = clamp(Math.ceil((y + size + padding - margin.top * cell) / cell), 0, qrSize)

  return {
    src,
    x,
    y,
    size,
    padding,
    edge,
    rounded: !!state.centerIconRounded,
    plate: !!state.centerIconPlate,
    cutout: {
      left,
      top,
      width: right - left,
      height: bottom - top,
    },
  }
}

/** 缓存解码结果（失败也缓存 undefined），避免防抖刷新反复解码大数据 URL。 */
const imageCache = new Map<string, Promise<HTMLImageElement | undefined>>()

export function loadCenterIconImage(src: string): Promise<HTMLImageElement | undefined> {
  const cached = imageCache.get(src)
  if (cached)
    return cached

  const promise = new Promise<HTMLImageElement | undefined>((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(undefined)
      return
    }

    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(undefined)
    image.src = src
  })

  imageCache.set(src, promise)
  return promise
}

/** arcTo 画圆角矩形路径；半径按 `Math.min(r, w/2, h/2)` 兜底。 */
function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2)

  ctx.beginPath()
  if (r <= 0) {
    ctx.rect(x, y, width, height)
    return
  }

  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

/**
 * 在当前变换（含 transformScale）下贴中心图：底板 → 圆角裁剪 → contain 等比绘制。
 * 图片解码失败时静默返回，不让预览整体挂掉。
 */
export async function drawCenterIcon(
  ctx: CanvasRenderingContext2D,
  layout: CenterIconLayout,
  options: { transparent: boolean, backgroundColor: string },
): Promise<void> {
  const image = await loadCenterIconImage(layout.src)
  if (!image)
    return

  const { x, y, size, padding, edge, rounded, plate } = layout

  const iw = image.naturalWidth || image.width || 0
  const ih = image.naturalHeight || image.height || 0
  if (!iw || !ih)
    return

  const radius = size * CenterIconLimits.cornerRadius

  ctx.save()

  // 底板：透明导出时不画，避免把「透明」变成一块不透明方块
  if (plate && !options.transparent) {
    roundedRectPath(ctx, x - padding, y - padding, edge, edge, radius + padding)
    ctx.fillStyle = options.backgroundColor
    ctx.fill()
  }

  // 裁剪路径必须重新起笔：canvas 的当前路径不会被 save()/restore() 隔离
  if (rounded) {
    roundedRectPath(ctx, x, y, size, size, radius)
  }
  else {
    ctx.beginPath()
    ctx.rect(x, y, size, size)
  }
  ctx.clip()

  // contain：等比缩放并居中
  const k = Math.min(size / iw, size / ih)
  const w = iw * k
  const h = ih * k
  ctx.drawImage(image, x + (size - w) / 2, y + (size - h) / 2, w, h)

  ctx.restore()
}

/**
 * 上传预处理：解出图片 → 按最长边缩到 maxSize → 统一重编码成 PNG 位图。
 * SVG 图标、无固有尺寸的图片因此都能安全地 drawImage / 进导出 SVG。
 */
export async function prepareCenterIcon(dataUrl: string, maxSize: number = CenterIconLimits.maxStoredPixels): Promise<string> {
  const image = await new Promise<HTMLImageElement | undefined>((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(undefined)
    img.src = dataUrl
  })

  if (!image)
    throw new Error('无法解析所选图片')

  const iw = image.naturalWidth || image.width || 0
  const ih = image.naturalHeight || image.height || 0
  if (!iw || !ih)
    throw new Error('无法解析所选图片')

  const k = Math.min(1, maxSize / Math.max(iw, ih))
  const width = Math.max(1, Math.round(iw * k))
  const height = Math.max(1, Math.round(ih * k))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx)
    throw new Error('无法解析所选图片')

  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL('image/png')
}
