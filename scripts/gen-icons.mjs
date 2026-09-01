// Generates the app + tray icons as PNGs with zero image dependencies.
// Run automatically on postinstall; also available via `npm run icons`.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

/** @param {number} w @param {number} h @param {Buffer} rgba */
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)]

/** Renders `sample(x, y) -> [r,g,b,a]` with 4x4 supersampling. */
function render(size, sample) {
  const S = 4
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const [pr, pg, pb, pa] = sample(x + (sx + 0.5) / S, y + (sy + 0.5) / S)
          const w = pa / 255
          r += pr * w; g += pg * w; b += pb * w; a += pa
        }
      }
      const n = S * S
      const aSum = a / n
      const wSum = a / 255 || 1
      const i = (y * size + x) * 4
      out[i] = Math.round(r / wSum)
      out[i + 1] = Math.round(g / wSum)
      out[i + 2] = Math.round(b / wSum)
      out[i + 3] = Math.round(aSum)
    }
  }
  return out
}

const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x < x1 && y >= y0 && y < y1

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (!inRect(x, y, x0, y0, x1, y1)) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

/**
 * The mark: two readings, the second higher, held above a datum line.
 *
 * The line is the standard you hold; the blocks are where you actually are. It
 * runs past them on both sides so it reads as a reference line rather than a
 * chart axis — the app is not a dashboard, it is a measurement against a bar
 * you set yourself.
 *
 * Coordinates are snapped to a 16-pixel grid, because the tray icon renders at
 * 16px in a single flat colour and anything off-grid turns to mush there. Three
 * rectangles, no curves, no interior detail: it survives the smallest size the
 * app ever draws it at.
 */
const MARK = [
  //  x0       y0       x1       y1
  [0.1875, 0.375, 0.4375, 0.625], // the earlier, lower reading
  [0.5625, 0.1875, 0.8125, 0.625], // the later, higher one
  [0.0625, 0.6875, 0.9375, 0.8125] // the datum line
]

function inGlyph(x, y, s) {
  return MARK.some(([x0, y0, x1, y1]) => inRect(x, y, x0 * s, y0 * s, x1 * s, y1 * s))
}

const BG = hex('#121110')
const ACCENT = hex('#E8A33D')
const TRAY_FG = [236, 240, 246]

// App icon: 256px rounded slab, amber ascending bars.
const appIcon = render(256, (x, y) => {
  const s = 256
  if (!inRoundRect(x, y, 0, 0, s, s, 56)) return [0, 0, 0, 0]
  if (inGlyph(x, y, s)) return [...ACCENT, 255]
  // hairline inner keyline for depth
  if (inRoundRect(x, y, 6, 6, s - 6, s - 6, 50) && !inRoundRect(x, y, 8, 8, s - 8, s - 8, 48)) {
    return [42, 40, 37, 255]
  }
  return [...BG, 255]
})

// Tray icons: transparent background, light glyph so it reads on the Windows taskbar.
const tray = (s) => render(s, (x, y) => (inGlyph(x, y, s) ? [...TRAY_FG, 255] : [0, 0, 0, 0]))

const files = [
  ['build/icon.png', encodePng(256, 256, appIcon)],
  ['resources/tray.png', encodePng(16, 16, tray(16))],
  ['resources/tray@2x.png', encodePng(32, 32, tray(32))],
  ['resources/icon.png', encodePng(256, 256, appIcon)]
]

for (const [rel, buf] of files) {
  const abs = resolve(root, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, buf)
  console.log('icon:', rel, buf.length + 'b')
}
