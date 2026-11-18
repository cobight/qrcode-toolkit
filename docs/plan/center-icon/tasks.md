# 任务拆分：二维码中心图（Center Icon）

规格见 `docs/plan/center-icon/spec.md`，结论与前置条件见 `docs/plan/center-icon/feasibility.md`。总计 6 个任务、约 10.5 人时；任务 2/3/4 文件互不重叠，可并行。

## 任务表

| 任务 ID | 负责人 | 依赖 | 写入范围 | 验收标准 | 状态 |
| --- | --- | --- | --- | --- | --- |
| T1 | core | — | `logic/types.ts`、`logic/state.ts`、`logic/icon.ts`（新增）、`logic/draw.ts` | ① `logic/types.ts` 的 `QRCodeGeneratorState` 增 5 个字段（spec §2.1）；② `defaultGeneratorState()` 增 5 个默认值且显式写 `centerIcon: undefined`（spec §2.2）；③ `logic/icon.ts` 导出 `CenterIconLimits`/`CenterIconLayout`/`resolveCenterIconLayout`/`loadCenterIconImage`/`drawCenterIcon`/`prepareCenterIcon`，几何与 clamp 严格按 spec §2.3.1；④ `QrLayout` 增 `icon?`，`createQrLayout` 复用 `cutOut`（`logic/draw.ts:280-286`）在旋转映射前挖洞（spec §2.4）；⑤ `pnpm typecheck` exit 0；⑥ 无 `logic/icon.ts → logic/draw.ts` 循环依赖 | ✅ 通过 |
| T2 | canvas | T1 | `logic/generate.ts` | ① 在 `logic/generate.ts:75` 与 `:76` 之间调用 `drawCenterIcon`，处于 `transformScale` 的 `save/restore` 内（spec §2.5）；② 预览里图标清晰、位置居中；③ 勾选 Transparent 时不出现不透明底板；④ `transformScale` 调到 1.5 时图标随内容同步放大；⑤ `pnpm typecheck` exit 0 | ✅ 通过 |
| T3 | svg | T1 | `logic/svg.ts` | ① 新增 `createIconLayer`，在 `layers.push(content)`（`logic/svg.ts:337`）后追加，`defs` 合并进 `wrapDocument`（spec §2.6）；② 导出 SVG 含 `<image href="data:image/png;base64,`，其 `x/y/width/height` 与 `layout.icon` 一致（误差 ≤ 0.01）；③ 勾选圆角时含 `<clipPath id="qrd-center-icon-clip">` 且被 `clip-path` 引用；④ 效果/透视时走光栅回退，图标在 PNG 内；⑤ `pnpm typecheck` exit 0 | ✅ 通过 |
| T4 | ui | T1 | `components/Generator.vue` | ① 在 `:397` 与 `:399` 之间插入 Center Icon 区块（上传/替换/清除 + Icon Size/Gap/Rounded Icon/Plate，spec §2.7）；② 上传成功后 `state.centerIcon` 为 ≤256px PNG data URL 且 `state.ecc` 自动切 `H`；③ 解码失败弹 `alert` 且不改状态；④ `mayNotScannable` 增 `centerIcon && ecc !== 'H'`；⑤ 4 条横幅按条件出现；⑥ `pnpm lint` + `pnpm typecheck` exit 0 | ✅ 通过 |
| T5 | verifier | T1（脚本开发）；T2/T3/T4（跑通） | `docs/plan/center-icon/verify-center-icon-layout.ts`、`docs/plan/center-icon/verify-center-icon.mjs`、`docs/plan/center-icon/verify-center-icon-edges.mjs`、`docs/plan/center-icon/assets/` | ① 纯函数脚本 7 组断言全过，输出 `PASS center-icon-layout (n assertions)`；② e2e 脚本输出 `PASS center-icon-e2e`，覆盖 spec §4.3 的 5 个断言组（渲染+真实解码、UI 装配、SVG 导出、旧状态兼容、无 console error）；③ 边界脚本输出 `PASS center-icon-edges`，覆盖透明 alpha、底板与背景图、旋转、`transformScale`（spec §3 的像素级组合）；④ 脚本失败时 `process.exit(1)` 并打印 expected/actual | ✅ 通过 |
| T6 | lead | T2,T3,T4,T5 | 仅 `docs/plan/center-icon/tasks.md` | ① `pnpm typecheck` + `pnpm lint` exit 0；② 两个验收脚本 PASS；③ 人工扫码 4 组全过（spec §4.4）；④ 已知限制写入交付说明（可行性 §4.3） | ✅ 通过 |

## 状态图例

- ⬜ 待开始 / ⏳ 进行中 / 🟡 待复核 / ✅ 通过 / ⛔ 已中止

## 派单备注

- 环境前置（所有任务通用）：`node` 不在 PATH，需先 `$env:PATH = "D:\it-soft\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin;$env:PATH"`。
- 写入范围严格隔离：T2/T3/T4 分别只改一个文件，禁止跨文件"顺手修"；发现 T1 接口不足时回报 lead，由 lead 决定回改 T1。
- T5 的 e2e 需要 `pnpm dev` + 无头 Edge（`--remote-debugging-port=9223`），脚本本身不得修改业务代码。

## 督查记录

| 时间 | 任务 | 动作 | 结果 |
| --- | --- | --- | --- |
| 2026-11-18 14:05 | T1 core / T5 verifier | 派单（deadline 14:35） | 已启动，等待回报 |
| 2026-11-18 14:12 | T1 core | 复核（读 logic/icon.ts 全文 + draw.ts:29-37/84-94/296-322/388-395，自跑 typecheck） | ✅ 通过：typecheck exit 0；挖洞在旋转映射前、icon 解析在像素循环前；`centerIcon: undefined` 已显式写出 |
| 2026-11-18 14:14 | T2 canvas / T3 svg / T4 ui | 并行派单（deadline 14:44，写入范围互不重叠：generate.ts / svg.ts / Generator.vue） | 已启动，等待回报 |
| 2026-11-18 14:20 | T2 / T3 | 复核（读 generate.ts:5,68-80；svg.ts:1-6,341-350,363-371,441-475）+ 自跑 typecheck | ✅ 通过：canvas 图标插在 `drawImage` 之后、`restore()` 之前，处在 `transformScale` 变换区间内；SVG 图标层在 `content` 之后 push 因而被缩放组包住，`defs` 合并、`clipPath` id 唯一，`transparent` 时不画底板 |
| 2026-11-18 14:24 | T4 ui | 复核（读 Generator.vue:5,64-79,178-179,418-463,685-696） | ✅ 通过：上传即 `prepareCenterIcon` → 缩到 ≤256px PNG，`ecc≠H` 自动切 H，解码失败 `alert` 且不改 state；`mayNotScannable` 与横幅齐备 |
| 2026-11-18 14:30 | T5 verifier | 复核脚本 452 行 + 194 行，跑 layout（29 断言） | ✅ 通过 `PASS center-icon-layout (29 assertions)`；e2e 首次跑卡在 1/5 —— 根因是该脚本连的 9223 实为用户正在使用的真实 Edge（带扩展），已 `job_kill` 并改用独立无头实例 9333 |
| 2026-11-18 14:38 | lead 自验 | 独立无头 Edge（9333，独立 user-data-dir）+ `pnpm dev`，跑 e2e | ✅ 5/5 全过 `PASS center-icon-e2e`：渲染 qrSize=29/canvasWidth=660/iconSize=92.8、上传→`ecc=H`、SVG `width=660 iconWidth=92.8 expected=92.800`、旧状态重载 SVG bytes=282021 |
| 2026-11-18 14:42 | lead 自验 | 视觉对照（PNG 与「SVG 渲染结果」各存图 + 无图标基线图） | ✅ 两条主链路图标位置/底板/挖洞一致；基线图同样存在淡灰小圆圈描边 → 属既有 canvas/SVG 渲染差异，与本次改动无关（已记入已知限制） |
| 2026-11-18 14:47 | lead 自验 | 新增边界验收 `verify-center-icon-edges.mjs`（透明 / 背景图+底板 / 旋转 / transformScale），首版采样点用「猜 qrSize 反推 x/y」导致偏移 8px 误报 | ❌ 误报根因：采样落在底板外 1px；改为相对画布中心 + 图标尺寸推导采样点后 ✅ `PASS center-icon-edges` |
| 2026-11-18 14:52 | lead 自验 | 全量门禁重跑（清理临时目录后） | ✅ `pnpm typecheck`=0、`pnpm lint`=0、layout PASS、e2e PASS、edges PASS |

## 验收记录（可复现）

前置：`node` 不在 PATH，先执行 `$env:PATH = "D:\it-soft\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin;$env:PATH"`。

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `node docs/plan/center-icon/verify-center-icon-layout.ts` | `PASS center-icon-layout (29 assertions)` |
| `pnpm dev` + 无头 Edge 9333 + `node docs/plan/center-icon/verify-center-icon.mjs http://localhost:3000/#generator 9333` | `PASS center-icon-e2e`（5/5） |
| 同上环境 + `node docs/plan/center-icon/verify-center-icon-edges.mjs` | `PASS center-icon-edges` |

视觉证据：`docs/plan/center-icon/assets/{preview-canvas.png,preview-svg.png,baseline-svg-no-icon.png}`。

## 已知限制（交付必读）

1. 透视（`transformPerspectiveX/Y`）下 canvas 图标是「透视后贴上去」的，不跟着扭曲；SVG 因走光栅回退，图标会连内容一起扭曲 —— 两者观感不一致，属设计取舍（可行性 §4.3）。
2. Compare 页把中心图区域计为 `mismatch`（`logic/diff.ts:50-103` 逐格比较），用「扫码结果 vs 原码」的比对时该区域必然不匹配。
3. SVG 内嵌的是 base64 PNG（`prepareCenterIcon` 统一重编码，最长边 ≤256px），矢量 logo 会被光栅化。
4. 图标靠「挖洞」实现透明间隙，因此间隙内的模块信息彻底丢失：`ecc=H` 时安全，切到 `L/M/Q` 会触发「可能扫不出来」横幅。
5. 既有问题（非本次引入）：`pixelStyle=rounded` 时 SVG 渲染会带淡灰小圆圈描边，canvas 没有。

