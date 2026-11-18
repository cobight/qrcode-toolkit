/**
 * lead 验收：线上 GitHub Pages 站点是否真的能跑起来（不只是返回 200）。
 * 用法：node docs/plan/center-icon/check-pages-live.mjs [url] [port]
 */
/* eslint-disable antfu/no-top-level-await -- 一次性验收脚本，顺序流 */
import process from 'node:process'
import { connect, log } from '../compose-rulers/cdp-client.mjs'

const url = process.argv[2] ?? 'https://cobight.github.io/qrcode-toolkit/'
const port = Number(process.argv[3] ?? 9334)

const page = await connect(port)
// Pages 的 HTML 默认缓存 10 分钟，验收时必须绕过缓存，否则会读到上一版部署的 baseURL
await page.send('Network.enable')
await page.send('Network.setCacheDisabled', { cacheDisabled: true })
await page.openPage(url, 1280, 900, 3000)

// 线上站点冷启动（新 profile + 首次拉 bundle）可能明显慢于本地预览，轮询等挂载完成再断言
const deadline = Date.now() + 30000
let mounted = false
while (Date.now() < deadline) {
  mounted = await page.evaluate(`(() => {
    const el = document.querySelector('#__nuxt')
    return !!el && el.children.length > 0 && !!document.querySelector('canvas')
  })()`)
  if (mounted)
    break
  await new Promise(resolve => setTimeout(resolve, 1000))
}

const info = await page.evaluate(`(() => {
  const canvas = document.querySelector('canvas')
  const links = [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => h && h.startsWith('/')).slice(0, 5)
  return {
    title: document.title,
    readyState: document.readyState,
    scripts: document.scripts.length,
    pathname: location.pathname,
    href: location.href,
    baseURL: window.__NUXT__?.config?.app?.baseURL ?? null,
    canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
    links,
    nuxtMounted: !!document.querySelector('#__nuxt')?.children.length,
  }
})()`)

log(`title=${info.title}`)
log(`baseURL=${info.baseURL} pathname=${info.pathname} nuxtMounted=${info.nuxtMounted} canvas=${JSON.stringify(info.canvas)}`)
log(`readyState=${info.readyState} scripts=${info.scripts} waitedMount=${mounted} href=${info.href}`)
log(`links=${JSON.stringify(info.links)}`)

const problems = page.problems ?? []
const fails = []
if (!info.nuxtMounted)
  fails.push('SPA 未挂载（#__nuxt 无子节点）')
if (!info.canvas)
  fails.push('页面没有渲染二维码 canvas')

// baseURL 必须等于最终落地 URL 的路径前缀（跟随 301 重定向后再比）：
//   项目站点 https://owner.github.io/repo/ → "/repo/"
//   自定义域名 https://qr.example.com/    → "/"
if (info.baseURL !== info.pathname)
  fails.push(`baseURL 不匹配：落地路径 ${info.pathname}，实际 baseURL ${info.baseURL}（Pages 的 base_path 没跟上？）`)

if (problems.length)
  fails.push(`控制台异常 ${problems.length} 条：${JSON.stringify(problems.slice(0, 3))}`)

// 第二轮：确认中心图功能真的随生产包上线（不是只有本地 dev 才可用）
await page.openPage(`${url}#generator`, 1280, 900, 4000)
const feature = await page.evaluate(`(() => {
  const text = document.body?.innerText ?? ''
  return {
    hasPanel: text.includes('Center Icon'),
    hasFileInput: !!document.querySelector('input[type=file]'),
  }
})()`)
log(`feature=${JSON.stringify(feature)}`)
if (!feature.hasPanel || !feature.hasFileInput)
  fails.push(`中心图 UI 未上线：${JSON.stringify(feature)}`)

if (fails.length) {
  for (const f of fails)
    process.stdout.write(`FAIL ${f}\n`)
  process.exit(1)
}

process.stdout.write(`PASS pages-live ${url}\n`)
page.close()
