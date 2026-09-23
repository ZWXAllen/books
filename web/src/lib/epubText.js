/**
 * 从 EPUB 提取纯文本并分页，供伪装模式使用。
 *
 * 重要：不要依赖 epubjs 的 section.load() + innerText。
 * 阅读器里能复制，是因为章节已经被渲染进 iframe，浏览器做过布局；
 * 未挂载到页面的 Document 上，innerText 常常是空字符串。
 * 更稳妥的方式：把 EPUB 当 zip，按 OPF spine 顺序读取 HTML 再去标签。
 */
import JSZip from 'jszip'

function normalizeText(raw) {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n)
      return Number.isFinite(code) ? String.fromCharCode(code) : _
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const code = parseInt(n, 16)
      return Number.isFinite(code) ? String.fromCharCode(code) : _
    })
}

function stripHtml(html) {
  return normalizeText(
    decodeEntities(
      String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
        .replace(/<(br|BR)\s*\/?>/g, '\n')
        .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|tr|section|article)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
    )
  )
}

function splitToPages(fullText, charsPerPage) {
  const pages = []
  const text = fullText.trim()
  if (!text) return pages

  let i = 0
  while (i < text.length) {
    let end = Math.min(i + charsPerPage, text.length)
    if (end < text.length) {
      const window = text.slice(i, end + 80)
      const breakAt = Math.max(
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('。'),
        window.lastIndexOf('！'),
        window.lastIndexOf('？'),
        window.lastIndexOf('\n'),
        window.lastIndexOf(' ')
      )
      if (breakAt > charsPerPage * 0.45) {
        end = i + breakAt + 1
      }
    }
    const chunk = text.slice(i, end).trim()
    if (chunk) pages.push(chunk)
    i = end
  }
  return pages
}

function dirname(path) {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(0, i) : ''
}

function resolvePath(baseDir, rel) {
  const cleaned = String(rel || '').split('#')[0].trim()
  if (!cleaned) return ''
  if (/^[a-z]+:/i.test(cleaned)) return cleaned
  const stack = (baseDir ? baseDir.split('/') : []).filter(Boolean)
  for (const part of cleaned.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

function pickZipFile(zip, path) {
  if (!path) return null
  if (zip.files[path]) return zip.files[path]
  // 兼容大小写 / 前导路径差异
  const lower = path.toLowerCase()
  const hit = Object.keys(zip.files).find((n) => n.toLowerCase() === lower)
  return hit ? zip.files[hit] : null
}

function attr(tag, name) {
  const re = new RegExp(name + '\\s*=\\s*["\']([^"\']+)["\']', 'i')
  const m = String(tag || '').match(re)
  return m ? m[1] : ''
}

async function readZipText(zip, path) {
  const file = pickZipFile(zip, path)
  if (!file || file.dir) return ''
  return file.async('string')
}

async function getSpineHtmlPaths(zip) {
  const containerXml = await readZipText(zip, 'META-INF/container.xml')
  let opfPath = ''
  const rootMatch = containerXml.match(/full-path\s*=\s*["']([^"']+)["']/i)
  if (rootMatch) opfPath = rootMatch[1]

  if (!opfPath) {
    // 兜底：随便找一个 opf
    opfPath = Object.keys(zip.files).find((n) => /\.opf$/i.test(n) && !zip.files[n].dir) || ''
  }
  if (!opfPath) return []

  const opfXml = await readZipText(zip, opfPath)
  const opfDir = dirname(opfPath)

  // manifest: id -> href
  const manifest = {}
  const itemRe = /<item\b[^>]*>/gi
  let m
  while ((m = itemRe.exec(opfXml))) {
    const tag = m[0]
    const id = attr(tag, 'id')
    const href = attr(tag, 'href')
    if (id && href) manifest[id] = href
  }

  const spine = []
  const itemrefRe = /<itemref\b[^>]*>/gi
  while ((m = itemrefRe.exec(opfXml))) {
    const idref = attr(m[0], 'idref')
    const href = manifest[idref]
    if (!href) continue
    const abs = resolvePath(opfDir, href)
    if (/\.(xhtml|html|htm)$/i.test(abs)) spine.push(abs)
  }

  if (spine.length) return spine

  // 再兜底：所有 html，按文件名排序
  return Object.keys(zip.files)
    .filter((n) => /\.(xhtml|html|htm)$/i.test(n) && !zip.files[n].dir)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

function guessTitleAuthor(zipNames, chapterTexts) {
  // 很轻量的兜底，真正标题仍以书架 meta 为准
  const head = chapterTexts.slice(0, 3).join('\n')
  const title = (head.match(/书名[:：]\s*(.+)/) || [])[1] || ''
  const author = (head.match(/作者[:：]\s*(.+)/) || [])[1] || ''
  return {
    title: normalizeText(title).slice(0, 80),
    author: normalizeText(author).slice(0, 80)
  }
}

/**
 * @param {string} fileUrl
 * @param {{ charsPerPage?: number }} [opts]
 * @returns {Promise<{ title: string, author: string, pages: string[], chapters: {label:string, startPage:number}[] }>}
 */
export async function extractEpubTextPages(fileUrl, opts = {}) {
  const charsPerPage = opts.charsPerPage || 1100

  const res = await fetch(fileUrl)
  if (!res.ok) {
    throw new Error(`无法读取 EPUB 文件 (${res.status})`)
  }
  const buf = await res.arrayBuffer()
  const zip = await JSZip.loadAsync(buf)
  const htmlPaths = await getSpineHtmlPaths(zip)

  const chapterBlocks = []
  for (const path of htmlPaths) {
    try {
      const html = await readZipText(zip, path)
      const text = stripHtml(html)
      // 过滤几乎空白的导航/封面壳页面
      if (text && text.length > 20) {
        chapterBlocks.push({
          path,
          label: path.split('/').pop() || path,
          text
        })
      }
    } catch (err) {
      console.warn('[epubText] read fail', path, err)
    }
  }

  const pages = []
  const chapters = []
  for (const block of chapterBlocks) {
    const startPage = pages.length
    const parts = splitToPages(block.text, charsPerPage)
    if (!parts.length) continue
    chapters.push({ label: block.label, startPage })
    pages.push(...parts)
  }

  const meta = guessTitleAuthor(
    Object.keys(zip.files),
    chapterBlocks.map((c) => c.text)
  )

  return {
    title: meta.title,
    author: meta.author,
    pages,
    chapters
  }
}
