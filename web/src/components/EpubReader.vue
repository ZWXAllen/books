<template>
  <div class="epub-wrap" :class="[layoutMode]">
    <button class="nav-arrow left" :disabled="atStart" @click="prev" title="上一页 (←)">‹</button>
    <div class="viewer-wrapper">
      <div class="viewer" ref="viewerEl"></div>
      <div v-if="layoutMode === 'spread'" class="book-spine"></div>
    </div>
    <button class="nav-arrow right" :disabled="atEnd" @click="next" title="下一页 (→)">›</button>

    <div v-if="loading" class="epub-loading">
      <div class="spin">⟳</div>
      <p>正在加载 EPUB…</p>
    </div>
    <div v-if="error" class="epub-error">{{ error }}</div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ePub from 'epubjs'
import { colorOf } from '../constants.js'

const props = defineProps({
  bookId: { type: String, required: true },
  fileUrl: { type: String, required: true },
  annotations: { type: Array, default: () => [] },
  activeId: { type: String, default: '' },
  initial: { type: Object, default: null },
  fontSize: { type: Number, default: 100 },
  theme: { type: String, default: 'light' },
  layoutMode: { type: String, default: 'spread' }
})
const emit = defineEmits(['select', 'progress', 'ready', 'open-annotation', 'toc'])

const viewerEl = ref(null)
const loading = ref(true)
const error = ref('')
const atStart = ref(true)
const atEnd = ref(false)

let book = null
let rendition = null
let destroyed = false
let locationsReady = false
const appliedMap = new Map() // id -> { cfi, color }
let hrefLabel = {}

let ro = null
/* ------------------------------ 初始化 ------------------------------ */

onMounted(async () => {
  try {
    book = ePub(props.fileUrl)
    rendition = book.renderTo(viewerEl.value, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      spread: props.layoutMode === 'spread' ? 'always' : 'none',
      allowScriptedContent: true
    })

    rendition.themes.register('shelf', {
      body: {
        'font-family': 'Georgia, "Songti SC", "PingFang SC", serif',
        'line-height': '1.8',
        color: '#22252c',
        padding: '0 6px'
      },
      '.shelf-hl': { cursor: 'pointer' },
      '::selection': { background: 'rgba(79,110,247,0.30)' }
    })
    rendition.themes.select('shelf')
    rendition.themes.fontSize(`${props.fontSize}%`)

    // 目录
    book.loaded.navigation.then((nav) => {
      hrefLabel = {}
      const flat = []
      const walk = (items, depth) => {
        for (const it of items || []) {
          const href = (it.href || '').split('#')[0]
          if (href) hrefLabel[href] = it.label?.trim()
          flat.push({ label: it.label?.trim() || href, href: it.href, depth })
          if (it.subitems?.length) walk(it.subitems, depth + 1)
        }
      }
      walk(nav.toc, 0)
      emit('toc', flat)
    })

    rendition.on('relocated', onRelocated)
    rendition.on('selected', onSelected)
    rendition.on('markClicked', (cfiRange) => {
      const hit = props.annotations.find((a) => a.cfi === cfiRange)
      if (hit) emit('open-annotation', hit)
    })
    rendition.on('rendered', (section, view) => {
      bindKeys(view)
    })

    const startCfi = props.initial?.location || undefined
    await rendition.display(startCfi)
    await book.ready
    loading.value = false

    emit('ready', { totalPages: 0 })

    // 后台生成定位表，用于计算百分比
    book.locations
      .generate(1500)
      .then(() => {
        locationsReady = true
        updateLocation()
      })
      .catch(() => {})

    syncAnnotations()
    watch(
      () => props.layoutMode,
      (newVal) => {
        if (rendition) {
          rendition.spread(newVal === 'spread' ? 'always' : 'none')
          resize()
        }
      }
    )


    ro = new ResizeObserver(() => {
      if (!destroyed) resize()
    })
    if (viewerEl.value) ro.observe(viewerEl.value)
  } catch (err) {
    error.value = `EPUB 加载失败：${err.message}`
    loading.value = false
  }
})

onBeforeUnmount(() => {
  destroyed = true
  ro?.disconnect()
  try {
    rendition?.destroy()
    book?.destroy()
  } catch {
    /* ignore */
  }
})

/* ------------------------------ 交互 ------------------------------ */

function bindKeys(view) {
  const doc = view?.document
  if (!doc) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) {
      e.preventDefault()
      next()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) {
      e.preventDefault()
      prev()
    }
  // 选区结束后通知外部收起工具条
  doc.addEventListener('mouseup', () => {
    setTimeout(() => {
      const sel = doc.getSelection()
      if (!sel || sel.isCollapsed) emit('select', null)
    }, 10)
  })
}

function next() {
  if (atEnd.value) return
  rendition?.next()
}

function prev() {
  if (atStart.value) return
  rendition?.prev()
}

function onRelocated(location) {
  const startCfi = location?.start?.cfi
  const endCfi = location?.end?.cfi || startCfi
  if (!startCfi) return

  const isAtEnd = !!location.atEnd
  atStart.value = !!location.atStart
  atEnd.value = isAtEnd

  const href = (location.start.href || '').split('#')[0]
  const current = {
    cfi: startCfi,
    endCfi,
    href,
    chapter: hrefLabel[href] || '',
    atStart: atStart.value,
    atEnd: isAtEnd
  }

  // 进度计算：以右侧页（endCfi）为准；到达尾页时直接判定为 100%
  let percent = 0
  if (isAtEnd) {
    percent = 100
  } else if (locationsReady && book?.locations) {
    try {
      const pct = (book.locations.percentageFromCfi(endCfi) || 0) * 100
      percent = Math.min(100, Math.max(0, pct))
    } catch {
      percent = 0
    }
  }

  emit('progress', {
    ...current,
    percent: Math.round(percent * 10) / 10,
    totalPages: 0,
    page: 0,
    kind: 'epub'
  })
}

function updateLocation() {
  if (!rendition) return
  const loc = rendition.currentLocation()
  if (loc?.start?.cfi) onRelocated(loc)
}

function onSelected(cfiRange, contents) {
  let text = ''
  let anchor = { x: window.innerWidth / 2, y: 120 }
  try {
    const range = contents.range(cfiRange)
    text = range.toString().replace(/\s+/g, ' ').trim()
    const rect = range.getBoundingClientRect()
    const frameEl = contents.document.defaultView.frameElement
    const fb = frameEl.getBoundingClientRect()
    anchor = { x: fb.left + rect.left + rect.width / 2, y: fb.top + rect.top }
  } catch {
    /* ignore */
  }
  if (!text) {
    emit('select', null)
    return
  }
  emit('select', {
    text,
    segments: [{ cfi: cfiRange, text }],
    anchor
  })
}

/* ------------------------------ 高亮同步 ------------------------------ */

function addHighlight(a) {
  if (!rendition || !a.cfi) return
  try {
    rendition.annotations.highlight(a.cfi, { id: a.id }, null, 'shelf-hl', {
      fill: colorOf(a.color).solid,
      'fill-opacity': '0.34',
      'mix-blend-mode': 'multiply'
    })
  } catch (err) {
    console.warn('[epub] 添加高亮失败', err)
  }
}

function removeHighlight(a) {
  if (!rendition || !a.cfi) return
  try {
    rendition.annotations.remove(a.cfi, 'highlight')
  } catch {
    /* ignore */
  }
}

function syncAnnotations() {
  if (!rendition) return
  const desired = new Map()
  for (const a of props.annotations) {
    if (a.cfi) desired.set(a.id, a)
  }

  for (const [id, prev] of [...appliedMap]) {
    const next = desired.get(id)
    if (!next) {
      removeHighlight(prev)
      appliedMap.delete(id)
    } else if (next.cfi !== prev.cfi || next.color !== prev.color) {
      removeHighlight(prev)
      addHighlight(next)
      appliedMap.set(id, next)
    } else {
      appliedMap.set(id, next)
    }
  }

  for (const [id, a] of desired) {
    if (!appliedMap.has(id)) {
      addHighlight(a)
      appliedMap.set(id, a)
    }
  }
}

watch(() => props.annotations, syncAnnotations, { deep: true })

watch(
  () => props.fontSize,
  (v) => rendition?.themes.fontSize(`${v}%`)
)

/* ------------------------------ 对外方法 ------------------------------ */

function display(target) {
  if (!target) return
  rendition?.display(target)
}

function scrollToCfi(cfi) {
  display(cfi)
}

function setFontSize(v) {
  rendition?.themes.fontSize(`${v}%`)
}

/** 容器尺寸变化（批注面板开合、窗口缩放）后重排 */
function resize() {
  if (!rendition || !viewerEl.value) return
  const w = viewerEl.value.clientWidth
  const h = viewerEl.value.clientHeight
  if (!w || !h) return
  let cfi = null
  try {
    cfi = rendition.currentLocation()?.start?.cfi || null
  } catch {
    /* ignore */
  }
  try {
    rendition.resize(w, h, cfi)
  } catch (err) {
    console.warn('[epub] 重排失败', err)
  }
}

defineExpose({ next, prev, nextPage: next, prevPage: prev, display, scrollToCfi, setFontSize, resize })
</script>

<style scoped>
.epub-wrap {
  position: relative;
  flex: 1;
  display: flex;
  align-items: stretch;
  background: radial-gradient(circle at 50% 45%, #f7f8fa 0%, #e8ebf0 100%);
  overflow: hidden;
  height: 100%;
  box-sizing: border-box;
  padding: 24px 64px 28px;
}

.viewer-wrapper {
  flex: 1;
  height: 100%;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  width: 100%;
  max-width: 1380px;
  margin: 0 auto;
  border-radius: 4px;
  box-shadow:
    0 22px 60px rgba(15, 23, 42, 0.16),
    0 8px 24px rgba(15, 23, 42, 0.08),
    0 1px 3px rgba(15, 23, 42, 0.06);
  background: #ffffff;
}

.viewer {
  width: 100%;
  height: 100%;
  margin: 0;
  min-height: 0;
  box-sizing: border-box;
}

.book-spine {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 3px;
  transform: translateX(-50%);
  background: linear-gradient(
    to right,
    rgba(0, 0, 0, 0.08) 0%,
    rgba(0, 0, 0, 0.18) 46%,
    rgba(0, 0, 0, 0.22) 50%,
    rgba(0, 0, 0, 0.18) 54%,
    rgba(0, 0, 0, 0.08) 100%
  );
  box-shadow: 0 0 14px rgba(0, 0, 0, 0.12);
  pointer-events: none;
  z-index: 10;
}

.viewer :deep(iframe) {
  border: none;
  background: #fff;
  box-shadow: 0 1px 3px rgba(20, 26, 40, 0.14), 0 6px 20px rgba(20, 26, 40, 0.06);
  border-radius: 3px;
}

.nav-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.90);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.10), 0 1px 3px rgba(15, 23, 42, 0.05);
  font-size: 22px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-2);
  z-index: 30;
  transition: all 0.2s cubic-bezier(0.2, 0.8, 0.3, 1);
  cursor: pointer;
}

.nav-arrow:hover:not(:disabled) {
  background: #ffffff;
  color: var(--accent);
  transform: translateY(-50%) scale(1.10);
  box-shadow: 0 8px 24px rgba(79, 110, 247, 0.20), 0 2px 6px rgba(15, 23, 42, 0.08);
}

.nav-arrow:disabled {
  opacity: 0.2;
  cursor: not-allowed;
  pointer-events: none;
}

.nav-arrow.left {
  left: 18px;
}

.nav-arrow.right {
  right: 18px;
}

.epub-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: var(--reader-bg);
  color: var(--text-2);
  font-size: 13px;
}

.epub-loading .spin {
  font-size: 30px;
  color: var(--accent);
}

.epub-error {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: #fff4f3;
  border: 1px solid #f6c9c5;
  color: #8f2820;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 13px;
}
</style>
