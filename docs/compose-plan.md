# 二维码排版栏目（Compose）可行性方案

> 目标：在现有 Generator / Compare / Verify 之外新增一个「排版」栏目，把已生成的二维码当作可拖动、可缩放的贴片，放到指定长宽比（9:16、16:9 等）的画布上，最终导出成图。
> 结论先行：**完全可行，且不需要引入新依赖**。核心工作量在「坐标一致性」和「大图持久化」两个坑上，其余都是现有组件的复用。

---

## 1. 现状事实（决定了方案边界）

| 事实 | 位置 | 对方案的影响 |
| --- | --- | --- |
| 视图切换是 URL hash 单一 ref，白名单校验 | `logic/view.ts:1`、`logic/view.ts:7-15` | 加一个 `'compose'` 即可，深链 `#compose` 自动可用 |
| 四个栏目 tab 与视图挂载都在 StateProvider | `components/StateProvider.vue:65-108`、`:111-128` | tab 按钮 + 视图容器各加一段 |
| 全部状态存在 `useLocalStorage('qrd-state-N')`，含 uploaded 里的 dataURL | `components/StateProvider.vue:12-21`、`logic/state.ts:106-118` | **大图 dataURL 入 localStorage 会撞 5MB 配额**，必须隔离 |
| 二维码产物是全尺寸 PNG dataURL（含 margin、背景色、透视、缩放） | `components/Generator.vue:23-28`、`logic/state.ts:14` | 贴片直接用它，所有生成效果天然保留，不用重算 |
| 生成时统一 `imageSmoothingEnabled = false` + lightColor 铺底 | `logic/generate.ts:63-67`、`:785-786` | 导出也要关插值，否则像素风会糊；贴片本体自带白底，可扫性反而更好 |
| 已有 cover 等比填充算法（背景图） | `logic/generate.ts:861-890`（`:878-886` 是裁剪逻辑） | 背景图 cover 直接复用这段思路 |
| 已有上传控件与拖放交互范例 | `components/ImageUpload.vue`、`components/Generator.vue:155-190` | 背景图上传不用重写 |
| 已有本地解码能力 | `logic/scan.ts:4-23` `scanQRCodeFromDataUrl` | 导出后可做「扫码自检」，这是本功能独有的质量闭环 |
| `ssr: false` | `nuxt.config.ts:12` | 可直接用 canvas / Image，无 SSR 兼容负担 |

---

## 2. 关键设计决策

### 2.1 坐标系：用「设计像素」，不用「屏幕像素」

这是本功能最容易翻车的地方。如果拖动时把屏幕 px 直接写进状态，那么窗口大小一变，用户摆好的位置就错了，导出结果也和预览不一致。

**做法：状态里所有几何量都以设计分辨率（如 1080×1920）为单位。** 预览容器按宽度算一个缩放比：

```ts
const previewScale = previewWidth / state.width // 预览 1 设计像素 = previewScale 屏幕像素
```

拖动时：`dxDesign = dxScreen / previewScale`。导出时不缩放，直接用设计像素绘制（或乘导出倍率）。这样预览、导出、换窗口三者永远一致。

### 2.2 单一布局真源：`resolveComposeLayout`

预览用 CSS，导出用 Canvas，两套渲染路径**必须共用同一份几何计算**，否则必然出现「预览看着对、导出歪了」。

```ts
// logic/compose.ts
export interface Rect { x: number, y: number, w: number, h: number }

export function resolveComposeLayout(s: ComposeState) {
  const qr = {
    x: s.qr.x,
    y: s.qr.y,
    w: s.qr.w,
    h: s.qr.w * s.qr.aspect, // aspect 来自二维码原图
  }
  const bg = s.background
    ? fitBackground(s.backgroundSize, s.width, s.height, s.backgroundFit)
    : { x: 0, y: 0, w: s.width, h: s.height }
  return { qr, bg }
}
```

- 预览：`style="{ transform: `translate(${qr.x *k}px, ${qr.y* k}px)`, width: qr.w * k + 'px' }"`
- 导出：`ctx.drawImage(img, qr.x * m, qr.y * m, qr.w * m, qr.h * m)`

同一份 `qr` 喂两边，一致性由结构保证，而不是靠人工对齐。

### 2.3 预览用 DOM 而不是 canvas

没必要为了拖拽每帧重绘 canvas。预览用 `<div>` + 两个 `<img>`（背景、贴片），CSS transform 位置，浏览器合成层处理，60fps 无压力，代码也少一半。只有导出那一刻才走 canvas。

---

## 3. 数据模型

```ts
// logic/types.ts
export interface ComposeStamp {
  src: string // 二维码 dataURL
  naturalW: number // 原图宽（用于锁定比例）
  naturalH: number
  x: number // 设计像素，左上角
  y: number
  w: number // 设计像素，高 = w * naturalH / naturalW
  rotation: number // 0 起步，预留
  padding: number // 贴片外扩白底（quiet zone），默认 0，可加 8~16
  radius: number // 白底圆角
  opacity: number // 1
}

export interface ComposeState {
  preset: '9:16' | '4:5' | '3:4' | '1:1' | '16:9' | '4:3' | '2:3' | 'custom'
  width: number // 设计/输出宽，默认 1080
  height: number // 默认 1920
  background: string | undefined // '#ffffff' 或 背景图 dataURL
  backgroundFit: 'cover' | 'contain' | 'stretch'
  backgroundSize: { w: number, h: number } | undefined
  backgroundDim: number // 背景压暗 0~0.6，保证二维码对比度
  stamp: ComposeStamp
  snap: boolean // 中线/三分线吸附
  showGuides: boolean
}
```

挂到 `defaultState()`（`logic/state.ts:106`）里的 `compose` 字段，与 `qrcode`/`compare`/`scanner` 平级。

**大字段隔离（必做）**：`state.compose.stamp.src` 和 `state.compose.background` 都是 dataURL，1 张 1080×1920 PNG 转 base64 约 1~3MB。现状 `StateProvider.vue:12` 把整个 State 塞进 localStorage，两张图就爆配额，而且抛异常会导致**整个状态保存失败**。
对策（二选一，推荐 B）：
- A. 存 localStorage 前剥掉 `src`/`background`，只留几何参数；刷新后贴片消失，需重新进入。
- B. 背景图与二维码图存在内存 `shallowRef`（`logic/compose.ts` 里），compose 状态只存几何参数；同时用 `watch` + `try/catch` 包住持久化，配额失败时降级为不持久化并提示。用户重新打开 Generator 时数据源本来就在。

---

## 4. 交互设计

| 操作 | 实现 | 说明 |
| --- | --- | --- |
| 拖动贴片 | `pointerdown` → `setPointerCapture` → `pointermove` | 用 Pointer Events 而不是 mouse，触摸/手写笔一并支持；`@vueuse/core` 的 `useDraggable` 也能用，但容器有缩放，手写 40 行更好控 |
| 缩放 | 右下角 handle，`w = clamp(startW + dx / k, min, max)` | 锁定宽高比，`h` 由 `naturalH/naturalW` 推出 |
| 约束 | 出界时钳回画布内 | 默认不可出血；预留 `allowBleed` 开关 |
| 精准微调 | 方向键 1px、Shift+方向键 10px | 成本极低，价值高（对像素党决定成败） |
| 吸附 | 靠近水平/垂直中线、三分线 ±8 设计像素时吸合，显示红线 | P1，增强「摆得正」的体感 |
| 滚轮缩放 | `wheel` + `ctrlKey` 或直接滚轮 | 与浏览器页面滚动冲突时用 `preventDefault` |

**最小尺寸保护**：像素风二维码被缩太小，模块不足 1px 就扫不出来。UI 里限制 `qr.w >= max(画布宽 * 0.12, 二维码模块数 * 2)`，低于阈值时给黄色提示（沿用 `Generator.vue:526` 的告警样式）。

---

## 5. 预设与切换

| 预设 | 尺寸 | 场景 |
| --- | --- | --- |
| 9:16 | 1080×1920 | 手机竖屏海报 / 小红书 / 朋友圈长图 |
| 4:5 | 1080×1350 | Instagram 竖图 |
| 3:4 | 1080×1440 | 通用竖图 |
| 1:1 | 1080×1080 | 方图 / 封面 |
| 16:9 | 1920×1080 | 横屏 / PPT / 视频封面 |
| 4:3 | 1440×1080 | 通用横图 |
| 2:3 | 1080×1620 | 海报打印 |
| custom | 手填宽高 | 任意 |

**切换预设时按比例映射**：`x' = x * newW / oldW`，`w' = w * newW / oldW`，而不是保留绝对像素——否则换个比例贴片就飞出画布。映射后仍要做一次「超界则等比缩到可容纳」。

---

## 6. 背景图（第二阶段）

两条入口，都在同一页面：

1. **先定画布，再放图**（当前需求的主路径）：选 9:16 → 上传图 → 按 `cover` 裁切填充 → 拖二维码。
2. **图定画布**（用户提到的「引用图片长宽」）：上传后弹一个选择：`使用图片原始尺寸 (2400×3600)` / `按当前预设裁切`。选前者时把 `state.width/height` 直接设为 `img.naturalWidth/naturalHeight`，并把 `backgroundFit` 设为 `cover`（比例相同即 1:1 贴合）。

上传复用 `components/ImageUpload.vue`（`v-model` 即 dataURL），拖放复用 `Generator.vue:155-190` 的 `useDropZone` + `elementsFromPoint` 判定区域写法。

**压暗底图**：`backgroundDim` 叠一层黑色半透明，保证深色海报下二维码仍高对比——比让用户手动调色更省事。

---

## 7. 导出

```ts
// logic/compose.ts
export async function renderComposeCanvas(s: ComposeState, multiplier = 1, type: 'png' | 'jpeg' = 'png') {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(s.width * multiplier)
  canvas.height = Math.round(s.height * multiplier)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false // 关键：像素风不糊

  // 1. 底色
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // 2. 背景（cover / contain / stretch，复用 generate.ts:878-886 的裁剪思路）
  // 3. 压暗
  // 4. 贴片白底 + 二维码，几何来自 resolveComposeLayout
  return canvas
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  canvas.toBlob((blob) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob!)
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }, 'image/png')
}
```

- 导出倍率：1x / 2x / 3x（默认 1x，即 1080×1920；2x 用于印刷）。
- 格式：PNG 默认；JPEG（`quality 0.92`）在有大背景图时体积小一个数量级。
- 文件名：`${text}[9x16@2x].png`，与 `Generator.vue:35` 的命名风格保持一致。

---

## 8. 风险清单

| 风险 | 严重度 | 对策 |
| --- | --- | --- |
| localStorage 配额爆炸（背景图 + 贴片 dataURL） | **高** | 见 3 节大字段隔离；持久化包 try/catch |
| 预览与导出几何不一致 | **高** | 单一 `resolveComposeLayout`，两边共用；写出 1 组固定小数位的基准用例抽查 |
| 缩得太小导致不可扫 | 中 | 最小尺寸约束 + 导出后 `scanQRCodeFromDataUrl` 自检并提示 |
| 像素风缩放糊边 | 中 | `imageSmoothingEnabled=false` + 预览 `image-rendering: pixelated` |
| 触摸端拖动与页面滚动打架 | 中 | 画布区 `touch-action: none`，仅画布内拦截 |
| 移动端能否用 | 低 | 排版页**不要**加 `isLargeScreen` 限制（`StateProvider.vue:115` 那种限制是 Compare 专属），海报场景移动端恰恰是主力 |
| 多次进出丢失编辑 | 低 | 状态存 `state.compose`，视图用 `v-if` 也不丢 |

---

## 9. 分期与工作量

| 阶段 | 内容 | 预估 |
| --- | --- | --- |
| **P0** | view 注册、tab、Generator 按钮、预设画布、拖拽缩放、纯色背景、PNG 导出 | 4~6 h |
| **P1** | 背景图上传/拖放、图片原始尺寸模式、cover/contain/压暗、导出倍率、JPEG | 3~4 h |
| **P2** | 吸附参考线、键盘微调、导出后扫码自检、状态持久化隔离、Save/Load state（JSON） | 2~3 h |

总计约 **9~13 h**，可拆成两个 MR：P0 出一个能用的最小闭环，P1/P2 增补。

---

## 10. 代码落点清单

| 文件 | 改动 |
| --- | --- |
| `logic/view.ts:1`、`:7-15` | 联合类型与白名单加 `'compose'` |
| `logic/types.ts` | 新增 `ComposeState`、`ComposeStamp` |
| `logic/state.ts:106` | `defaultState()` 加 `compose: defaultComposeState()`；新增 `defaultComposeState()` |
| `logic/compose.ts`（新） | `PRESETS`、`resolveComposeLayout()`、`renderComposeCanvas()`、`downloadCanvas()`、`fitBackground()` |
| `components/Compose.vue`（新） | 页面骨架：左参数面板 + 右画布预览 |
| `components/ComposeStage.vue`（新，可选） | 画布预览 + 拖拽/缩放/吸附交互 |
| `components/SettingsCanvasSize.vue`（新，可选） | 预设选择器 + 自定义宽高 |
| `components/StateProvider.vue:65-108`、`:111-128` | tab 按钮 + `<Compose v-if="view === 'compose'" :state="state" />` |
| `components/Generator.vue:504-510` | Download 旁加「Place QR」按钮：`view.value = 'compose'` |

UI 复用现有原子组件：`OptionItem`、`OptionSlider`、`OptionSelectGroup`、`OptionColor`、`ImageUpload`，样式沿用 `text-button` / `icon-button` 快捷键（`uno.config.ts:21-23`），零新依赖。

---

## 11. 验收标准

1. 选 9:16，画布显示 1080×1920 的等比预览；切换到 16:9 后贴片按比例跟随，不飞出画布。
2. 拖动、缩放后，导出的 PNG 与预览像素级位置一致（误差 < 1 设计像素）。
3. 上传 2400×3600 背景图，两种模式（预设优先 / 图片原始尺寸）都能正确铺满。
4. 导出的图用 `scanQRCodeFromDataUrl` 解码成功；缩到最小尺寸阈值以下时 UI 给出不可扫提示。
5. 刷新页面不抛 `QuotaExceededError`，`qrd-state-N` 仍可正常读写。
6. `pnpm typecheck` 与 `pnpm lint` 通过。

---

## 12. 待确认项（不阻塞开工，按默认值先做）

1. 栏目名：英文 tab 用 `Compose`，中文语境叫「排版」——是否接受？
2. 是否需要「从 Compare 里上传的二维码」进入排版（目前默认只接 Generator 的最新产物 `dataUrlGeneratedQRCode`）？
3. 是否需要一次放多个二维码/文字水印（当前模型是单贴片，但 `ComposeStamp[]` 已预留升级空间）？
4. 导出默认倍率 1x 是否够用，还是要固定 2x？

---

## 13. 落地记录（实际实现与验证）

### 13.1 与方案的三处偏差

| 方案 | 实际实现 | 原因 |
| --- | --- | --- |
| 单贴片（待确认项 3） | **多贴片** `state.compose.stamps[]`，数组顺序即图层顺序，支持上移/下移/复制/删除 | 用户明确要求多贴片 + 可调上下层 |
| 吸附/键盘/压暗列为 P2 | 与 P0 一起实现 | 都是几十行纯逻辑，分成两期反而增加改动面 |
| `resolveComposeLayout()` 单独暴露 | 收敛进 `renderComposeCanvas()` + `stampStyle()`，两者共用同一套几何常量 | 预览与导出的几何只需一致，不必各留一份 API |

### 13.2 预设切换：按宽度比例映射（不缩水）

`rescaleStamps()` 的实现是**宽度跟随画布宽度比例**，不给长短边统一系数：

```ts
const kx = state.width / oldWidth
const ky = state.height / oldHeight
for (const stamp of state.stamps) {
  const ratio = stampHeight(stamp) / Math.max(1, stamp.w)
  stamp.x *= kx
  stamp.y *= ky
  stamp.w *= kx
  stamp.padding *= kx
  stamp.radius *= kx
  // 换到更矮的画布时高度可能装不下，按高度上限收一次，避免贴片被裁掉
  const available = state.height - stamp.padding * 2
  if (ratio > 0 && stamp.w * ratio > available)
    stamp.w = Math.max(120, available / ratio)
  clampStamp(stamp, state.width, state.height)
}
```

- 用 `min(kx, ky)` 会让 9:16 ↔ 16:9 来回切换**持续缩水**（实测 432 → 243 → 136.7 px），改按 `kx` 后往返稳定（432 → 768 → 432 → 768 → 432）。
- 代价：换到更矮的画布时贴片被 `clampStamp` 上推，往返后 y 会保留这个新位置（实测 744 → 297.8 → 529.4，第二次往返不再变化）。这是「不越界」优先于「还原原坐标」的取舍。

### 13.3 验证记录（headless Edge + CDP 驱动真实页面）

| 项目 | 证据 |
| --- | --- |
| 1x / 3x 导出尺寸 | `qrcode[9_16_1080x1920@1x].png` IHDR 1080×1920；`@3x` 3240×5760 |
| 预设切换 | 16:9 导出 5760×3240；贴片宽度 432 → 768 → 432 往返稳定 |
| 背景 cover | 600×800 测试图铺满 1080×1920，(200,960)=(153,0,0) 红、(900,960)=(0,0,153) 蓝，横向裁切居中 |
| 背景 contain | 上下各 240 px 留白：y=5/100/239 为纯白，y=260 为绿色边框 |
| 背景 stretch | 由同一 `resolveFitRect()` 分支覆盖，未单独截图 |
| 压暗 0.4 | 纯绿 (0,255,0) 采样为 (0,153,0)，即 0.6 倍 |
| 多贴片合成 | 导出图检出两条独立白色静区带（x 316–763，宽 448 = 432 + 2×8），y 分别落在 522–968 与 1292–1732 |
| 拖动 / 缩放 / 键盘 | 拖动屏幕 60 px（scale 0.4224）→ x +142、y −71 精确对应；右下角手柄 48 px → w +114（锁比例）；方向键 → x +1 |
| 导出图可扫 | Verify 标签扫描导出图解码出 `qrcode.antfu.me`；Resize 300 时匹配区域 102×99，Resize 1000 时 351×323 |
| 刷新恢复 | 清空 `localStorage` 重载后贴片自动落回 `dataUrlGeneratedQRCode`；`composeBackground` 随之清空（符合设计：大字段不持久化） |
| typecheck / lint | `vue-tsc --noEmit` 与 `eslint .` 均退出码 0 |

> 备注：扫描验证最早一次失败（"No QR code found"）不是合成图不可扫，而是当时贴片被缩到 12.7% 宽度、叠上 Verify 默认 300 px 预处理后二维码只剩约 38 px。修掉缩水后，默认预处理即可解码。

---

## 14. 图层化改造（图片图层 / 透明背景 / 亮度）

原实现里「QR Codes」列表其实只有二维码，来源写死、刷新后还容易串味。本轮把它改成通用的**图片图层**模型，同时修掉从 Generator 取图时丢透明背景的问题。

### 14.1 数据模型

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `kind` | `'qr' \| 'image'` | 图层来源类型，决定图片来源解析与默认值 |
| `plate` | `boolean` | 是否铺白色底板。旧存档按 `padding > 0` 反推 |
| `brightness` | `number` | 亮度系数，`1` 为原图，范围 0.2–2 |

默认值差异：`kind === 'qr'` 时 `plate = true`、`padding = 8`（二维码需要静区）；导入图片时 `plate = false`、`padding = 0`（保留原图透明）。

### 14.2 图片来源解析

| 图层类型 | 来源 | 刷新后 |
| --- | --- | --- |
| `qr` | 永远跟随 `dataUrlGeneratedQRCodeForCompose`（未压平画布，保留透明背景） | 仍然有效，因为 Generator 常驻并会自动重绘 |
| `image` | 导入时登记进模块级 `stampSources` Map 的快照 | 丢失（大图不进 localStorage），需要重新导入 |

关键修复：`getStampSource()` 之前先查 Map，导致 QR 图层被冻结在「创建那一刻」的产物上——用户在 Generator 里勾选透明背景、改配色后，Compose 里不会更新。现在 `qr` 分支优先取实时产物：

```ts
export function getStampSource(stamp: ComposeStamp) {
  if (stamp.kind === 'qr')
    return dataUrlGeneratedQRCodeForCompose.value ?? dataUrlGeneratedQRCode.value ?? stampSources.get(stamp.id)
  return stampSources.get(stamp.id)
}
```

同时 `Generator.run()` 在压平之前多存一份未压平画布，专供 Compose 使用；压平版本继续为 Compare / ControlNet 服务。

### 14.3 几何与打底

- `stamp.x / stamp.y` 指**图片内容左上角**，白底板允许溢出画布边缘。
- `clampStamp()` 只夹图片内容：`x ∈ [0, max(width - w, 0)]`。
- 预览与导出都按 `pad = plate ? padding : 0` 计算外框；预览用 `left: (x - pad) * k` 配合 `content-box`，导出的 canvas 用 `x - pad` 画圆角白底。两者共用同一套值，避免预览多偏移一个 padding。

### 14.4 亮度实现

预览用 CSS `filter: brightness(n)`，导出在 canvas 上逐像素乘系数（`drawStampImage()`）；没有用 `ctx.filter`，因为 Safari 上该属性会静默失效，导致「预览亮、导出不亮」。

### 14.5 交互

- Layers 卡片：`QR` 按钮取 Generator 当前产物，`Image` 按钮多选导入；每行有棋盘格缩略图（可看出透明区）、可改名、来源与原始尺寸、上移/下移/复制/删除。
- 属性卡新增 `Source`（Generator / Imported + Replace）、`Brightness`、`Plate`；`Quiet zone` 只在开了底板时出现。
- 画布支持直接把图片拖进来落成图层（拖放位置即落点，多文件错开 24 px）。

### 14.6 验证记录（单图层，避免下层白底板干扰）

画布背景设为 `#ff0000`，二维码 432×432 落在 (324, 744)，导入 400×300 纯 `#808080` 图片做亮度样本。

| 场景 | 采样点 | 结果 | 结论 |
| --- | --- | --- | --- |
| 透明背景 + 关底板 | QR 静区内 (336, 960) | (255, 0, 0) | 透明区露出画布底色，未补白 |
| 透明背景 + 关底板 | 画布角落 (40, 40) | (255, 0, 0) | 底色正常 |
| 开底板 | QR 静区内 (336, 960) | (255, 255, 255) | 白底板生效 |
| 开底板 | 底板外沿 (320, 960) | (255, 255, 255) | 底板比图片大 8 px 静区 |
| 亮度 0.5 | 灰图区域 (700, 1050) | (64, 64, 64) | 128 × 0.5 精确命中 |
| 亮度 1 | 灰图区域 (700, 1050) | (128, 128, 128) | 原图不变 |

| 项目 | 证据 |
| --- | --- |
| 图层来源 | Layers 行显示 `QR 1 · Generator · 580×580`、`gray400 · Imported · 400×300` |
| 预览与导出一致 | 图片元素 `left = 60.75` / 期望 `60.15`，差值来自 stage 1 px 边框与取整 |
| 导入落图 | `kind='image'`、`plate=false`、`padding=0`、宽度 432（画布 40%），比例按原图 400:300 |
| typecheck / lint | `vue-tsc --noEmit` 与 `eslint .` 均退出码 0 |

### 14.7 已知取舍

1. 多个 `qr` 图层共享同一份 Generator 产物：改 Generator 会同时改所有 QR 图层。需要两版二维码时，用「复制」后再到 Generator 改一版、另一版改为导入图片。
2. 导入图片只活在内存，刷新后变空白图层（几何保留），需要重新 `Replace`。这是为了不把几 MB 的 dataURL 塞进 localStorage 触发 `QuotaExceededError`。
3. 白底板与静区是两个概念：底板是给贴片垫底的白块（透明二维码贴彩底时才有意义）；静区是二维码本身需要的留白。Plate 设为 Auto 时透明图片不会铺白底，静区由 Generator 自带的 margin 提供。

---

## 15. 白底板跟随图片透明度（Plate: Auto）

### 15.1 问题

用户在 Compose 里把画布背景设为纯黑、在 Generator 勾了透明背景，点 QR 加图层，导出的二维码静区却是白的——白底板盖住了背景图。

原因：`createStamp()` 对 `kind === 'qr'` 一律 `plate = true`，与图片实际是否透明无关；而已存在的图层即使后来 Generator 变透明，`plate` 仍是 `true`。

### 15.2 模型

`ComposeStamp` 新增 `plateAuto: boolean`，与 `plate` 组成三态：

| UI | plateAuto | plate | 实际行为 |
| --- | --- | --- | --- |
| Auto | true | 忽略 | 图片带透明像素就不铺白底，否则铺 |
| On | false | true | 强制白底 |
| Off | false | false | 强制不铺白底 |

- 新建 QR 图层：`plateAuto = true`、`padding = 8`（静区仍保留，只是不铺白）。导入图片：`plateAuto = false`、`plate = false`。
- 旧存档迁移：`plateAuto ??= kind === 'qr'`，二维码图层自动获得跟随能力；导入图层行为不变。

### 15.3 透明度判定

`measureAlpha()` 把图片画到 64×64 离屏画布，扫描 alpha 通道，任一点 `alpha < 250` 即认为该图带透明区（透明背景二维码的边角一定是 0）。

结果缓存进响应式 `Map<src, boolean>`（上限 12 条，超出淘汰最早的一条），因为 Generator 每次重绘都会产生新的 dataURL。响应式缓存让预览在判定完成后自动重绘，不需要手动刷新。

判定未完成时按用户设定渲染（`plate` 值兜底），判定完成后由缓存触发更新；`addStampFromSource()` / `replaceStampSource()` 会在落层前先 await 一次检测，避免首次进入时白底闪一帧再消失。

### 15.4 验证（headless Edge + CDP，画布 1080×1920 纯黑，QR 432×432 居中）

| 场景 | 采样点 | 结果 | 结论 |
| --- | --- | --- | --- |
| 透明 QR 自动放置 | 静区内 (334,754) | (0,0,0) | 没有白底，露出画布黑 |
| 透明 QR 自动放置 | 底板外沿 (320,754) | (0,0,0) | 完全没有底板 |
| 透明 QR 自动放置 | 模块 (540,960) | (255,255,255) | 二维码本体正常 |
| 点 QR 按钮新建（Generator 已是透明） | 状态 | `auto=true, plate=false` | 新图层直接判定为不铺白底 |
| 已存在的 QR 图层（`plate=true`） | 状态 + 像素 | `auto=true`，静区 (0,0,0) | 跟随实时产物，白底自动消失 |
| Plate = On | 预览外框 | `background #ffffff`、padding 2.13px（8×0.266） | 强制白底生效 |
| Plate = Off / Auto | 预览外框 | 背景透明、padding 0 | 回到无底板 |
| typecheck / lint | — | `vue-tsc --noEmit`、`eslint .` 退出码 0 | — |

> Plate = On 的导出像素沿用第 13 节已验过的 `plate = true` 分支（静区采样 255,255,255），预览与导出共用 `isPlateActive()` 同一个判定函数。

---

## 16. 选中图层的边界提示

问题：透明二维码和深色背景贴在一起时，图层的实际边界肉眼看不出来，拖动时不知道拖到哪了。

选中图层后叠加一组**仅预览可见**的提示（不进入导出，`renderComposeCanvas` 完全不读这些 DOM）：

| 元素 | 样式 | 作用 |
| --- | --- | --- |
| 边框 | `box-shadow: 0 0 0 1px #fff / 0 0 0 2.5px rgba(0,0,0,.5)` | 白线加深色描边，黑底白底都看得见 |
| 四角 | 6×6 白方块 + 深色描边，各向外偏移 3px | 明确四个角，便于对齐 |
| 右下角手柄 | 原有圆形手柄（缩放用） | 不变 |
| 尺寸徽标 | 拖动时在框上方显示 `432 × 432` | 拖动过程中实时反馈 |

边框容器是 `inset: 0` 的绝对定位层，正好覆盖贴片的 padding box（图片 + 白底板），所以开/关 Plate 时框的边界都等于肉眼可见的边界；`pointer-events: none` 保证不抢拖动事件。徽标只在 `activeDragId` 命中时渲染，松手即收起（pointerup / pointercancel 都会清）。

验证（headless Edge + CDP，1080×1920 黑画布）：

| 检查项 | 结果 |
| --- | --- |
| 选中层 DOM 子节点 | 6 个（边框 + 4 角 + 手柄），未选中层 0 个 |
| 边框 computed boxShadow | `rgba(255,255,255,0.95) 0 0 0 1px, rgba(0,0,0,0.5) ...` |
| 边框 pointer-events | `none` |
| 拖动中 | 子节点 7 个（多出徽标），徽标文本 `432 × 432` |
| 拖动后松手 | 徽标消失，边框保留，Position 实时刷新为 474.293 / 837.933 |
| 拖动位移 | 屏幕 +40/+25 px（scale 0.266）→ 设计坐标 +150/+94，与 state 一致 |

> 提示只在选中时出现，点击画布空白处（`@pointerdown.self`）会取消选中并一并隐藏。


