import assert from 'node:assert/strict'
import process from 'node:process'
import { buildRulerTicks, niceStep } from '../../../logic/ruler.ts'

/** niceStep：>= target 的最小 1/2/5×10ⁿ，非法输入一律 1 */
const niceCases: [number, number][] = [
  [1.6, 2],
  [6.4, 10],
  [0.9, 1],
  [160, 200],
  [0, 1],
  [-3, 1],
  [Number.NaN, 1],
  [Number.POSITIVE_INFINITY, 1],
]
for (const [target, expected] of niceCases)
  assert.equal(niceStep(target), expected, `niceStep(${target}) 应返回 ${expected}，实际 ${niceStep(target)}`)

/** 预设 9:16（1080×1920）在 scale = 0.4 下：432 屏幕像素 */
const ticks = buildRulerTicks(432, 0.4)
assert.ok(ticks.length > 0, 'buildRulerTicks(432, 0.4) 不应返回空数组')
assert.equal(ticks[0].design, 0, '首刻度 design 必须为 0')
assert.equal(ticks[0].screen, 0, '首刻度 screen 必须为 0')
assert.ok(ticks[ticks.length - 1].design <= 1080, `末刻度 design 不应超过 1080，实际 ${ticks[ticks.length - 1].design}`)

const majors = ticks.filter(tick => tick.major)
assert.ok(majors.length >= 2, '主刻度至少要有 2 个')
for (let i = 1; i < majors.length; i++) {
  const gap = majors[i].screen - majors[i - 1].screen
  assert.ok(gap >= 60 - 1e-6, `相邻主刻度屏幕间距应 >= 60，实际 ${gap}`)
}

/** 刻度值不得出现浮点尾巴 */
for (const tick of ticks) {
  assert.equal(tick.design, Number(tick.design.toFixed(3)), `design 未收敛：${tick.design}`)
  assert.equal(tick.screen, Number(tick.screen.toFixed(3)), `screen 未收敛：${tick.screen}`)
}

/** scale = 1、长度 1000：主刻度间距必须正好 100 屏幕像素 */
const unitTicks = buildRulerTicks(1000, 1)
const unitMajors = unitTicks.filter(tick => tick.major)
assert.ok(unitMajors.length >= 2, 'buildRulerTicks(1000, 1) 主刻度至少要有 2 个')
for (let i = 1; i < unitMajors.length; i++)
  assert.equal(unitMajors[i].screen - unitMajors[i - 1].screen, 100, '主刻度间距必须为 100')

/** 非法输入：空数组 */
assert.deepEqual(buildRulerTicks(0, 1), [], 'length = 0 应返回空数组')
assert.deepEqual(buildRulerTicks(Number.NaN, 1), [], 'length = NaN 应返回空数组')
assert.deepEqual(buildRulerTicks(600, 0), [], 'scale = 0 应返回空数组')
assert.deepEqual(buildRulerTicks(600, -1), [], 'scale = -1 应返回空数组')
assert.deepEqual(buildRulerTicks(600, Number.NaN), [], 'scale = NaN 应返回空数组')

/** 极端缩放：刻度总数必须 <= 400 */
const extremeTicks = buildRulerTicks(600, 0.02)
assert.ok(extremeTicks.length > 0, 'buildRulerTicks(600, 0.02) 不应返回空数组')
assert.ok(extremeTicks.length <= 400, `刻度总数应 <= 400，实际 ${extremeTicks.length}`)

process.stdout.write('PASS\n')
