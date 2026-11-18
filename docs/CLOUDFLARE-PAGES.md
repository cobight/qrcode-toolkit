# Cloudflare Pages 部署手册

> 适用版本：Nuxt 4 + pnpm 10 + Node 24（见 `package.json` / `.nvmrc`）
> 产出形态：纯静态 SPA（`ssr: false`），构建目录 `.output/public`

---

## 1. 这个项目为什么能上 Pages

| 事实 | 依据 |
| --- | --- |
| 渲染模式为纯客户端 SPA | `nuxt.config.ts` → `ssr: false` |
| 没有服务端接口 | 仓库无 `server/` 目录，无 API 路由 |
| 构建产物是静态文件 | `pnpm run generate` → `.output/public`（HTML + `_nuxt/` 静态资源） |
| 无数据库 / KV / R2 依赖 | 全部逻辑在浏览器内完成（扫码、生成、比对） |

也就是说：Pages 只需要把它当静态托管，不需要 Workers、Functions、绑定的存储。

---

## 2. 前置条件

- Node.js **24.x**（`.nvmrc` 已锁定；Nuxt 4 要求 `^22.22.3 || ^24.15.0 || >=26`）
- pnpm **10.x**（`package.json` → `packageManager: pnpm@10.11.1`）
- Cloudflare 账号（Pages 免费额度：每月 500 次构建、无限带宽、单文件 25 MiB）

本地自检：

```bash
node -v          # v24.x
pnpm -v          # 10.x
pnpm install
pnpm run generate   # 应生成 .output/public
```

---

## 3. 方式 A：Git 集成（推荐，推送即部署）

### 3.1 创建项目

1. 进入 **Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git**
2. 选择本仓库与分支（如 `main`）
3. 构建设置按下表填写

### 3.2 构建设置

| 配置项 | 值 | 说明 |
| --- | --- | --- |
| Framework preset | `Nuxt`（或 None） | 仅用来预填，最终以本表为准 |
| Build command | `pnpm run generate` | 静态生成，不要用 `pnpm run build` |
| Build output directory | `.output/public` | 不是 `dist`，不是 `.output` |
| Root directory | 仓库根（留空） | 本项目不是 monorepo |
| Node.js version | 由 `.nvmrc` 自动读取（24） | 也可显式设环境变量 `NODE_VERSION=24` |
| pnpm version | 由 `packageManager` 字段决定（10.11.1） | 如需覆盖：`PNPM_VERSION=10.11.1` |

### 3.3 环境变量

| 变量 | 是否必需 | 用途 |
| --- | --- | --- |
| `NODE_VERSION` | 可选 | 覆盖 node 版本，建议 `24` |
| `PNPM_VERSION` | 可选 | 覆盖 pnpm 版本，建议 `10.11.1` |
| `CF_PAGES_BRANCH` / `CF_PAGES_COMMIT_SHA` | 自动注入 | 构建脚本会读取，用于把分支/commit 写进页面 build 信息 |

> `modules/build-info.ts` 会依次尝试：Cloudflare/GitHub 注入的环境变量 → 本机 `git` 命令 → `unknown` 兜底。
> 所以即使构建环境没有 `.git` 目录，构建也不会失败。

### 3.4 首次部署后验收

```bash
# 首页能拿到 HTML 与静态资源
curl -I https://<项目名>.pages.dev/
curl -I https://<项目名>.pages.dev/_nuxt/entry.<hash>.css

# 二级路由正常（预渲染产物）
curl -I https://<项目名>.pages.dev/batch

# 不存在的路径应返回 404 页面
curl -o /dev/null -w "%{http_code}\n" https://<项目名>.pages.dev/__not_found__

# CORS 头（来自 public/_headers）
curl -sI https://<项目名>.pages.dev/ | grep -i access-control
```

---

## 4. 方式 B：本地构建 + 直传（不接 Git）

适合内网、私有仓库或想完全控制构建机的场景。

```bash
pnpm install
pnpm run generate
npx wrangler pages deploy .output/public --project-name <项目名>
```

首次执行会要求 `wrangler login`（浏览器授权）。CI 中用 API Token：

```bash
wrangler pages deploy .output/public \
  --project-name <项目名> \
  --branch main
# 环境变量：CLOUDFLARE_API_TOKEN、CLOUDFLARE_ACCOUNT_ID
```

> 直传模式下没有 Git 元数据，build 信息会是 `unknown`——这是预期行为，不影响功能。

---

## 5. 路由与回退行为

当前页面（构建时全量预渲染）：

| 路由 | 产物 |
| --- | --- |
| `/` | `index.html` |
| `/batch` | `batch/index.html` |
| 未命中 | `404.html` |

- Cloudflare Pages 自身会把 `/batch/index.html` 映射到 `/batch`，无需额外配置。
- **不要**盲目加 `public/_redirects` 的 `/* /index.html 200`：当前只有两个静态路由，加了反而会让 `404.html` 失效。
- 若以后新增了**未预渲染**的动态路由，再添加 `public/_redirects`：

  ```
  /* /index.html 200
  ```

## 5.1 响应头

`public/_headers` 会被原样复制到产物根目录：

```
/*
  Access-Control-Allow-Origin: *
```

这是为了让「Stable Diffusion WebUI 扩展」等外部页面能跨域引用本站资源；与 `netlify.toml` 中的配置意图一致。

---

## 6. 自定义域名与 HTTPS

1. Pages 项目 → **Custom domains** → 添加域名
2. 域名托管在同一 Cloudflare 账号：自动写入 CNAME，几分钟生效
3. 域名在外部 DNS：按提示添加 `CNAME <项目名>.pages.dev`
4. 证书由 Cloudflare 自动签发（Universal SSL），无需额外操作

---

## 7. 预览部署与回滚

| 场景 | 操作 |
| --- | --- |
| 每个 PR 的预览环境 | Git 集成默认开启，`https://<hash>.<项目名>.pages.dev` |
| 关闭某分支预览 | Settings → Builds & deployments → Preview deployments |
| 回滚到历史版本 | Deployments → 选择历史部署 → `Rollback to this deployment` |
| 重新部署最新提交 | Deployments → `Retry deployment` |

---

## 8. 常见故障排查

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| `node: command not found` / 版本不符 | 构建机 node 版本过低（Nuxt 4 要求 ≥22.22.3） | 设 `NODE_VERSION=24`，或确认 `.nvmrc` 已提交 |
| `ERROR: Cannot find matching keyid` / pnpm 版本异常 | `packageManager` 与实际 pnpm 不匹配 | 设 `PNPM_VERSION=10.11.1`，或删除 `packageManager` 字段 |
| `ERR_PNPM_OUTDATED_LOCKFILE` | 锁文件与 `package.json` 不一致 | 本地跑 `pnpm install` 后提交 `pnpm-lock.yaml` |
| `fatal: not a git repository` | 构建环境没有 `.git`，而旧版 `modules/build-info.ts` 硬依赖 git | 已修复（env → git → unknown 兜底）；若报错说明回退了该文件 |
| 部署成功但访问 404 | Build output 填错（填成 `dist` 或 `.output`） | 改为 `.output/public` |
| 页面白屏 | 静态资源 404 / 缓存旧 hash | 检查 `_nuxt/` 是否上传；强制刷新；确认没有失效的 `_redirects` |
| 二级路由 404 | 产物里没有 `batch/index.html` | 确认构建命令是 `pnpm run generate` 且预渲染日志含 `/batch` |
| 跨域被拦 | 缺少 `_headers` | 确认 `public/_headers` 存在且产物根目录有该文件 |
| 构建超时 | 依赖安装慢 | 打开 Pages 构建缓存（Settings → Build cache），或用直传方式 |

---

## 9. 与仓库内其他配置的关系

| 文件 | 作用 | Pages 是否使用 |
| --- | --- | --- |
| `netlify.toml` | Netlify 的构建/重定向/响应头配置 | 不使用（保留不影响 Pages） |
| `public/_headers` | 静态响应头 | 使用 |
| `public/_redirects` | 路由重写/回退 | 使用（当前不需要） |
| `.nvmrc` | Node 版本 | 使用 |
| `.npmrc` | pnpm 安装行为（`shamefully-hoist` 等） | 使用 |
| `.pnpmrc` | **不存在此约定**，pnpm 不读取该文件 | 不使用 |

> 注意：本项目历史上曾有 `.npmrc` 被误改名为 `.pnpmrc` 的情况。pnpm 只读 `.npmrc`，改名会让 `shamefully-hoist` 等设置静默失效。

---

## 10. 一次性清单（复制到 PR 描述里逐项打勾）

- [ ] `.nvmrc` = 24，已提交
- [ ] `.npmrc` 存在（不是 `.pnpmrc`）
- [ ] `pnpm-lock.yaml` 与 `package.json` 一致
- [ ] 本地 `pnpm run generate` 通过，产物在 `.output/public`
- [ ] Pages 构建命令 = `pnpm run generate`
- [ ] Pages 输出目录 = `.output/public`
- [ ] 部署后 `/`、`/batch`、404 三条链路验收通过
- [ ] 自定义域名证书状态 = Active

---

## 附录 A：本仓库实测验证记录

> 环境：Windows / Node 24.21.0 / pnpm 10.11.1 / Nuxt 4.6.3，验证时间 2026-11-02。

| 验证项 | 命令 | 结果 |
| --- | --- | --- |
| 依赖可复现安装 | `pnpm install --frozen-lockfile` | exit 0，锁文件未变更 |
| 类型检查 | `pnpm run typecheck`（vue-tsc 3.3.14 + TS 5.9.3） | exit 0，0 error |
| 静态检查 | `pnpm run lint`（ESLint 10 flat config） | exit 0，0 error |
| 静态构建 | `pnpm run generate` | exit 0，5 条路由预渲染 |
| 产物规模 | `.output/public` | 25 个文件 / 约 8.4 MB |
| 资源引用完整性 | 解析 HTML 内 32 条 `/_nuxt/*`、`/qrcodes/*` 引用 | 全部存在，0 缺失 |
| 路由行为（模拟 Pages 托管） | `/`、`/batch`、`/batch/` | 200 + `text/html` |
| 404 行为 | 任意未命中路径 | 404 + `404.html` |
| 响应头 | `GET /_headers` | 已随产物发布 |

> 单个最大文件是扫码 wasm 包（`_nuxt/*.js`，约 6.2 MB），远低于 Pages 25 MiB 单文件上限。
> 若首屏体积敏感，可对该模块做动态 `import()` 懒加载（属于性能优化，不影响能否部署）。
