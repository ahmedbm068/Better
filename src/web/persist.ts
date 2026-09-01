/**
 * Keeping the browser database between visits.
 *
 * IndexedDB rather than localStorage: the database is a binary blob measured in
 * megabytes, and localStorage holds strings and caps out around five.
 *
 * This is a cache, not the record. The server holds the truth, and a browser
 * that has lost its storage re-pulls everything. That is the difference between
 * the web client and the desktop app, and it is why the download is still worth
 * offering: only one of them survives clearing site data.
 */
const DB_NAME = 'better'
const STORE = 'database'
const KEY = 'snapshot'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * The database saved last time, if any.
 *
 * Every failure returns undefined rather than throwing. A private window, a
 * browser told to block site data, or a corrupt entry should all mean the same
 * thing to the caller: start empty and pull from the server.
 */
export async function loadSnapshot(): Promise<Uint8Array | undefined> {
  try {
    const db = await open()
    return await new Promise((resolve) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
      request.onsuccess = () => {
        const value = request.result
        resolve(value instanceof Uint8Array ? value : undefined)
      }
      request.onerror = () => resolve(undefined)
    })
  } catch {
    return undefined
  }
}

export async function saveSnapshot(bytes: Uint8Array): Promise<boolean> {
  try {
    const db = await open()
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(bytes, KEY)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
      tx.onabort = () => resolve(false)
    })
  } catch {
    return false
  }
}

export async function clearSnapshot(): Promise<void> {
  try {
    const db = await open()
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY)
  } catch {
    // Nothing to clear, or nowhere to clear it from.
  }
}

/**
 * Saves at most once every `delayMs`, and once more on the way out.
 *
 * Exporting the whole database on every keystroke would be wasteful, and
 * exporting it never would lose the last thing the user did. `pagehide` rather
 * than `beforeunload`, because it is the one mobile browsers actually fire.
 */
export interface AutoSave {
  /** Call after a write; the save itself happens on the debounce. */
  schedule: () => void
  /** Saves now, if anything is outstanding. */
  flush: () => void
  stop: () => void
}

export function autoSave(exportBytes: () => Uint8Array, delayMs = 2000): AutoSave {
  let timer: ReturnType<typeof setTimeout> | null = null
  let dirty = false

  const write = (): void => {
    if (!dirty) return
    dirty = false
    void saveSnapshot(exportBytes())
  }

  const schedule = (): void => {
    dirty = true
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      write()
    }, delayMs)
  }

  const onHide = (): void => write()
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') write()
  }
  addEventListener('pagehide', onHide)
  addEventListener('visibilitychange', onVisibility)

  return {
    schedule,
    flush: write,
    stop() {
      if (timer) clearTimeout(timer)
      removeEventListener('pagehide', onHide)
      removeEventListener('visibilitychange', onVisibility)
    }
  }
}
