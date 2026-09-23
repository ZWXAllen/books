import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { extractEpubMeta, extractPdfMeta } from './metadata.js'
import { COVER_DIR, getMetaCache, setMetaCache } from './store.js'

export const SUPPORTED = new Set(['.pdf', '.epub'])

function bookId(relPath) {
  return crypto.createHash('sha1').update(relPath).digest('hex').slice(0, 12)
}

/** 递归收集目录下所有 pdf / epub */
export function walk(dir, baseDir = dir, acc = []) {
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, baseDir, acc)
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (SUPPORTED.has(ext)) acc.push({ full, rel: path.relative(baseDir, full), ext })
    }
  }
  return acc
}

function coverPathFor(id, ext = 'jpg') {
  return path.join(COVER_DIR, `${id}.${ext}`)
}

function findCoverFile(id) {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg']) {
    const p = coverPathFor(id, ext)
    if (fs.existsSync(p)) return p
  }
  return null
}

function cleanTitleFromFile(name) {
  return name
    .replace(/\.(pdf|epub)$/i, '')
    .replace(/[_\s]*\((z-lib\.org|z-lib|libgen|1lib|annas-archive)\)/gi, '')
    .replace(/\s*[-_]\s*(z-lib\.org|libgen)\s*$/i, '')
    .replace(/[_]+/g, ' ')
    .trim()
}

/**
 * 扫描书库，返回书目数组。带元数据缓存：文件 mtime+size 不变则复用。
 */
export async function scanLibrary(libraryDir, { onProgress } = {}) {
  const result = {
    libraryDir,
    exists: fs.existsSync(libraryDir),
    books: [],
    scannedAt: Date.now()
  }
  if (!result.exists) return result

  const files = walk(libraryDir)
  const cache = getMetaCache()
  const nextCache = {}
  let done = 0

  for (const file of files) {
    let stat
    try {
      stat = fs.statSync(file.full)
    } catch {
      continue
    }
    const id = bookId(file.rel)
    const stamp = `${stat.size}-${Math.round(stat.mtimeMs)}`
    const cached = cache[id]

    const book = {
      id,
      relPath: file.rel,
      fileName: path.basename(file.full),
      format: file.ext === '.pdf' ? 'pdf' : 'epub',
      size: stat.size,
      mtime: stat.mtimeMs,
      hasCover: !!findCoverFile(id)
    }

    if (cached && cached.stamp === stamp) {
      Object.assign(book, cached.meta)
      if (!book.category) {
        book.category = determineCategory(file, book, libraryDir)
        book.shelf = book.category
      }
      book.hasCover = !!findCoverFile(id)
    } else {
      let meta
      try {
        meta = await extractOne(file, id, libraryDir)
      } catch (err) {
        console.warn(`[scan] 解析失败 ${file.rel}：${err.message}`)
        meta = { title: cleanTitleFromFile(book.fileName), author: '', description: '', pageCount: 0 }
      }
      if (!meta.title) meta.title = cleanTitleFromFile(book.fileName)
      Object.assign(book, meta)
      nextCache[id] = {
        stamp,
        meta: {
          title: meta.title,
          author: meta.author,
          description: meta.description,
          pageCount: meta.pageCount,
          pubdate: meta.pubdate,
          language: meta.language,
          subject: meta.subject || '',
          category: meta.category,
          shelf: meta.shelf
        }
      }
      book.hasCover = !!findCoverFile(id)
    }

    result.books.push(book)
    done += 1
    onProgress?.({ done, total: files.length, current: book.fileName })
  }

  // 保留已失效条目的缓存没有意义，直接以本次结果为准
  setMetaCache(nextCache)

  result.books.sort((a, b) =>
    (a.title || a.fileName).localeCompare(b.title || b.fileName, 'zh-Hans-CN')
  )
  return result
}

async function extractOne(file, id, libraryDir) {
  const baseName = path.basename(file.full)
  const fallbackTitle = cleanTitleFromFile(baseName)
  const fallbackDir = path.basename(path.dirname(file.full))
  const meta = {
    title: fallbackTitle,
    author: '',
    description: '',
    subject: '',
    pageCount: 0,
    pubdate: '',
    language: '',
    category: '',
    shelf: ''
  }
  try {
    if (file.ext === '.epub') {
      const epub = extractEpubMeta(file.full)
      meta.title = epub.title || fallbackTitle
      meta.author = epub.author || ''
      meta.description = (epub.description || '').slice(0, 500)
      meta.pageCount = epub.pageCount
      meta.language = epub.language || ''
      meta.subject = epub.subject || ''
      if (epub.coverBuffer) {
        const ext = epub.coverExt === 'jpeg' ? 'jpg' : epub.coverExt || 'jpg'
        fs.writeFileSync(coverPathFor(id, ext), epub.coverBuffer)
      }
    } else {
      const pdf = await extractPdfMeta(file.full)
      meta.title = pdf.title || fallbackTitle
      meta.author = pdf.author || ''
      meta.description = (pdf.description || '').slice(0, 500)
      meta.pageCount = pdf.pageCount
      meta.pubdate = pdf.pubdate
      meta.subject = pdf.subject || ''
      // PDF 封面由前端用 pdfjs 渲染首页后回传（见 /api/books/:id/cover）
    }
  } catch (err) {
    console.warn(`[scan] 解析失败 ${file.rel}：${err.message}`)
  }
  meta.category = determineCategory(file, meta, libraryDir)
  meta.shelf = meta.category
  return meta
}

function determineCategory(file, meta, libraryDir) {
  // 1. 本地目录分类：若存放在一级或多级子目录下，以相对子目录名作为分类
  const relDir = path.dirname(file.rel)
  if (relDir && relDir !== '.' && relDir !== '/') {
    const topDir = relDir.split(/[\\/]/)[0]
    if (topDir && topDir !== path.basename(libraryDir)) {
      return topDir
    }
  }

  // 2. 书籍自带元数据分类（如 EPUB 的 dc:subject 或 PDF 的 Subject）
  if (meta.subject && typeof meta.subject === 'string' && meta.subject.trim()) {
    return meta.subject.trim()
  }

  // 3. 根目录无元数据时的智能主题识别
  const text = `${meta.title || ''} ${file.rel || ''} ${meta.description || ''}`.toLowerCase()
  if (/金钱|财富|理财|投资|经济|金融|股票|商业|心理学/.test(text)) return '理财'
  if (/计算机|代码|编程|算法|系统|技术|架构|开发|数据|clean code/.test(text)) return '技术'
  if (/文学|小说|海明威|老人生|名著|诗歌|散文|传记/.test(text)) return '文学'

  return '其他'
}

export { bookId, findCoverFile, coverPathFor }
