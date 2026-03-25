/**
 * 256x256 ICO 파일 생성 (PNG 스트림 내장 방식)
 * ICO 스펙: header(6) + directory entry(16) + PNG data
 */
const fs = require('fs')
const zlib = require('zlib')

const SIZE = 256

// 256x256 RGBA 픽셀 버퍼 생성 (파란 배경 + 흰 PC 아이콘)
function makePng(size) {
  // PNG 시그니처
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  // IHDR 청크
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(size, 0)   // width
  ihdrData.writeUInt32BE(size, 4)   // height
  ihdrData[8] = 8   // bit depth
  ihdrData[9] = 2   // color type: RGB
  ihdrData[10] = 0  // compression
  ihdrData[11] = 0  // filter
  ihdrData[12] = 0  // interlace

  function chunk(type, data) {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const typeBuffer = Buffer.from(type, 'ascii')
    const all = Buffer.concat([typeBuffer, data])
    // CRC32
    const crc = crc32(all)
    const crcBuf = Buffer.alloc(4)
    crcBuf.writeUInt32BE(crc >>> 0)
    return Buffer.concat([len, typeBuffer, data, crcBuf])
  }

  // 간단한 CRC32
  const crcTable = (function() {
    const t = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let j = 0; j < 8; j++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[i] = c
    }
    return t
  })()

  function crc32(buf) {
    let crc = 0xffffffff
    for (const b of buf) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)
    return crc ^ 0xffffffff
  }

  // 픽셀 데이터 (row by row, filter byte = 0)
  const rawRows = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3)  // filter_byte + RGB
    row[0] = 0  // filter: None

    for (let x = 0; x < size; x++) {
      let r = 15, g = 23, b = 42  // bg: #0f172a (dark navy)

      // 외곽 라운드 사각형 (모니터 몸체)
      const mx = Math.abs(x - size / 2), my = Math.abs(y - size / 2)
      if (mx < 90 && my < 70) { r = 30; g = 41; b = 59 }  // #1e293b
      if (mx < 85 && my < 65) { r = 59; g = 130; b = 246 } // #3b82f6 (파란 화면)
      if (mx < 80 && my < 60) { r = 14; g = 165; b = 233 } // 밝은 파랑 내부

      // AI 텍스트 영역
      if (mx < 30 && my < 20) { r = 255; g = 255; b = 255 }  // 흰 블록
      if (mx < 25 && my < 15) { r = 59; g = 130; b = 246 }   // 파랑 안쪽

      // 받침대
      if (mx < 10 && my > 65 && my < 80) { r = 30; g = 41; b = 59 }
      if (mx < 40 && my > 75 && my < 82) { r = 30; g = 41; b = 59 }

      row[1 + x * 3 + 0] = r
      row[1 + x * 3 + 1] = g
      row[1 + x * 3 + 2] = b
    }
    rawRows.push(row)
  }

  const rawBuf = Buffer.concat(rawRows)
  const compressed = zlib.deflateSync(rawBuf, { level: 6 })

  const ihdrChunk = chunk('IHDR', ihdrData)
  const idatChunk = chunk('IDAT', compressed)
  const iendChunk = chunk('IEND', Buffer.alloc(0))

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk])
}

const png256 = makePng(SIZE)

// ICO 헤더: 256x256 PNG 방식 (type=1 icon, 1 image)
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)  // reserved
header.writeUInt16LE(1, 2)  // type: icon
header.writeUInt16LE(1, 4)  // image count

// Directory entry (16 bytes)
const dirEntry = Buffer.alloc(16)
dirEntry[0] = 0        // width: 0 = 256
dirEntry[1] = 0        // height: 0 = 256
dirEntry[2] = 0        // color count
dirEntry[3] = 0        // reserved
dirEntry.writeUInt16LE(1, 4)   // planes
dirEntry.writeUInt16LE(32, 6)  // bit count
dirEntry.writeUInt32LE(png256.length, 8)  // data size
dirEntry.writeUInt32LE(22, 12) // data offset (6 + 16)

const ico = Buffer.concat([header, dirEntry, png256])
fs.writeFileSync('resources/icon.ico', ico)
console.log(`✓ icon.ico generated (${ico.length} bytes, 256×256)`)
