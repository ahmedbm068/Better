/**
 * Checks that reordering a list actually persists.
 *
 * Drives a real HTML5 drag through the DevTools protocol, then reloads the page
 * and re-reads the order from the main process — so a pass means the new order
 * survived the round trip to SQLite, not just a local state change.
 *
 * Usage: npx electron . --remote-debugging-port=9342   then
 *        node scripts/reorder-check.mjs
 */
const PORT = process.env.CDP_PORT ?? '9342'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve)
  ws.addEventListener('error', reject)
})

let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result)
    pending.delete(m.id)
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

const storedOrder = () =>
  evaluate(`window.api.listHabits().then((h) => h.map((x) => x.name))`)

// Open Lists.
await evaluate(`[...document.querySelectorAll('nav button')]
  .find((b) => b.textContent.trim().startsWith('Lists'))?.click()`)
await sleep(1400)

const before = await storedOrder()
console.log('stored before :', before.join(' | '))

const handles = await evaluate(`(() => {
  const hs = [...document.querySelectorAll('button[aria-label^="Reorder habit"]')]
  return hs.map((h) => { const r = h.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })
})()`)
console.log('grip handles found:', handles.length)
if (handles.length < 3) throw new Error('expected drag handles on the habit rows')

// Keyboard path: focus the first handle and press ArrowDown.
await evaluate(`document.querySelectorAll('button[aria-label^="Reorder habit"]')[0].focus()`)
for (const key of ['ArrowDown']) {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: 40 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: 40 })
}
await sleep(1500)
const afterKeyboard = await storedOrder()
console.log('after Arrow Down:', afterKeyboard.join(' | '))

const movedDown =
  afterKeyboard[0] === before[1] && afterKeyboard[1] === before[0] &&
  afterKeyboard.length === before.length
console.log(movedDown ? 'keyboard reorder: PASS' : 'keyboard reorder: FAIL')

// Drag path: real DragEvents through the component's own handlers, moving the
// last row onto the first. Arms the grip first, exactly as a mouse would.
const dragged = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('li')].filter(
    (li) => li.querySelector('button[aria-label^="Reorder habit"]')
  )
  if (rows.length < 2) return 'not enough rows'
  const from = rows[rows.length - 1]
  const to = rows[0]
  const grip = from.querySelector('button[aria-label^="Reorder habit"]')

  grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  const dt = new DataTransfer()
  from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
  to.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, cancelable: true }))
  to.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, cancelable: true }))
  from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
  return 'dispatched'
})()`)
console.log('drag:', dragged)
await sleep(1600)

const afterDrag = await storedOrder()
console.log('after drag     :', afterDrag.join(' | '))

// Reload and confirm the order came back from the database, not from state.
await send('Page.enable')
await send('Page.reload')
await sleep(3000)
const afterReload = await storedOrder()
console.log('after reload   :', afterReload.join(' | '))

const persisted = JSON.stringify(afterReload) === JSON.stringify(afterDrag)
console.log(persisted ? 'persistence: PASS' : 'persistence: FAIL')

ws.close()
process.exit(movedDown && persisted ? 0 : 1)
