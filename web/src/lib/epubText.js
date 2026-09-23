/**
 * 从 EPUB 提取纯文本并分页，供伪装模式使用。
 */
import ePub from 'epubjs'

function normalizeText(raw) {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

/**
 * @param {string} fileUrl
 * @param {{ charsPerPage?: number }} [opts]
 */
export async function extractEpubTextPages(fileUrl, opts = {}) {
  const charsPerPage = opts.charsPerPage || 1100
  const book = ePub(fileUrl, { openAs: 'epub', replacements: 'blobUrl' })
  await book.ready

  let title = ''
  let author = ''
  try {
    const meta = await book.loaded.metadata
    title = meta?.title || ''
    author = meta?.creator || meta?.author || ''
  } catch {
    /* ignore */
  }

  const chapterBlocks = []
  const spineLen = book.spine?.length || 0

  for (let idx = 0; idx < spineLen; idx++) {
    const section = book.spine.get(idx)
    if (!section) continue
    try {
      const doc = await section.load(book.load.bind(book))
      const body = doc?.body || doc?.documentElement
      const text = normalizeText(body?.innerText || body?.textContent || '')
      section.unload?.()
      if (text && text.length > 20) {
        chapterBlocks.push({ index: idx, text })
      }
    } catch (err) {
      console.warn('[epubText] section load failed', idx, err)
    }
  }

  const tocLabels = []
  try {
    const nav = await book.loaded.navigation
    const walk = (items) => {
      for (const it of items || []) {
        if (it.label) tocLabels.push(it.label.trim())
        if (it.subitems?.length) walk(it.subitems)
      }
    }
    walk(nav?.toc)
  } catch {
    /* ignore */
  }

  const pages = []
  const chapters = []
  let labelIdx = 0

  for (const block of chapterBlocks) {
    const startPage = pages.length
    const label = tocLabels[labelIdx] || `Section ${block.index + 1}`
    labelIdx++
    const parts = splitToPages(block.text, charsPerPage)
    if (parts.length) {
      chapters.push({ label, startPage })
      pages.push(...parts)
    }
  }

  try {
    book.destroy?.()
  } catch {
    /* ignore */
  }

  return { title, author, pages, chapters }
}
