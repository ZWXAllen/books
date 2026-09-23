import { defineStore } from 'pinia'
import { api } from '../api.js'

export const useLibraryStore = defineStore('library', {
  state: () => ({
    libraryDir: '',
    exists: true,
    books: [],
    stats: { total: 0, reading: 0, finished: 0, unread: 0 },
    loading: false,
    scanning: false,
    scanState: { done: 0, total: 0, current: '' },
    coverJob: null,
    error: '',
    keyword: '',
    category: 'all',
    sort: 'recent',
    view: 'grid',
    loaded: false
  }),

  getters: {
    categories(state) {
      const counts = { all: state.books.length }
      for (const b of state.books) {
        const cat = b.category || b.shelf || '未分类'
        counts[cat] = (counts[cat] || 0) + 1
      }
      const list = [{ key: 'all', label: '全部', count: counts.all }]
      for (const [k, v] of Object.entries(counts)) {
        if (k !== 'all') list.push({ key: k, label: k, count: v })
      }
      return list
    },

    filtered(state) {
      let list = state.books
      if (state.category && state.category !== 'all') {
        list = list.filter((b) => (b.category || b.shelf || '未分类') === state.category)
      }
      const kw = state.keyword.trim().toLowerCase()
      if (kw) {
        list = list.filter((b) =>
          [b.title, b.author, b.fileName, b.shelf, b.category].filter(Boolean).some((v) =>
            String(v).toLowerCase().includes(kw)
          )
        )
      }
      const arr = [...list]
      switch (state.sort) {
        case 'title':
          arr.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh-Hans-CN'))
          break
        case 'author':
          arr.sort((a, b) => (a.author || '~').localeCompare(b.author || '~', 'zh-Hans-CN'))
          break
        case 'progress':
          arr.sort((a, b) => (b.progress?.percent || 0) - (a.progress?.percent || 0))
          break
        case 'recent':
        default:
          arr.sort((a, b) => (b.progress?.updatedAt || 0) - (a.progress?.updatedAt || 0))
          break
      }
      return arr
    }
  },

  actions: {
    async load({ silent = false } = {}) {
      if (!silent) this.loading = true
      this.error = ''
      try {
        const data = await api.listBooks()
        this.libraryDir = data.libraryDir
        this.exists = data.exists
        this.books = data.books
        this.stats = data.stats
        this.loaded = true
      } catch (err) {
        this.error = err.message
      } finally {
        this.loading = false
      }
    },
    setCategory(cat) {
      this.category = cat
    },


    async scan() {
      this.scanning = true
      this.scanState = { done: 0, total: 0, current: '' }
      try {
        await api.scan()
        // 轮询进度直到结束
        for (;;) {
          await new Promise((r) => setTimeout(r, 500))
          const st = await api.scanProgress()
          this.scanState = { done: st.done, total: st.total, current: st.current }
          if (!st.running) {
            if (st.error) this.error = st.error
            break
          }
        }
        await this.load({ silent: true })
        this.generateMissingCovers()
      } catch (err) {
        this.error = err.message
      } finally {
        this.scanning = false
      }
    },

    async changeDir(dir) {
      const cfg = await api.setConfig(dir)
      this.libraryDir = cfg.libraryDir
      this.exists = true
      await this.scan()
    },

    patchBookProgress(id, progress) {
      const book = this.books.find((b) => b.id === id)
      if (!book) return
      book.progress = { ...book.progress, ...progress }
      this.stats = this.computeStats()
    },

    /**
     * PDF 的封面由浏览器用 pdfjs 渲染首页后回传服务端缓存。
     * 只在首次扫描后执行一次，后续从磁盘缓存读取。
     */
    async generateMissingCovers() {
      if (this.coverJob) return
      const targets = this.books.filter((b) => b.format === 'pdf' && !b.hasCover)
      if (!targets.length) return

      this.coverJob = { total: targets.length, done: 0, current: '', cancelled: false }
      let pdfjsLib
      let getDocumentParams
      try {
        const mod = await import('../lib/pdf.js')
        pdfjsLib = mod.pdfjsLib
        getDocumentParams = mod.getDocumentParams
      } catch (err) {
        console.warn('[cover] pdfjs 加载失败', err)
        this.coverJob = null
        return
      }
      for (const b of targets) {
        if (this.coverJob.cancelled) break
        this.coverJob.current = b.title
        try {
          const doc = await pdfjsLib.getDocument(getDocumentParams(api.fileUrl(b.id, b.fileName))).promise
          const page = await doc.getPage(1)
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: 420 / base.width })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          const ctx = canvas.getContext('2d')
          ctx.fillStyle = '#fff'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          await page.render({ canvasContext: ctx, viewport }).promise
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
          const res = await api.uploadCover(b.id, dataUrl)
          b.coverUrl = res.url
          b.hasCover = true
          await doc.destroy()
        } catch (err) {
          console.warn('[cover] 生成失败：', b.title, err.message)
        }
        this.coverJob.done += 1
      }
      this.coverJob = null
    },

    cancelCoverJob() {
      if (this.coverJob) this.coverJob.cancelled = true
    },

    computeStats() {
      const s = { total: this.books.length, reading: 0, finished: 0, unread: 0 }
      for (const b of this.books) {
        const p = b.progress?.percent || 0
        if (p >= 99.5) s.finished += 1
        else if (p > 0) s.reading += 1
        else s.unread += 1
      }
      return s
    }
  }
})
