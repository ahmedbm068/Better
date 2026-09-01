/**
 * Development helper: attaches to a running instance over the Chrome DevTools
 * Protocol, drives the UI a little, and writes screenshots plus any console
 * errors. Not part of the app; used to check the renderer really renders.
 *
 * Usage:
 *   npx electron . --remote-debugging-port=9333
 *   node scripts/capture.mjs <outDir> [route ...]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const PORT = process.env.CDP_PORT ?? '9333'
const outDir = process.argv[2] ?? '.'
const routes = process.argv.slice(3)

mkdirSync(outDir, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function findPage(attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // The app is still starting up.
    }
    await sleep(500)
  }
  throw new Error('no debuggable page appeared')
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.logs = []
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
        return
      }
      if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
        this.logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`)
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        this.logs.push(`exception: ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description ?? ''}`)
      }
    })
  }

  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    return res.result?.value
  }

  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    const file = join(outDir, `${name}.png`)
    writeFileSync(file, Buffer.from(data, 'base64'))
    console.log('shot:', file)
  }
}

const page = await findPage()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve)
  ws.addEventListener('error', reject)
})

const cdp = new Cdp(ws)
await cdp.send('Page.enable')
await cdp.send('Runtime.enable')
await sleep(2500)

await cdp.shot('01-home')

for (const route of routes) {
  // Click the sidebar entry by its visible label.
  const clicked = await cdp.evaluate(`(() => {
    const target = [...document.querySelectorAll('nav button')]
      .find((b) => b.textContent.trim().toLowerCase().startsWith(${JSON.stringify(route.toLowerCase())}))
    if (!target) return false
    target.click()
    return true
  })()`)
  await sleep(1400)
  if (clicked) await cdp.shot(`${route.toLowerCase()}`)
  else console.log(`route not found: ${route}`)
}

if (process.env.DRIVE === '1') {
  // Back to Today first: the checkboxes only exist on the home screen.
  await cdp.evaluate(`[...document.querySelectorAll('nav button')]
    .find((b) => b.textContent.trim().startsWith('Today'))?.click()`)
  await sleep(1200)

  // Exercise the real mutation path from the UI: tick habits, confirm clean.
  const ticked = await cdp.evaluate(`(() => {
    const boxes = [...document.querySelectorAll('[role="checkbox"]')]
    boxes.slice(0, 4).forEach((b) => b.click())
    boxes.slice(6, 10).forEach((b) => b.click())
    return boxes.length
  })()`)
  console.log('checkboxes found:', ticked)
  await sleep(1800)
  await cdp.shot('02-home-populated')
}

if (process.env.DAY === '1') {
  // Calendar, then today's cell, to reach the day-detail screen.
  await cdp.evaluate(`[...document.querySelectorAll('nav button')]
    .find((b) => b.textContent.trim().startsWith('Calendar'))?.click()`)
  await sleep(1400)
  const opened = await cdp.evaluate(`(() => {
    const cell = document.querySelector('button.bg-accent-soft:not([disabled])')
    if (!cell) return false
    cell.click()
    return true
  })()`)
  await sleep(1600)
  if (opened) await cdp.shot('03-day-detail')
  else console.log('today cell not clickable')
}

const title = await cdp.evaluate('document.title')
const bodyText = await cdp.evaluate('document.body.innerText.slice(0, 400)')
console.log('title:', title)
console.log('--- visible text ---')
console.log(bodyText)

if (cdp.logs.length) {
  console.log('--- console errors ---')
  for (const line of cdp.logs) console.log(line)
} else {
  console.log('--- no console errors ---')
}

ws.close()
process.exit(0)
