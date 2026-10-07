// Draws the toolbar icon (a card whose lines of text fade away) without any image dependencies.
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const sum = Buffer.alloc(4)
  sum.writeUInt32BE(crc(body))
  return Buffer.concat([len, body, sum])
}

function roundedBox(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r
  const qy = Math.abs(y - cy) - hh + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

function render(size) {
  const px = Buffer.alloc(size * size * 4)
  const s = size / 128
  const lines = [
    { y: 44, w: 30, a: 1 },
    { y: 64, w: 22, a: 0.6 },
    { y: 84, w: 14, a: 0.28 },
  ]
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5) / s
      const y = (j + 0.5) / s
      const aa = 1 / s
      const bg = Math.min(1, Math.max(0, 0.5 - roundedBox(x, y, 64, 64, 60, 60, 28) / aa))
      let white = 0
      for (const l of lines) {
        const d = roundedBox(x, y, 64 - (30 - l.w), l.y, l.w, 6, 6)
        white = Math.max(white, Math.min(1, Math.max(0, 0.5 - d / aa)) * l.a)
      }
      const o = (j * size + i) * 4
      px[o] = Math.round(29 + (255 - 29) * white)
      px[o + 1] = Math.round(155 + (255 - 155) * white)
      px[o + 2] = Math.round(240 + (255 - 240) * white)
      px[o + 3] = Math.round(255 * bg)
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let j = 0; j < size; j++) px.copy(raw, j * (size * 4 + 1) + 1, j * size * 4, (j + 1) * size * 4)
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const size of [16, 32, 48, 128]) writeFileSync(`public/icons/icon${size}.png`, render(size))
