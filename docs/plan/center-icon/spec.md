# 开发规格：二维码中心图（Center Icon）

目标：给 Generator 增加「中心图（logo）」能力，尺寸/间隙/圆角/底板可调，PNG 与 SVG 导出都必须生效，且不破坏可扫性。实施前请读 `docs/plan/center-icon/feasibility.md`（方案 B、前置条件、已知限制）。

---

## 1. 需求与验收标准

| 编号 | 需求 | 验收标准（可测） | 验证方式 |
| --- | --- | --- | --- |
| R1 | 可上传一张图片作为中心图 | 上传后 `state.centerIcon` 形如 `data:image/png;base64,...`，且解码后最长边 ≤ 256px；预览画布中心出现该图 | e2e：读 localStorage 字段 + canvas 中心像素颜色 |
| R2 | 图标尺寸可调并受限 | 尺寸 = 二维码边长 × `centerIconSize`/100，取值被 clamp 到 8–18；16 表示 16% | 纯函数脚本 `verify-center-icon-layout.ts` |
| R3 | 图标周围有可调透明间隙 | 间隙 = 图标边长 × `centerIconPadding`/100，clamp 0–10；间隙区间内模块**不绘制** | 纯函数脚本算 `cutout`；e2e 采样间隙像素 == 背景色或 alpha 0 |
| R4 | 圆角裁剪 | `centerIconRounded=true` 时图标四角圆角半径 = 图标边长 × 0.14 | e2e：SVG 文本含 `<clipPath>` 且 `clip-path="url(#qrd-center-icon-clip)"` 指向同一 id |
| R5 | 底板 | `centerIconPlate=true` 时用背景色涂满「间隙方框」，避免背景图透出；透明导出时**不画**底板 | e2e：设背景图 + 底板开，间隙像素 == 背景色；勾透明后同一像素 alpha 为不透明且不存在整块不透明底板（取间隙外侧像素 alpha=0） |
| R6 | PNG 导出带中心图 | `downloadPNG` 产物中心区域为图标像素 | e2e 采样 canvas |
| R7 | SVG 导出带中心图且为矢量壳 + 位图芯 | SVG 含 `<image href="data:image/png;base64,`，`x/y/width/height` 与 `layout.icon` 一致（误差 ≤ 0.01）；`transformScale≠1` 时图标位于缩放组内 | e2e：拦截 `URL.createObjectURL` 后读 Blob 文本 |
| R8 | 可扫性 | ECC=H、尺寸 16%、间隙 8% 时，生成的 PNG 用 `qr-scanner-wechat` 解码结果 === 原文 | e2e 调用 `logic/scan.ts:4-23` |
| R9 | 上传即切 ECC=H | 上传前 ecc 为 M，上传后 `state.ecc === 'H'` | e2e：读 localStorage |
| R10 | 旧状态兼容 | 删除 `centerIcon*` 五个字段后刷新，页面无异常，导出 SVG 不含 `<image href="data:image/png` | e2e |
| R11 | 代码质量门 | `pnpm typecheck` 与 `pnpm lint` 均 exit 0 | 命令 |
| R12 | 不污染其他标签页 | Compose「Place on Canvas」贴片中心有图标；Batch 页行为不变（默认状态无图标） | 人工 + e2e 快照对比 |

---

## 2. 接口、数据结构与配置变更

### 2.1 状态字段（`logic/types.ts`）

在 `QRCodeGeneratorState` 中、`backgroundImage?: string`（`logic/types.ts:122`）之后新增：

```ts
  /** 中心图（data URL，统一重编码为 PNG，最长边 ≤ 256px） */
  centerIcon?: string
  /** 图标边长占二维码内容边长的百分比，clamp 到 8–18 */
  centerIconSize: number
  /** 透明间隙占图标边长的百分比，clamp 到 0–10 */
  centerIconPadding: number
  /** 是否圆角裁剪 */
  centerIconRounded: boolean
  /** 是否用背景色涂满间隙方框（背景图场景下保证对比度） */
  centerIconPlate: boolean
```

> 命名说明：fork 用 `icon/iconSize/iconPadding/iconRounded`，本仓库统一加 `centerIcon` 前缀——`icon*` 与 `PixelStyleIcons`、`MarkerShapeIcons`、`i-*` 图标类名冲突风险高，且导出 JSON 里需要自解释。

### 2.2 默认值（`logic/state.ts:25-63`）

```ts
    centerIcon: undefined,
    centerIconSize: 16,
    centerIconPadding: 8,
    centerIconRounded: true,
    centerIconPlate: true,
```

要求：

- `centerIcon: undefined` **必须显式写出**：`components/Generator.vue:86-90` 的 `reset()` 用 `Object.assign(state.value, defaultGeneratorState())`，不写这个键就清不掉图标。
- 旧 `localStorage` 靠 `components/StateProvider.vue:12-21` 的 `mergeDefaults` 补默认值；`resolveCenterIconLayout` 仍需对 `undefined/NaN/越界` 兜底（见 §3）。

### 2.3 新增模块 `logic/icon.ts`

只依赖 `~/logic/types`，**不得** import `logic/draw.ts`（否则与 `draw.ts → icon.ts` 形成循环）。

```ts
import type { QRCodeGeneratorState } from './types'

export const CenterIconLimits = {
  minSize: 8,
  maxSize: 18,
  minPadding: 0,
  maxPadding: 10,
  cornerRadius: 0.14,
  maxStoredPixels: 256,
} as const

export interface CenterIconLayout {
  src: string
  /** 图标方框左上角，工作画布坐标系（未施加 transformScale） */
  x: number
  y: number
  /** 图标方框边长 */
  size: number
  /** 每侧间隙宽度 */
  padding: number
  /** 间隙方框边长 = size + 2 * padding */
  edge: number
  rounded: boolean
  plate: boolean
  /** 需要从矩阵中挖掉的模块范围（模块坐标，半开区间） */
  cutout: { left: number, top: number, width: number, height: number }
}

export function resolveCenterIconLayout(
  state: QRCodeGeneratorState,
  options: {
    cell: number
    qrSize: number
    margin: { top: number, right: number, bottom: number, left: number }
  },
): CenterIconLayout | undefined

export function loadCenterIconImage(src: string): Promise<HTMLImageElement | undefined>

export async function drawCenterIcon(
  ctx: CanvasRenderingContext2D,
  layout: CenterIconLayout,
  options: { transparent: boolean, backgroundColor: string },
): Promise<void>

export async function prepareCenterIcon(dataUrl: string, maxSize?: number): Promise<string>
```

#### 2.3.1 几何（`resolveCenterIconLayout`）

设 `cell` = 每模块像素（`state.scale`），`qrSize` = 模块数（`qrcode.size`），`margin` = `resolveMargin(state.margin)`。

```
qrEdge   = qrSize * cell
centerX  = (margin.left + qrSize / 2) * cell
centerY  = (margin.top  + qrSize / 2) * cell
sizePct  = clamp(num(state.centerIconSize,  16), 8, 18)
padPct   = clamp(num(state.centerIconPadding, 8), 0, 10)
size     = qrEdge * sizePct / 100
padding  = size * padPct / 100
edge     = size + padding * 2
x        = centerX - size / 2
y        = centerY - size / 2
```

`num(v, fallback) = Number.isFinite(v) ? v : fallback`。

挖洞范围（模块坐标，原点 = 二维码内容左上角）：

```
startX = (x - padding - margin.left * cell) / cell
startY = (y - padding - margin.top  * cell) / cell
exoX   = (x + size + padding - margin.left * cell) / cell
exoY   = (y + size + padding - margin.top  * cell) / cell
cutout.left   = clamp(Math.floor(startX), 0, qrSize)
cutout.top    = clamp(Math.floor(startY), 0, qrSize)
cutout.right  = clamp(Math.ceil(exoX),    0, qrSize)
cutout.bottom = clamp(Math.ceil(exoY),    0, qrSize)
cutout.width  = cutout.right - cutout.left
cutout.height = cutout.bottom - cutout.top
```

**返回值规则**：`state.centerIcon` 为空、或不是以 `data:image/` 开头 → 返回 `undefined`；`cutout.width === 0 || cutout.height === 0`（极端 margin / 极小 QR）→ 仍返回 layout（图标照画），但挖洞为空。

不变式（脚本要断言）：

- `16%` 尺寸下 `size / qrEdge === 0.16`（浮点用 `Math.abs(a-b) < 1e-9`）。
- `cutout.width / qrSize ≤ 0.25`（18% 尺寸 + 10% 间隙时约 0.216，面积占比 ≤ 5%，远低于 H 级约 30% 的码字恢复能力）。
- 均匀 margin 时 `cutout.left + cutout.right === qrSize`、`cutout.top + cutout.bottom === qrSize`。

#### 2.3.2 画布贴图（`drawCenterIcon`）

在 `ctx` 当前变换（含 `transformScale`）下绘制，顺序：

1. `const image = await loadCenterIconImage(layout.src)`；`undefined` 直接返回（占位图加载失败不抛错，避免整个预览挂掉）。
2. `ctx.save()`。
3. 若 `plate && !transparent`：以 `(x-padding, y-padding, edge, edge)` 画圆角矩形（半径 `size * 0.14 + padding`），`fillStyle = options.backgroundColor`，`fill()`。
4. `ctx.beginPath()`；`rounded` 时画 `(x, y, size, size)` 圆角矩形（半径 `size * 0.14`），否则 `ctx.rect(...)`；`ctx.clip()`。
5. contain 等比缩放：`k = Math.min(size / iw, size / ih)`，`w = iw * k`，`h = ih * k`，`drawImage(image, x + (size - w) / 2, y + (size - h) / 2, w, h)`；`iw/ih` 取 `naturalWidth || width`，为 0 时跳过。
6. `ctx.restore()`。

圆角路径用 `arcTo` 实现（`painter.ts` 里 `arcTo` 已有先例），半径再 `Math.min(r, w/2, h/2)` 兜底。

#### 2.3.3 上传预处理（`prepareCenterIcon`）

- 用 `Image` 解码 data URL，失败则 `throw new Error('无法解析所选图片')`。
- `k = Math.min(1, maxSize / Math.max(naturalWidth, naturalHeight))`，目标尺寸 `Math.max(1, Math.round(...))`。
- 画进 canvas 后 `canvas.toDataURL('image/png')` 返回。
- 目的有三：把 SVG 图标、无固有尺寸的图片统一成位图（否则 `drawImage` 与导出 SVG 都会出问题）；控制 `localStorage` 体积；保证 SVG 内 base64 体积可控。

#### 2.3.4 图片缓存（`loadCenterIconImage`）

`Map<string, Promise<HTMLImageElement | undefined>>` 缓存，失败也缓存 `undefined`，避免 250ms 防抖刷新（`components/Generator.vue:239-245`）反复解码大数据 URL。

### 2.4 布局接入（`logic/draw.ts`）

1. `QrLayout` 增加字段（`logic/draw.ts:27-33`）：

```ts
export interface QrLayout {
  cell: number
  halfcell: number
  width: number
  height: number
  pixels: PixelInfo[]
  /** 中心图几何；无图标时为 undefined */
  icon?: CenterIconLayout
}
```

2. `createQrLayout` 在算出 `width/height` 之后（`logic/draw.ts:71-73` 之后）解析一次：

```ts
  const icon = resolveCenterIconLayout(state, {
    cell,
    qrSize: qr.size,
    margin: { top: marginTop, right: marginRight, bottom: marginBottom, left: marginLeft },
  })
```

3. `getInfo` 内，在 `marginNoiseSpace === 'extreme'` 的 `cutOut` 调用之后（`logic/draw.ts:288-301` 之后）、旋转映射之前（`:303` 之前）追加：

```ts
    if (icon && icon.cutout.width > 0 && icon.cutout.height > 0)
      cutOut(icon.cutout.left, icon.cutout.top, icon.cutout.width, icon.cutout.height)
```

4. 返回值追加 `icon`（`logic/draw.ts:368-374`）。

说明：

- 复用既有 `cutOut`（`logic/draw.ts:280-286`）→ `isDark=false, isBorder=true, isIgnored=true`，`paintQr` 在 `logic/draw.ts:398-400` 跳过，canvas 与 SVG **零改动同步生效**。
- 挖洞在旋转（`:303-325`）之前、模块坐标系内完成，四个旋转角度下中心图始终居中；不要改成画布坐标系的擦除。

### 2.5 canvas 渲染接入（`logic/generate.ts`）

在 `realCtx.drawImage(canvas, 0, 0, width, height)`（`logic/generate.ts:75`）与 `realCtx.restore()`（`:76`）之间插入：

```ts
  if (layout.icon)
    await drawCenterIcon(realCtx, layout.icon, { transparent, backgroundColor })
```

要点：

- 必须在这段 `save()/restore()` 内、`transformScale` 变换生效时绘制，才能与二维码同步缩放（映射式见 `logic/generate.ts:67-74`）。
- 必须在 `applyEffect`（`:52-53`）与 `applyBackground`（`:49-56`）之后 → 图标保持清晰，不被 crystalize/liquidify 模糊，也不会被背景覆盖。
- 透视（`:47`）之前已发生，图标因此不随透视扭曲——**这是已记录的已知限制**，UI 需提示（§2.7）。
- `updateDataUrl` / `dataUrlGeneratedQRCode*`（`components/Generator.vue:46-61`）自动继承，无需改动。

### 2.6 SVG 渲染接入（`logic/svg.ts`）

1. 新增内部函数（放在 `createBackgroundLayer` 之后、`wrapDocument` 之前，可复用 `loadImage`（`:417`）、`escapeAttribute`（`:426`）、`num`（`:17`）、`normalizeColor`（`logic/painter.ts:30`））：

```ts
async function createIconLayer(
  icon: CenterIconLayout,
  options: { transparent: boolean, backgroundColor: string },
): Promise<{ defs: string[], body: string } | undefined> {
  const image = await loadImage(icon.src)
  if (!image)
    return undefined

  const { x, y, size, padding, edge, rounded, plate } = icon
  const radius = size * CenterIconLimits.cornerRadius
  const defs: string[] = []
  let clip = ''

  if (rounded) {
    defs.push(`<clipPath id="qrd-center-icon-clip"><rect x="${num(x)}" y="${num(y)}" width="${num(size)}" height="${num(size)}" rx="${num(radius)}"/></clipPath>`)
    clip = ' clip-path="url(#qrd-center-icon-clip)"'
  }

  const plateRect = plate && !options.transparent
    ? createPlateRect()
    : ''

  return {
    defs,
    body: `${plateRect}<image href="${escapeAttribute(icon.src)}" x="${num(x)}" y="${num(y)}" width="${num(size)}" height="${num(size)}" preserveAspectRatio="xMidYMid meet"${clip}/>`,
  }

  function createPlateRect() {
    const { color, opacity } = normalizeColor(options.backgroundColor)
    const r = radius + padding
    return `<rect x="${num(x - padding)}" y="${num(y - padding)}" width="${num(edge)}" height="${num(edge)}" rx="${num(r)}" fill="${color}"${opacity === 1 ? '' : ` fill-opacity="${num(opacity)}"`}/>`
  }
}
```

2. `generateQRCodeSVG` 中，在 `layers.push(content)`（`logic/svg.ts:337`）之后追加图标图层，并把它的 `defs` 合并进 `wrapDocument`：

```ts
  const iconLayer = layout.icon
    ? await createIconLayer(layout.icon, { transparent, backgroundColor: getBackgroundColor(state) })
    : undefined
  if (iconLayer)
    layers.push(iconLayer.body)
```

```ts
  return wrapDocument({
    width,
    height,
    defs: iconLayer ? [...defs, ...iconLayer.defs] : defs,
    body,
  })
```

要点：

- 图标必须在 `layers` 里、`transformScale` 分组**之内**（`logic/svg.ts:342-344` 会把整个 `layers` 包进 `<g>`），与 canvas 的 `setTransform` 对应。
- 光栅回退路径（`logic/svg.ts:372-387`）无需改：它内部调用 `generateQRCode`，图标已包含在 PNG 里。
- `preserveAspectRatio="xMidYMid meet"` 负责 contain 等比，无需预先算偏移。
- `<clipPath>` 的 id 固定 `qrd-center-icon-clip`；同一文档只会有一个中心图，无冲突。

### 2.7 界面（`components/Generator.vue`）

**插入位置**：`Background` 的 `OptionItem` 结束（`components/Generator.vue:397`）与 `Colors` 前的分隔线（`:399`）之间。

```vue
        <OptionItem title="Center Icon" div>
          <button v-else relative text-button text-xs>
            <img
              v-if="state.centerIcon" :src="state.centerIcon"
              absolute inset-0 z-0 h-full w-full rounded object-contain op50
            >
            <div i-ri-image-add-line z-1 />
            <div z-1>
              {{ state.centerIcon ? 'Replace' : 'Upload' }}
            </div>
            <ImageUpload
              :model-value="state.centerIcon"
              @update:model-value="onCenterIconChange"
            />
          </button>
          <button v-if="state.centerIcon" icon-button-sm title="Clear">
            <div i-carbon-close @click="state.centerIcon = undefined" />
          </button>
        </OptionItem>

        <template v-if="state.centerIcon">
          <OptionItem title="Icon Size" nested description="Icon edge, in percent of the QR code edge">
            <OptionSlider
              v-model="state.centerIconSize"
              :min="CenterIconLimits.minSize"
              :max="CenterIconLimits.maxSize"
              :step="1"
              unit="%"
            />
          </OptionItem>
          <OptionItem title="Gap" nested description="Transparent gap around the icon, in percent of the icon edge">
            <OptionSlider
              v-model="state.centerIconPadding"
              :min="CenterIconLimits.minPadding"
              :max="CenterIconLimits.maxPadding"
              :step="1"
              unit="%"
            />
          </OptionItem>
          <OptionItem title="Rounded Icon" nested>
            <OptionCheckbox v-model="state.centerIconRounded" />
          </OptionItem>
          <OptionItem title="Plate" nested description="Fill the gap with the background color, so a background image does not show through">
            <OptionCheckbox v-model="state.centerIconPlate" />
          </OptionItem>
        </template>
```

脚本部分：

```ts
import { CenterIconLimits, prepareCenterIcon } from '~/logic/icon'

async function onCenterIconChange(dataurl?: string) {
  if (!dataurl) {
    state.value.centerIcon = undefined
    return
  }
  try {
    state.value.centerIcon = await prepareCenterIcon(dataurl, CenterIconLimits.maxStoredPixels)
    if (state.value.ecc !== 'H')
      state.value.ecc = 'H'
  }
  catch {
    // eslint-disable-next-line no-alert
    alert('This image can not be used as a center icon.')
  }
}
```

`mayNotScannable`（`components/Generator.vue:139-162`）追加一条：

```ts
  if (state.value.centerIcon && state.value.ecc !== 'H')
    return true
```

提示横幅：加在现有横幅块（`components/Generator.vue:607-618`）之后，风格照抄 `border="~ yellow-6/60 rounded" bg-yellow-5:10 px3 py2 text-sm text-yellow-6`：

| 条件 | 文案（英文，与现有 UI 一致） |
| --- | --- |
| `state.centerIcon && state.ecc !== 'H'` | `The <b>center icon</b> covers data modules. Use <b>H</b> error correction and verify before printing.` |
| `state.centerIcon && qrcode && qrcode.version < 3` | `This QR Code is too small (version {{ qrcode.version }}) for a center icon.` |
| `state.centerIcon && (state.transformPerspectiveX !== 0 \|\| state.transformPerspectiveY !== 0)` | `The center icon is <b>not</b> warped by the perspective transform.` |
| `state.centerIcon` | `The <b>compare tab</b> does not know about the center icon; its area will be reported as mismatched.` |

**不改动**：`components/ImageUpload.vue`（`:1-38` 已满足，`FileReader` → data URL → emit）、拖拽上传区（`:200-237` 只处理扫码目标）、`Download` 区（`:557-591`）、`Save/Load state`（`:92-135` 按 `Object.keys(state.value)` 自动覆盖，新字段免费生效）。

### 2.8 不新增的内容

- 无新依赖、无 `package.json` 变更。
- 无新配置项、无环境变量。
- 不改 `logic/diff.ts`、`logic/utils.ts`、`pages/batch.vue`、`logic/compose.ts`。

---

## 3. 边界与失败路径

| 场景 | 期望行为 |
| --- | --- |
| 未上传图标 | `resolveCenterIconLayout` 返回 `undefined`；挖洞不发生；SVG 无 `<image>`；PNG/SVG 与改动前逐字节等价（除 `state` 多出的默认字段） |
| `centerIcon` 不是 `data:image/` 前缀（旧状态/手改 JSON） | 返回 `undefined`，不画、不切洞 |
| `centerIconSize/Padding` 为 `undefined`/`NaN`（旧 localStorage） | `num()` 回退 16 / 8，再 clamp |
| 值越界（例如 50 / -5） | clamp 到 18 / 0，不报错 |
| 上传的图片解码失败（损坏/非图片） | `prepareCenterIcon` 抛错 → UI `alert`，`state.centerIcon` 保持原值 |
| 上传 SVG / 无固有尺寸图片 | 走 canvas 重编码，天然转成位图；`naturalWidth` 为 0 时 `drawCenterIcon` 跳过绘制 |
| 图标 data URL 体积过大（>1MB JPEG 原图） | 重编码后 ≤256px PNG，通常 10–60KB |
| `localStorage` 写入超配额 | 由 vueuse 自身行为决定（与 `backgroundImage` 同等风险）；上传期压缩是唯一缓解，不做额外兜底 |
| `qrSize` 很小（version 1，21 模块）+ 18% 尺寸 | 挖洞约 5×5 模块；UI 出「version < 3」横幅；e2e 用 version ≥ 3 的文本验证扫码 |
| `margin` 为 0 | `size = qrEdge * pct`，间隙直接贴到二维码边缘；图标仍居中，不越界 |
| 非居中 margin（top≠left） | 中心按 `margin.left/top` 偏移，图标落在二维码内容方形中心（不是画布中心） |
| `rotate` 为 90/180/270 | 挖洞在旋转映射之前完成、且关于中心对称 → 图标始终居中；`cutout` 不变 |
| `transparent: true` | 间隙像素 alpha=0；**不画底板**；图标自身 alpha 保留 |
| `transparent: false` + `backgroundImage` | 底板（默认开）用背景色涂满间隙，避免照片透出；关掉底板则背景图透出 |
| `effect !== 'none'` | 图标在效果之后绘制 → 保持清晰；SVG 走光栅回退（图标已在 PNG 内） |
| `transformScale ≠ 1` | 图标随内容同步缩放（canvas 用同一变换、SVG 在 `<g>` 内） |
| `transformPerspectiveX/Y ≠ 0` | 图标不扭曲，出提示横幅；SVG 走光栅回退（因此图标随整张图一起被透视——此时与 canvas 行为不同，属已知不对称，见下） |
| Compare 标签页 | 图标区域计为 mismatch，出提示横幅 |
| `renderPointsType !== 'all'` | 与中心图叠加：挖洞仍生效；「partial QR」横幅照旧 |

> **已知不对称（记录接受）**：`effect`/`perspective` 存在时 SVG 走 `generateRasterSVG`（`logic/svg.ts:372-387`），图标随整张 PNG 一起被扭曲；canvas 预览里图标是清晰的。exporter 两条路径在极端参数下视觉不同，v1 接受并写进交付说明。

---

## 4. 测试策略

仓库无测试框架（`package.json:1-56`），CI 只跑 lint + typecheck（`.github/workflows/ci.yml:24,41`）。因此验收分三层，脚本放 `docs/plan/center-icon/` 下（沿用 `docs/plan/compose-rulers/verify-interaction.mjs:1-15` 的约定：脚本不参与打包）。

**环境前置**：Windows 上 `node` 不在 PATH，需先注入：

```powershell
$env:PATH = "D:\it-soft\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin;$env:PATH"
node -v   # v24.21.0
```

### 4.1 第 1 层：静态门

```powershell
cd E:\dsh\qrcode-toolkit
pnpm typecheck   # 期望：无输出错误，exit 0
pnpm lint        # 期望：无输出错误，exit 0
```

### 4.2 第 2 层：纯函数（`docs/plan/center-icon/verify-center-icon-layout.ts`）

Node 24 类型剥离直接跑：`node docs/plan/center-icon/verify-center-icon-layout.ts`（相对 `import '../../logic/icon.ts'`）。

断言清单：

1. 无 `centerIcon` → `undefined`；`centerIcon: 'https://x/y.png'` → `undefined`。
2. `qrSize=33, cell=10, margin=2, size=16, padding=8`：`size === 52.8`、`padding === 4.224`、`edge === 61.248`、`x === (2*10 + 330/2) - 26.4 === 158.6`（同 y）。
3. 同参数下 `cutout` 的 `left/top/right/bottom/width/height` 与手算一致；`cutout.left + cutout.right === 33`。
4. 越界 clamp：`centerIconSize=50 → 18`、`centerIconSize=2 → 8`、`centerIconPadding=50 → 10`、`centerIconPadding=-5 → 0`。
5. 缺失字段：`centerIconSize: undefined as any` → 等价 16；`centerIconPadding: Number.NaN` → 等价 8。
6. 面积保护（两条，旧版本单条断言与 floor/ceil 取整冲突，已修正）：① 理想跨度 `(size + 2 * padding) / cell / qrSize <= 0.22`（`size=18, padding=10` 时约 0.216）；② 实际模块跨度用 `qrSize=41, cell=10, size=18, padding=10` 断言 `cutout.width / 41 <= 0.25`（33 模块场景下向外取整会多算 1 格，`9/33 = 0.2727` 属预期行为，不作为失败条件）。
7. 非居中 margin（`{top:0,right:4,bottom:0,left:0}`）时 `cutout.top + cutout.bottom === qrSize`。

输出 `PASS center-icon-layout (n assertions)`；任一断言失败打印 `expected/actual` 并 `process.exit(1)`。

### 4.3 第 3 层：CDP e2e（`docs/plan/center-icon/verify-center-icon.mjs`）

复用 `docs/plan/compose-rulers/cdp-client.mjs`（`connect`/`evaluate`/`openPage`/`log`，见 `:7`、`:44`、`:55`、`:78`）。

启动：`pnpm dev`（默认 `http://localhost:3000`）+ 带 `--remote-debugging-port=9223` 的无头 Edge（与既有脚本一致）。

```powershell
node docs/plan/center-icon/verify-center-icon.mjs http://localhost:3000/#generator 9223
```

断言步骤：

1. **渲染 + 扫码（页面内跑真实渲染）**：`page.evaluate` 里 `await import('/logic/generate.ts')`、`await import('/logic/state.ts')`、`await import('/logic/icon.ts')`、`await import('/logic/scan.ts')`：
   - 用 `defaultGeneratorState()` 构造 state：`text='center-icon-check'`、`ecc='H'`、`scale=20`、`margin=2`、`centerIconSize=16`、`centerIconPadding=8`、`centerIcon=<1×1 或 8×8 纯红 PNG data URL>`；
   - `await generateQRCode(canvas, state)`；
   - 断言：中心像素 RGB ≈ `(255,0,0)`；间隙方框内落在模块上的采样点为背景色 `#ffffff`（该点应因挖洞而未被绘制）；
   - `const { result } = await scanQRCodeFromDataUrl(canvas.toDataURL())`；断言 `result?.data === 'center-icon-check'`（`logic/scan.ts:16` 返回结构见 `logic/scan.ts:22`，具体字段名以 `qr-scanner-wechat` 的 `ScanResult` 为准，实施时打印一次 `JSON.stringify(result)` 校准）。
2. **UI 装配 + 上传即切 ECC**：写 `localStorage['qrd-state-1']`（state 形状见 `components/StateProvider.vue:12-21`，中心图放在 `.qrcode` 内）→ `Page.navigate` 重载 → 断言：
   - 页面出现文本 `Center Icon`、`Icon Size`、`Gap`、`Rounded Icon`、`Plate`；
   - 存在 `img[src^="data:image/png"]`（预览缩略图）。
   - ECC 自动切换：先把 `.qrcode.ecc` 置 `M` 并重载；在页面内用 `DataTransfer` 给 Center Icon 的 `input[type=file]` 赋一个 8×8 PNG `File` 并 `dispatchEvent(new Event('input'))`；等待 500ms 后读 `localStorage['qrd-state-1']`，断言 `.qrcode.ecc === 'H'` 且 `.qrcode.centerIcon` 以 `data:image/png;base64,` 开头。
3. **SVG 导出**：页面内 `window.URL.createObjectURL = (blob) => { window.__svgBlob = blob; return 'blob:stub' }`，点击 `SVG` 按钮，`await window.__svgBlob.text()`，断言：
   - 含 `<image href="data:image/png;base64,`；
   - 含 `<clipPath id="qrd-center-icon-clip">` 与 `clip-path="url(#qrd-center-icon-clip)"`；
   - 图标 `<image>` 的 `width` 等于期望 `size`：脚本先按 spec §2.3.1 从 state 算出 `qrEdge * centerIconSize / 100`（例如 `qrSize=33, scale=20` → `qrEdge=660`、`16%` → `105.6`），再与 SVG 中的 `width="..."` 比对，误差 ≤ 0.01。
4. **旧状态兼容**：把 `qrd-state-1` 里 `centerIcon*` 五个键删掉 → 重载 → 断言页面无异常、导出 SVG 不含 `data:image/png;base64`。
5. **全程无 console error / 未捕获异常**：`page.problems`（`docs/plan/compose-rulers/cdp-client.mjs` 汇总 console.error 与 exception）为空。

输出 `PASS center-icon-e2e` / `FAIL <断言>` + `process.exit(1)`。

### 4.4 第 4 层：人工确认（交付前必做）

1. 手机相机分别扫：无图标基线、图标 16%/间隙 8%、图标 18%/间隙 0、透明 PNG。
2. 导出 SVG 用浏览器直接打开 + 用 Inkscape/Illustrator 各打开一次（验证 `clipPath` 兼容）。
3. Compose 页拖入生成图，确认贴片中心有图标、白底板判定正常。

---

## 5. 实施顺序与写入范围

| 序号 | 任务 | 写入范围（不重叠） | 依赖 | 完成判据 |
| --- | --- | --- | --- | --- |
| 1 | 数据与几何核心 | `logic/types.ts`、`logic/state.ts`、`logic/icon.ts`（新增）、`logic/draw.ts` | — | `pnpm typecheck` 通过；`verify-center-icon-layout.ts` 全绿 |
| 2 | canvas 贴图 | `logic/generate.ts` | 1 | 预览画布中心出现图标；透明模式无底板 |
| 3 | SVG 贴图 | `logic/svg.ts` | 1 | 导出 SVG 含 `<image>`/`clipPath`，位置尺寸正确 |
| 4 | 界面 | `components/Generator.vue` | 1 | 上传/调节/清除可用；4 条横幅按条件出现 |
| 5 | 验收脚本 | `docs/plan/center-icon/verify-center-icon-layout.ts`、`docs/plan/center-icon/verify-center-icon.mjs` | 1（脚本可在 1 完成后先写，2/3/4 完成后跑通） | 两个脚本 PASS |
| 6 | 交叉验证与交付 | 无代码改动（仅 `docs/plan/center-icon/tasks.md` 状态） | 2,3,4,5 | typecheck + lint + 两个脚本 + 人工扫码全绿 |

并行规则：任务 2、3、4 彼此文件不重叠，可并行；任务 5 依赖 1 的接口，可与 2/3/4 并行开发、最后串行验证。
