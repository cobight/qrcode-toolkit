import { Buffer } from 'node:buffer'
/**
 * 暗色模式截图验收脚本（仅验收用，不参与打包）。
 * 用法（先启动带 --remote-debugging-port=9223 的无头 Edge）：
 *   node docs/plan/compose-rulers/capture-dark.mjs <url> <out.png> [port]
 */
import { writeFileSync } from 'node:fs'
import process from 'node:process'
import { connect, log } from './cdp-client.mjs'

async function main() {
  const url = process.argv[2] ?? 'http://localhost:3000/#compose'
  const out = process.argv[3] ?? 'dark.png'
  const port = Number(process.argv[4] ?? 9223)
  const page = await connect(port)

  await page.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: 'dark' },
    ],
  })
  await page.openPage(url)

  const screenshot = await page.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(out, Buffer.from(screenshot.data, 'base64'))
  log(`saved ${out}`)
  page.close()
  process.exit(0)
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exit(1)
})
