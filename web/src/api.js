const BASE = '/api'
let staticMode = null // null = auto-detect, true = static (GitHub Pages), false = server
let cachedBooks = []

// 本地存储键前缀
const STORAGE_PREFIX = 'ebook_'

function getStored(key, fallback = null) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function setStored(key, value) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value))
  } catch (err) {
    console.warn('[storage] 保存失败', err)
  }
}

function removeStored(key) {
  try {
    localStorage.removeItem(STORAGE_PREFIX + key)
  } catch {
    /* ignore */
  }
}

async function request(url, options = {}) {
  const res = await fetch(BASE + url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  })
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`
    try {
      const data = await res.json()
      if (data?.error) msg = data.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  if (res.status === 204) return null
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export const api = {
  isStatic: () => staticMode === true,

  getConfig: async () => {
    if (staticMode === true) {
      return {
        libraryDir: 'GitHub 仓库 (library/)',
        exists: true,
        static: true
      }
    }
    try {
      const res = await request('/config')
      staticMode = false
      return res
    } catch {
      staticMode = true
      return {
        libraryDir: 'GitHub 仓库 (library/)',
        exists: true,
        static: true
      }
    }
  },

  setConfig: async (libraryDir) => {
    if (staticMode) return { ok: true }
    return request('/config', { method: 'POST', body: { libraryDir } })
  },

  listDir: async (dir) => {
    if (staticMode) return { dir: '/', parent: null, dirs: [] }
    return request(`/fs/list${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`)
  },

  listBooks: async () => {
    // 优先尝试本地后端 API；若在 GitHub Pages 或未起后端，则回退为读取静态 books.json
    if (staticMode !== true) {
      try {
        const res = await request('/books')
        staticMode = false
        cachedBooks = res.books || []
        return res
      } catch {
        staticMode = true
      }
    }

    // 静态模式：加载打包好的 books.json
    const res = await fetch('./books.json?t=' + Date.now())
    if (!res.ok) {
      throw new Error(`无法加载静态书单 books.json (${res.status})`)
    }
    const data = await res.json()
    cachedBooks = data.books || []

    // 将保存在当前浏览器中的个人阅读进度合并到书目中
    const booksWithProgress = cachedBooks.map((b) => {
      const savedProg = getStored('prog_' + b.id, null)
      const customCover = getStored('cover_' + b.id, null)
      return {
        ...b,
        coverUrl: customCover || b.coverUrl || (b.hasCover ? `./covers/${b.id}.jpg` : null),
        progress: savedProg || b.progress || {
          percent: 0,
          page: 1,
          totalPages: b.pageCount || 0,
          finished: false,
          updatedAt: null
        }
      }
    })

    return {
      libraryDir: data.libraryDir || 'library',
      exists: true,
      scannedAt: data.scannedAt || Date.now(),
      books: booksWithProgress,
      stats: data.stats || { total: booksWithProgress.length, reading: 0, finished: 0, unread: booksWithProgress.length }
    }
  },

  scan: async () => {
    if (staticMode) {
      return { ok: true }
    }
    return request('/scan', { method: 'POST' })
  },

  scanProgress: async () => {
    if (staticMode) {
      return { done: 0, total: 0, current: '' }
    }
    return request('/scan/progress')
  },

  uploadCover: async (id, dataUrl) => {
    if (staticMode) {
      setStored('cover_' + id, dataUrl)
      return { ok: true, url: dataUrl }
    }
    try {
      return await request(`/books/${id}/cover`, { method: 'POST', body: { dataUrl } })
    } catch {
      setStored('cover_' + id, dataUrl)
      return { ok: true, url: dataUrl }
    }
  },

  getProgress: async (id) => {
    if (staticMode) {
      return getStored('prog_' + id, null)
    }
    try {
      return await request(`/books/${id}/progress`)
    } catch {
      return getStored('prog_' + id, null)
    }
  },

  saveProgress: async (id, data) => {
    // 始终本地备份一份，换页无延迟
    setStored('prog_' + id, { ...data, updatedAt: Date.now() })
    if (staticMode) return { ok: true }
    try {
      return await request(`/books/${id}/progress`, { method: 'PUT', body: data })
    } catch {
      return { ok: true }
    }
  },

  resetProgress: async (id) => {
    removeStored('prog_' + id)
    if (staticMode) return { ok: true }
    try {
      return await request(`/books/${id}/progress`, { method: 'DELETE' })
    } catch {
      return { ok: true }
    }
  },

  listAnnotations: async (id) => {
    if (staticMode) {
      return getStored('ann_' + id, [])
    }
    try {
      return await request(`/books/${id}/annotations`)
    } catch {
      return getStored('ann_' + id, [])
    }
  },

  createAnnotation: async (id, data) => {
    const item = {
      id: 'ann_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      bookId: id,
      ...data,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    const list = getStored('ann_' + id, [])
    list.push(item)
    setStored('ann_' + id, list)

    if (staticMode) return item
    try {
      return await request(`/books/${id}/annotations`, { method: 'POST', body: data })
    } catch {
      return item
    }
  },

  updateAnnotation: async (id, aid, data) => {
    const list = getStored('ann_' + id, [])
    const hit = list.find((a) => a.id === aid)
    if (hit) {
      Object.assign(hit, data, { updatedAt: Date.now() })
      setStored('ann_' + id, list)
    }
    if (staticMode) return hit || data
    try {
      return await request(`/books/${id}/annotations/${aid}`, { method: 'PATCH', body: data })
    } catch {
      return hit || data
    }
  },

  deleteAnnotation: async (id, aid) => {
    const list = getStored('ann_' + id, [])
    const next = list.filter((a) => a.id !== aid)
    setStored('ann_' + id, next)
    if (staticMode) return { ok: true }
    try {
      return await request(`/books/${id}/annotations/${aid}`, { method: 'DELETE' })
    } catch {
      return { ok: true }
    }
  },

  clearAnnotations: async (id) => {
    removeStored('ann_' + id)
    if (staticMode) return { ok: true }
    try {
      return await request(`/books/${id}/annotations`, { method: 'DELETE' })
    } catch {
      return { ok: true }
    }
  },

  /**
   * 提供书籍原文件地址：
   * - 静态模式（GitHub Pages）：直接返回以 ./library/ 开头的相对路径，浏览器支持 HTTP Range 分片加载；
   * - 本地服务模式：走 /api/books/:id/file/...
   */
  fileUrl: (id, name) => {
    if (staticMode === true) {
      const book = cachedBooks.find((b) => b.id === id)
      if (book?.relPath) {
        // 将相对路径各段安全编码，保留 /
        const encodedRel = book.relPath
          .split('/')
          .map((seg) => encodeURIComponent(seg))
          .join('/')
        return `./library/${encodedRel}`
      }
    }
    return `${BASE}/books/${id}/file/${encodeURIComponent(name || 'book.bin')}`
  }
}
