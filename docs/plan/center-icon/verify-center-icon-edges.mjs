/**
 * 边界验收（spec §3）：透明、背景图+底板、旋转、transformScale 四个场景的像素断言。
 *
 * 与 `verify-center-icon.mjs` 互补：那份验主链路（渲染+解码 / UI 装配 / SVG 导出 / 旧状态兼容 / 无 console error），
 * 这份验主链路之外的组合边界。采样点全部相对画布中心推导，不依赖「猜 qrSize 再反推 x/y」。
 *
 * 运行前置：
 *   1. `pnpm dev` 起在 http://localhost:3000
 *   2. 独立无头 Edge：`msedge --headless=new --disable-extensions --remote-debugging-port=9333 --user-data-dir=%TEMP%\qrcode-cdp-9333`
 *   3. 用法：`node docs/plan/center-icon/verify-center-icon-edges.mjs [baseUrl] [port]`，默认 `http://localhost:3000/#generator` / `9333`
 */
/* eslint-disable antfu/no-top-level-await -- 一次性验收脚本：纯 CLI 顺序流，包一层 main() 只会增加缩进噪音 */
import process from 'node:process'
import { connect, log } from '../compose-rulers/cdp-client.mjs'

const baseUrl = process.argv[2] ?? 'http://localhost:3000/#generator'
const port = Number(process.argv[3] ?? 9333)

const page = await connect(port)
await page.openPage(baseUrl, 1200, 900, 8000)

const result = await page.evaluate(`(async () => {
  const imp = name => import('/_nuxt/logic/' + name + '.ts')
  const { defaultGeneratorState } = await imp('state')
  const { generateQRCode } = await imp('generate')

  // 纯蓝方块图标：便于区分「图标」与「底下的图案」
  const makeIcon = () => {
    const c = document.createElement('canvas')
    c.width = 32; c.height = 32
    const g = c.getContext('2d')
    g.fillStyle = '#1e88e5'
    g.fillRect(0, 0, 32, 32)
    return c.toDataURL('image/png')
  }
  // 纯红背景图
  const makeBg = () => {
    const c = document.createElement('canvas')
    c.width = 16; c.height = 16
    const g = c.getContext('2d')
    g.fillStyle = '#ff0000'
    g.fillRect(0, 0, 16, 16)
    return c.toDataURL('image/png')
  }

  const base = {
    ...defaultGeneratorState(),
    text: 'https://dsh.dev/center-icon',
    ecc: 'H',
    scale: 16,
    margin: 3,
    centerIcon: makeIcon(),
    centerIconSize: 16,
    centerIconPadding: 8,
    centerIconRounded: true,
    centerIconPlate: true,
  }

  const px = (canvas, x, y) => {
    const d = canvas.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data
    return [d[0], d[1], d[2], d[3]]
  }

  // 中心 / 底板带（图标半宽 + 底板厚度一半）/ 画布左上角
  const probe = (canvas, size, scale) => {
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    const band = (size * scale) / 2 + (size * scale * 0.08) / 2
    return {
      center: px(canvas, cx, cy),
      band: px(canvas, cx, cy - band + 1),
      far: px(canvas, 6, 6),
    }
  }

  const iconSizeOf = (canvas, scale, sizePct) => {
    const qrSize = Math.round(canvas.width / scale) - 6
    return (qrSize * sizePct) / 100
  }

  const out = {}

  // ---------- 1. transparent：间隙 alpha=0，且不画底板
  {
    const canvas = document.createElement('canvas')
    await generateQRCode(canvas, base, { transparent: true })
    out.transparent = probe(canvas, iconSizeOf(canvas, base.scale, base.centerIconSize), base.scale)
  }

  // ---------- 2. 背景图 + 底板开 / 关
  {
    const on = document.createElement('canvas')
    await generateQRCode(on, { ...base, backgroundImage: makeBg() })
    out.bgOn = probe(on, iconSizeOf(on, base.scale, base.centerIconSize), base.scale)

    const off = document.createElement('canvas')
    await generateQRCode(off, { ...base, backgroundImage: makeBg(), centerIconPlate: false })
    out.bgOff = probe(off, iconSizeOf(off, base.scale, base.centerIconSize), base.scale)
  }

  // ---------- 3. rotate 0 / 90 / 180 / 270：图标仍在中心
  {
    const centers = {}
    for (const rotate of [0, 90, 180, 270]) {
      const canvas = document.createElement('canvas')
      await generateQRCode(canvas, { ...base, rotate })
      centers['r' + rotate] = px(canvas, canvas.width / 2, canvas.height / 2)
    }
    out.rotate = centers
  }

  // ---------- 4. transformScale 1.5：图标随内容一起放大
  {
    const scale = 1.5
    const canvas = document.createElement('canvas')
    await generateQRCode(canvas, { ...base, transformScale: scale })
    out.scaled = probe(canvas, iconSizeOf(canvas, base.scale, base.centerIconSize), scale)
  }

  return out
})()`)

const near = (a, b, tol = 12) => a.every((v, i) => Math.abs(v - (b[i] ?? v)) <= tol)
const isBlue = p => p[2] > 150 && p[0] < 120
const fails = []

if (!isBlue(result.transparent.center))
  fails.push(`transparent 中心应为蓝色图标，实际 ${result.transparent.center}`)
if (result.transparent.band[3] !== 0)
  fails.push(`transparent 底板带应 alpha=0，实际 ${result.transparent.band}`)

if (!near(result.bgOn.far, [255, 0, 0, 255], 40))
  fails.push(`背景图未铺上，实际 far=${result.bgOn.far}`)
if (!near(result.bgOn.band, [255, 255, 255, 255], 12))
  fails.push(`底板开启时底板带应为白色，实际 ${result.bgOn.band}`)
if (!isBlue(result.bgOn.center))
  fails.push(`底板开启时中心应为蓝色图标，实际 ${result.bgOn.center}`)

if (!near(result.bgOff.band, [255, 0, 0, 255], 40))
  fails.push(`底板关闭时底板带应透出红色背景图，实际 ${result.bgOff.band}`)
if (!isBlue(result.bgOff.center))
  fails.push(`底板关闭时中心仍应为蓝色图标，实际 ${result.bgOff.center}`)

for (const [k, v] of Object.entries(result.rotate)) {
  if (!isBlue(v))
    fails.push(`${k} 中心应仍是蓝色图标，实际 ${v}`)
}

if (!isBlue(result.scaled.center))
  fails.push(`transformScale 中心应为蓝色图标，实际 ${result.scaled.center}`)
if (!isBlue(result.scaled.band))
  fails.push(`transformScale 图标放大后应覆盖底板带，实际 ${result.scaled.band}`)

if (fails.length) {
  for (const f of fails)
    process.stdout.write(`FAIL ${f}\n`)
  log({ result })
  process.exit(1)
}

process.stdout.write('PASS center-icon-edges (transparent alpha / plate vs backgroundImage / rotate / transformScale)\n')
page.close()
