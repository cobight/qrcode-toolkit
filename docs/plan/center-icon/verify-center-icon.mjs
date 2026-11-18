/**
 * 中心图（center icon）端到端验收，仅验收用，不参与打包。
 *
 * 覆盖 docs/plan/center-icon/spec.md §4.3 的 5 组断言：真实渲染 + 扫码、
 * UI 装配与上传即切 ECC、SVG 导出、旧状态兼容、全程无 console error。
 *
 * 前置（与 docs/plan/compose-rulers/verify-interaction.mjs 一致）：
 *   1. pnpm dev 跑在 http://localhost:3000
 *   2. 无头 Edge 带 --remote-debugging-port=9223
 * 用法：
 *   node docs/plan/center-icon/verify-center-icon.mjs [页面URL] [debug端口]
 *   默认 URL=http://localhost:3000/#generator 端口=9223
 */
import process from 'node:process'
import { connect, log } from '../compose-rulers/cdp-client.mjs'

const PAGE_URL = process.argv[2] || 'http://localhost:3000/#generator'
const DEBUG_PORT = Number(process.argv[3] || 9223)
const STORAGE_KEY = 'qrd-state-1'
const CENTER_ICON_KEYS = [
  'centerIcon',
  'centerIconSize',
  'centerIconPadding',
  'centerIconRounded',
  'centerIconPlate',
]

function check(label, condition, detail) {
  if (condition)
    return
  throw new Error(`FAIL ${label}${detail
    ? `（${detail}）`
    : ''}`)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 真正重载当前页（`Page.navigate` 到同一 URL 只会走同文档导航，不会重新挂载应用）。
 */
async function reload(page, waitMs = 5000) {
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(waitMs)
}

/** 页面内构造 8×8 纯红 PNG 的代码片段（复用点） */
const RED_PNG_SNIPPET = `
  const makePng = () => {
    const c = document.createElement('canvas')
    c.width = 8
    c.height = 8
    const g = c.getContext('2d')
    g.fillStyle = '#ff0000'
    g.fillRect(0, 0, 8, 8)
    return c.toDataURL('image/png')
  }
`

/** §4.3-1：页面内跑真实 canvas 渲染 + 扫码 */
async function stepRenderAndScan(page) {
  const result = await page.evaluate(`(async () => {
    // Nuxt dev 只把源码模块暴露在 /_nuxt/ 下（/logic/x.ts 会落到 SPA fallback 的 HTML）
    const imp = name => import('/_nuxt/logic/' + name + '.ts')
    const { defaultGeneratorState } = await imp('state')
    const { generateQRCode } = await imp('generate')
    const { resolveCenterIconLayout } = await imp('icon')
    const { scanQRCodeFromDataUrl } = await imp('scan')
    ${RED_PNG_SNIPPET}
    const png = makePng()

    const state = {
      ...defaultGeneratorState(),
      text: 'center-icon-check',
      ecc: 'H',
      scale: 20,
      margin: 2,
      centerIconSize: 16,
      centerIconPadding: 8,
    }

    const withIcon = document.createElement('canvas')
    const plain = document.createElement('canvas')
    await generateQRCode(withIcon, { ...state, centerIcon: png })
    await generateQRCode(plain, state)

    const cell = state.scale
    const m = 2
    const qrSize = Math.round(withIcon.width / cell) - m * 2
    const layout = resolveCenterIconLayout(
      { ...state, centerIcon: png },
      { cell, qrSize, margin: { top: m, right: m, bottom: m, left: m } },
    )

    const dataOf = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
    const withData = dataOf(withIcon)
    const plainData = dataOf(plain)
    const px = (img, x, y) => {
      const i = (y * img.width + x) * 4
      return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]
    }

    // 中心像素：图标内部，应被红色图片覆盖
    const center = px(withData, Math.round(withIcon.width / 2), Math.round(withIcon.height / 2))

    // 间隙环（图标外侧、底板内侧）四条边：plain 里是深色模块，withIcon 里应变成白底板
    const plateX0 = Math.round(layout.x - layout.padding)
    const plateY0 = Math.round(layout.y - layout.padding)
    const plateX1 = Math.round(layout.x + layout.size + layout.padding)
    const plateY1 = Math.round(layout.y + layout.size + layout.padding)
    const iconX0 = Math.ceil(layout.x)
    const iconY0 = Math.ceil(layout.y)
    const iconX1 = Math.floor(layout.x + layout.size)
    const iconY1 = Math.floor(layout.y + layout.size)
    const strips = [
      [plateX0, iconX0, plateY0, plateY1],
      [iconX1, plateX1, plateY0, plateY1],
      [iconX0, iconX1, plateY0, iconY0],
      [iconX0, iconX1, iconY1, plateY1],
    ]
    const isDark = ([r, g, b, a]) => a > 0 && r + g + b < 384
    const isWhite = ([r, g, b, a]) => a > 0 && r > 250 && g > 250 && b > 250

    let darkInPlain = 0
    let whiteWithIcon = 0
    for (const [sx0, sx1, sy0, sy1] of strips) {
      for (let y = sy0; y < sy1; y++) {
        for (let x = sx0; x < sx1; x++) {
          if (!isDark(px(plainData, x, y)))
            continue
          darkInPlain++
          if (isWhite(px(withData, x, y)))
            whiteWithIcon++
        }
      }
    }

    const { result: scanned, error } = await scanQRCodeFromDataUrl(withIcon.toDataURL('image/png'))

    return {
      center,
      darkInPlain,
      whiteWithIcon,
      scannedText: scanned ? (scanned.text ?? scanned.data ?? null) : null,
      scanError: error ? String(error) : null,
      canvasWidth: withIcon.width,
      qrSize,
      iconSize: layout.size,
    }
  })()`)

  const [r, g, b] = result.center
  check(
    '中心像素为图标红色',
    r > 200 && g < 60 && b < 60,
    `actual rgb(${r},${g},${b}) expected ≈ (255,0,0)`,
  )
  check(
    '挖洞 + 白底板：间隙环内原深色模块变白',
    result.darkInPlain > 0 && result.whiteWithIcon === result.darkInPlain,
    `darkInPlain=${result.darkInPlain} whiteWithIcon=${result.whiteWithIcon}`,
  )
  check(
    '中心图二维码仍可扫码',
    result.scannedText === 'center-icon-check',
    `actual ${JSON.stringify(result.scannedText)} expected "center-icon-check"${result.scanError
      ? ` scanError=${result.scanError}`
      : ''}`,
  )
  log(`  渲染 + 扫码：qrSize=${result.qrSize} canvasWidth=${result.canvasWidth} iconSize=${result.iconSize}`)
}

/** 写 localStorage 状态（中心图在、ECC=M），再重载页面 */
async function stepSeedState(page, { ecc, withIcon }) {
  const seeded = await page.evaluate(`(async () => {
    const { defaultState } = await import('/_nuxt/logic/state.ts')
    ${RED_PNG_SNIPPET}
    const s = defaultState()
    s.qrcode = {
      ...s.qrcode,
      text: 'center-icon-check',
      ecc: ${JSON.stringify(ecc)},
      scale: 20,
      margin: 2,
      centerIconSize: 16,
      centerIconPadding: 8,
    }
    if (${withIcon})
      s.qrcode.centerIcon = makePng()
    else
      delete s.qrcode.centerIcon
    localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, JSON.stringify(s))
    return { ecc: s.qrcode.ecc, hasIcon: !!s.qrcode.centerIcon }
  })()`)

  await reload(page)
  return seeded
}

/** §4.3-2：UI 文案 + 缩略图 */
async function stepUI(page) {
  const ui = await page.evaluate(`(async () => {
    const labels = ['Center Icon', 'Icon Size', 'Gap', 'Rounded Icon', 'Plate']
    const body = document.body.innerText || ''
    const thumb = document.querySelector('img[src^="data:image/png"]')
    return {
      missing: labels.filter(label => !body.includes(label)),
      thumbPrefix: thumb ? thumb.getAttribute('src').slice(0, 22) : null,
    }
  })()`)

  check(
    'Center Icon 面板文案齐全',
    ui.missing.length === 0,
    `missing ${JSON.stringify(ui.missing)}`,
  )
  check(
    '缩略图 img[src^="data:image/png"] 存在',
    typeof ui.thumbPrefix === 'string',
    `actual ${JSON.stringify(ui.thumbPrefix)}`,
  )
}

/** §4.3-2：DataTransfer 注入文件 → 自动切 ECC=H */
async function stepUploadSwitchesEcc(page) {
  const upload = await page.evaluate(`(async () => {
    ${RED_PNG_SNIPPET}
    const inputs = Array.from(document.querySelectorAll('input[type=file]'))
    // 取「最近祖先文本含 Center Icon 且该祖先最短」的图片 input，避免误中背景图 / 二维码上传
    let best = null
    for (const input of inputs) {
      if (input.accept !== 'image/*')
        continue
      let node = input.parentElement
      while (node && node !== document.body) {
        const text = node.textContent || ''
        if (text.includes('Center Icon')) {
          if (!best || text.length < best.length)
            best = { input, length: text.length }
          break
        }
        node = node.parentElement
      }
    }
    const target = best ? best.input : null
    if (!target)
      return { error: '未找到 Center Icon 的 input[type=file]' }

    const dataUrl = makePng()
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), ch => ch.charCodeAt(0))
    const file = new File([bytes], 'center-icon.png', { type: 'image/png' })
    const dt = new DataTransfer()
    dt.items.add(file)
    target.files = dt.files
    target.dispatchEvent(new Event('input', { bubbles: true }))
    return { ok: true, size: file.size, inputs: inputs.length, containerLength: best.length }
  })()`)

  check('注入 8×8 PNG 到 Center Icon 的 file input', !upload.error, upload.error)
  log(`  注入：${upload.inputs} 个 file input，命中容器文本长度 ${upload.containerLength}`)
  await sleep(2000)

  const stored = await page.evaluate(`(async () => {
    const raw = localStorage.getItem(${JSON.stringify(STORAGE_KEY)})
    const s = raw ? JSON.parse(raw) : {}
    const q = s.qrcode || {}
    return { ecc: q.ecc ?? null, centerIcon: q.centerIcon ? String(q.centerIcon).slice(0, 30) : null }
  })()`)

  check(
    '上传中心图后自动切 ECC=H',
    stored.ecc === 'H',
    `actual ${JSON.stringify(stored.ecc)} expected "H"`,
  )
  check(
    'localStorage 中心图前缀 data:image/png;base64,',
    typeof stored.centerIcon === 'string' && stored.centerIcon.startsWith('data:image/png;base64,'),
    `actual ${JSON.stringify(stored.centerIcon)}`,
  )
  log(`  上传 → ecc=${stored.ecc} centerIcon=${String(stored.centerIcon).slice(0, 22)}…`)
}

/**
 * 拦截 URL.createObjectURL，点 SVG 按钮，读回 SVG 文本并解析关键结构。
 * @returns {Promise<{svg: string, svgWidth: number, iconWidth: number, expected: number}>} SVG 文本与解析出的宽度/期望值
 */
async function exportSvg(page) {
  const exported = await page.evaluate(`(async () => {
    window.__svgBlob = null
    const original = URL.createObjectURL
    URL.createObjectURL = (blob) => {
      window.__svgBlob = blob
      return 'blob:stub'
    }
    try {
      const textOf = el => (el.textContent || '').trim()
      let button = Array.from(document.querySelectorAll('button')).find(el => textOf(el) === 'SVG')
      if (!button) {
        const nav = Array.from(document.querySelectorAll('button')).find(el => textOf(el) === 'Generator')
        if (nav) {
          nav.click()
          await new Promise(resolve => setTimeout(resolve, 500))
        }
        button = Array.from(document.querySelectorAll('button')).find(el => textOf(el) === 'SVG')
      }
      if (!button)
        return { error: '未找到文案为 SVG 的按钮' }

      button.click()
      for (let i = 0; i < 60 && !window.__svgBlob; i++)
        await new Promise(resolve => setTimeout(resolve, 50))
      if (!window.__svgBlob)
        return { error: '点击 SVG 后未捕获到 Blob（createObjectURL 未被调用）' }

      const svg = await window.__svgBlob.text()
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
      const root = doc.documentElement
      const svgWidth = Number.parseFloat(root.getAttribute('width') || '')
      const iconImage = Array.from(doc.querySelectorAll('image'))
        .find(el => (el.getAttribute('clip-path') || '').includes('qrd-center-icon-clip'))
      const iconWidth = iconImage ? Number.parseFloat(iconImage.getAttribute('width') || '') : null

      const raw = localStorage.getItem(${JSON.stringify(STORAGE_KEY)})
      const stored = raw ? JSON.parse(raw) : {}
      const q = stored.qrcode || {}
      const cell = Number(q.scale)
      const marginValue = q.margin
      const margins = typeof marginValue === 'number'
        ? { top: marginValue, right: marginValue, bottom: marginValue, left: marginValue }
        : (marginValue || { top: 0, right: 0, bottom: 0, left: 0 })
      const qrEdge = svgWidth - (margins.left + margins.right) * cell
      const sizePct = Math.min(18, Math.max(8, Number.isFinite(q.centerIconSize) ? q.centerIconSize : 16))
      const expected = qrEdge * sizePct / 100

      return {
        svg,
        length: svg.length,
        svgWidth,
        iconWidth,
        expected,
        hasImageData: svg.includes('<image href="data:image/png;base64,'),
        hasClipPath: svg.includes('<clipPath id="qrd-center-icon-clip">'),
        hasClipRef: svg.includes('clip-path="url(#qrd-center-icon-clip)"'),
        hasAnyPngData: svg.includes('data:image/png;base64,'),
      }
    }
    finally {
      URL.createObjectURL = original
    }
  })()`)

  check('SVG 导出可用', !exported.error, exported.error)
  return exported
}

/** §4.3-3：SVG 导出断言 */
async function stepSvgExport(page) {
  const exported = await exportSvg(page)

  check(
    'SVG 含 <image href="data:image/png;base64,',
    exported.hasImageData,
    `length=${exported.length}`,
  )
  check('SVG 含 <clipPath id="qrd-center-icon-clip">', exported.hasClipPath, 'clipPath defs 缺失')
  check('SVG 含 clip-path="url(#qrd-center-icon-clip)"', exported.hasClipRef, 'image 的 clip-path 缺失')
  check(
    'SVG 图标宽度 = qrEdge * centerIconSize / 100',
    Number.isFinite(exported.iconWidth) && Math.abs(exported.iconWidth - exported.expected) <= 0.01,
    `actual ${exported.iconWidth} expected ${exported.expected}（svgWidth=${exported.svgWidth}）`,
  )
  log(`  SVG：width=${exported.svgWidth} iconWidth=${exported.iconWidth} expected=${exported.expected.toFixed(3)} bytes=${exported.length}`)
}

/** §4.3-4：删掉 centerIcon* 五键 → 重载无异常且 SVG 不含 center 图标 */
async function stepLegacyState(page) {
  const removed = await page.evaluate(`(async () => {
    const raw = localStorage.getItem(${JSON.stringify(STORAGE_KEY)})
    const s = raw ? JSON.parse(raw) : {}
    const q = s.qrcode || {}
    for (const key of ${JSON.stringify(CENTER_ICON_KEYS)})
      delete q[key]
    s.qrcode = q
    localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, JSON.stringify(s))
    return { remaining: ${JSON.stringify(CENTER_ICON_KEYS)}.filter(key => key in q) }
  })()`)
  check(
    'centerIcon* 五个键已从 localStorage 删除',
    removed.remaining.length === 0,
    `still present ${JSON.stringify(removed.remaining)}`,
  )

  await reload(page)

  const alive = await page.evaluate(`(async () => {
    return {
      hasGenerator: !!(document.body.innerText || '').includes('Generator'),
      hasCenterIconLabel: (document.body.innerText || '').includes('Center Icon'),
      thumb: !!document.querySelector('img[src^="data:image/png"]'),
    }
  })()`)
  check('旧状态重载后页面仍正常渲染', alive.hasGenerator, JSON.stringify(alive))

  const exported = await exportSvg(page)
  check(
    '旧状态导出 SVG 不含 data:image/png',
    !exported.hasAnyPngData && !exported.hasClipRef,
    `hasAnyPngData=${exported.hasAnyPngData} hasClipRef=${exported.hasClipRef}`,
  )
  log(`  旧状态兼容：重载正常，SVG bytes=${exported.length}`)
}

async function main() {
  log(`center-icon e2e：${PAGE_URL}（CDP ${DEBUG_PORT}）`)
  const page = await connect(DEBUG_PORT)

  try {
    await page.openPage(PAGE_URL, 1440, 1000, 8000)

    log('1/5 渲染 + 扫码')
    await stepRenderAndScan(page)

    log('2/5 UI 装配与上传切 ECC')
    await stepSeedState(page, { ecc: 'M', withIcon: true })
    await stepUI(page)
    await stepUploadSwitchesEcc(page)

    log('3/5 SVG 导出')
    await stepSvgExport(page)

    log('4/5 旧状态兼容')
    await stepLegacyState(page)

    log('5/5 无 console error / 未捕获异常')
    check(
      'page.problems 为空',
      page.problems.length === 0,
      page.problems.slice(0, 5).join(' | '),
    )

    log('PASS center-icon-e2e')
  }
  finally {
    page.close()
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})
