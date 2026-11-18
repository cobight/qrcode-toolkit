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
await page.openPage(url, 1280, 900, 12000)

const info = await page.evaluate(`(() => {
  const canvas = document.querySelector('canvas')
  const links = [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => h && h.startsWith('/')).slice(0, 5)
  return {
    title: document.title,
    baseURL: window.__NUXT__?.config?.app?.baseURL ?? null,
    canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
    links,
    nuxtMounted: !!document.querySelector('#__nuxt')?.children.length,
  }
})()`)

log(`title=${info.title}`)
log(`baseURL=${info.baseURL} nuxtMounted=${info.nuxtMounted} canvas=${JSON.stringify(info.canvas)}`)
log(`links=${JSON.stringify(info.links)}`)

const problems = page.problems ?? []
const fails = []
if (!info.nuxtMounted)
  fails.push('SPA 未挂载（#__nuxt 无子节点）')
if (!info.canvas)
  fails.push('页面没有渲染二维码 canvas')
if (problems.length)
  fails.push(`控制台异常 ${problems.length} 条：${JSON.stringify(problems.slice(0, 3))}`)

if (fails.length) {
  for (const f of fails)
    process.stdout.write(`FAIL ${f}\n`)
  process.exit(1)
}

process.stdout.write(`PASS pages-live ${url}\n`)
page.close()
