# 可行性分析：二维码中心图（Center Icon）

**结论：有条件可行，建议立刻做。** 改动集中在「状态字段 → 布局期切洞 → canvas / SVG 双后端贴图」三层，可完全复用现有的 `cutOut` 机制与 painter 抽象；上游 fork 的补丁（[4a25f0c](https://github.com/akinazuki/qrcode-toolkit/commit/4a25f0c1497f6cd8ad44f5336005a8624b90ca6b)）基于重构前的单函数渲染，**不能 cherry-pick**，但其几何公式、参数区间与「透明间隙 + 圆角裁剪 + contain 缩放」的思路可以直接移植。前置条件见第 5 节（ECC 固定 H 的显式提示、图标尺寸上限 18%、上传时重编码到 ≤256px）。

---

## 1. 目标与非目标

### 1.1 目标

| 编号 | 目标 | 可验收口径 |
| --- | --- | --- |
| G1 | Generator 支持上传一张图片作为二维码中心图 | 上传后预览画布中心出现该图，`state.centerIcon` 为 `data:image/png;base64,...` |
| G2 | 图标周围留出可调的透明间隙（避免与模块粘连） | 间隙区间内的模块不被绘制，间隙宽度随 `centerIconPadding` 线性变化 |
| G3 | 尺寸、间隙、圆角、底板四个参数可调且有上下限 | 尺寸 8–18%（占二维码边长）、间隙 0–10%（占图标边长）、圆角/底板为布尔 |
| G4 | PNG 与 SVG 两种导出都带中心图，且像素级一致 | 同一 state 导出的 SVG 光栅化后与 PNG 在图标区域一致（e2e 断言尺寸与位置） |
| G5 | 不破坏可扫性 | 在 ECC=H、尺寸 ≤18% 的前提下，生成的 PNG 能被 `qr-scanner-wechat` 解码回原文（脚本自动断言） |
| G6 | 状态可持久化/导入导出，旧状态不报错 | 老 `localStorage` 缺字段时回退默认值；`Save state` 导出的 JSON 含新字段 |

### 1.2 非目标（v1 明确不做）

- 不做图标自身的旋转、描边、滤镜、去背景；不做图标形状裁切（圆形/星形）。
- 不做偏心/多图标；只支持正中心一个。
- **不做透视（perspective）下的图标贴图**：图标画在输出画布坐标系，不随透视扭曲，UI 给出提示（详见 §3 与 spec §3）。
- 不改 Compare 标签页的对比算法：图标区域会被算作 mismatch，只加提示横幅。
- 不引入新依赖、不新增网络请求、不新建测试框架（与仓库现状一致，见 §2.1）。
- 不改 Compose 的数据模型：图标随生成图进入贴片，模型不变。

---

## 2. 现状（事实与证据）

### 2.1 基线与环境

| 事实 | 证据 |
| --- | --- |
| 基线绿：类型检查与 lint 均通过 | 2026-11-18 执行 `pnpm typecheck` → exit 0；`pnpm lint` → exit 0（node v24.21.0） |
| CI 只跑 lint + typecheck，无单测 | `.github/workflows/ci.yml:24`（`pnpm run lint`）、`.github/workflows/ci.yml:41`（`pnpm run typecheck`），node 24.x |
| 仓库无测试框架 | `package.json:1-56` 无 vitest/jest；历史验收靠放在 `docs/plan/<任务>/` 下的独立脚本，见 `docs/plan/compose-rulers/verify-interaction.mjs:1-15` |
| 本项目已有 PNG + SVG 导出 | `components/Generator.vue:63-67`（downloadPNG）、`components/Generator.vue:69-84`（downloadSVG） |
| Windows 上 node 不在 PATH | `pnpm typecheck` 直接跑会失败：`'node' is not recognized as an internal or external command`；把 `D:\it-soft\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin` 前置到 `PATH` 后 exit 0 |

### 2.2 渲染管线（现状）

canvas 路径 `logic/generate.ts:16-241`：

1. `createQrLayout(state)` 解析矩阵与每个模块的标志（`logic/generate.ts:26`）；
2. 离屏 canvas 上 `paintQr(painter, layout, state)` 逐像素绘制（`logic/generate.ts:44`）；
3. `applyPerspective()`（`logic/generate.ts:47`，实现在 `:78-141`）；
4. 效果与背景：`applyEffect()`、`applyBackground()`（`logic/generate.ts:49-56`，`applyBackground` 在 `:208-240`，先铺底色/背景图再 `drawImage(clone)` 盖回二维码，因此**被挖掉的模块会露出背景图**）；
5. 拷到输出 canvas，并施加 `transformScale`：`setTransform(scale,0,0,scale, -(scale-1)*width/2, -(scale-1)*height/2)` 后 `drawImage`（`logic/generate.ts:59-76`）。

SVG 路径 `logic/svg.ts:308-356`：

1. `needsRasterFallback`（`logic/svg.ts:366-370`）命中效果/透视时退化为「PNG 塞 `<image>`」（`logic/svg.ts:372-387`）；
2. 否则 `createQrLayout` + `paintQr` 进 `SvgPainter`（`logic/svg.ts:32-300`），产出 `{ defs, content }`（`logic/svg.ts:328-329`）；
3. 图层顺序：背景图层（`createBackgroundLayer`，`logic/svg.ts:389-415`）→ 二维码内容；`transformScale !== 1` 时整组套 `<g transform=...>`（`logic/svg.ts:331-344`）；非透明时再在最外层补一层纯色底（`createFlatBackground`，`logic/svg.ts:358-363`）；
4. `wrapDocument`（`logic/svg.ts:434-450`）统一输出 `<defs>` 与 `<svg>`，已有 `escapeAttribute`（`logic/svg.ts:426-432`）。

两条路径共享同一份 `createQrLayout` 与 `paintQr`，这正是「一次几何、两后端一致」的基础（`logic/draw.ts:45-48` 的注释明确写了这个承诺）。

### 2.3 关键复用点：`cutOut`

`logic/draw.ts:280-286` 已有一个挖洞原语：

```ts
function cutOut(ix: number, iy: number, w: number, h: number) {
  if (x >= ix && x < ix + w && y >= iy && y < iy + h) {
    isDark = false
    isBorder = true
    isIgnored = true
  }
}
```

它目前服务于 `marginNoiseSpace === 'extreme'` 的假定位图形（`logic/draw.ts:288-301`），坐标是**模块坐标**（循环变量 `x/y` 取值 `-margin .. qr.size+margin-1`，`logic/draw.ts:349-352`），并且在旋转/边距映射之前调用（`logic/draw.ts:303-325`）。中心图挖洞完全复用同一落点：在 `:288` 之后追加一次 `cutOut(...)`，后续 `paintQr` 会因 `isIgnored` 跳过（`logic/draw.ts:398-400`），canvas 与 SVG 自动同步。

### 2.4 下游影响面

| 调用点 | 影响 |
| --- | --- |
| `components/Generator.vue:46-61` `run()` | 预览、`dataUrlGeneratedQRCode`、`dataUrlGeneratedQRCodeForCompose` 都会自动带上中心图 |
| `logic/compose.ts:91` / `components/Compose.vue:107` | 「Place on Canvas」贴片会带上中心图；`measureAlpha`（`logic/compose.ts:121-136`）只看 alpha，不受影响 |
| `logic/utils.ts:27-34` → `logic/diff.ts:50-103` | Compare 逐格比对，**中心图区域会被计为 mismatch**，v1 只提示不改算法 |
| `pages/batch.vue:41,55,66` | 批量页用 `defaultGeneratorState()`，新字段默认 `centerIcon: undefined`，行为不变 |
| `components/StateProvider.vue:12-21` | `mergeDefaults` 会把缺失的新字段填成默认值，老状态向后兼容 |

### 2.5 fork 补丁为什么不能直接 apply

| 补丁落点 | fork 的写法 | 本仓库现状 | 可移植性 |
| --- | --- | --- | --- |
| `logic/generate.ts` `drawQRCode()` 内、transform 之后 `await drawCenterIcon(ctx, ...)` | 单函数渲染，直接用 `ctx.clearRect` 抠洞 | `drawQRCode` 不存在；渲染已拆成 layout / paint / 透视 / 效果 / 拷贝（`logic/generate.ts:16-241`） | ❌ 需重写落点 |
| `toSVG(width, height, background?, overlay?)` 里拼 `${defs}` + `<mask>` + `<clipPath>` + `<image>` | 单文件字符串拼接，`defs` 由它自己管 | SVG 由 `SvgPainter` 产 `{defs, content}`，`wrapDocument` 统一收口（`logic/svg.ts:308-356`、`:434-450`） | ❌ 需接入 layers/defs |
| 擦除：`SvgContext` 里 `clearRect` 等价物 | fork 自带 `SvgContext` | 本仓库擦除走 `SvgPainter` 的 `<mask>`（`logic/svg.ts:286-299`）与 `CanvasPainter` 的 `destination-out`（`logic/painter.ts:70-130`） | ❌ 不存在该类 |
| `types.ts` + `state.ts` 四个字段 | `icon` / `iconSize` / `iconPadding` / `iconRounded`，默认 16 / 8 / true | 可直接照搬语义 | ✅ 语义可搬，命名按本仓库风格重定 |

另外 fork 在 canvas 里用 `clearRect` 抠透明间隙，只在「有底色」的前提下成立；本仓库 `generateQRCode(..., { transparent: true })` 的底色是空的（`logic/generate.ts:63-66`），`clearRect` 是空操作，靠它抠不出间隙。**布局期切洞才是唯一能同时覆盖透明 / 非透明、canvas / SVG 的做法**。

---

## 3. 方案对比

| 维度 | 方案 A：照搬 fork（事后 clearRect + 覆盖绘制） | 方案 B（推荐）：布局期切洞 + 输出期贴图 | 方案 C：DOM/CSS 叠加中心图 | 方案 D：换用 `qr-code-styling` 重写渲染 |
| --- | --- | --- | --- | --- |
| SVG 导出 | 要另写一套 mask/clipPath，与 canvas 两套逻辑 | 切洞天然共享；只需补一个 `<image>` 图层 | 完全导不出（或退化为整张 PNG） | 需替换整套渲染，SVG 与现有 painter 能力（像素风格、标记形状、噪点、透视）不兼容 |
| 透明导出 | `clearRect` 在透明画布上是空操作，间隙抠不出来 | 模块根本不绘制 → 间隙天然是 alpha 0 | 叠加层在导出时丢失 | 依赖库行为 |
| 一致性风险 | canvas 与 SVG 两套坐标/裁剪各自实现 | 一套几何（`logic/icon.ts`），两端只负责画 | 无（一致性无从谈起） | 中：整仓视觉回归 |
| 改动面 | 中（但分散在两个后端） | 6 个文件 + 1 个新模块 | 小 | 极大 |
| 与效果/透视共存 | 图标在 effect 之后画 → 清晰；透视下不扭曲 | 同 A | 无 | 由库决定 |
| 可扫性可验证性 | 可 | 可（脚本可解码 PNG，见 §4） | 不可 | 可 |
| 结论 | 只借思路与公式 | ✅ 采用 | ❌ 否决（导出是硬需求） | ❌ 否决（成本与回归面不成比例） |

**取舍理由**：方案 B 让「切哪里」与「画什么」彻底分离——`logic/draw.ts` 只决定哪些模块被挖掉，`logic/generate.ts` 与 `logic/svg.ts` 只负责在同一个矩形里画图片。这既满足 PNG/SVG 像素一致的既有承诺，也让透明导出不留任何残影，同时把新增状态局限在 5 个字段。

---

## 4. 工作量与风险

### 4.1 工作量

| 任务 | 内容 | 预估 |
| --- | --- | --- |
| T1 核心 | 5 个状态字段、`clamp` 与几何公式、`logic/icon.ts`（几何/图片加载/画布贴图/上传重编码）、`logic/draw.ts` 挖洞与 `QrLayout.icon` | 2.5 h |
| T2 canvas | `logic/generate.ts` 在 `transformScale` 组内贴图（底板、圆角、contain） | 1.5 h |
| T3 SVG | `logic/svg.ts` 新增图标图层 + `clipPath` 进 `defs`；光栅回退路径自动复用 | 2 h |
| T4 界面 | 上传/替换/清除 + 4 个控件 + 3 条提示横幅 | 1.5 h |
| T5 验收脚本 | 纯函数脚本（Node 24 类型剥离）+ CDP e2e（真实解码断言） | 2 h |
| T6 交叉验证 | typecheck、lint、e2e、人工扫码 | 1 h |
| 合计 | | ≈ 10.5 h |

### 4.2 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 中心图吃掉过多模块导致扫不出 | 高（核心价值） | 尺寸硬上限 18%（面积 3.24%）、间隙上限 10%；上传即切 ECC=H（H 可恢复约 30% 码字，见 [ISO/IEC 18004 汇总](https://stackoverflow.com/questions/11115156/how-to-compute-the-maximum-size-of-a-logo-inserted-in-a-qrcode)）；`version < 3` 时额外告警；e2e 用 `logic/scan.ts:4-23` 真实解码 |
| 图标 data URL 撑爆 `localStorage`（5 MB 配额） | 中 | 上传时用 canvas 重编码为 PNG 且最长边 ≤256px（`prepareCenterIcon`），单图通常 10–60 KB；失败直接抛错提示 |
| 图标是 SVG / 无固有尺寸的图片，`drawImage` 失败或画不出 | 中 | 统一重编码为 PNG 位图，一处解决 canvas / SVG「导出后打不开」的双重问题 |
| Compare 页把图标区域算成 mismatch | 中 | 明确为已知限制，Generator 加提示横幅；不改 `logic/diff.ts`（避免为 v1 引入未验证的格子豁免逻辑） |
| 透视变形下图标不贴合 | 低（视觉瑕疵） | 图标在 effect/透视之后绘制 → 保持清晰；UI 提示「图标不随透视扭曲」；文档写明 |
| 深色/透明模式间隙露出背景图，图标对比度不足 | 中 | 默认开启「底板」（用 `getBackgroundColor` 涂满间隙），透明导出时自动跳过底板 |
| 旧 localStorage 缺字段导致 `NaN` 尺寸 | 中 | `resolveCenterIconLayout` 对每个数值做 `Number.isFinite` + `clamp` 双重兜底；`defaultGeneratorState()` 提供默认值 |
| SVG 阅读器对 `<clipPath>` 的兼容性 | 低 | 只在勾选圆角时输出 `clip-path`；其余情况用方形 `<image>`，退化为最保守写法 |

### 4.3 已知限制（交付时需明示）

1. 透视（`transformPerspectiveX/Y ≠ 0`）不会扭曲中心图。
2. Compare 标签页不理解中心图，图标区域报 mismatch。
3. SVG 图标以 base64 PNG 内嵌，矢量图标会被光栅成 256px 位图。

---

## 5. 结论

**有条件可行，建议按方案 B 实施。**

- 主路径改动 6 个既有文件（`logic/types.ts`、`logic/state.ts`、`logic/draw.ts`、`logic/generate.ts`、`logic/svg.ts`、`components/Generator.vue`）+ 新增 `logic/icon.ts` + 2 个验收脚本，无新依赖。
- 前置条件（缺一不可）：
  1. 状态里 5 个字段必须有默认值且在 `defaultGeneratorState()` 中显式给出，保证旧状态与 Reset 行为正确；
  2. 挖洞必须发生在 `logic/draw.ts` 的模块坐标阶段（复用 `cutOut`），不得在渲染后擦除；
  3. 上传必须重编码为 ≤256px 的 PNG；
  4. ECC ≠ H 与 `version < 3` 时必须给出可见提示。
- 验收靠三层证据：`pnpm typecheck` + `pnpm lint`；纯函数断言；CDP e2e（含 `qr-scanner-wechat` 真实解码）+ 人工扫码。

详见 `docs/plan/center-icon/spec.md`（规格）与 `docs/plan/center-icon/tasks.md`（任务拆分）。
