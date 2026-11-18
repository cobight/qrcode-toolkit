export const PixelStyles = [
  'square',
  'rounded',
  'dot',
  'squircle',
  'row',
  'column',
] as const

// @unocss-include
export const PixelStyleIcons = [
  'i-custom-pixel-square',
  'i-custom-pixel-rounded',
  'i-custom-pixel-dot',
  'i-custom-pixel-squircle',
  'i-custom-pixel-row',
  'i-custom-pixel-column',
]

export const MarkerShapes = [
  'square',
  'circle',
  'plus',
  'box',
  'octagon',
  'random',
  'tiny-plus',
] as const

export const MarkerSubShapes = [
  'square',
  'circle',
  'box',
  'random',
  'plus',
] as const

export const MarkerInnerShapes = [
  'square',
  'circle',
  'plus',
  'diamond',
  'eye',
] as const

export const MarkerShapeIcons = [
  'i-custom-marker-square',
  'i-custom-marker-circle',
  'i-custom-marker-plus',
  'i-custom-marker-box',
  'i-custom-marker-octagon',
  'i-custom-marker-random',
  'i-custom-marker-tiny-plus',
]

export const MarkerInnerShapeIcons = [
  'i-custom-marker-inner-square',
  'i-custom-marker-inner-circle',
  'i-custom-marker-inner-plus',
  'i-custom-marker-inner-diamond',
  'i-custom-marker-inner-eye',
]

export const MarkerSubShapeIcons = [
  'i-custom-marker-square',
  'i-custom-marker-circle',
  'i-custom-marker-plus',
  'i-custom-marker-random',
  'i-custom-marker-tiny-plus',
]

export type PixelStyle = typeof PixelStyles[number]
export type MarkerShape = typeof MarkerShapes[number]
export type MarkerInnerShape = typeof MarkerInnerShapes[number]

export interface GeneratedQRInfo {
  width: number
  height: number
}

export interface MarginObject {
  top: number
  right: number
  bottom: number
  left: number
}

export interface QrCodeGeneratorMarkerState {
  markerStyle: PixelStyle | 'auto'
  markerShape: MarkerShape
  markerInnerShape: MarkerInnerShape | 'auto'
}

export interface QRCodeGeneratorState extends QrCodeGeneratorMarkerState {
  text: string
  ecc: 'L' | 'M' | 'Q' | 'H'
  margin: number | MarginObject
  scale: number
  seed: number
  lightColor: string
  darkColor: string
  maskPattern: number
  boostECC: boolean
  minVersion: number
  maxVersion: number
  pixelStyle: PixelStyle
  markers: QrCodeGeneratorMarkerState[]
  markerSub: MarkerShape
  marginNoise: boolean
  marginNoiseRate: number
  marginNoiseSpace: 'none' | 'marker' | 'full' | 'minimal' | 'extreme'
  marginNoiseOpacity: number | [number, number]
  renderPointsType: 'all' | 'data' | 'function' | 'guide' | 'marker'
  invert: boolean
  rotate: 0 | 90 | 180 | 270
  effect: 'none' | 'crystalize' | 'liquidify'
  effectTiming: 'before' | 'after'
  effectCrystalizeRadius: number
  effectLiquidifyDistortRadius: number
  effectLiquidifyRadius: number
  effectLiquidifyThreshold: number
  backgroundImage?: string
  /** 中心图（data URL，统一重编码为 PNG，最长边 ≤ 256px） */
  centerIcon?: string
  /** 图标边长占二维码内容边长的百分比，clamp 到 8–18 */
  centerIconSize: number
  /** 透明间隙占图标边长的百分比，clamp 到 0–10 */
  centerIconPadding: number
  /** 是否圆角裁剪 */
  centerIconRounded: boolean
  /** 是否用背景色涂满间隙方框（背景图场景下保证对比度） */
  centerIconPlate: boolean

  transformPerspectiveX: number
  transformPerspectiveY: number
  transformScale: number
}

export interface ComparionState {
  grayscale: boolean
  contrast: number
  brightness: number
  blur: number
  grid: boolean
  gridSize: number
  gridMarginSize: number | MarginObject
  gridOpacity: number
  gridColor: string
  overlay: boolean
  overlayBlendMode: string
  overlayOpacity: number
  pixelView: boolean
  diffThreshold: number

  downloadType: 'correction' | 'mask'
  downloadShowImage: boolean
  maskColor: string
  maskShape: 'square' | 'circle'
  correctionShape: 'square' | 'circle'
  correctionOpacity: number
  correctionBlur: number
  correctionBlendMode: GlobalCompositeOperation | 'none'
}

export interface UploadState {
  image?: string
  qrcode?: string
  qrcodeWidth?: number
  qrcodeHeight?: number
}

export interface ScannerState {
  resize: number
  contrast: number
  blur: number
  brightness: number
  grayscale: boolean
  locks: string[]
  cameraMirror: boolean
  cameraViewMode: 'original' | 'processed'
  cameraSampleDelay: number
}

export const ComposePresetIds = [
  '9:16',
  '4:5',
  '3:4',
  '1:1',
  '16:9',
  '4:3',
  '2:3',
  'custom',
] as const

export type ComposePresetId = typeof ComposePresetIds[number]

export type ComposeBackgroundFit = 'cover' | 'contain' | 'stretch'

/** 贴片来源：qr 来自 Generator 产物，image 来自本地导入 */
export type ComposeStampKind = 'qr' | 'image'

export interface ComposeStamp {
  id: string
  /** 图层名，可改名 */
  name: string
  kind: ComposeStampKind
  /** 原图尺寸，用于锁定宽高比和在刷新后重建几何 */
  naturalW: number
  naturalH: number
  /** 设计坐标（以 ComposeState.width/height 为单位），图片内容左上角 */
  x: number
  y: number
  /** 设计坐标下的图片宽度，高度由 naturalW/naturalH 推出 */
  w: number
  rotation: 0 | 90 | 180 | 270
  /**
   * 白底板是否自动跟随图片透明度：
   * true 时图片带透明像素就不铺白底，用户手动改过开关后置为 false。
   */
  plateAuto: boolean
  /** 是否铺白色底板；关闭时保留原图透明背景（plateAuto 为 true 时此值仅作兜底） */
  plate: boolean
  /** 白底板外扩的静区，设计像素，仅在 plate 开启时生效 */
  padding: number
  radius: number
  opacity: number
  /** 亮度倍数：1 为原图，小于 1 压暗，大于 1 提亮 */
  brightness: number
}

export interface ComposeState {
  preset: ComposePresetId
  width: number
  height: number
  backgroundColor: string
  backgroundKind: 'color' | 'image'
  backgroundFit: ComposeBackgroundFit
  /** 底图压暗，保证二维码对比度 */
  dim: number
  /** 数组顺序即图层顺序，越靠后越在上层 */
  stamps: ComposeStamp[]
  selectedId?: string
  snap: boolean
  exportScale: number
  exportFormat: 'png' | 'jpeg'
}

export interface State {
  qrcode: QRCodeGeneratorState
  compare: ComparionState
  scanner: ScannerState
  compose: ComposeState
  uploaded: UploadState
}

export interface Segment {
  x: number
  y: number
  index: number
  data: ImageData
  hex: string
  color: [number, number, number, number]
  luminance: number
  value: number
  expected: number
  isMargin: boolean
}

export interface Diff {
  segments: Segment[]
  mainSegments: Segment[]
  mismatchDark: Segment[]
  mismatchLight: Segment[]
  mismatchCount: number
  avarageLuminance: number
  lightLuminance: number
  darkLuminance: number
}
