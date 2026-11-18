/**
 * 交互回归验收脚本（仅验收用，不参与打包）。
 * 断言：拖动画布上的图层后，右侧 Position 的两个数字输入框发生变化，
 * 且整个过程中页面没有 console error / 未捕获异常（尺子不得干扰指针事件）。
 * 用法（先启动带 --remote-debugging-port=9223 的无头 Edge）：
 *   node docs/plan/compose-rulers/verify-interaction.mjs <url> [port]
 */
import process from 'node:process'
import { connect, log } from './cdp-client.mjs'

async function main() {
  const url = process.argv[2] ?? 'http://localhost:3000/#compose'
  const port = Number(process.argv[3] ?? 9223)
  const page = await connect(port)
  await page.openPage(url)

  // 归一化持久化状态：固定成 1080×1920、只留一个居中的图层并选中它，
  // 这样拖拽目标是确定的，且右侧 Position 面板一定出现
  const normalize = `(() => {
    const raw = localStorage.getItem('qrd-state-1')
    if (!raw)
      return 'no state'
    const state = JSON.parse(raw)
    let compose = null
    const walk = (node) => {
      if (!node || typeof node !== 'object' || compose)
        return
      if (Array.isArray(node.stamps) && typeof node.width === 'number')
        compose = node
      for (const key of Object.keys(node)) walk(node[key])
    }
    walk(state)
    if (!compose || !compose.stamps.length)
      return 'no stamps'
    const stamp = compose.stamps[0]
    compose.width = 1080
    compose.height = 1920
    stamp.x = Math.round((1080 - stamp.width) / 2)
    stamp.y = Math.round((1920 - stamp.height) / 2)
    compose.stamps = [stamp]
    compose.selectedId = stamp.id
    localStorage.setItem('qrd-state-1', JSON.stringify(state))
    return 'ok'
  })()`
  const normalizeResult = await page.evaluate(normalize)
  log('normalize:', normalizeResult)
  if (normalizeResult !== 'ok') {
    log('FAIL')
    page.close()
    process.exit(1)
  }
  await page.send('Page.navigate', { url })
  await new Promise(resolve => setTimeout(resolve, 5000))

  const readNumbers = `Array.from(document.querySelectorAll('input[type=number]')).map(input => input.value)`
  const before = await page.evaluate(readNumbers)
  const stage = await page.evaluate(`(() => {
    const rect = document.querySelector('div[tabindex="0"]').getBoundingClientRect()
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
  })()`)

  const centerX = stage.x + stage.w / 2
  const centerY = stage.y + stage.h / 2
  await page.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: centerX,
    y: centerY,
    button: 'left',
    clickCount: 1,
    buttons: 1,
  })
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: centerX + 40,
    y: centerY + 30,
    button: 'left',
    buttons: 1,
  })
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: centerX + 40,
    y: centerY + 30,
    button: 'left',
    clickCount: 1,
    buttons: 0,
  })
  await new Promise(resolve => setTimeout(resolve, 500))

  const after = await page.evaluate(readNumbers)
  const changed = before
    .map((value, index) => [value, after[index]])
    .filter(([, newValue]) => newValue !== null && newValue !== undefined)
    .map(([value, newValue]) => [value, newValue])
    .filter(([oldValue, newValue]) => oldValue !== newValue)

  log('stage rect:', stage)
  log('numbers before:', before)
  log('numbers after:', after)
  log('changed pairs:', changed)
  log('problems:', page.problems.length ? page.problems : 'none')

  // 断言：恰好两个数字变化（即 Position 的 x/y），且两个方向都增大
  const movedRightDown = changed.length === 2
    && changed.every(([oldValue, newValue]) => Number(newValue) > Number(oldValue))
  const ok = movedRightDown && page.problems.length === 0
  log(ok ? 'PASS' : 'FAIL')
  page.close()
  process.exit(ok ? 0 : 1)
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exit(1)
})
