import process from 'node:process'

/**
 * 验收第 2 层：`logic/icon.ts` 的中心图几何纯函数断言（spec §4.2）。
 *
 * 仅验收用，不参与打包。Node 24 原生类型剥离直接运行：
 *   node docs/plan/center-icon/verify-center-icon-layout.ts
 *
 * 退出码：0 = 全绿；1 = 断言失败（打印 expected/actual）；2 = `logic/icon.ts` 还没实现。
 */

interface CenterIconCutout {
  left: number
  top: number
  width: number
  height: number
}

interface CenterIconLayout {
  src: string
  x: number
  y: number
  size: number
  padding: number
  edge: number
  rounded: boolean
  plate: boolean
  cutout: CenterIconCutout
}

interface LayoutOptions {
  cell: number
  qrSize: number
  margin: { top: number, right: number, bottom: number, left: number }
}

interface IconModule {
  resolveCenterIconLayout: (state: Record<string, unknown>, options: LayoutOptions) => CenterIconLayout | undefined
}

/** 相对 `docs/plan/center-icon/` 往上三级 = 仓库根（与 `verify-ruler.ts:3` 同一约定）。 */
const MODULE_PATH = '../../../logic/icon.ts'

/** 只校验 `data:image/` 前缀，几何计算不碰图片内容，所以这里不需要合法 PNG。 */
const ICON_SRC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='

const CELL = 10
const QR_SIZE = 33
/** 均匀 margin 2（spec §4.2 断言 2 的参数）。 */
const MARGIN = { top: 2, right: 2, bottom: 2, left: 2 }
const QR_EDGE = QR_SIZE * CELL

let total = 0
const failures: string[] = []

function near(label: string, actual: number, expected: number, tolerance = 1e-9) {
  total++
  if (typeof actual !== 'number' || !(Math.abs(actual - expected) <= tolerance))
    failures.push(`${label}\n    expected: ${expected}\n    actual:   ${String(actual)}`)
}

function same(label: string, actual: unknown, expected: unknown) {
  total++
  if (actual !== expected)
    failures.push(`${label}\n    expected: ${String(expected)}\n    actual:   ${String(actual)}`)
}

/** 动态 import `logic/icon.ts`；模块还不存在时按约定 exit 2，绝不静默通过。 */
async function loadIcon(): Promise<IconModule> {
  try {
    return (await import(MODULE_PATH)) as unknown as IconModule
  }
  catch (error) {
    const detail = error as { code?: string, message?: string }
    if (detail.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find module/.test(detail.message ?? '')) {
      process.stderr.write('logic/icon.ts not ready yet\n')
      process.stderr.write(`（先完成任务 1「数据与几何核心」，再重跑 ${import.meta.url}；原始错误：${detail.message}）\n`)
      process.exit(2)
    }
    throw error
  }
}

/** 默认 state + 覆盖项；只用到 centerIcon* 五个字段，其余字段为占位。 */
function makeState(patch: Record<string, unknown> = {}) {
  return {
    text: 'center-icon-check',
    ecc: 'H',
    scale: CELL,
    margin: 2,
    centerIcon: ICON_SRC,
    centerIconSize: 16,
    centerIconPadding: 8,
    centerIconRounded: true,
    centerIconPlate: true,
    ...patch,
  }
}

function options(qrSize = QR_SIZE, margin = MARGIN): LayoutOptions {
  return { cell: CELL, qrSize, margin }
}

async function main() {
  const icon = await loadIcon()

  function requireLayout(label: string, state: Record<string, unknown>, opts: LayoutOptions) {
    const layout = icon.resolveCenterIconLayout(state, opts)
    if (!layout) {
      process.stdout.write(`FAIL ${label}\n    expected: 返回 CenterIconLayout\n    actual:   undefined\n`)
      process.exit(1)
    }
    return layout
  }

  // -------------------------------------------------------------- 1. 无图标 / 非 data URL
  same('无 centerIcon 应返回 undefined', icon.resolveCenterIconLayout(makeState({ centerIcon: undefined }), options()), undefined)
  same('centerIcon 为空字符串应返回 undefined', icon.resolveCenterIconLayout(makeState({ centerIcon: '' }), options()), undefined)
  same('非 data:image 前缀应返回 undefined', icon.resolveCenterIconLayout(makeState({ centerIcon: 'https://x/y.png' }), options()), undefined)

  // -------------------------------------------------------------- 2. 几何（qrSize=33, cell=10, margin=2, 16%, 8%）
  const baseline = requireLayout('基线几何（qrSize=33/cell=10/margin=2/16%/8%）', makeState(), options())
  near('size 应等于 330 * 16% = 52.8', baseline.size, 52.8)
  near('padding 应等于 52.8 * 8% = 4.224', baseline.padding, 4.224)
  near('edge 应等于 size + 2 * padding = 61.248', baseline.edge, 61.248)
  near('x 应等于 (2 * 10 + 330 / 2) - 26.4 = 158.6', baseline.x, 158.6)
  near('y 应等于 (2 * 10 + 330 / 2) - 26.4 = 158.6', baseline.y, 158.6)
  near('size / qrEdge 应等于 0.16', baseline.size / QR_EDGE, 0.16)
  same('rounded 应透传 centerIconRounded', baseline.rounded, true)
  same('plate 应透传 centerIconPlate', baseline.plate, true)
  same('src 应透传 centerIcon', baseline.src, ICON_SRC)

  // -------------------------------------------------------------- 3. cutout（模块坐标）
  near('cutout.left 应等于 13', baseline.cutout.left, 13)
  near('cutout.top 应等于 13', baseline.cutout.top, 13)
  near('cutout.width 应等于 7', baseline.cutout.width, 7)
  near('cutout.height 应等于 7', baseline.cutout.height, 7)
  near('均匀 margin 下 cutout.left + (left + width) 应等于 qrSize', baseline.cutout.left + baseline.cutout.left + baseline.cutout.width, QR_SIZE)
  near('均匀 margin 下 cutout.top + (top + height) 应等于 qrSize', baseline.cutout.top + baseline.cutout.top + baseline.cutout.height, QR_SIZE)

  // -------------------------------------------------------------- 4. 越界 clamp
  const size50 = requireLayout('centerIconSize=50 的布局', makeState({ centerIconSize: 50 }), options())
  near('centerIconSize=50 应 clamp 到 18（size = 330 * 18%）', size50.size, 59.4)
  const size2 = requireLayout('centerIconSize=2 的布局', makeState({ centerIconSize: 2 }), options())
  near('centerIconSize=2 应 clamp 到 8（size = 330 * 8%）', size2.size, 26.4)
  const pad50 = requireLayout('centerIconPadding=50 的布局', makeState({ centerIconPadding: 50 }), options())
  near('centerIconPadding=50 应 clamp 到 10（padding = size * 10%）', pad50.padding, baseline.size * 10 / 100)
  const padNeg = requireLayout('centerIconPadding=-5 的布局', makeState({ centerIconPadding: -5 }), options())
  near('centerIconPadding=-5 应 clamp 到 0', padNeg.padding, 0)
  near('centerIconPadding=-5 时 edge 应等于 size', padNeg.edge, padNeg.size)

  // -------------------------------------------------------------- 5. 缺失字段兜底
  const sizeNaN = requireLayout('centerIconSize=undefined 的布局', makeState({ centerIconSize: undefined }), options())
  near('centerIconSize=undefined 应等价 16', sizeNaN.size, baseline.size)
  const padNaN = requireLayout('centerIconPadding=NaN 的布局', makeState({ centerIconPadding: Number.NaN }), options())
  near('centerIconPadding=NaN 应等价 8', padNaN.padding, baseline.padding)

  // -------------------------------------------------------------- 6. 面积保护（18% + 10% 间隙）
  const maxLayout = requireLayout('18% 尺寸 + 10% 间隙的布局', makeState({ centerIconSize: 18, centerIconPadding: 10 }), options())
  const idealModules = (maxLayout.size + 2 * maxLayout.padding) / CELL / QR_SIZE
  total++
  if (!(idealModules <= 0.22)) {
    failures.push(`理想跨度 (size + 2 * padding) / cell / qrSize 应 <= 0.22
    expected: <= 0.22
    actual:   ${idealModules}`)
  }
  // 实际模块跨度：qrSize=41 时 floor/ceil 只多算 1 个模块，ratio 才落进 0.25 门限
  const maxLayout41 = requireLayout('18% 尺寸 + 10% 间隙的布局（qrSize=41）', makeState({ centerIconSize: 18, centerIconPadding: 10 }), options(41))
  total++
  if (!(maxLayout41.cutout.width / 41 <= 0.25)) {
    failures.push(`qrSize=41 时 cutout.width / 41 应 <= 0.25
    expected: <= 0.25
    actual:   ${maxLayout41.cutout.width / 41}（cutout.width = ${maxLayout41.cutout.width}）`)
  }

  // -------------------------------------------------------------- 7. 非居中 margin
  const offCenter = requireLayout('margin {top:0,right:4,bottom:0,left:0} 的布局', makeState(), options(QR_SIZE, { top: 0, right: 4, bottom: 0, left: 0 }))
  near('非居中 margin 下 cutout.top + cutout.bottom 应等于 qrSize', offCenter.cutout.top + offCenter.cutout.top + offCenter.cutout.height, QR_SIZE)
  near('非居中 margin 下图标仍居中于内容方形（y = 165 - 26.4 = 138.6）', offCenter.y, 138.6)

  if (failures.length) {
    for (const failure of failures)
      process.stdout.write(`FAIL ${failure}\n`)
    process.stdout.write(`FAIL center-icon-layout (${failures.length}/${total} assertions failed)\n`)
    process.exit(1)
  }

  process.stdout.write(`PASS center-icon-layout (${total} assertions)\n`)
}

main().catch((error) => {
  process.stderr.write(`${(error as Error).message}\n`)
  process.exit(1)
})
