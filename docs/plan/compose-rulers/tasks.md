# 任务清单：Compose 画布横纵标尺（Ruler）

规格：`docs/plan/compose-rulers/spec.md`；可行性：`docs/plan/compose-rulers/feasibility.md`

| 任务 ID | 负责人 | 依赖 | 写入范围 | 验收标准 | 状态 |
| --- | --- | --- | --- | --- | --- |
| T1 | ruler-core（子 agent） | 无 | 新建 `logic/ruler.ts`、`components/ComposeRuler.vue`、`docs/plan/compose-rulers/verify-ruler.ts` | `node docs/plan/compose-rulers/verify-ruler.ts` 打印 PASS 且退出码 0；`pnpm typecheck` 退出码 0 | ✅ 通过（lead 复核：本人重跑 verify 脚本 PASS；`logic/ruler.ts:19-67` 与 spec 2.1 逐条一致） |
| T2 | stage-integration（子 agent） | T1 落盘 | 只改 `components/ComposeStage.vue` | `pnpm exec nuxi prepare` 后 `pnpm typecheck` 与 `pnpm lint` 退出码 0；`git diff --stat` 不含 `logic/compose.ts` | ✅ 通过（lead 复核：`components/ComposeStage.vue:17`、`:20-24`、`:27-40`、`:276-279` 与施工图一致；typecheck/lint 退出码 0；`logic/compose.ts` mtime 16:05:33 早于本轮首个改动 16:42） |
| T3 | lead（本人验收） | T2 | 不改业务文件（仅收尾修 `components/ComposeRuler.vue` 末尾标签裁切） | 见下方「最终验收结果」A1–A9 全过 | ✅ 通过 |

## 基线（改动前实测）

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck`（vue-tsc --noEmit） | 退出码 0 |
| `pnpm lint`（eslint .） | 退出码 0 |

## 最终验收结果（lead 实跑，2026-11-18 复跑）

| 编号 | 验收项 | 证据 | 结论 |
| --- | --- | --- | --- |
| A1 | 横尺在画布上边缘外侧、纵尺在左边缘外侧，角块补齐 | 截图 `compose-ruler-light-final.png`；DOM 为 `grid-template-columns: 24px <stageW>px` | ✅ |
| A2 | 0 刻度与画布原点对齐（误差 ≤1px） | Pillow 量像素：纵尺「0」字形在 y=116-122，画布白区自 y=115 起；「200」191-197（理论 186.5）、「400」265-271（理论 261） | ✅ |
| A3 | 刻度随缩放自适应，主刻度间距 ≥60px，数字用设计像素 | `verify-ruler.ts` PASS；截图 1080×1920 下主刻度 200 设计 px、屏幕间距 ≈74.5px | ✅ |
| A4 | 不遮挡画面、不拦截指针 | `components/ComposeRuler.vue:83` `pointer-events-none`；拖拽回归 PASS | ✅ |
| A5 | 导出不受影响 | `logic/compose.ts` mtime 16:05:33，早于本轮首个改动（16:42），文件未改；`renderComposeCanvas` 只读 `ComposeState` | ✅ |
| A6 | 拖拽/吸附/键盘行为不变 | `verify-interaction.mjs` PASS：Position 324→431.26、744→824.45（+40/+30 屏幕 px ÷ scale 0.3729），无 console error | ✅ |
| A7 | 浅色/深色主题都可读 | 截图 `compose-ruler-light-final.png`、`compose-ruler-dark-final.png` | ✅ |
| A8 | 极端画布尺寸不崩、不出现 NaN | `verify-extremes.mjs` PASS：200×200 与 8000×8000 下 stage 580×580 / 616×616，横纵尺标签各 5 / 9 个，`nanStyles` 为空 | ✅ |
| A9 | 构建与静态检查 | `pnpm typecheck` 0、`pnpm lint` 0、`pnpm build` 0（11.0s） | ✅ |

## 督查记录

| 时间 | 动作 | 结果 |
| --- | --- | --- |
| 2026-11-17 16:40 | 派单 T1 给 ruler-core，deadline 17:10 | 已派出 |
| 2026-11-17 16:43 | T1 完成，lead 复核代码 + 重跑 verify-ruler.ts | 通过 |
| 2026-11-17 16:44 | 派单 T2 给 stage-integration，deadline 17:14 | 已派出 |
| 2026-11-17 16:47 | T2 完成，lead 复核 diff + 跑 typecheck/lint | 通过 |
| 2026-11-17 17:08 | T3 自查发现 lint 红：验收脚本与 `ComposeRuler.vue` 新分支不符合 antfu 规则（91 errors） | lead 当场修：抽 `cdp-client.mjs`、脚本改 `async main()`、`node:` 内置模块显式 import、`--fix` 格式化 |
| 2026-11-18 10:49 | 复跑全量门槛（typecheck / lint / build / 单元 / 拖拽 / 极端尺寸 / 浅深色截图） | 全绿 |
