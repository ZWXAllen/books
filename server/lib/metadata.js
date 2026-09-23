import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'

/* =========================================================================
 *  EPUB 元数据 + 封面
 * ========================================================================= */

function firstTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const m = xml.match(re)
  return m ? decodeEntities(m[1].replace(/<[^>]+>/g, '').trim()) : ''
}

function decodeEntities(s = '') {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim()
}

export function extractEpubMeta(filePath) {
  const out = { title: '', author: '', description: '', subject: '', coverBuffer: null, coverExt: null, pageCount: 0 }
  const zip = new AdmZip(filePath)
  const entries = zip.getEntries()

  // 1. container.xml -> opf 路径
  const container = zip.getEntry('META-INF/container.xml')
  let opfPath = ''
  if (container) {
    const xml = container.getData().toString('utf8')
    const m = xml.match(/full-path="([^"]+)"/i)
    if (m) opfPath = decodeURIComponent(m[1])
  }
  if (!opfPath) {
    const guess = entries.find((e) => e.entryName.toLowerCase().endsWith('.opf'))
    if (guess) opfPath = guess.entryName
  }
  if (!opfPath) throw new Error('未找到 OPF 文件')

  const opfEntry = zip.getEntry(opfPath)
  if (!opfEntry) throw new Error('OPF 文件不存在')
  const opf = opfEntry.getData().toString('utf8')
  const opfDir = path.posix.dirname(opfPath)

  out.title = firstTag(opf, 'dc:title') || firstTag(opf, 'title')
  out.author = firstTag(opf, 'dc:creator') || firstTag(opf, 'creator')
  out.description = firstTag(opf, 'dc:description')
  out.language = firstTag(opf, 'dc:language')
  out.subject = firstTag(opf, 'dc:subject') || firstTag(opf, 'subject') || ''

  // 2. 目录清单：id -> href
  const manifest = {}
  const itemRe = /<item\b[^>]*>/gi
  let m
  while ((m = itemRe.exec(opf))) {
    const tag = m[0]
    const id = (tag.match(/\bid="([^"]+)"/i) || [])[1]
    const href = (tag.match(/\bhref="([^"]+)"/i) || [])[1]
    const props = (tag.match(/\bproperties="([^"]+)"/i) || [])[1] || ''
    const type = (tag.match(/\bmedia-type="([^"]+)"/i) || [])[1] || ''
    if (id && href) manifest[id] = { href, props, type }
  }

  // 3. 找封面
  let coverHref = ''
  const metaCover = opf.match(/<meta\b[^>]*name="cover"[^>]*content="([^"]+)"/i)
  if (metaCover && manifest[metaCover[1]]) coverHref = manifest[metaCover[1]].href
  if (!coverHref) {
    const propCover = Object.values(manifest).find((it) => it.props.includes('cover-image'))
    if (propCover) coverHref = propCover.href
  }
  if (!coverHref) {
    const byName = Object.values(manifest).find(
      (it) => it.type.startsWith('image/') && /cover/i.test(it.href)
    )
    if (byName) coverHref = byName.href
  }

  if (coverHref) {
    const full = opfDir === '.' ? coverHref : path.posix.join(opfDir, coverHref)
    const entry =
      zip.getEntry(full) ||
      zip.getEntry(decodeURIComponent(full)) ||
      entries.find((e) => e.entryName.toLowerCase() === full.toLowerCase())
    if (entry) {
      out.coverBuffer = entry.getData()
      out.coverExt = path.extname(entry.entryName).slice(1).toLowerCase() || 'jpg'
    }
  }

  // 4. 粗略页数：spine 项数
  const spineCount = (opf.match(/<itemref\b/gi) || []).length
  out.pageCount = spineCount

  return out
}

/* =========================================================================
 *  PDF 元数据（用 pdfjs 解析 Info 字典，不需要 canvas）
 * ========================================================================= */

let pdfjsPromise = null
async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const lib = await import('pdfjs-dist/legacy/build/pdf.mjs')
      return lib
    })()
  }
  return pdfjsPromise
}

function normalizePdfDate(str) {
  if (!str) return ''
  const m = String(str).match(/D:(\d{4})(\d{2})?(\d{2})?/)
  if (!m) return ''
  return `${m[1]}-${m[2] || '01'}-${m[3] || '01'}`
}

export async function extractPdfMeta(filePath) {
  const out = { title: '', author: '', description: '', subject: '', pageCount: 0, pubdate: '' }
  const pdfjs = await getPdfjs()
  const data = new Uint8Array(fs.readFileSync(filePath))
  const doc = await pdfjs.getDocument({
    data,
    verbosity: 0,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true
  }).promise

  out.pageCount = doc.numPages
  try {
    const meta = await doc.getMetadata()
    const info = meta?.info || {}
    const md = meta?.metadata
    const get = (key) => {
      const v = info[key]
      if (v == null) return ''
      return String(v).trim()
    }
    out.title = get('Title')
    out.author = get('Author')
    out.subject = get('Subject')
    out.description = get('Subject') || get('Keywords')
    out.pubdate = normalizePdfDate(get('CreationDate'))
    if (md && typeof md.get === 'function') {
      out.title = out.title || (md.get('dc:title') || '').trim()
      out.author = out.author || (md.get('dc:creator') || '').trim()
    }
  } catch {
    /* 元数据解析失败不影响主流程 */
  }
  try {
    await doc.destroy()
  } catch {
    /* ignore */
  }
  return out
}
