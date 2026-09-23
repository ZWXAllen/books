<template>
  <div class="pdf-reader-wrap" :class="[layoutMode]" ref="wrapEl" @mouseup="onMouseUp" @click="onClick">
    <!-- 左右翻页按钮 -->
    <button class="nav-arrow left" :disabled="atStart" @click.stop="prevPage" title="上一页 (←)">‹</button>

    <div class="stage" ref="stageEl">
      <!-- 左右双页对开 / 单页展示区 -->
      <div
        class="book-spread"
        :class="{ 'is-dual': currentPages.length === 2, 'is-single': currentPages.length === 1 }"
        :style="{ height: spreadHeight + 'px' }"
      >
        <template v-for="(pageNum, idx) in currentPages" :key="pageNum">
          <div
            class="pdf-page"
            :class="{
              'page-left': currentPages.length === 2 && idx === 0,
              'page-right': currentPages.length === 2 && idx === 1
            }"
            :data-page="pageNum"
            :style="{ width: pageWidth + 'px', height: spreadHeight + 'px' }"
            :ref="(el) => setPageRef(pageNum, el)"
          >
            <canvas :ref="(el) => setCanvasRef(pageNum, el)"></canvas>

            <div class="text-layer" :ref="(el) => setTextRef(pageNum, el)"></div>

            <div class="hl-layer">
              <template v-for="a in highlightsByPage[pageNum] || []" :key="a.id">
                <div
                  v-for="(r, i) in a.rects"
                  :key="a.id + '-' + i"
                  class="hl"
                  :class="{ 'has-note': !!a.note, active: a.id === activeId }"
                  :style="{
                    left: r.x * 100 + '%',
                    top: r.y * 100 + '%',
                    width: r.w * 100 + '%',
                    height: r.h * 100 + '%',
                    background: colorOf(a.color).fill
                  }"
                ></div>
              </template>
            </div>

            <span class="page-label">{{ pageNum }}</span>
          </div>

          <!-- 双页中央书脊投影线 -->
          <div v-if="currentPages.length === 2 && idx === 0" class="book-spine"></div>
        </template>
      </div>
    </div>

    <button class="nav-arrow right" :disabled="atEnd" @click.stop="nextPage" title="下一页 (→)">›</button>

    <div v-if="loading" class="pdf-loading">
      <div class="spin">⟳</div>
      <p>正在加载 PDF…</p>
    </div>
    <div v-if="error" class="pdf-error">{{ error }}</div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { pdfjsLib, getDocumentParams } from '../lib/pdf.js'
import { colorOf } from '../constants.js'
import { api } from '../api.js'

const props = defineProps({
  bookId: { type: String, required: true },
  fileUrl: { type: String, required: true },
  annotations: { type: Array, default: () => [] },
  activeId: { type: String, default: '' },
  initial: { type: Object, default: null },
  hasCover: Boolean,
  layoutMode: { type: String, default: 'spread' } // 'spread' | 'single'
})

const emit = defineEmits(['select', 'progress', 'ready', 'open-annotation', 'cover-generated'])

const wrapEl = ref(null)
const stageEl = ref(null)
const loading = ref(true)
const error = ref('')
const pageWidth = ref(480)
const spreadHeight = ref(680)
const currentPage = ref(1)
const totalPages = ref(0)

const pageRefs = {}
const canvasRefs = {}
const textRefs = {}
const rendered = new Set()
const renderTasks = new Map()

let pdfDoc = null
let ratio = 1.414
let ro = null
let destroyed = false
let resizeTimer = null
let lastW = 0
let lastH = 0

const isSpread = computed(() => props.layoutMode === 'spread')

const currentPages = computed(() => {
  if (!totalPages.value) return []
  if (!isSpread.value || totalPages.value <= 1) {
    return [currentPage.value]
  }
  // 左右双页对开：从第 1 页开始成双 [1, 2], [3, 4], [5, 6]...
  const left = currentPage.value % 2 === 1 ? currentPage.value : currentPage.value - 1
  const right = left + 1 <= totalPages.value ? left + 1 : null
  return right ? [left, right] : [left]
})

const atStart = computed(() => {
  if (currentPages.value.length === 0) return true
  return currentPages.value[0] <= 1
})

const atEnd = computed(() => {
  if (!totalPages.value || currentPages.value.length === 0) return true
  return currentPages.value[currentPages.value.length - 1] >= totalPages.value
})

const highlightsByPage = computed(() => {
  const map = {}
  for (const a of props.annotations) {
    if (!a.page || !a.rects?.length) continue
    ;(map[a.page] ||= []).push(a)
  }
  return map
})

function setPageRef(num, el) {
  if (el) pageRefs[num] = el
  else delete pageRefs[num]
}

function setCanvasRef(num, el) {
  if (el) canvasRefs[num] = el
  else delete canvasRefs[num]
}

function setTextRef(num, el) {
  if (el) textRefs[num] = el
  else delete textRefs[num]
}

/* ------------------------------ 尺寸计算 ------------------------------ */

function computeDimensions() {
  const stage = stageEl.value
  if (!stage) return
  const w = stage.clientWidth - 16
  const h = stage.clientHeight - 8
  if (w <= 0 || h <= 0) return
  lastW = w
  lastH = h

  const isDual = currentPages.value.length === 2
  if (isDual) {
    // 左右两页并排
    const maxWByHeight = h / ratio
    const maxWByWidth = (w - 2) / 2 // 减去 2px 书脊宽度
    const pw = Math.floor(Math.min(maxWByHeight, maxWByWidth))
    pageWidth.value = Math.max(160, pw)
    spreadHeight.value = Math.floor(pageWidth.value * ratio)
  } else {
    // 单页居中
    const maxWByHeight = h / ratio
    const pw = Math.floor(Math.min(maxWByHeight, w))
    pageWidth.value = Math.max(160, pw)
    spreadHeight.value = Math.floor(pageWidth.value * ratio)
  }
}

function onResize() {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    if (destroyed || !stageEl.value) return
    const stage = stageEl.value
    if (Math.abs(stage.clientWidth - 16 - lastW) < 10 && Math.abs(stage.clientHeight - 8 - lastH) < 10) return
    computeDimensions()
    destroyAll()
    nextTick(() => {
      renderCurrentSpread()
    })
  }, 100)
}

/* ------------------------------ 渲染 ------------------------------ */

async function renderPage(num) {
  if (num < 1 || num > totalPages.value) return
  if (rendered.has(num) || destroyed) return
  rendered.add(num)

  let canvas = canvasRefs[num]
  let textLayer = textRefs[num]
  if (!canvas) {
    await nextTick()
    canvas = canvasRefs[num]
    textLayer = textRefs[num]
  }
  if (!canvas || destroyed) {
    rendered.delete(num)
    return
  }

  try {
    const page = await pdfDoc.getPage(num)
    const baseVp = page.getViewport({ scale: 1 })
    const scale = pageWidth.value / baseVp.width
    const viewport = page.getViewport({ scale })
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    canvas.width = Math.floor(viewport.width * dpr)
    canvas.height = Math.floor(viewport.height * dpr)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, viewport.width, viewport.height)

    const task = page.render({ canvasContext: ctx, viewport })
    renderTasks.set(num, task)
    await task.promise
    renderTasks.delete(num)
    if (destroyed) return

    await buildTextLayer(page, num, viewport, textLayer)
  } catch (err) {
    if (err?.name !== 'RenderingCancelledException') {
      console.warn(`[pdf] 第 ${num} 页渲染失败`, err)
    }
    rendered.delete(num)
  }
}

async function buildTextLayer(page, num, viewport, container) {
  if (!container) return
  try {
    const content = await page.getTextContent()
    if (destroyed || !textRefs[num]) return
    container.textContent = ''
    const frag = document.createDocumentFragment()
    const spans = []

    for (const item of content.items) {
      if (!item.str) continue
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform)
      const angle = Math.atan2(tx[1], tx[0])
      const fontHeight = Math.hypot(tx[2], tx[3])
      let left, top
      if (angle === 0) {
        left = tx[4]
        top = tx[5] - fontHeight
      } else {
        left = tx[4] + fontHeight * Math.sin(angle)
        top = tx[5] - fontHeight * Math.cos(angle)
      }
      const span = document.createElement('span')
      span.textContent = item.str
      span.style.left = `${left}px`
      span.style.top = `${top}px`
      span.style.fontSize = `${fontHeight}px`
      span.dataset.target = String(item.width * viewport.scale)
      frag.appendChild(span)
      spans.push(span)
    }
    container.appendChild(frag)

    for (const span of spans) {
      const target = parseFloat(span.dataset.target)
      const actual = span.getBoundingClientRect().width
      if (actual > 0.5 && target > 0.5) {
        span.style.transform = `scaleX(${(target / actual).toFixed(4)})`
      }
    }
  } catch {
    /* 文本层解析失败不阻塞整体渲染 */
  }
}

function destroyPage(num) {
  const task = renderTasks.get(num)
  if (task) {
    try {
      task.cancel()
    } catch {
      /* ignore */
    }
    renderTasks.delete(num)
  }
  const canvas = canvasRefs[num]
  if (canvas) {
    canvas.width = 1
    canvas.height = 1
  }
  const tl = textRefs[num]
  if (tl) tl.textContent = ''
  rendered.delete(num)
}

function destroyAll() {
  for (const n of [...rendered]) destroyPage(n)
}

async function renderCurrentSpread() {
  const cur = currentPages.value
  for (const n of cur) {
    await renderPage(n)
  }
}

/* ------------------------------ 翻页与定位 ------------------------------ */

function emitProgress() {
  const pages = currentPages.value
  if (!pages.length) return
  const spreadPages = pages.length === 2 ? `${pages[0]}-${pages[1]}` : `${pages[0]}`
  const maxP = Math.max(...pages)
  // 进度以右侧那一页为准；到最后一页时强制设为 100%
  const percent = maxP >= totalPages.value || atEnd.value
    ? 100
    : Math.min(100, Math.round((maxP / totalPages.value) * 100))
  emit('progress', {
    page: maxP,
    spreadPages,
    totalPages: totalPages.value,
    percent,
    kind: 'pdf'
  })
}

async function goToPage(num) {
  const target = Math.max(1, Math.min(num, totalPages.value))
  currentPage.value = target
  destroyAll()
  computeDimensions()
  await nextTick()
  await renderCurrentSpread()
  emitProgress()
}

function nextPage() {
  if (atEnd.value) return
  if (isSpread.value) {
    const left = currentPage.value % 2 === 1 ? currentPage.value : currentPage.value - 1
    const nextNum = left + 2
    if (nextNum <= totalPages.value + 1) {
      goToPage(Math.min(totalPages.value, nextNum))
    }
  } else {
    if (currentPage.value < totalPages.value) {
      goToPage(currentPage.value + 1)
    }
  }
}

function prevPage() {
  if (atStart.value) return
  if (isSpread.value) {
    const left = currentPage.value % 2 === 1 ? currentPage.value : currentPage.value - 1
    const prevNum = left - 2
    goToPage(Math.max(1, prevNum))
  } else {
    if (currentPage.value > 1) {
      goToPage(currentPage.value - 1)
    }
  }
}

function scrollToPage(num) {
  goToPage(num)
}

/* ------------------------------ 生命周期 ------------------------------ */

onMounted(async () => {
  try {
    const task = pdfjsLib.getDocument(getDocumentParams(props.fileUrl))
    pdfDoc = await task.promise
    totalPages.value = pdfDoc.numPages

    const first = await pdfDoc.getPage(1)
    const base = first.getViewport({ scale: 1 })
    ratio = base.height / base.width

    // 初始页定位
    const initPage = props.initial?.page || 1
    currentPage.value = Math.max(1, Math.min(initPage, totalPages.value))

    await nextTick()
    computeDimensions()
    await renderCurrentSpread()
    emitProgress()
    emit('ready', { totalPages: totalPages.value })

    if (!props.hasCover) generateCover()

    ro = new ResizeObserver(() => onResize())
    if (stageEl.value) ro.observe(stageEl.value)
  } catch (err) {
    error.value = `PDF 加载失败：${err.message}`
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  destroyed = true
  ro?.disconnect()
  clearTimeout(resizeTimer)
  for (const t of renderTasks.values()) {
    try {
      t.cancel()
    } catch {
      /* ignore */
    }
  }
  renderTasks.clear()
  pdfDoc?.destroy()
})

watch(
  () => props.layoutMode,
  () => {
    destroyAll()
    computeDimensions()
    nextTick(() => {
      renderCurrentSpread()
      emitProgress()
    })
  }
)

/* ------------------------------ 选区 / 划线 ------------------------------ */

function onMouseUp() {
  setTimeout(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      emit('select', null)
      return
    }
    const range = sel.getRangeAt(0)
    const text = sel.toString().replace(/\s+/g, ' ').trim()
    if (!text) {
      emit('select', null)
      return
    }
    const pageEls = [...(stageEl.value?.querySelectorAll('.pdf-page') || [])]
    const groups = new Map()
    let lastRect = null

    for (const r of range.getClientRects()) {
      if (r.width < 1.5 || r.height < 1.5) continue
      const pe = pageEls.find((el) => {
        const b = el.getBoundingClientRect()
        return r.top < b.bottom && r.bottom > b.top && r.left < b.right && r.right > b.left
      })
      if (!pe) continue
      const b = pe.getBoundingClientRect()
      const num = Number(pe.dataset.page)
      const x0 = Math.max(r.left, b.left)
      const x1 = Math.min(r.right, b.right)
      const y0 = Math.max(r.top, b.top)
      const y1 = Math.min(r.bottom, b.bottom)
      const arr = groups.get(num) || []
      arr.push({
        x: (x0 - b.left) / b.width,
        y: (y0 - b.top) / b.height,
        w: (x1 - x0) / b.width,
        h: (y1 - y0) / b.height
      })
      groups.set(num, arr)
      lastRect = r
    }

    if (!groups.size) {
      emit('select', null)
      return
    }

    const segments = [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([page, rects]) => ({ page, rects, text }))

    emit('select', {
      text,
      segments,
      anchor: lastRect
        ? { x: lastRect.left + lastRect.width / 2, y: lastRect.top }
        : { x: window.innerWidth / 2, y: 120 }
    })
  }, 10)
}

function onClick(e) {
  const sel = window.getSelection()
  if (sel && !sel.isCollapsed && String(sel).trim()) return
  const pageEl = e.target.closest?.('.pdf-page')
  if (!pageEl) return
  const b = pageEl.getBoundingClientRect()
  const x = (e.clientX - b.left) / b.width
  const y = (e.clientY - b.top) / b.height
  const num = Number(pageEl.dataset.page)
  const hit = props.annotations.find(
    (a) =>
      a.page === num &&
      a.rects?.some(
        (r) =>
          x >= r.x - 0.005 && x <= r.x + r.w + 0.005 && y >= r.y - 0.005 && y <= r.y + r.h + 0.005
      )
  )
  if (hit) emit('open-annotation', hit)
}

/* ------------------------------ 封面生成 ------------------------------ */

async function generateCover() {
  try {
    const page = await pdfDoc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: 600 / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    await api.uploadCover(props.bookId, dataUrl)
    emit('cover-generated')
  } catch (err) {
    console.warn('[pdf] 生成封面失败', err)
  }
}

defineExpose({
  nextPage,
  prevPage,
  next: nextPage,
  prev: prevPage,
  scrollToPage,
  goToPage,
  currentPage,
  totalPages,
  currentPages
})
</script>

<style scoped>
.pdf-reader-wrap {
  position: relative;
  flex: 1;
  height: 100%;
  display: flex;
  align-items: stretch;
  background: radial-gradient(circle at 50% 45%, #f7f8fa 0%, #e8ebf0 100%);
  overflow: hidden;
  box-sizing: border-box;
}

.stage {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 64px 28px;
  overflow: hidden;
  box-sizing: border-box;
}

.book-spread {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  box-shadow:
    0 22px 60px rgba(15, 23, 42, 0.16),
    0 8px 24px rgba(15, 23, 42, 0.08),
    0 1px 3px rgba(15, 23, 42, 0.06);
  border-radius: 4px;
  background: #ffffff;
  transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.3, 1), box-shadow 0.25s;
}

.book-spread.is-dual .pdf-page.page-left {
  border-top-left-radius: 4px;
  border-bottom-left-radius: 4px;
  box-shadow: inset -8px 0 16px rgba(0, 0, 0, 0.04);
  border-right: 1px solid rgba(0, 0, 0, 0.05);
}

.book-spread.is-dual .pdf-page.page-right {
  border-top-right-radius: 4px;
  border-bottom-right-radius: 4px;
  box-shadow: inset 8px 0 16px rgba(0, 0, 0, 0.04);
  border-left: 1px solid rgba(0, 0, 0, 0.05);
}

.book-spread.is-single .pdf-page {
  border-radius: 4px;
  box-shadow:
    0 20px 50px rgba(15, 23, 42, 0.14),
    0 6px 18px rgba(15, 23, 42, 0.08);
}

.book-spine {
  width: 3px;
  align-self: stretch;
  background: linear-gradient(
    to right,
    rgba(0, 0, 0, 0.08) 0%,
    rgba(0, 0, 0, 0.18) 46%,
    rgba(0, 0, 0, 0.22) 50%,
    rgba(0, 0, 0, 0.18) 54%,
    rgba(0, 0, 0, 0.08) 100%
  );
  box-shadow: 0 0 14px rgba(0, 0, 0, 0.12);
  z-index: 10;
  pointer-events: none;
}
.pdf-page {
  position: relative;
  background: #fff;
  overflow: hidden;
  user-select: text;
  box-sizing: border-box;
}

.pdf-page canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.text-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  line-height: 1;
  pointer-events: none;
  user-select: text;
}

.text-layer :deep(span) {
  position: absolute;
  white-space: pre;
  transform-origin: 0 0;
  color: transparent;
  cursor: text;
  pointer-events: auto;
}

.text-layer :deep(::selection) {
  background: rgba(79, 110, 247, 0.35);
}

.hl-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.hl {
  position: absolute;
  mix-blend-mode: multiply;
  pointer-events: auto;
  cursor: pointer;
  border-radius: 2px;
}

.hl.active {
  outline: 2px solid var(--accent);
}

.hl.has-note::after {
  content: '';
  position: absolute;
  bottom: -3px;
  left: 0;
  right: 0;
  height: 2px;
  background: currentColor;
  opacity: 0.8;
}

.page-label {
  position: absolute;
  bottom: 12px;
  right: 14px;
  font-size: 11px;
  font-weight: 550;
  color: var(--text-3);
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(4px);
  border: 1px solid rgba(0, 0, 0, 0.06);
  padding: 2px 8px;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  pointer-events: none;
  font-variant-numeric: tabular-nums;
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

.pdf-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--reader-bg);
  color: var(--text-2);
  font-size: 13.5px;
  z-index: 30;
}

.pdf-error {
  position: absolute;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--danger-soft);
  color: var(--danger);
  padding: 10px 18px;
  border-radius: var(--radius);
  font-size: 13px;
  z-index: 40;
}
</style>
