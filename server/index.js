import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ROOT,
  getConfig,
  setConfig,
  getProgress,
  getAllProgress,
  setProgress,
  removeProgress,
  getAnnotations,
  addAnnotation,
  updateAnnotation,
  deleteAnnotation,
  clearAnnotations,
  flush
} from './lib/store.js'
import { scanLibrary, findCoverFile, coverPathFor, walk, bookId } from './lib/scanner.js'

const PORT = Number(process.env.PORT || 5178)
const app = express()

app.use(cors())
app.use(express.json({ limit: '20mb' }))

/* ------------------------------ 扫描任务状态 ------------------------------ */
const scanState = {
  running: false,
  done: 0,
  total: 0,
  current: '',
  startedAt: 0,
  finishedAt: 0,
  error: null
}

async function runScan() {
  if (scanState.running) return
  const { libraryDir } = getConfig()
  scanState.running = true
  scanState.done = 0
  scanState.total = 0
  scanState.current = ''
  scanState.error = null
  scanState.startedAt = Date.now()
  try {
    await scanLibrary(libraryDir, {
      onProgress: (p) => {
        scanState.done = p.done
        scanState.total = p.total
        scanState.current = p.current
      }
    })
  } catch (err) {
    scanState.error = err.message
    console.error('[scan] 出错：', err)
  } finally {
    scanState.running = false
    scanState.finishedAt = Date.now()
    rebuildIndex()
  }
}

/* ------------------------------ 配置 ------------------------------ */

app.get('/api/config', (req, res) => {
  const cfg = getConfig()
  res.json({ ...cfg, exists: fs.existsSync(cfg.libraryDir) })
})

app.post('/api/config', async (req, res) => {
  const { libraryDir } = req.body || {}
  if (!libraryDir || typeof libraryDir !== 'string') {
    return res.status(400).json({ error: '缺少 libraryDir' })
  }
  const abs = path.resolve(libraryDir.replace(/^~(?=$|\/)/, process.env.HOME || '~'))
  if (!fs.existsSync(abs)) {
    return res.status(400).json({ error: `目录不存在：${abs}` })
  }
  if (!fs.statSync(abs).isDirectory()) {
    return res.status(400).json({ error: `不是目录：${abs}` })
  }
  const cfg = setConfig({ libraryDir: abs })
  runScan()
  res.json({ ...cfg, exists: true })
})

/* ------------------------------ 书目 ------------------------------ */

app.get('/api/books', async (req, res) => {
  const { libraryDir } = getConfig()
  if (!fs.existsSync(libraryDir)) {
    return res.json({ libraryDir, exists: false, books: [], progress: {}, stats: emptyStats() })
  }
  const result = await scanLibrary(libraryDir)
  const progress = getAllProgress()
  const books = result.books.map((b) => {
    const p = progress[b.id]
    return {
      ...b,
      coverUrl: b.hasCover ? `/api/books/${b.id}/cover?t=${Math.round(b.mtime)}` : null,
      progress: p
        ? {
            percent: p.percent || 0,
            page: p.page || 1,
            totalPages: p.totalPages || b.pageCount || 0,
            location: p.location || null,
            finished: (p.percent || 0) >= 99.5,
            updatedAt: p.updatedAt
          }
        : { percent: 0, page: 1, totalPages: b.pageCount || 0, finished: false, updatedAt: null }
    }
  })
  res.json({
    libraryDir,
    exists: true,
    scannedAt: result.scannedAt,
    books,
    stats: buildStats(books)
  })
})

function emptyStats() {
  return { total: 0, reading: 0, finished: 0, unread: 0 }
}

function buildStats(books) {
  const s = { total: books.length, reading: 0, finished: 0, unread: 0 }
  for (const b of books) {
    const p = b.progress?.percent || 0
    if (p >= 99.5) s.finished += 1
    else if (p > 0) s.reading += 1
    else s.unread += 1
  }
  return s
}

app.post('/api/scan', (req, res) => {
  runScan()
  res.json({ ok: true, state: scanState })
})

app.get('/api/scan/progress', (req, res) => {
  res.json(scanState)
})

/**
 * 提供电子书原文件。
 * 支持在末尾追加文件名（如 /file/My%20Book.epub），
 * 因为 epub.js 依赖 URL 后缀判断是「压缩包」还是「解压目录」。
 */
app.get('/api/books/:id/file/:name?', (req, res) => {
  const book = locateBook(req.params.id)
  if (!book) return res.status(404).json({ error: '书籍不存在' })
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Accept-Ranges', 'bytes')
  res.sendFile(book.full, { dotfiles: 'allow' }, (err) => {
    if (err && !res.headersSent) res.status(500).end()
  })
})

app.get('/api/books/:id/cover', (req, res) => {
  const file = findCoverFile(req.params.id)
  if (!file) return res.status(404).end()
  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.sendFile(file)
})

/** 前端渲染 PDF 首页后回传封面 */
app.post('/api/books/:id/cover', (req, res) => {
  const { dataUrl } = req.body || {}
  if (!dataUrl || typeof dataUrl !== 'string') return res.status(400).json({ error: '缺少 dataUrl' })
  const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/)
  if (!m) return res.status(400).json({ error: 'dataUrl 格式不正确' })
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1]
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length > 8 * 1024 * 1024) return res.status(413).json({ error: '图片过大' })
  const target = coverPathFor(req.params.id, ext)
  // 清掉其它扩展名的旧封面
  for (const other of ['jpg', 'png', 'webp']) {
    const p = coverPathFor(req.params.id, other)
    if (p !== target && fs.existsSync(p)) {
      try {
        fs.unlinkSync(p)
      } catch {
        /* ignore */
      }
    }
  }
  fs.writeFileSync(target, buf)
  res.json({ ok: true, url: `/api/books/${req.params.id}/cover?t=${Date.now()}` })
})

/* ------------------------------ 阅读进度 ------------------------------ */

app.get('/api/books/:id/progress', (req, res) => {
  res.json(getProgress(req.params.id) || null)
})

app.put('/api/books/:id/progress', (req, res) => {
  const saved = setProgress(req.params.id, req.body || {})
  res.json(saved)
})

app.delete('/api/books/:id/progress', (req, res) => {
  removeProgress(req.params.id)
  res.json({ ok: true })
})

/* ------------------------------ 批注 / 划线 ------------------------------ */

app.get('/api/books/:id/annotations', (req, res) => {
  res.json(getAnnotations(req.params.id))
})

app.post('/api/books/:id/annotations', (req, res) => {
  const item = addAnnotation(req.params.id, req.body || {})
  res.json(item)
})

app.patch('/api/books/:id/annotations/:aid', (req, res) => {
  const item = updateAnnotation(req.params.id, req.params.aid, req.body || {})
  if (!item) return res.status(404).json({ error: '批注不存在' })
  res.json(item)
})

app.delete('/api/books/:id/annotations/:aid', (req, res) => {
  const ok = deleteAnnotation(req.params.id, req.params.aid)
  if (!ok) return res.status(404).json({ error: '批注不存在' })
  res.json({ ok: true })
})

app.delete('/api/books/:id/annotations', (req, res) => {
  clearAnnotations(req.params.id)
  res.json({ ok: true })
})
/* ------------------------------ PDF 字体与 CMap 静态资源 ------------------------------ */

const cmapsDir = path.join(ROOT, 'node_modules/pdfjs-dist/cmaps')
if (fs.existsSync(cmapsDir)) {
  app.use('/api/cmaps', express.static(cmapsDir))
}

const standardFontsDir = path.join(ROOT, 'node_modules/pdfjs-dist/standard_fonts')
if (fs.existsSync(standardFontsDir)) {
  app.use('/api/standard_fonts', express.static(standardFontsDir))
}

/* ------------------------------ 目录浏览（用于设置面板选目录） ------------------------------ */

app.get('/api/fs/list', (req, res) => {
  const raw = req.query.dir
  const dir = raw
    ? path.resolve(String(raw).replace(/^~(?=$|\/)/, process.env.HOME || '~'))
    : process.env.HOME || '/'
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name))
    res.json({ dir, parent: path.dirname(dir), dirs })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

/* ------------------------------ 静态资源（生产） ------------------------------ */

const distDir = path.join(ROOT, 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

/* ------------------------------ 辅助 ------------------------------ */

let bookIndex = new Map() // id -> { full, rel, mtime }

function rebuildIndex() {
  const { libraryDir } = getConfig()
  const next = new Map()
  if (fs.existsSync(libraryDir)) {
    for (const f of walk(libraryDir)) {
      next.set(bookId(f.rel), { full: f.full, rel: f.rel, format: f.ext.slice(1) })
    }
  }
  bookIndex = next
}

function locateBook(id) {
  const hit = bookIndex.get(id)
  if (hit && fs.existsSync(hit.full)) return hit
  rebuildIndex()
  return bookIndex.get(id) || null
}

rebuildIndex()

app.listen(PORT, '127.0.0.1', async () => {
  const cfg = getConfig()
  console.log(`\n  📚 电子书阅读平台服务已启动`)
  console.log(`  ├─ API      http://127.0.0.1:${PORT}/api`)
  console.log(`  ├─ 书库目录  ${cfg.libraryDir}${fs.existsSync(cfg.libraryDir) ? '' : '  (不存在，请在页面中设置)'}`)
  console.log(`  └─ 前端     开发模式请另开终端执行 npm run web (http://localhost:5173)\n`)
  if (fs.existsSync(cfg.libraryDir)) runScan()
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    flush()
    process.exit(0)
  })
}
