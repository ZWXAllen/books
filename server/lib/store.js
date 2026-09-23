import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const DATA_DIR = path.join(ROOT, 'data')
export const COVER_DIR = path.join(DATA_DIR, 'covers')

for (const dir of [DATA_DIR, COVER_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

const FILES = {
  config: path.join(DATA_DIR, 'config.json'),
  progress: path.join(DATA_DIR, 'progress.json'),
  annotations: path.join(DATA_DIR, 'annotations.json'),
  meta: path.join(DATA_DIR, 'meta.json')
}

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback
    const raw = fs.readFileSync(file, 'utf8')
    if (!raw.trim()) return fallback
    return JSON.parse(raw)
  } catch (err) {
    console.warn(`[store] 读取 ${path.basename(file)} 失败，使用默认值：`, err.message)
    return fallback
  }
}

let writeTimer = null
const dirty = new Set()

/** 合并写盘，避免高频写（阅读进度每秒都会变） */
function scheduleWrite(key) {
  dirty.add(key)
  if (writeTimer) return
  writeTimer = setTimeout(() => {
    writeTimer = null
    for (const k of dirty) {
      try {
        fs.writeFileSync(FILES[k], JSON.stringify(cache[k], null, 2), 'utf8')
      } catch (err) {
        console.error(`[store] 写入 ${k} 失败：`, err.message)
      }
    }
    dirty.clear()
  }, 300)
}

const cache = {
  config: readJSON(FILES.config, {}),
  progress: readJSON(FILES.progress, {}),
  annotations: readJSON(FILES.annotations, {}),
  meta: readJSON(FILES.meta, {})
}

/* ------------------------------- 配置 ------------------------------- */

export const DEFAULT_LIBRARY_DIR = process.env.BOOKS_DIR
  ? path.resolve(process.env.BOOKS_DIR)
  : path.join(ROOT, 'library')

export function getConfig() {
  const cfg = cache.config
  if (!cfg.libraryDir) cfg.libraryDir = DEFAULT_LIBRARY_DIR
  return {
    libraryDir: cfg.libraryDir,
    theme: cfg.theme || 'light',
    fontSize: cfg.fontSize || 100
  }
}

export function setConfig(patch) {
  cache.config = { ...cache.config, ...patch }
  scheduleWrite('config')
  return getConfig()
}

/* ------------------------------- 阅读进度 ------------------------------- */

export function getProgress(bookId) {
  return cache.progress[bookId] || null
}

export function getAllProgress() {
  return cache.progress
}

export function setProgress(bookId, patch) {
  const prev = cache.progress[bookId] || {}
  cache.progress[bookId] = {
    ...prev,
    ...patch,
    percent: clampPercent(patch.percent ?? prev.percent ?? 0),
    updatedAt: Date.now()
  }
  scheduleWrite('progress')
  return cache.progress[bookId]
}

export function removeProgress(bookId) {
  delete cache.progress[bookId]
  scheduleWrite('progress')
}

function clampPercent(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10))
}

/* ------------------------------- 批注 / 划线 ------------------------------- */

export function getAnnotations(bookId) {
  return cache.annotations[bookId] || []
}

export function addAnnotation(bookId, data) {
  const list = cache.annotations[bookId] || (cache.annotations[bookId] = [])
  const now = Date.now()
  const item = {
    id: `an_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    color: 'yellow',
    note: '',
    createdAt: now,
    updatedAt: now,
    ...data
  }
  list.push(item)
  scheduleWrite('annotations')
  return item
}

export function updateAnnotation(bookId, id, patch) {
  const list = cache.annotations[bookId] || []
  const idx = list.findIndex((a) => a.id === id)
  if (idx === -1) return null
  list[idx] = { ...list[idx], ...patch, id, updatedAt: Date.now() }
  scheduleWrite('annotations')
  return list[idx]
}

export function deleteAnnotation(bookId, id) {
  const list = cache.annotations[bookId] || []
  const idx = list.findIndex((a) => a.id === id)
  if (idx === -1) return false
  list.splice(idx, 1)
  scheduleWrite('annotations')
  return true
}

export function clearAnnotations(bookId) {
  cache.annotations[bookId] = []
  scheduleWrite('annotations')
}

/* ------------------------------- 元数据缓存 ------------------------------- */

export function getMetaCache() {
  return cache.meta
}

export function setMetaCache(next) {
  cache.meta = next
  scheduleWrite('meta')
}

/* ------------------------------- 清理 ------------------------------- */

export function flush() {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  for (const k of Object.keys(FILES)) {
    try {
      fs.writeFileSync(FILES[k], JSON.stringify(cache[k], null, 2), 'utf8')
    } catch {
      /* ignore */
    }
  }
  dirty.clear()
}
