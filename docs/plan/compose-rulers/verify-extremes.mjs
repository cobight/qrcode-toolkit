import { Buffer } from 'node:buffer'
/**
 * 极端画布尺寸验收脚本（仅验收用，不参与打包）。
 * 做法：在页面里把「Size」那一对数字输入框改写成 200×200 与 8000×8000，
 * 走真实 UI 输入链路，然后探测画布 rect、尺子标签与 NaN 样式。
 * 断言：
 *   1) 输入生效（持久化状态里的 width/height 等于目标值）；
 *   2) 画布 rect 为正数且无 NaN/Infinity；
 *   3) 页面上没有任何 inline style 出现 NaN/Infinity；
 *   4) 横尺、纵尺都能产出 ≥2 个主刻度标签；
 *   5) 全程无 console.error / 未捕获异常。
 * 用法（先启动带 --remote-debugging-port=9223 的无头 Edge）：
 *   node docs/plan/compose-rulers/verify-extremes.mjs <url> <out-dir> [port]
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { connect, log } from './cdp-client.mjs'

const probe = `(() => {
  const stage = document.querySelector('div[tabindex="0"]')
  const rect = stage.getBoundingClientRect()
  const grid = stage.parentElement
  // grid 子节点顺序：角块、横尺、纵尺、画布
  const rulers = Array.from(grid.children).slice(1, 3)
  const nanStyles = Array.from(document.querySelectorAll('[style]'))
    .filter(el => /NaN|Infinity/.test(el.getAttribute('style')))
    .map(el => el.tagName + ':' + el.getAttribute('style').slice(0, 80))
  const labels = rulers.map(el => Array.from(el.children)
    .map(child => child.textContent.trim()).filter(Boolean))
  let canvasSize = null
  try {
    const state = JSON.parse(localStorage.getItem('qrd-state-1') || '{}')
    const walk = node => {
      if (!node || typeof node !== 'object' || canvasSize) return
      if (Array.isArray(node.stamps) && typeof node.width === 'number') canvasSize = [node.width, node.height]
      for (const key of Object.keys(node)) walk(node[key])
    }
    walk(state)
  } catch (error) {}
  return {
    canvasSize,
    stage: { w: Math.round(rect.width), h: Math.round(rect.height) },
    rulerSize: rulers.map((el) => {
      const box = el.getBoundingClientRect()
      return Math.round(box.width) + 'x' + Math.round(box.height)
    }),
    labels,
    nanStyles,
  }
})()`

function setSize(fromWidth, fromHeight, toWidth, toHeight) {
  return `(() => {
    const inputs = Array.from(document.querySelectorAll('input[type=number]'))
    let index = -1
    for (let i = 0; i < inputs.length - 1; i += 1) {
      if (inputs[i].value === '${fromWidth}' && inputs[i + 1].value === '${fromHeight}') {
        index = i
        break
      }
    }
    if (index < 0)
      return 'pair ${fromWidth}x${fromHeight} not found in ' + JSON.stringify(inputs.map(input => input.value))
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    const apply = (el, value) => {
      setter.call(el, String(value))
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    apply(inputs[index], ${toWidth})
    apply(inputs[index + 1], ${toHeight})
    return 'ok'
  })()`
}

async function main() {
  const url = process.argv[2] ?? 'http://localhost:3000/#compose'
  const outDir = process.argv[3] ?? '.'
  const port = Number(process.argv[4] ?? 9223)
  const page = await connect(port)
  await page.openPage(url)

  const initial = await page.evaluate(probe)
  const report = { initial: initial.canvasSize }
  const steps = [
    {
      name: 'small',
      from: initial.canvasSize ?? [1080, 1920],
      to: [200, 200],
    },
    {
      name: 'large',
      from: [200, 200],
      to: [8000, 8000],
    },
  ]

  for (const step of steps) {
    const setResult = await page.evaluate(setSize(step.from[0], step.from[1], step.to[0], step.to[1]))
    await new Promise(resolve => setTimeout(resolve, 1500))
    const state = await page.evaluate(probe)
    const screenshot = await page.send('Page.captureScreenshot', { format: 'png' })
    const file = join(outDir, `compose-ruler-${step.name}.png`)
    writeFileSync(file, Buffer.from(screenshot.data, 'base64'))
    report[step.name] = {
      setResult,
      expected: step.to,
      ...state,
      file,
    }
  }

  log(report)
  log('problems:', page.problems.length ? page.problems : 'none')

  const ok = steps.every(({ name }) => {
    const item = report[name]
    return item !== undefined
      && item.setResult === 'ok'
      && String(item.canvasSize) === String(item.expected)
      && item.stage.w > 0
      && item.stage.h > 0
      && Number.isFinite(item.stage.w)
      && Number.isFinite(item.stage.h)
      && item.nanStyles.length === 0
      && item.labels[0].length >= 2
      && item.labels[1].length >= 2
  })
  log(ok && page.problems.length === 0
    ? 'PASS'
    : 'FAIL')
  page.close()
  process.exit(ok && page.problems.length === 0
    ? 0
    : 1)
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exit(1)
})
