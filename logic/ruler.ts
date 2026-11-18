/**
 * 画布标尺的刻度数学：纯函数，无 Vue / DOM / 任何 import 依赖。
 * 单位：design = 设计像素（与 ComposeState.width/height 同一坐标系），screen = 浏览器 CSS 像素。
 */

export interface RulerTick {
  /** 设计坐标（px），已收敛到 3 位小数 */
  design: number
  /** 相对尺子起点的屏幕偏移（px），= design * scale，已收敛到 3 位小数 */
  screen: number
  /** 是否主刻度（主刻度才画数字） */
  major: boolean
}

/** 刻度总数上限，防极端缩放下 DOM 爆炸 */
const MAX_TICKS = 400

/** 返回 >= target 的最小 1/2/5×10ⁿ；非法输入（≤0 / NaN / Infinity）返回 1 */
export function niceStep(target: number): number {
  if (!Number.isFinite(target) || target <= 0)
    return 1
  const exponent = Math.floor(Math.log10(target))
  const magnitude = 10 ** exponent
  const normalized = target / magnitude
  let step = 10
  if (normalized <= 1)
    step = 1
  else if (normalized <= 2)
    step = 2
  else if (normalized <= 5)
    step = 5
  // 收敛浮点尾巴，避免 0.30000000000000004 这类值
  return Number((step * magnitude).toFixed(12))
}

/**
 * @param lengthScreen 尺子可见长度，屏幕像素
 * @param scale        设计像素 → 屏幕像素
 * @param minMajorScreen 主刻度最小屏幕间距，默认 60
 */
export function buildRulerTicks(lengthScreen: number, scale: number, minMajorScreen = 60): RulerTick[] {
  if (!Number.isFinite(lengthScreen) || !Number.isFinite(scale) || lengthScreen <= 0 || scale <= 0)
    return []

  const designLength = lengthScreen / scale
  const majorStep = Math.max(1, niceStep(minMajorScreen / scale))
  let minorStep = majorStep / 5
  // 设计像素下不足 1 的次刻度没有意义，直接不画次刻度
  if (minorStep < 1)
    minorStep = majorStep
  // 防爆：刻度总数不超过 MAX_TICKS
  if (designLength / minorStep > MAX_TICKS)
    minorStep = Math.max(minorStep, niceStep(designLength / MAX_TICKS))

  const ticks: RulerTick[] = []
  for (let i = 0; i * minorStep <= designLength + 1e-6; i++) {
    const design = Number((i * minorStep).toFixed(3))
    ticks.push({
      design,
      screen: Number((design * scale).toFixed(3)),
      major: majorStep === minorStep
        ? true
        : i % 5 === 0,
    })
  }
  return ticks
}
