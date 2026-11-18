# 可行性分析：Compose 画布横纵标尺（Ruler）

**结论一句话**：可行，低风险。Compose 预览的坐标体系已经集中在 `scale` 一个变量上，在画布外侧加一条顶边横尺 + 一条左边纵尺，纯展示、不参与导出，改动集中在 `components/ComposeStage.vue` 与两个新文件。

## 1. 目标与非目标

### 目标

1. Compose 预览画布的**上边缘**与**左边缘**各显示一条标尺（ruler），刻度单位是**设计像素**（与 `ComposeState.width/height`、Position 输入框、导出尺寸同一套坐标）。
2. 刻度随预览缩放自适应：窗口变宽 / 画布尺寸变化时，主刻度步长在 `1/2/5 × 10ⁿ` 中自动切换，任意缩放级别下主刻度屏幕间距保持 ≥ 60px，数字不重叠。
3. 尺子位于画布**外侧**，不遮挡画面内容；`renderComposeCanvas` 的导出结果与现状**逐像素一致**。
4. 尺子不拦截指针事件（不改动现有拖拽 / 缩放 / 吸附 / 键盘微调行为）。

### 非目标

- 不做鼠标位置十字线、实时坐标读数（用户明确选择最小档）。
- 不做可拖出的辅助参考线（guides）、参考线持久化、与图层间距测量。
- 不做尺子开关、单位切换（px / mm / %）、尺子缩放联动（拖动尺子改变画布尺寸）。
- 不新增任何 `ComposeState` 字段，不动 localStorage 结构。

## 2. 现状（事实与证据）

| 事实 | 证据 |
| --- | --- |
| Compose 页面是「左画布 + 右 24rem 参数栏」两列，`lt-lg` 时竖排 | `components/Compose.vue:210` |
| 画布组件只接收 `ComposeState`，内部用一个 `scale` 把设计像素映射成屏幕像素 | `components/ComposeStage.vue:5-7`、`components/ComposeStage.vue:17-21` |
| `scale = min(可用宽 / width, 可用高 / height)`，可用宽取 `wrapEl` 实测宽（缺省 640），可用高取 `windowHeight - 260`（下限 360） | `components/ComposeStage.vue:17-21` |
| 画布 DOM 尺寸 = 设计尺寸 × scale，节点 `ref="stageEl"`，本身带 1px 边框（`border-box` 快捷类 = `border border-base rounded`） | `components/ComposeStage.vue:23-26`、`components/ComposeStage.vue:262`、`uno.config.ts:20` |
| 图层、吸附参考线、拖入落点全部以 `stageEl` 为定位基准，除以 / 乘以 `scale` | `components/ComposeStage.vue:48-70`、`components/ComposeStage.vue:219-225`、`components/ComposeStage.vue:318-323` |
| 导出走独立 canvas，逐项读 `ComposeState`，完全不读 DOM | `logic/compose.ts:415-467` |
| `ComposeState` 当前无任何「显示辅助」类字段（无 grid / ruler / guides 开关） | `logic/types.ts:221-236`、`logic/state.ts:107-122` |
| 项目无测试框架，脚本只有 build / dev / typecheck / lint / generate | `package.json:6-17` |
| 视图由 URL hash 决定，`#compose` 可直达 Compose | `logic/view.ts:1`、`logic/view.ts:7-15` |
| 设计系统：UnoCSS attributify + shortcuts（`bg-secondary`、`border-base`、`text-button`），图标族 `i-ri-*` | `uno.config.ts:15-41`、`components/ComposeStage.vue:302` |
| 深色模式由 `@nuxtjs/color-mode` 提供，现有组件已用 `bg-white dark:bg-black` 一类类名 | `uno.config.ts:16`、`package.json:32` |

**关键推论**：尺子只需要知道两件事——画布在屏幕上的像素长度（`state.width * scale`）和 `scale` 本身。它不需要知道任何图层几何，因此可以做成纯展示组件，与拖拽逻辑零耦合。

## 3. 方案对比

### 方案 A：DOM 刻度（推荐）

在画布外套一层 CSS Grid：左上角块 + 顶边横尺 + 左边纵尺 + 画布。尺子内部按 `buildRulerTicks()` 返回的刻度数组渲染绝对定位的 1px 线，主刻度带数字。

- 优点：无 DPR / 字体渲染 / canvas 生命周期问题；SSR 安全；样式直接吃 UnoCSS 主题与深色模式；刻度数组是纯函数，可脱离浏览器断言。
- 缺点：极端缩放时 DOM 节点数量增加。实测上界：800px 屏幕跨度 / 12px 最小次刻度 ≈ 67 个节点 × 2 条尺子，可忽略。

### 方案 B：Canvas 绘制尺子

尺子用一个 `<canvas>`，按 DPR 放大绘制刻度与文字。

- 优点：节点数恒定，像素级可控，未来画参考线时更顺。
- 缺点：需处理 `devicePixelRatio`、字体加载时机、深浅色主题变更重绘；`scale` 变化时整块重绘；文字在 DPR=1 与 1.5 下渲染差异要单独调。为一个纯装饰组件引入这套复杂度不划算。

### 方案 C：CSS repeating-linear-gradient 纯样式刻度

用 `repeating-linear-gradient` 画刻度，不写 JS。

- 优点：代码量最小。
- 缺点：**无法在刻度上写数字**，而「横纵显示尺子」的核心价值就是读出设计坐标；且步长随 `scale` 变化时必须重新生成整条 gradient 字符串，可读性反而更差。

### 取舍

选 **A**。理由是：数字标签是刚需，纯函数刻度可被脚本断言（这是本项目唯一能自动化的验证手段），且不与即将可能出现的「参考线」需求耦合过度——真要做参考线，方案 A 的刻度数组同样可复用。

## 4. 工作量与风险

| 项 | 估计 |
| --- | --- |
| 新增 `logic/ruler.ts`（刻度数学，纯函数） | 0.5 人时 |
| 新增 `components/ComposeRuler.vue`（两条尺子共用） | 1 人时 |
| 改 `components/ComposeStage.vue`（Grid 包裹 + 可用空间扣除尺子厚度） | 0.5 人时 |
| 验证（typecheck / lint / 刻度断言脚本 / 浏览器目测） | 1 人时 |
| 合计 | 约 0.5 人日 |

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| 加尺子后可用空间变小，`scale` 未同步扣除导致画布溢出容器 | 中 | `scale` 计算里显式减 `RULER_SIZE`（`components/ComposeStage.vue:17-21`），并设最小可用宽 120px 兜底 |
| 刻度数字在画布最右 / 最下被裁切 | 低 | 尺子容器 `overflow-hidden` + 最后一个主刻度标签允许被裁（与 Figma 一致，不影响读数） |
| 深色模式下刻度线看不见 | 低 | 用 `op` 半透明 + UnoCSS 主题变量，两种模式各自目测一次 |
| 画布 1px 边框导致 0 刻度与内容原点差 1px | 低 | 已知公差，验收标准里写明「≤ 1px」，不做额外补偿逻辑 |
| 移动端（`lt-lg` 单列）尺子挤压画布 | 低 | 可用宽扣除尺子厚度并保底 120px；画布本来就随窗口缩，视觉上仍完整 |

## 5. 结论

**可行（无条件）**。前置条件只有一条：`pnpm typecheck` 与 `pnpm lint` 在改动前是绿的（当前正在核对基线，若基线本身有错，则验收口径改为「不新增错误」）。
