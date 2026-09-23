/**
 * 静态部署构建脚本：
 * 扫描 library/ 目录，生成 books.json，并将电子书与封面复制到 dist/，供 GitHub Pages 静态托管
 * 运行方式：node scripts/build-static.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { walk, bookId } from '../server/lib/scanner.js'
import { extractEpubMeta, extractPdfMeta } from '../server/lib/metadata.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LIB_DIR = path.join(ROOT, 'library')
const DIST_DIR = path.join(ROOT, 'dist')
const DIST_LIB = path.join(DIST_DIR, 'library')
const DIST_COVERS = path.join(DIST_DIR, 'covers')
const DATA_COVERS = path.join(ROOT, 'data', 'covers')
const META_CACHE_FILE = path.join(ROOT, 'data', 'meta.json')

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function cleanTitle(name) {
  return name
    .replace(/\.(pdf|epub)$/i, '')
    .replace(/[_\s]*\((z-lib\.org|z-lib|libgen|1lib|annas-archive)\)/gi, '')
    .replace(/\s*[-_]\s*(z-lib\.org|libgen)\s*$/i, '')
    .replace(/[_]+/g, ' ')
    .trim()
}

function determineCategory(file, meta) {
  // 1. 本地目录分类
  const relDir = path.dirname(file.rel)
  if (relDir && relDir !== '.' && relDir !== '/') {
    const topDir = relDir.split(/[\\/]/)[0]
    if (topDir && topDir !== 'library') return topDir
  }
  // 2. 内嵌元数据
  if (meta.subject && typeof meta.subject === 'string' && meta.subject.trim()) {
    return meta.subject.trim()
  }
  // 3. 智能推断
  const text = `${meta.title || ''} ${file.rel || ''} ${meta.description || ''}`.toLowerCase()
  if (/金钱|财富|理财|投资|经济|金融|股票|商业|心理学/.test(text)) return '理财'
  if (/计算机|代码|编程|算法|系统|技术|架构|开发|数据|clean code/.test(text)) return '技术'
  if (/文学|小说|海明威|老人生|名著|诗歌|散文|传记/.test(text)) return '文学'
  return '其他'
}

function copyDirRecursive(src, dest) {
  ensureDir(dest)
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

async function buildStatic() {
  console.log('📦 开始构建 GitHub Pages 静态数据产物...')
  ensureDir(DIST_DIR)
  ensureDir(DIST_LIB)
  ensureDir(DIST_COVERS)

  if (!fs.existsSync(LIB_DIR)) {
    console.warn('⚠️  未找到 library 目录，将跳过书籍打包')
    return
  }

  // 1. 清空并准备 dist/library（使用短文件名 id.ext，避免超长/特殊字符路径 404）
  console.log('  ├─ 正在复制电子书文件到 dist/library...')
  fs.rmSync(DIST_LIB, { recursive: true, force: true })
  ensureDir(DIST_LIB)

  // 2. 复制已有封面到 dist/covers
  if (fs.existsSync(DATA_COVERS)) {
    console.log('  ├─ 正在复制封面文件到 dist/covers...')
    for (const f of fs.readdirSync(DATA_COVERS)) {
      if (!f.startsWith('.')) {
        fs.copyFileSync(path.join(DATA_COVERS, f), path.join(DIST_COVERS, f))
      }
    }
  }

  // 3. 扫描并解析书籍元数据
  console.log('  ├─ 正在扫描书籍元数据与分类...')
  let cache = {}
  try {
    if (fs.existsSync(META_CACHE_FILE)) {
      cache = JSON.parse(fs.readFileSync(META_CACHE_FILE, 'utf8'))
    }
  } catch {
    cache = {}
  }

  const files = walk(LIB_DIR)
  const books = []

  for (const file of files) {
    const id = bookId(file.rel)
    const baseName = path.basename(file.full)
    const fallbackTitle = cleanTitle(baseName)
    let stat = { size: 0, mtimeMs: 0 }
    try {
      stat = fs.statSync(file.full)
    } catch {
      /* ignore */
    }

    let meta = {
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

    if (cache[id]?.meta) {
      Object.assign(meta, cache[id].meta)
    } else {
      try {
        if (file.ext === '.epub') {
          const epub = extractEpubMeta(file.full)
          meta.title = epub.title || fallbackTitle
          meta.author = epub.author || ''
          meta.description = (epub.description || '').slice(0, 500)
          meta.pageCount = epub.pageCount || 0
          meta.language = epub.language || ''
          meta.subject = epub.subject || ''
          if (epub.coverBuffer) {
            const ext = epub.coverExt === 'jpeg' ? 'jpg' : epub.coverExt || 'jpg'
            fs.writeFileSync(path.join(DIST_COVERS, `${id}.${ext}`), epub.coverBuffer)
          }
        } else if (file.ext === '.pdf') {
          const pdf = await extractPdfMeta(file.full)
          meta.title = pdf.title || fallbackTitle
          meta.author = pdf.author || ''
          meta.description = (pdf.description || '').slice(0, 500)
          meta.pageCount = pdf.pageCount || 0
          meta.pubdate = pdf.pubdate || ''
          meta.subject = pdf.subject || ''
        }
      } catch (err) {
        console.warn(`[scan] 解析失败 ${file.rel}：`, err.message)
      }
    }

    if (!meta.title) meta.title = fallbackTitle
    meta.category = determineCategory(file, meta)
    meta.shelf = meta.category

    // 检查是否有封面
    const hasCover =
      fs.existsSync(path.join(DIST_COVERS, `${id}.jpg`)) ||
      fs.existsSync(path.join(DIST_COVERS, `${id}.png`)) ||
      fs.existsSync(path.join(DIST_COVERS, `${id}.webp`))

    // 静态托管使用短路径，规避 GitHub Pages 对超长中文文件名的兼容问题
    const staticRel = `${id}${file.ext}`
    try {
      fs.copyFileSync(file.full, path.join(DIST_LIB, staticRel))
    } catch (err) {
      console.warn(`[copy] 复制失败 ${file.rel}:`, err.message)
    }

    books.push({
      id,
      relPath: staticRel,
      fileName: baseName,
      format: file.ext === '.pdf' ? 'pdf' : 'epub',
      size: stat.size,
      mtime: stat.mtimeMs,
      hasCover,
      coverUrl: hasCover ? `./covers/${id}.jpg` : null,
      ...meta,
      progress: {
        percent: 0,
        page: 1,
        totalPages: meta.pageCount || 0,
        finished: false,
        updatedAt: null
      }
    })
  }

  // 按分类与书名排序
  books.sort((a, b) => (a.title || a.fileName).localeCompare(b.title || b.fileName, 'zh-Hans-CN'))

  const manifest = {
    libraryDir: 'library',
    scannedAt: Date.now(),
    books,
    stats: {
      total: books.length,
      reading: 0,
      finished: 0,
      unread: books.length
    }
  }

  const manifestPath = path.join(DIST_DIR, 'books.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

  // 同时也输出一份到 web/public/books.json 方便本地不依赖后端时使用
  const publicDir = path.join(ROOT, 'web', 'public')
  ensureDir(publicDir)
  fs.writeFileSync(path.join(publicDir, 'books.json'), JSON.stringify(manifest, null, 2), 'utf8')

  console.log(`  └─ 生成 books.json 成功 (共 ${books.length} 本书)`)
  console.log('✅ GitHub Pages 静态产物打包完成！')
}

buildStatic().catch((err) => {
  console.error('构建失败：', err)
  process.exit(1)
})
