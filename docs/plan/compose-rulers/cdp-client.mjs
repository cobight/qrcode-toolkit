/**
 * 验收脚本共用的极简 CDP 客户端（仅验收用，不参与打包）。
 * 依赖浏览器已带 --remote-debugging-port 启动。
 */
import process from 'node:process'

export async function connect(port = 9223) {
  const response = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`,
    { method: 'PUT' },
  )
  const target = await response.json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map()
  const problems = []
  let id = 0

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown')
      problems.push(`exception: ${message.params.exceptionDetails.text}`)
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error')
      problems.push(`console.error: ${message.params.args.map(arg => arg.value ?? arg.description).join(' ')}`)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error)
        reject(new Error(JSON.stringify(message.error)))
      else
        resolve(message.result)
    }
  })

  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))

  function send(method, params = {}) {
    const messageId = ++id
    return new Promise((resolve, reject) => {
      pending.set(messageId, { resolve, reject })
      ws.send(JSON.stringify({ id: messageId, method, params }))
    })
  }

  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails)
      throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }

  async function openPage(url, width = 1440, height = 1000, waitMs = 6000) {
    await send('Runtime.enable')
    await send('Page.enable')
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await send('Page.navigate', { url })
    await new Promise(resolve => setTimeout(resolve, waitMs))
  }

  return {
    send,
    evaluate,
    openPage,
    problems,
    close: () => ws.close(),
  }
}

/** 统一输出，避免触发 no-console 规则 */
export function log(...parts) {
  process.stdout.write(`${parts.map(part => typeof part === 'string'
    ? part
    : JSON.stringify(part, null, 2)).join(' ')}\n`)
}
