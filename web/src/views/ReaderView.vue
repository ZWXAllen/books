<template>
  <div class="reader">
    <header class="rbar">
      <div class="r-left">
        <button class="back-btn" @click="goHome" title="返回书架">←</button>
        <div class="r-title">
          <h1>{{ book?.title || '加载中…' }}</h1>
          <p>{{ book?.author || '' }}</p>
        </div>
      </div>

      <div class="r-center">
        <div class="pbar">
          <i :style="{ width: percent + '%' }"></i>
        </div>
        <span class="pnum">{{ progressLabel }}</span>
      </div>

      <div class="r-right">
        <div class="fs-ctl" v-if="book?.format === 'epub'">
          <button class="btn btn-ghost btn-icon" @click="changeFont(-10)" title="减小字号">A－</button>
          <span class="fs-val">{{ fontSize }}%</span>
          <button class="btn btn-ghost btn-icon" @click="changeFont(10)" title="增大字号">A＋</button>
        </div>
        <button
          class="btn layout-btn"
          :class="{ active: layoutMode === 'spread' }"
          :title="layoutMode === 'spread' ? '当前：左右双页视图，点击切换单页' : '当前：单页视图，点击切换双页'"
          @click="toggleLayout"
        >
          {{ layoutMode === 'spread' ? '📖 双页' : '📄 单页' }}
        </button>
        <button class="btn panel-btn" :class="{ active: panelOpen }" @click="panelOpen = !panelOpen">
          ✎ 批注 <em v-if="annotations.length">{{ annotations.length }}</em>
        </button>
                <button
          v-if="book?.format === 'epub' || book?.format === 'pdf'"
          class="btn disguise-btn"
          title="伪装模式：看起来像 Cursor / VS Code / 终端 (Ctrl/Cmd+Shift+D)"
          @click="enterDisguise"
        >🎭 伪装</button>
        <button class="btn reset-btn" title="清除这本书的阅读进度" @click="resetProgress">↺</button>
      </div>
    </header>

    <div class="r-body">
      <PdfReader
        v-if="ready && book?.format === 'pdf'"
        ref="readerRef"
        :book-id="book.id"
        :file-url="fileUrl"
        :annotations="annotations"
        :active-id="activeId"
        :initial="initial"
        :has-cover="book.hasCover"
        :layout-mode="layoutMode"
        @select="onSelect"
        @progress="onProgress"
        @open-annotation="openAnnotation"
        @cover-generated="onCoverGenerated"
      />

      <EpubReader
        v-else-if="ready && book?.format === 'epub'"
        ref="readerRef"
        :book-id="book.id"
        :file-url="fileUrl"
        :annotations="annotations"
        :active-id="activeId"
        :initial="initial"
        :font-size="fontSize"
        :layout-mode="layoutMode"
        @select="onSelect"
        @progress="onProgress"
        @toc="onToc"
        @open-annotation="openAnnotation"
      />

      <div v-else-if="!book && library.loaded" class="r-missing">
        <div class="m-ico">🔍</div>
        <h2>找不到这本书</h2>
        <p>它可能已被移动或删除，试试重新扫描书库。</p>
        <button class="btn btn-primary" @click="goHome">返回书架</button>
      </div>
      <div v-else class="r-missing">
        <div class="spin" style="font-size: 30px; color: var(--accent)">⟳</div>
      </div>

      <AnnotationPanel
        v-if="panelOpen"
        :book="book"
        :annotations="sortedAnnotations"
        :toc="toc"
        :open="panelOpen"
        :active-id="activeId"
        @close="panelOpen = false"
        @goto="gotoAnnotation"
        @edit="editAnnotation"
        @remove="removeAnnotation"
        @toc="gotoToc"
      />
    </div>

    <SelectionToolbar
      :visible="!!selection"
      :anchor="selection?.anchor || { x: 0, y: 0 }"
      :text="selection?.text || ''"
      @highlight="onHighlight"
      @note="onAddNote"
      @copy="copySelection"
    />

    <NoteEditor
      v-if="noteTarget"
      :quote="noteTarget.a?.text || selection?.text || ''"
      :note="noteTarget.a?.note || ''"
      :color-key="noteTarget.a?.color || lastColor"
      :is-new="noteTarget.mode === 'new'"
      @close="noteTarget = null"
      @save="saveNote"
      @delete="deleteFromEditor"
    />

    <transition name="fade">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </transition>

    <DisguiseReader
      v-if="disguiseOn && (book?.format === 'epub' || book?.format === 'pdf')"
      :book-id="book.id"
      :file-url="fileUrl"
      :book-title="book.title"
      :book-author="book.author || ''"
      :format="book.format"
      :initial-page="disguisePage"
      :initial="initial"
      :theme="disguiseTheme"
      @exit="exitDisguise"
      @progress="onDisguiseProgress"
      @theme-change="onDisguiseTheme"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLibraryStore } from '../stores/library.js'
import { useAnnotations } from '../composables/useAnnotations.js'
import { api } from '../api.js'
import PdfReader from '../components/PdfReader.vue'
import EpubReader from '../components/EpubReader.vue'
import AnnotationPanel from '../components/AnnotationPanel.vue'
import SelectionToolbar from '../components/SelectionToolbar.vue'
import NoteEditor from '../components/NoteEditor.vue'
import DisguiseReader from '../components/DisguiseReader.vue'

const route = useRoute()
const router = useRouter()
const library = useLibraryStore()

const bookId = route.params.id
const book = ref(null)

const {
  annotations,
  sorted: sortedAnnotations,
  load: loadAnnotations,
  createMany: createAnnotations,
  update: updateAnnotation,
  remove: removeAnnotationById
} = useAnnotations(bookId)

const readerRef = ref(null)
const ready = ref(false)
const panelOpen = ref(false)
const selection = ref(null)
const noteTarget = ref(null)
const activeId = ref('')
const toc = ref([])
const toast = ref('')
const lastColor = ref('yellow')
let pending = null

const fontSize = ref(Number(localStorage.getItem('reader-font') || 100))
const layoutMode = ref(localStorage.getItem('reader-layout') || 'spread')
const disguiseOn = ref(false)
const disguiseTheme = ref(localStorage.getItem('disguise-theme') || 'cursor')
const disguisePage = ref(0)

function toggleLayout() {
  layoutMode.value = layoutMode.value === 'spread' ? 'single' : 'spread'
  localStorage.setItem('reader-layout', layoutMode.value)
}

const initial = ref(null)
const live = ref({ percent: 0, page: 0, totalPages: 0, chapter: '' })

const fileUrl = computed(() => api.fileUrl(bookId, book.value?.fileName))

const percent = computed(() => Math.round(live.value.percent || 0))

const progressLabel = computed(() => {
  if (!book.value) return ''
  if (book.value.format === 'pdf' && live.value.totalPages) {
    const pageText = live.value.spreadPages ? `第 ${live.value.spreadPages}` : `第 ${live.value.page || 1}`
    return `${pageText} / ${live.value.totalPages} 页 · ${percent.value}%`
  }
  return `${percent.value}%${live.value.chapter ? ' · ' + live.value.chapter : ''}`
})

let saveTimer = null
let toastTimer = null

/* ------------------------------ 初始化 ------------------------------ */

onMounted(async () => {
  if (!library.loaded) await library.load()
  book.value = library.books.find((b) => b.id === bookId) || null

  if (book.value) {
    const p = book.value.progress
    initial.value = p && p.percent > 0 ? { page: p.page, totalPages: p.totalPages, location: p.location, ratioInPage: p.ratioInPage } : null
    live.value = {
      percent: p?.percent || 0,
      page: p?.page || 1,
      totalPages: p?.totalPages || book.value.pageCount || 0,
      chapter: p?.chapter || ''
    }
  }

  await loadAnnotations()
  ready.value = true

  window.addEventListener('keydown', onKeydown)

  // ?disguise=1|cursor|vscode|terminal 直接进入伪装
  const dq = String(route.query.disguise || '')
  if (dq && (book.value?.format === 'epub' || book.value?.format === 'pdf')) {
    if (['cursor', 'vscode', 'terminal'].includes(dq)) {
      disguiseTheme.value = dq
      localStorage.setItem('disguise-theme', dq)
    }
    enterDisguise()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  clearTimeout(saveTimer)
  flushProgress()
})

function onKeydown(e) {
  const tag = e.target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return

  // Ctrl/Cmd + Shift + D 开关伪装模式
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
    e.preventDefault()
    if (book.value?.format === 'epub' || book.value?.format === 'pdf') {
      if (disguiseOn.value) exitDisguise()
      else enterDisguise()
    }
    return
  }

  if (disguiseOn.value) return // 伪装层自己处理方向键

  if (e.key === 'Escape') {
    if (noteTarget.value) noteTarget.value = null
    else if (selection.value) selection.value = null
    else if (panelOpen.value) panelOpen.value = false
    return
  }
  if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) {
    e.preventDefault()
    if (readerRef.value?.nextPage) readerRef.value.nextPage()
    else if (readerRef.value?.next) readerRef.value.next()
  } else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) {
    e.preventDefault()
    if (readerRef.value?.prevPage) readerRef.value.prevPage()
    else if (readerRef.value?.prev) readerRef.value.prev()
  }
}

function enterDisguise() {
  if (book.value?.format !== 'epub' && book.value?.format !== 'pdf') {
    showToast('伪装模式目前仅支持 EPUB / PDF')
    return
  }
  try {
    const saved = Number(localStorage.getItem('disguise_page_' + bookId) || '0')
    disguisePage.value = Number.isFinite(saved) ? saved : 0
  } catch {
    disguisePage.value = 0
  }
  disguiseOn.value = true
  panelOpen.value = false
  selection.value = null
}

function exitDisguise() {
  disguiseOn.value = false
  document.title = (book.value?.title ? book.value.title + ' · ' : '') + '书架'
}

function onDisguiseTheme(theme) {
  disguiseTheme.value = theme
  localStorage.setItem('disguise-theme', theme)
}

function onDisguiseProgress(p) {
  onProgress(p)
}

/* ------------------------------ 进度 ------------------------------ */

function onProgress(p) {
  live.value = {
    percent: p.percent || 0,
    page: p.page || 0,
    spreadPages: p.spreadPages || '',
    totalPages: p.totalPages || 0,
    chapter: p.chapter || ''
  }
  pending = p
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    flushProgress()
  }, 900)
}

async function flushProgress() {
  const p = pending
  pending = null
  if (!p) return
  const payload = {
    percent: p.percent,
    page: p.page || 0,
    totalPages: p.totalPages || 0,
    location: p.cfi || null,
    ratioInPage: p.ratioInPage ?? null,
    chapter: p.chapter || ''
  }
  try {
    await api.saveProgress(bookId, payload)
    library.patchBookProgress(bookId, {
      percent: payload.percent,
      page: payload.page,
      totalPages: payload.totalPages,
      location: payload.location,
      ratioInPage: payload.ratioInPage,
      finished: payload.percent >= 99.5,
      updatedAt: Date.now()
    })
  } catch (err) {
    console.warn('[reader] 保存进度失败', err)
  }
}

async function resetProgress() {
  await flushProgress()
  await api.resetProgress(bookId)
  library.patchBookProgress(bookId, { percent: 0, page: 1, updatedAt: null, finished: false })
  showToast('已清除阅读进度，刷新后从头开始')
}

function showToast(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2400)
}

/* ------------------------------ 选区与划线 ------------------------------ */

function onSelect(sel) {
  selection.value = sel ? { ...sel } : null
}

function onHighlight(colorKey) {
  createFromSelection({ color: colorKey, note: '' })
}

function onAddNote() {
  if (!selection.value) return
  noteTarget.value = { mode: 'new', a: null }
}

async function createFromSelection({ color, note }) {
  const sel = selection.value
  if (!sel) return
  lastColor.value = color
  const payloads = sel.segments.map((s) => ({
    type: book.value?.format || 'pdf',
    text: s.text,
    color,
    note,
    chapter: live.value.chapter || '',
    ...(s.page ? { page: s.page, rects: s.rects } : {}),
    ...(s.cfi ? { cfi: s.cfi } : {})
  }))
  try {
    await createAnnotations(payloads)
    showToast(note ? '已添加批注' : '已添加划线')
  } catch (err) {
    showToast(`保存失败：${err.message}`)
  }
  selection.value = null
  window.getSelection()?.removeAllRanges()
}

function copySelection() {
  if (!selection.value) return
  navigator.clipboard
    ?.writeText(selection.value.text)
    .then(() => showToast('已复制'))
    .catch(() => showToast('复制失败'))
  selection.value = null
}

/* ------------------------------ 批注操作 ------------------------------ */

function openAnnotation(a) {
  activeId.value = a.id
  noteTarget.value = { mode: 'edit', a }
  panelOpen.value = true
}

function editAnnotation(a) {
  activeId.value = a.id
  noteTarget.value = { mode: 'edit', a }
}

async function saveNote({ note, color }) {
  const target = noteTarget.value
  if (!target) return
  if (target.mode === 'new') {
    await createFromSelection({ color, note })
  } else {
    try {
      await updateAnnotation(target.a.id, { note, color })
      showToast('已保存')
    } catch (err) {
      showToast(`保存失败：${err.message}`)
    }
  }
  noteTarget.value = null
}

async function deleteFromEditor() {
  const target = noteTarget.value
  if (!target?.a) return
  await removeAnnotation(target.a)
  noteTarget.value = null
}

async function removeAnnotation(a) {
  await removeAnnotationById(a.id)
  if (activeId.value === a.id) activeId.value = ''
  showToast('已删除')
}

function gotoAnnotation(a) {
  activeId.value = a.id
  if (book.value?.format === 'pdf' && a.page) {
    readerRef.value?.scrollToPage(a.page)
  } else if (a.cfi) {
    readerRef.value?.scrollToCfi(a.cfi)
  }
}

function gotoToc(item) {
  if (item?.href) readerRef.value?.display(item.href)
}

function onToc(list) {
  toc.value = list
}

function onCoverGenerated() {
  library.load({ silent: true })
}

/* ------------------------------ 其它 ------------------------------ */

function changeFont(delta) {
  fontSize.value = Math.max(70, Math.min(180, fontSize.value + delta))
  localStorage.setItem('reader-font', String(fontSize.value))
  setTimeout(() => readerRef.value?.resize?.(), 260)
}

watch(panelOpen, () => {
  // 面板开合会改变阅读区宽度，需要通知阅读器重排
  setTimeout(() => readerRef.value?.resize?.(), 80)
})

function goHome() {
  flushProgress()
  router.push({ name: 'home' })
}
</script>

<style scoped>
.reader {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
}

.rbar {
  height: 56px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 18px;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.03);
  z-index: 100;
  box-sizing: border-box;
}

.r-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
}

.back-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 15px;
  font-weight: 500;
  transition: all 0.2s cubic-bezier(0.2, 0.8, 0.3, 1);
  cursor: pointer;
  flex-shrink: 0;
}

.back-btn:hover {
  background: var(--surface);
  border-color: var(--border-strong);
  transform: translateX(-2px);
  box-shadow: var(--shadow-sm);
}

.r-title {
  min-width: 0;
}

.r-title h1 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 360px;
  letter-spacing: -0.01em;
}

.r-title p {
  margin: 1px 0 0;
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 360px;
}

.r-center {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 5px 14px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 20px;
  flex-shrink: 0;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.02);
}

.pbar {
  width: 140px;
  height: 6px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

.pbar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #4f6ef7 0%, #6366f1 100%);
  border-radius: 3px;
  transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

.pnum {
  font-size: 12px;
  font-weight: 550;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.r-right {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
  flex: 1;
}

.layout-btn {
  height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 550;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-2);
  transition: all 0.15s ease;
  cursor: pointer;
}

.layout-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.layout-btn.active {
  background: var(--accent-soft);
  border-color: #c7d2fe;
  color: var(--accent);
}

.fs-ctl {
  display: flex;
  align-items: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 3px;
  height: 34px;
}

.fs-ctl .btn-icon {
  width: 28px;
  height: 28px;
  font-size: 12px;
  border-radius: 6px;
}

.fs-val {
  font-size: 11.5px;
  font-weight: 550;
  color: var(--text-2);
  width: 38px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.panel-btn {
  height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 550;
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-2);
  transition: all 0.15s ease;
  cursor: pointer;
}

.panel-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.panel-btn.active {
  background: var(--accent-soft);
  border-color: #c7d2fe;
  color: var(--accent);
}

.panel-btn em {
  font-style: normal;
  background: var(--accent);
  color: #fff;
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 10px;
  font-weight: 600;
}

.reset-btn {
  height: 34px;
  width: 34px;
  padding: 0;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  color: var(--text-3);
  background: var(--surface);
  border: 1px solid var(--border);
  transition: all 0.15s ease;
  cursor: pointer;
}

.reset-btn:hover {
  color: var(--text);
  border-color: var(--border-strong);
}

.r-body {
  flex: 1;
  display: flex;
  min-height: 0;
  height: calc(100vh - 54px);
  height: calc(100dvh - 54px);
  position: relative;
  overflow: hidden;
  box-sizing: border-box;
}

.r-missing {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-2);
  background: var(--reader-bg);
}

.m-ico {
  font-size: 40px;
}

.r-missing h2 {
  margin: 0;
  font-size: 17px;
  color: var(--text);
}

.r-missing p {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--text-3);
}

.toast {
  position: fixed;
  bottom: 26px;
  left: 50%;
  transform: translateX(-50%);
  background: #23262e;
  color: #fff;
  font-size: 12.5px;
  padding: 9px 18px;
  border-radius: 20px;
  box-shadow: var(--shadow-lg);
  z-index: 1300;
}

.disguise-btn {
  border-color: #3d4f7a;
  color: #c8d4ff;
  background: #1a2338;
}
.disguise-btn:hover {
  background: #243152;
}
</style>
