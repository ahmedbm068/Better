/**
 * Regression check for the modal focus bug.
 *
 * Types a full phrase one key at a time into the "Start a session" dialog and
 * asserts every character landed. The bug it guards against dropped everything
 * after the first keystroke, because the dialog re-focused its close button on
 * each render.
 *
 * Usage: npx electron . --remote-debugging-port=9340   then
 *        node scripts/typing-check.mjs
 */
const PORT = process.env.CDP_PORT ?? '9340'
const PHRASE = 'deep work session'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) throw new Error('no debuggable page')

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve)
  ws.addEventListener('error', reject)
})

let id = 0
const pending = new Map()
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result)
    pending.delete(msg.id)
  }
})
const send = (method, params = {}) => {
  const myId = ++id
  ws.send(JSON.stringify({ id: myId, method, params }))
  return new Promise((r) => pending.set(myId, r))
}
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))
    .result?.value

await send('Runtime.enable')

// Home screen, then open the session dialog.
await evaluate(`[...document.querySelectorAll('nav button')]
  .find((b) => b.textContent.trim().startsWith('Today'))?.click()`)
await sleep(1200)
const opened = await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'START WORK')
  if (!b) return false
  b.click()
  return true
})()`)
if (!opened) throw new Error('START WORK button not found')
await sleep(900)

const focusedOnOpen = await evaluate(
  `document.activeElement?.tagName + ':' + (document.activeElement?.getAttribute('aria-label') ?? '')`
)
console.log('focus on open:', focusedOnOpen)

// Type character by character, the way a person does.
for (const ch of PHRASE) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
  await sleep(60)
}
// Long enough to cross a one-second re-render tick.
await sleep(1400)

const value = await evaluate(`document.querySelector('#home-projects') &&
  [...document.querySelectorAll('input[type=text]')].map((i) => i.value).find((v) => v.length > 0) || ''`)
const stillFocused = await evaluate(`document.activeElement?.tagName`)

console.log(`typed  : "${PHRASE}"`)
console.log(`in field: "${value}"`)
console.log('focus after typing:', stillFocused)

const ok = value === PHRASE && stillFocused === 'INPUT'
console.log(ok ? 'PASS — every character landed and focus stayed put' : 'FAIL')
ws.close()
process.exit(ok ? 0 : 1)
