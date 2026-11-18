# 开发规格：Compose 画布横纵标尺（Ruler）

> 读者假设：没有参与需求讨论的工程师。按本文档实现，不需要看任何聊天记录。
> 单位约定：**设计像素**（= `ComposeState.width/height` 的坐标系，与 Position 输入框、导出尺寸一致）；**屏幕像素**（= 浏览器 CSS px，预览用 `scale` 从设计像素映射）。

## 1. 需求与验收标准（每条可测）

| ID | 需求 | 验收标准（可测） |
| --- | --- | --- |
| A1 | Compose 预览画布上边缘出现横尺，左边缘出现纵尺，交叉处有一个 24×24 的角块 | 打开 `#compose`，画布左上角外有 24px 宽带状区域：上边一条水平刻度带、左边一条垂直刻度带，两者在左上角相接，中间无断层 |
| A2 | 刻度单位是设计像素，0 刻度对齐画布左上角 | 横尺 0 刻度线在画布左边缘，纵尺 0 刻度线在画布上边缘；横尺末端主刻度数值 ≤ `state.width`，且 `state.width` 落在画布右边缘 ±1px 内 |
| A3 | 主刻度步长自适应，任意 `scale` 下主刻度屏幕间距 ≥ 60px 且 < 300px | 预设 `9:16`（1080×1920）在 1440 宽窗口下：相邻带数字刻度的间距目测 ≥ 60px；把窗口从 800px 拖到 1920px，刻度数量变化但数字不重叠、不出现 `1.0000000002` 这类浮点尾巴 |
| A4 | 尺子只在画布外侧，不覆盖画面 | 画布内任何像素都不被尺子遮挡；尺子区域 `pointer-events: none`（在尺子上按住拖动不会选中图层、不会触发画布拖放） |
| A5 | 导出结果不含尺子 | 同一状态下「导出前」与「导出后」的 `renderComposeCanvas` 输出不变：`logic/compose.ts` 未被修改（`git diff --stat` 不含该文件），导出的 PNG 尺寸 = `width*exportScale × height*exportScale` |
| A6 | 现有交互零回归 | 图层拖拽、右下角缩放、方向键微调（Shift×10）、吸附参考线、拖入图片落点位置，全部与改动前一致；吸附红线仍与画布中线对齐 |
| A7 | 深浅色模式都可读 | `color-mode` 切到 dark：刻度线与数字可见（对背景对比度目测可辨），不出现纯黑压纯黑 |
| A8 | 尺度极端值不崩 | 画布 200×200 与 8000×8000 两种尺寸下：尺子不报错、不产生 `NaN` 宽度、页面不横向滚动溢出容器 |

## 2. 接口、数据结构与配置变更

### 2.1 新增文件 `logic/ruler.ts`（纯函数，无 Vue / DOM 依赖）

```ts
export interface RulerTick {
  /** 设计坐标（px），已收敛到 3 位小数 */
  design: number
  /** 相对尺子起点的屏幕偏移（px），= design * scale，已收敛到 3 位小数 */
  screen: number
  /** 是否主刻度（主刻度才画数字） */
  major: boolean
}

/** 返回 >= target 的最小 1/2/5×10ⁿ；非法输入（≤0 / NaN / Infinity）返回 1 */
export function niceStep(target: number): number

/**
 * @param lengthScreen 尺子可见长度，屏幕像素
 * @param scale        设计像素 → 屏幕像素
 * @param minMajorScreen 主刻度最小屏幕间距，默认 60
 */
export function buildRulerTicks(lengthScreen: number, scale: number, minMajorScreen?: number): RulerTick[]
```

`buildRulerTicks` 行为规定（逐条可断言）：

1. `!Number.isFinite(lengthScreen) || !Number.isFinite(scale) || lengthScreen <= 0 || scale <= 0` → 返回 `[]`。
2. `designLength = lengthScreen / scale`；`majorStep = Math.max(1, niceStep(minMajorScreen / scale))`。
3. `minorStep = majorStep / 5`；若 `minorStep < 1` 则 `minorStep = majorStep`（即不画次刻度）。
4. 防爆：若 `designLength / minorStep > 400`，令 `minorStep = Math.max(minorStep, niceStep(designLength / 400))`，保证刻度总数 ≤ 400。
5. 从 `i = 0` 递增 `v = i * minorStep`，`v <= designLength + 1e-6` 时产出刻度；`design` 与 `screen` 都用 `Number(x.toFixed(3))` 收敛。
6. `major` 判定：`majorStep === minorStep ? true : i % 5 === 0`。
7. 数组**必须包含** 0 刻度（`design === 0`、`screen === 0`）。

`niceStep` 行为规定：

| target | 返回 |
| --- | --- |
| `1.6` | `2` |
| `6.4` | `10` |
| `0.9` | `1` |
| `160` | `200` |
| `0` / `-3` / `NaN` | `1` |

### 2.2 新增组件 `components/ComposeRuler.vue`

> Nuxt 自动导入组件，调用方不需要 `import`。

```ts
const props = withDefaults(defineProps<{
  orientation: 'horizontal' | 'vertical'
  /** 尺子长度，屏幕像素 = 画布宽（或高）× scale */
  length: number
  /** 设计像素 → 屏幕像素 */
  scale: number
  /** 尺子厚度，默认 24 */
  thickness?: number
}>(), { thickness: 24 })
```

渲染规定：

- 根节点：`relative`、`select-none`、`pointer-events-none`、`overflow-hidden`、`bg-secondary`，并用 `border-base` 画内侧分隔线（横向尺画 `border-b`，纵向尺画 `border-r`）。
- 尺寸：横向 `width: length px; height: thickness px`；纵向 `height: length px; width: thickness px`。
- 刻度：横向 `position:absolute; left: screen px; bottom:0; width:1px; height: major?9px:4px`；纵向 `position:absolute; top: screen px; right:0; height:1px; width: major?9px:4px`。颜色用 `currentColor`，主刻度 `opacity: 0.55`，次刻度 `opacity: 0.3`。
- 数字：只画主刻度。横向 `left: screen + 3px; top: 1px`；纵向 `top: screen + 1px; left: 1px`。字号 `9px`、`line-height: 1`、`white-space: nowrap`、`font-variant-numeric: tabular-nums`、`opacity: 0.5`。文本 = `formatLabel(design)`。
- `formatLabel(v)`：`Math.round(v)`；`>= 10000` 时返回 `${(v/1000).toFixed(1).replace(/\.0$/, '')}k`，否则返回十进制字符串。
- 刻度数据：`computed(() => buildRulerTicks(props.length, props.scale))`。
- 组件内**不得**读取 `ComposeState`，不得发起任何全局副作用。

### 2.3 修改 `components/ComposeStage.vue`

只改布局与可用空间预算，不改拖拽 / 吸附 / 键盘逻辑。

1. 新增常量 `const RULER_SIZE = 24`（与尺子 `thickness` 同一来源，写字面量常量即可）。
2. `scale` 计算（现在 `components/ComposeStage.vue:17-21`）改为**扣除尺子厚度**，并给可用宽保底 120px：

```ts
const availableHeight = Math.max(360, windowHeight.value - 260) - RULER_SIZE
const availableWidth = Math.max(120, (wrapWidth.value || 640) - RULER_SIZE)
```

3. 新增 `stageW` / `stageH` 两个 computed（`props.state.width * scale.value`、`props.state.height * scale.value`），`stageStyle` 改为引用它们。

4. 模板结构（`components/ComposeStage.vue:259-325`）：

```html
<div ref="wrapEl" w-full>
  <div class="mx-auto w-max" :style="gridStyle">
    <div class="border-b border-r border-base bg-secondary" />   <!-- 角块 24×24 -->
    <ComposeRuler orientation="horizontal" :length="stageW" :scale="scale" :thickness="RULER_SIZE" />
    <ComposeRuler orientation="vertical" :length="stageH" :scale="scale" :thickness="RULER_SIZE" />
    <div ref="stageEl" ...>原画布内容，一个字符都不要改...</div>
  </div>
  <div mt-2 text-center text-xs op40>原底部提示行</div>
</div>
```

`gridStyle`：

```ts
const gridStyle = computed(() => ({
  display: 'grid',
  gridTemplateColumns: `${RULER_SIZE}px ${stageW.value}px`,
  gridTemplateRows: `${RULER_SIZE}px ${stageH.value}px`,
}))
```

5. 画布节点去掉 `mx-auto`（居中已由 grid 容器的 `mx-auto` 承担），其余 class 与事件保持不变。
6. 底部提示行文案可加一句尺子说明（可选，英文，例如 `Rulers show design pixels`）。

### 2.4 数据结构 / 配置变更

**无。** 不新增 `ComposeState` 字段，不改 `defaultComposeState()`（`logic/state.ts:107-122`），不改 `logic/types.ts`，不改 localStorage 结构，不改导出参数。

## 3. 边界与失败路径

| 场景 | 期望行为 |
| --- | --- |
| `scale <= 0` / `length = 0`（画布尺寸非法、`wrapEl` 尚未测量） | `buildRulerTicks` 返回 `[]`，尺子渲染为空白条；页面不报错 |
| 画布 200×200，可用宽 900 → `scale` 可能 > 1 | 主刻度步长仍 ≥ 60 屏幕像素；刻度不重复、不重叠 |
| 画布 8000×8000，可用宽 900 → `scale ≈ 0.11` | 主刻度 `majorStep = 1000` 设计像素（≈110 屏幕像素），刻度总数很少，正常渲染 |
| 窗口极窄（可用宽 < 120 + 24） | 可用宽保底 120，画布可能略超出容器；允许横向被裁切，**不得**产生控制台异常 |
| 主刻度数字在尺子末端被裁掉 | 允许（`overflow-hidden`），与 Figma 行为一致，不额外做翻转 / 省略逻辑 |
| 画布带 1px 边框（`border-box` 快捷类，`uno.config.ts:20`） | 0 刻度与内容原点最多差 1px，属已知公差，不做补偿 |
| 尺子上按下指针 | `pointer-events: none`，事件穿透，画布 `@pointerdown.self` 行为不变 |
| 导出 | `logic/compose.ts` 完全未改，导出图不含尺子（A5） |

## 4. 测试策略

1. **类型**：`pnpm typecheck` → 退出码 0（基线已确认绿）。
2. **Lint**：`pnpm lint` → 退出码 0（基线已确认绿）。
3. **刻度纯函数断言**：新增 `docs/plan/compose-rulers/verify-ruler.ts`，用 `node:assert/strict` 覆盖：
   - `niceStep` 五个用例（见 2.1 表）；
   - `buildRulerTicks(432, 0.4)`：首刻度 `design === 0 && screen === 0`，末刻度 `design <= 1080`，相邻主刻度屏幕间距 ≥ 60；
   - `buildRulerTicks(1000, 1)`：主刻度间距 === 100；
   - 非法输入（`0`、`NaN`、`-1`）返回 `[]`；
   - `buildRulerTicks(600, 0.02)`（极端缩放）：刻度总数 ≤ 400。
   运行方式：`node docs/plan/compose-rulers/verify-ruler.ts`（Node 24 原生类型剥离，脚本内只用类型注解，不用 enum / namespace / 装饰器）。全部通过时打印 `PASS` 并退出 0。
4. **构建**：`pnpm build` 退出码 0（收尾门槛，验证 Nuxt 编译与组件自动导入成立）。
5. **视觉验收**：`pnpm dev` → 打开 `http://localhost:3000/#compose`，按第 1 节 A1–A8 逐条核对（含深色模式与窗口缩放）。

## 5. 实施顺序与写入范围

| 顺序 | 任务 | 写入范围（只允许这些文件） | 前置 |
| --- | --- | --- | --- |
| 1 | 刻度内核 + 尺子组件 + 断言脚本 | 新建 `logic/ruler.ts`、`components/ComposeRuler.vue`、`docs/plan/compose-rulers/verify-ruler.ts` | 无 |
| 2 | 画布集成 | 只改 `components/ComposeStage.vue` | 任务 1 的三个文件已落盘 |
| 3 | 统一验收 | 不改业务文件，只跑命令 | 任务 2 完成 |

**互斥声明**：任务 1 与任务 2 的写入范围不重叠；两个任务都**不得**修改 `logic/compose.ts`、`logic/types.ts`、`logic/state.ts`、`components/Compose.vue`。
