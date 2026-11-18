import type { ComposeBackgroundFit, ComposePresetId, ComposeStamp, ComposeStampKind, ComposeState } from './types'
import { dataUrlGeneratedQRCode, dataUrlGeneratedQRCodeForCompose } from './state'

export interface ComposePreset {
  id: ComposePresetId
  label: string
  width: number
  height: number
}

/** 画布预设：宽高均为设计像素，长边统一 1080 / 1920 两档 */
export const COMPOSE_PRESETS: ComposePreset[] = [
  {
    id: '9:16',
    label: '9:16',
    width: 1080,
    height: 1920,
  },
  {
    id: '4:5',
    label: '4:5',
    width: 1080,
    height: 1350,
  },
  {
    id: '3:4',
    label: '3:4',
    width: 1080,
    height: 1440,
  },
  {
    id: '2:3',
    label: '2:3',
    width: 1080,
    height: 1620,
  },
  {
    id: '1:1',
    label: '1:1',
    width: 1080,
    height: 1080,
  },
  {
    id: '16:9',
    label: '16:9',
    width: 1920,
    height: 1080,
  },
  {
    id: '4:3',
    label: '4:3',
    width: 1440,
    height: 1080,
  },
  {
    id: 'custom',
    label: 'Custom',
    width: 1080,
    height: 1920,
  },
]

/**
 * 背景图 dataURL 体积大，只放内存不进 localStorage。
 * 刷新后丢失，但画布尺寸与贴片几何仍然保留。
 */
export const composeBackground = shallowRef<string>()

/** 贴片 id → 图片快照（刷新后为空：qr 回落 Generator 当前产物，image 需要重新导入） */
const stampSources = new Map<string, string>()
const imageCache = new Map<string, HTMLImageElement>()

/**
 * 图片来源 → 是否含透明像素。用响应式 Map 让预览在检测完成后自动重绘；
 * 只缓存最近若干个来源，避免 Generator 每次重绘的 dataURL 无限堆积。
 */
const sourceAlpha = reactive(new Map<string, boolean>())
const SOURCE_ALPHA_LIMIT = 12

export function registerStampSource(id: string, src: string) {
  stampSources.set(id, src)
}

/**
 * 解析贴片实际使用的图片。
 * QR 图层永远跟随 Generator 最新产物（透明背景、配色、特效都会实时体现），
 * 导入的图片才使用注册时快照，因为本地文件没有可回溯的来源。
 */
export function getStampSource(stamp: ComposeStamp) {
  if (stamp.kind === 'qr')
    return dataUrlGeneratedQRCodeForCompose.value ?? dataUrlGeneratedQRCode.value ?? stampSources.get(stamp.id)
  return stampSources.get(stamp.id)
}

export function stampSourceLabel(stamp: ComposeStamp) {
  return stamp.kind === 'qr'
    ? 'Generator'
    : 'Imported'
}

export function loadImage(src: string) {
  const cached = imageCache.get(src)
  if (cached)
    return Promise.resolve(cached)
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      imageCache.set(src, img)
      resolve(img)
    }
    img.onerror = () => reject(new Error(`Failed to load image: ${src.slice(0, 32)}`))
    img.src = src
  })
}

export function stampHeight(stamp: ComposeStamp) {
  return stamp.w * stamp.naturalH / Math.max(1, stamp.naturalW)
}

/** 缩放采样图片，看有没有半透明/全透明像素（二维码透明背景的边角一定是 alpha 0） */
function measureAlpha(img: HTMLImageElement) {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx)
    return false
  ctx.drawImage(img, 0, 0, size, size)
  const data = ctx.getImageData(0, 0, size, size).data
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250)
      return true
  }
  return false
}

/** 检测并缓存图片来源是否透明；同一个 dataURL 只测一次 */
export async function syncSourceAlpha(src?: string) {
  if (!src)
    return false
  const cached = sourceAlpha.get(src)
  if (cached !== undefined)
    return cached
  const img = await loadImage(src)
  const hasAlpha = measureAlpha(img)
  if (sourceAlpha.size >= SOURCE_ALPHA_LIMIT) {
    const oldest = sourceAlpha.keys().next().value
    if (oldest)
      sourceAlpha.delete(oldest)
  }
  sourceAlpha.set(src, hasAlpha)
  return hasAlpha
}

/**
 * 这一层实际要不要白底板。
 * plateAuto 为 true 时跟随图片来源：自带透明像素就不铺白底，避免盖住画布背景；
 * 检测还没出结果时先按用户设定渲染，出结果后响应式地图会触发重绘。
 */
export function isPlateActive(stamp: ComposeStamp) {
  if (!stamp.plateAuto)
    return stamp.plate
  const src = getStampSource(stamp)
  if (!src)
    return stamp.plate
  const known = sourceAlpha.get(src)
  return known === undefined
    ? stamp.plate
    : !known
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/** 把贴片内容拉回画布内（白底板允许溢出边缘） */
export function clampStamp(stamp: ComposeStamp, width: number, height: number) {
  const h = stampHeight(stamp)
  stamp.x = clamp(stamp.x, 0, Math.max(width - stamp.w, 0))
  stamp.y = clamp(stamp.y, 0, Math.max(height - h, 0))
}

export function createStamp(
  name: string,
  naturalW: number,
  naturalH: number,
  state: ComposeState,
  kind: ComposeStampKind = 'image',
): ComposeStamp {
  const ratio = Math.max(1, naturalH) / Math.max(1, naturalW)
  const maxW = state.width * 0.4
  const maxH = state.height * 0.4
  const w = Math.max(Math.min(maxW, maxH / ratio), 120)
  const h = w * ratio
  return {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    name,
    kind,
    naturalW: Math.max(1, naturalW),
    naturalH: Math.max(1, naturalH),
    x: Math.round((state.width - w) / 2),
    y: Math.round((state.height - h) / 2),
    w: Math.round(w),
    rotation: 0,
    // 二维码的底板跟随图片透明度（透明背景就不垫白），普通图片默认无底板
    plateAuto: kind === 'qr',
    plate: kind === 'qr',
    padding: kind === 'qr'
      ? 8
      : 0,
    radius: 0,
    opacity: 1,
    brightness: 1,
  }
}

/** 兼容旧存档：补齐 kind / plateAuto / plate / brightness */
export function normalizeStamp(stamp: ComposeStamp) {
  stamp.kind ??= 'qr'
  stamp.plateAuto ??= stamp.kind === 'qr'
  stamp.plate ??= stamp.padding > 0
  stamp.brightness ??= 1
  return stamp
}

export function normalizeComposeState(state: ComposeState) {
  for (const stamp of state.stamps)
    normalizeStamp(stamp)
  return state
}

export function readFileAsDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Failed to read image file'))
    reader.readAsDataURL(file)
  })
}

/** 把一张图片作为新图层放进画布中央，来源只存内存 */
export async function addStampFromSource(
  state: ComposeState,
  src: string,
  name: string,
  kind: ComposeStampKind = 'image',
) {
  const img = await loadImage(src)
  const stamp = createStamp(name, img.naturalWidth || img.width, img.naturalHeight || img.height, state, kind)
  registerStampSource(stamp.id, src)
  // 先把透明度检测做掉，首次渲染就知道要不要白底板，避免白底闪一下再消失
  const hasAlpha = await syncSourceAlpha(src)
  if (kind === 'qr')
    stamp.plate = !hasAlpha
  state.stamps.push(stamp)
  state.selectedId = stamp.id
  return stamp
}

/** 就地替换图层图片：宽度保留，按新图比例重算高度并夹回画布 */
export async function replaceStampSource(
  state: ComposeState,
  stamp: ComposeStamp,
  src: string,
  kind: ComposeStampKind = 'image',
) {
  const img = await loadImage(src)
  stamp.naturalW = Math.max(1, img.naturalWidth || img.width)
  stamp.naturalH = Math.max(1, img.naturalHeight || img.height)
  stamp.kind = kind
  stamp.w = Math.max(40, Math.min(stamp.w, state.width))
  registerStampSource(stamp.id, src)
  if (kind === 'qr')
    stamp.plate = !(await syncSourceAlpha(src))
  clampStamp(stamp, state.width, state.height)
  return stamp
}

/** 把贴片映射到新画布：宽度按画布宽度比例走，保证 9:16 ↔ 16:9 来回切换不缩水 */
export function rescaleStamps(state: ComposeState, oldWidth: number, oldHeight: number) {
  if (!oldWidth || !oldHeight)
    return
  const kx = state.width / oldWidth
  const ky = state.height / oldHeight
  for (const stamp of state.stamps) {
    const ratio = stampHeight(stamp) / Math.max(1, stamp.w)
    stamp.x *= kx
    stamp.y *= ky
    stamp.w *= kx
    stamp.padding *= kx
    stamp.radius *= kx
    // 换到更扁的画布时高度可能装不下，按高度上限收一次，避免贴片被裁掉
    const available = state.height - stamp.padding * 2
    if (ratio > 0 && stamp.w * ratio > available)
      stamp.w = Math.max(120, available / ratio)
    clampStamp(stamp, state.width, state.height)
  }
}

export function applyPreset(state: ComposeState, id: ComposePresetId) {
  const preset = COMPOSE_PRESETS.find(p => p.id === id)
  if (!preset)
    return
  const oldWidth = state.width
  const oldHeight = state.height
  state.preset = id
  if (id === 'custom')
    return
  state.width = preset.width
  state.height = preset.height
  rescaleStamps(state, oldWidth, oldHeight)
}

export function setCanvasSize(state: ComposeState, width: number, height: number) {
  const nextWidth = clamp(Math.round(width), 200, 8000)
  const nextHeight = clamp(Math.round(height), 200, 8000)
  if (nextWidth === state.width && nextHeight === state.height)
    return
  const oldWidth = state.width
  const oldHeight = state.height
  state.width = nextWidth
  state.height = nextHeight
  state.preset = 'custom'
  rescaleStamps(state, oldWidth, oldHeight)
}

/** cover / contain / stretch 的目标矩形，预览用 CSS background-size 对齐同一语义 */
export function resolveFitRect(imgWidth: number, imgHeight: number, boxWidth: number, boxHeight: number, fit: ComposeBackgroundFit) {
  if (fit === 'stretch' || !imgWidth || !imgHeight) {
    return {
      x: 0,
      y: 0,
      width: boxWidth,
      height: boxHeight,
    }
  }
  const scale = fit === 'cover'
    ? Math.max(boxWidth / imgWidth, boxHeight / imgHeight)
    : Math.min(boxWidth / imgWidth, boxHeight / imgHeight)
  const width = imgWidth * scale
  const height = imgHeight * scale
  return {
    x: (boxWidth - width) / 2,
    y: (boxHeight - height) / 2,
    width,
    height,
  }
}

export function backgroundSizeCss(fit: ComposeBackgroundFit) {
  if (fit === 'stretch')
    return '100% 100%'
  return fit
}

function fillRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2)
  if (r <= 0) {
    ctx.fillRect(x, y, width, height)
    return
  }
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
  ctx.fill()
}

/**
 * 画贴片本体。亮度用逐像素 RGB 线性乘法，和预览的 `filter: brightness()` 同一套语义，
 * 且不会像 ctx.filter 那样在部分浏览器（Safari）里静默失效。
 */
function drawStampImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  stamp: ComposeStamp,
  width: number,
  height: number,
) {
  const brightness = stamp.brightness ?? 1
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  if (Math.abs(brightness - 1) < 0.005) {
    ctx.drawImage(img, -w / 2, -h / 2, w, h)
    return
  }
  const offscreen = document.createElement('canvas')
  offscreen.width = w
  offscreen.height = h
  const offCtx = offscreen.getContext('2d')
  if (!offCtx) {
    ctx.drawImage(img, -w / 2, -h / 2, w, h)
    return
  }
  offCtx.imageSmoothingEnabled = false
  offCtx.drawImage(img, 0, 0, w, h)
  const pixels = offCtx.getImageData(0, 0, w, h)
  const data = pixels.data
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0)
      continue
    data[i] = clamp(data[i] * brightness, 0, 255)
    data[i + 1] = clamp(data[i + 1] * brightness, 0, 255)
    data[i + 2] = clamp(data[i + 2] * brightness, 0, 255)
  }
  offCtx.putImageData(pixels, 0, 0)
  ctx.drawImage(offscreen, -w / 2, -h / 2, w, h)
}

/** 按设计像素渲染，multiplier 为导出倍率；预览和导出共用同一套几何 */
export async function renderComposeCanvas(state: ComposeState, multiplier = 1) {
  const width = Math.max(1, Math.round(state.width * multiplier))
  const height = Math.max(1, Math.round(state.height * multiplier))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx)
    throw new Error('Canvas 2D context unavailable')

  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = state.backgroundColor || '#ffffff'
  ctx.fillRect(0, 0, width, height)

  if (state.backgroundKind === 'image' && composeBackground.value) {
    const img = await loadImage(composeBackground.value)
    const rect = resolveFitRect(img.naturalWidth, img.naturalHeight, width, height, state.backgroundFit)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height)
    ctx.imageSmoothingEnabled = false
  }

  if (state.dim > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${state.dim})`
    ctx.fillRect(0, 0, width, height)
  }

  for (const stamp of state.stamps) {
    const src = getStampSource(stamp)
    if (!src)
      continue
    const img = await loadImage(src)
    await syncSourceAlpha(src)
    const qrWidth = stamp.w * multiplier
    const qrHeight = stampHeight(stamp) * multiplier
    const pad = isPlateActive(stamp)
      ? stamp.padding * multiplier
      : 0
    ctx.save()
    ctx.globalAlpha = stamp.opacity
    ctx.translate((stamp.x + stamp.w / 2) * multiplier, (stamp.y + stampHeight(stamp) / 2) * multiplier)
    if (stamp.rotation)
      ctx.rotate(stamp.rotation * Math.PI / 180)
    if (pad > 0) {
      ctx.fillStyle = '#ffffff'
      fillRoundedRect(ctx, -qrWidth / 2 - pad, -qrHeight / 2 - pad, qrWidth + pad * 2, qrHeight + pad * 2, stamp.radius * multiplier)
    }
    drawStampImage(ctx, img, stamp, qrWidth, qrHeight)
    ctx.restore()
  }

  return canvas
}

export async function exportComposeImage(state: ComposeState, text = '') {
  const canvas = await renderComposeCanvas(state, state.exportScale)
  const isJpeg = state.exportFormat === 'jpeg'
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, isJpeg ? 'image/jpeg' : 'image/png', 0.92))
  if (!blob)
    return
  const name = (text || 'qrcode').replace(/\W/g, '_').slice(0, 40)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${name}[${state.preset}_${state.width}x${state.height}@${state.exportScale}x].${isJpeg ? 'jpg' : 'png'}`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
