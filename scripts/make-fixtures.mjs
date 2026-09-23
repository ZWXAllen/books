/**
 * 生成用于自测的样例电子书（PDF + EPUB），输出到 ./library
 * 运行：node scripts/make-fixtures.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'library')
fs.mkdirSync(OUT, { recursive: true })

/* ------------------------------ 封面绘制 ------------------------------ */
let canvasLib = null
try {
  canvasLib = await import('@napi-rs/canvas')
} catch {
  canvasLib = null
}

function makeCover({ title, author, c1, c2, label }) {
  const W = 800
  const H = 1200
  if (canvasLib) {
    const canvas = canvasLib.createCanvas(W, H)
    const ctx = canvas.getContext('2d')
    const grad = ctx.createLinearGradient(0, 0, W, H)
    grad.addColorStop(0, c1)
    grad.addColorStop(1, c2)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)

    ctx.fillStyle = 'rgba(255,255,255,0.10)'
    ctx.beginPath()
    ctx.arc(W * 0.8, H * 0.18, 260, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(W * 0.15, H * 0.88, 200, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.font = 'bold 64px sans-serif'
    ctx.textAlign = 'left'
    const lines = wrap(ctx, title, W - 140)
    let y = H * 0.42
    for (const line of lines) {
      ctx.fillText(line, 70, y)
      y += 82
    }

    ctx.font = '34px sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.78)'
    ctx.fillText(author, 70, y + 40)

    ctx.font = 'bold 26px sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.fillText(label, 70, 110)
    return canvas.toBuffer('image/jpeg', 88)
  }
  return solidPng(W, H, c1)
}

function wrap(ctx, text, maxWidth) {
  const lines = []
  let cur = ''
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxWidth && cur) {
      lines.push(cur)
      cur = ch
    } else {
      cur += ch
    }
  }
  if (cur) lines.push(cur)
  return lines
}

/* 无 canvas 时的兜底：纯色 PNG */
function solidPng(w, h, hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    const off = y * (w * 3 + 1)
    raw[off] = 0
    for (let x = 0; x < w; x++) {
      raw[off + 1 + x * 3] = r
      raw[off + 2 + x * 3] = g
      raw[off + 3 + x * 3] = b
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

let CRC_TABLE = null
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c
    }
  }
  let crc = 0xffffffff
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return crc ^ 0xffffffff
}

/* ------------------------------ PDF 生成 ------------------------------ */
function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

/** PDF 文本字符串：非 ASCII 用 UTF-16BE 十六进制串，保证中文可被正确解析 */
function pdfString(s) {
  const str = String(s)
  if (/^[\x20-\x7e]*$/.test(str)) return `(${esc(str)})`
  const buf = Buffer.from('\ufeff' + str, 'utf16le')
  // utf16le -> 交换字节序得到 UTF-16BE
  for (let i = 0; i < buf.length; i += 2) {
    const t = buf[i]
    buf[i] = buf[i + 1]
    buf[i + 1] = t
  }
  return `<${buf.toString('hex').toUpperCase()}>`
}

function buildPdf({ title, author, pages }) {
  const objects = []
  const add = (content) => {
    objects.push(content)
    return objects.length // 1-based obj number
  }

  // 占位：先分配编号
  const catalogNum = 1
  const pagesNum = 2
  const fontNum = 3
  const infoNum = 4
  objects.push(null, null, null, null) // 占位

  const pageNums = []
  const contentNums = []

  for (const p of pages) {
    const body = p.stream
    const stream = `BT\n${body}\nET`
    const cNum = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)
    const pNum = add(
      `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 595 842] ` +
        `/Resources << /Font << /F1 ${fontNum} 0 R >> >> /Contents ${cNum} 0 R >>`
    )
    contentNums.push(cNum)
    pageNums.push(pNum)
  }

  objects[catalogNum - 1] = `<< /Type /Catalog /Pages ${pagesNum} 0 R >>`
  objects[pagesNum - 1] =
    `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageNums.length} >>`
  objects[fontNum - 1] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`
  objects[infoNum - 1] =
    `<< /Title ${pdfString(title)} /Author ${pdfString(author)} /Producer (EbookShelf Fixture) /CreationDate (D:20260101120000) >>`

  // 组装
  let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
  const offsets = []
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefStart = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNum} 0 R /Info ${infoNum} 0 R >>\n`
  pdf += `startxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

const LOREM = [
  'A reader lives a thousand lives before he dies. The man who never reads lives only one.',
  'Books are a uniquely portable magic, a door into another mind and another time.',
  'Reading is to the mind what exercise is to the body; it sharpens and it strengthens.',
  'There is no friend as loyal as a book, no counsel so patient, no voice so lasting.',
  'The world is full of magical things patiently waiting for our wits to grow sharper.',
  'To learn to read is to light a fire; every syllable that is spelled out is a spark.'
]

function pdfPages(count, startPage = 1) {
  const pages = []
  for (let i = 0; i < count; i++) {
    const n = startPage + i
    const lines = []
    if (i === 0) {
      // 封面页
      lines.push('0.16 0.29 0.63 rg')
      lines.push('0 0 595 842 re f')
      lines.push('1 1 1 rg')
      lines.push('BT /F1 30 Tf 60 640 Td (Ebook Shelf Sample) Tj ET')
      lines.push('BT /F1 18 Tf 60 590 Td (A generated PDF for testing) Tj ET')
      lines.push('BT /F1 14 Tf 60 560 Td (page 1) Tj ET')
    } else {
      lines.push('0 0 0 rg')
      lines.push(`BT /F1 22 Tf 60 770 Td (Chapter ${n}) Tj ET`)
      let y = 720
      for (let k = 0; k < 12; k++) {
        const text = LOREM[(i + k) % LOREM.length]
        for (const seg of splitSeg(text, 78)) {
          lines.push(`BT /F1 13 Tf 60 ${y} Td (${esc(seg)}) Tj ET`)
          y -= 22
          if (y < 90) break
        }
        if (y < 90) break
      }
      lines.push(`BT /F1 11 Tf 60 60 Td (-- page ${n} --) Tj ET`)
    }
    pages.push({ stream: lines.join('\n') })
  }
  return pages
}

function splitSeg(text, len) {
  const words = text.split(' ')
  const out = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > len) {
      out.push(cur.trim())
      cur = w
    } else {
      cur += ' ' + w
    }
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/* ------------------------------ EPUB 生成 ------------------------------ */
function buildEpub({ title, author, uuid, chapters, coverJpeg }) {
  const files = []
  const add = (name, content, store = false) => files.push({ name, content, store })

  add('mimetype', 'application/epub+zip', true)
  add(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
  )
  if (coverJpeg) add('OEBPS/images/cover.jpg', coverJpeg)

  const manifestItems = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
  ]
  if (coverJpeg) {
    manifestItems.push('<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>')
    manifestItems.push('<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>')
  }
  chapters.forEach((c, i) => {
    manifestItems.push(`<item id="ch${i + 1}" href="chapter${i + 1}.xhtml" media-type="application/xhtml+xml"/>`)
  })

  const spineItems = []
  if (coverJpeg) spineItems.push('<itemref idref="cover"/>')
  chapters.forEach((c, i) => spineItems.push(`<itemref idref="ch${i + 1}"/>`))

  add(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>en</dc:language>
    <dc:description>A generated EPUB used to test the Ebook Shelf reader.</dc:description>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${spineItems.join('\n    ')}
  </spine>
</package>`
  )

  add(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:${uuid}"/></head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
    ${chapters
      .map(
        (c, i) =>
          `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${c.title}</text></navLabel><content src="chapter${i + 1}.xhtml"/></navPoint>`
      )
      .join('\n    ')}
  </navMap>
</ncx>`
  )

  add(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body>
  <nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
    ${chapters.map((c, i) => `<li><a href="chapter${i + 1}.xhtml">${c.title}</a></li>`).join('\n    ')}
  </ol></nav>
</body>
</html>`
  )

  if (coverJpeg) {
    add(
      'OEBPS/cover.xhtml',
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Cover</title><style>body{margin:0;padding:0;text-align:center}img{max-width:100%;height:auto}</style></head>
<body><img src="images/cover.jpg" alt="cover"/></body>
</html>`
    )
  }

  chapters.forEach((c, i) => {
    add(
      `OEBPS/chapter${i + 1}.xhtml`,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${c.title}</title>
<style>
  body { font-family: Georgia, serif; line-height: 1.7; padding: 6% 8%; }
  h1 { font-size: 1.5em; margin-bottom: 1em; }
  p { margin: 0 0 1em; text-indent: 1.5em; }
</style>
</head>
<body>
  <h1>${c.title}</h1>
  ${c.paragraphs.map((p) => `<p>${p}</p>`).join('\n  ')}
</body>
</html>`
    )
  })

  return files
}

async function writeZip(files, outPath) {
  const AdmZip = (await import('adm-zip')).default
  const zip = new AdmZip()
  for (const f of files) {
    zip.addFile(f.name, Buffer.from(f.content, 'utf8'))
    if (f.store) {
      const entry = zip.getEntry(f.name)
      entry.header.method = 0 // 0 = stored
    }
  }
  zip.writeZip(outPath)
}

/* ------------------------------ 输出 ------------------------------ */

const books = [
  {
    dir: '技术',
    pdf: {
      file: '深入理解计算机系统（样例）.pdf',
      title: '深入理解计算机系统',
      author: 'Randal E. Bryant',
      pages: 14
    }
  },
  {
    dir: '技术',
    epub: {
      file: 'Designing Data-Intensive Applications (Sample).epub',
      title: 'Designing Data-Intensive Applications',
      author: 'Martin Kleppmann',
      c1: '#1f3a93',
      c2: '#0f2027',
      label: 'SAMPLE EDITION',
      chapters: 5
    }
  },
  {
    dir: '文学',
    epub: {
      file: 'The Old Man and the Sea (Sample).epub',
      title: 'The Old Man and the Sea',
      author: 'Ernest Hemingway',
      c1: '#c0392b',
      c2: '#6d1b1b',
      label: 'CLASSICS',
      chapters: 4
    }
  },
  {
    dir: '文学',
    pdf: {
      file: 'Sample - Clean Code.pdf',
      title: 'Clean Code',
      author: 'Robert C. Martin',
      pages: 10
    }
  }
]

const CHAPTER_TITLES = [
  'Chapter 1 · Beginnings',
  'Chapter 2 · The Long Road',
  'Chapter 3 · A Quiet Turn',
  'Chapter 4 · What the Water Knew',
  'Chapter 5 · Afterwards'
]

for (const b of books) {
  const target = path.join(OUT, b.dir)
  fs.mkdirSync(target, { recursive: true })

  if (b.pdf) {
    const buf = buildPdf({
      title: b.pdf.title,
      author: b.pdf.author,
      pages: pdfPages(b.pdf.pages)
    })
    fs.writeFileSync(path.join(target, b.pdf.file), buf)
    console.log('✓ PDF ', path.join(b.dir, b.pdf.file), `${(buf.length / 1024).toFixed(0)}KB`)
  }

  if (b.epub) {
    const cover = makeCover({
      title: b.epub.title,
      author: b.epub.author,
      c1: b.epub.c1,
      c2: b.epub.c2,
      label: b.epub.label
    })
    const chapters = CHAPTER_TITLES.slice(0, b.epub.chapters).map((t) => ({
      title: t,
      paragraphs: [
        ...LOREM.map((s) => s + ' ' + LOREM[(LOREM.indexOf(s) + 2) % LOREM.length]),
        ...LOREM.slice(0, 4).map((s) => s + ' ' + LOREM[(LOREM.indexOf(s) + 4) % LOREM.length])
      ]
    }))
    const files = buildEpub({
      title: b.epub.title,
      author: b.epub.author,
      uuid: `${Math.random().toString(16).slice(2, 10)}-0000-4000-8000-000000000000`,
      chapters,
      coverJpeg: cover
    })
    const out = path.join(target, b.epub.file)
    await writeZip(files, out)
    console.log('✓ EPUB', path.join(b.dir, b.epub.file), `${(fs.statSync(out).size / 1024).toFixed(0)}KB`)
  }
}

console.log(`\n样例书已生成到：${OUT}\n`)
