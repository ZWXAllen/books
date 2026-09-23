<template>
  <div class="disguise" :class="[theme, modeClass]" tabindex="0" ref="rootEl" @keydown="onKey">
    <!-- ========== Cursor / VS Code ========== -->
    <template v-if="theme === 'cursor' || theme === 'vscode'">
      <div class="titlebar">
        <div class="traffic">
          <i class="c red"></i><i class="c yellow"></i><i class="c green"></i>
        </div>
        <div class="titlebar-center">
          <span class="win-title">{{ windowTitle }}</span>
        </div>
        <div class="titlebar-right">
          <button class="tb-btn" title="切换主题 (T)" @click.stop="cycleTheme">{{ themeLabel }}</button>
          <button class="tb-btn danger" title="退出伪装 (Esc)" @click.stop="$emit('exit')">退出</button>
        </div>
      </div>

      <div class="ide-body">
        <aside class="activity">
          <button class="act active" title="Explorer">☰</button>
          <button class="act" title="Search">⌕</button>
          <button class="act" title="Git">⑂</button>
          <button class="act" title="Extensions">▣</button>
          <div class="act-spacer"></div>
          <button class="act" title="Settings">⚙</button>
        </aside>

        <aside class="sidebar" v-if="sidebarOpen">
          <div class="side-head">EXPLORER</div>
          <div class="side-project">{{ projectName }}</div>
          <ul class="tree">
            <li
              v-for="f in fakeFiles"
              :key="f.path"
              :class="{ active: f.path === activeFile, folder: f.folder }"
              @click="!f.folder && (activeFile = f.path)"
            >
              <span class="indent" :style="{ width: f.depth * 12 + 'px' }"></span>
              <span class="ico">{{ f.folder ? '📁' : fileIcon(f.path) }}</span>
              <span class="name">{{ f.name }}</span>
            </li>
          </ul>
        </aside>

        <section class="editor">
          <div class="tabs">
            <div class="tab active">
              <span class="tab-ico">{{ fileIcon(activeFile) }}</span>
              <span>{{ activeFile.split('/').pop() }}</span>
              <em>×</em>
            </div>
            <div class="tab dim" v-for="t in softTabs" :key="t">
              <span class="tab-ico">{{ fileIcon(t) }}</span>
              <span>{{ t.split('/').pop() }}</span>
            </div>
            <div class="tabs-grow"></div>
            <div class="tab-hint">{{ mode === 'text' ? '↑↓ / PgUp PgDn 翻页 · Esc 退出' : '← → / 空格翻页 · Esc 退出' }}</div>
          </div>

          <!-- 文本模式 -->
          <div v-if="mode === 'text'" class="code-pane" ref="paneEl">
            <div class="gutter">
              <span v-for="n in lineCount" :key="n">{{ n }}</span>
            </div>
            <pre class="code" :style="{ fontSize: fontPx + 'px' }"><code>{{ decoratedPage }}</code></pre>
          </div>

          <!-- 扫描版 / 图片 EPUB：内嵌真实阅读器 -->
          <div v-else-if="mode === 'viewer'" class="viewer-pane">
            <div class="viewer-mask-top">{{ activeFile }} — preview</div>
            <EpubReader
              v-if="format === 'epub'"
              ref="readerRef"
              :book-id="bookId"
              :file-url="fileUrl"
              :annotations="[]"
              :initial="viewerInitial"
              :font-size="100"
              layout-mode="single"
              @progress="onViewerProgress"
            />
            <PdfReader
              v-else-if="format === 'pdf'"
              ref="readerRef"
              :book-id="bookId"
              :file-url="fileUrl"
              :annotations="[]"
              :initial="viewerInitial"
              :has-cover="false"
              layout-mode="single"
              @progress="onViewerProgress"
            />
          </div>

          <div class="statusbar">
            <div class="sb-left">
              <span>{{ branchLabel }}</span>
              <span v-if="mode === 'text'">Ln {{ page + 1 }}, Col 1</span>
              <span v-else>Preview</span>
              <span>{{ percent }}%</span>
            </div>
            <div class="sb-right">
              <span>UTF-8</span>
              <span>{{ mode === 'text' ? 'Markdown' : (format === 'pdf' ? 'PDF Preview' : 'Preview') }}</span>
              <span>{{ theme === 'cursor' ? 'Cursor Tab' : 'Prettier' }}</span>
              <span v-if="mode === 'text'">{{ page + 1 }} / {{ totalPages || '…' }}</span>
              <span v-else>{{ statusLabel }}</span>
            </div>
          </div>
        </section>

        <aside class="chat" v-if="theme === 'cursor' && chatOpen">
          <div class="chat-head">
            <span>Chat</span>
            <button class="mini" @click="chatOpen = false">×</button>
          </div>
          <div class="chat-body">
            <div class="bubble user">继续帮我看这段逻辑，别改接口。</div>
            <div class="bubble ai">
              <p>好的，我先按文件上下文阅读。</p>
              <pre v-if="mode === 'text'" class="ai-quote">{{ pagePreview }}</pre>
              <pre v-else class="ai-quote">正在预览二进制/排版资源，建议按页翻看截图式内容。</pre>
              <p>需要我继续往下翻，还是抽出关键步骤？</p>
            </div>
          </div>
          <div class="chat-input">
            <span>Ask Cursor…</span>
            <em>⌘⏎</em>
          </div>
        </aside>
      </div>
    </template>

    <!-- ========== Terminal ========== -->
    <template v-else>
      <div class="term-chrome">
        <div class="traffic">
          <i class="c red"></i><i class="c yellow"></i><i class="c green"></i>
        </div>
        <span class="term-title">{{ termTitle }}</span>
        <div class="titlebar-right">
          <button class="tb-btn" @click.stop="cycleTheme">{{ themeLabel }}</button>
          <button class="tb-btn danger" @click.stop="$emit('exit')">退出</button>
        </div>
      </div>

      <div v-if="mode === 'text'" class="term-body" ref="paneEl">
        <div class="term-line dim">{{ userHost }}:~/work/app$ less docs/brief.md</div>
        <div class="term-line dim"># {{ camouflageName }} — page {{ page + 1 }}/{{ totalPages || '?' }} ({{ percent }}%)</div>
        <div class="term-line dim"># keys: j/k ↑↓ PgUp/PgDn  next/prev · q Esc quit</div>
        <pre class="term-pre" :style="{ fontSize: fontPx + 'px' }">{{ pageText }}</pre>
        <div class="term-prompt">:</div>
      </div>

      <div v-else class="term-viewer">
        <div class="term-line dim term-pad">{{ userHost }}:~/work/app$ open docs/brief.pdf</div>
        <div class="viewer-pane terminal-viewer">
          <EpubReader
            v-if="format === 'epub'"
            ref="readerRef"
            :book-id="bookId"
            :file-url="fileUrl"
            :annotations="[]"
            :initial="viewerInitial"
            :font-size="100"
            layout-mode="single"
            @progress="onViewerProgress"
          />
          <PdfReader
            v-else-if="format === 'pdf'"
            ref="readerRef"
            :book-id="bookId"
            :file-url="fileUrl"
            :annotations="[]"
            :initial="viewerInitial"
            :has-cover="false"
            layout-mode="single"
            @progress="onViewerProgress"
          />
        </div>
      </div>
    </template>

    <div v-if="loading" class="boot">
      <div class="boot-card">
        <div class="spin">⟳</div>
        <p>Indexing workspace…</p>
      </div>
    </div>
    <div v-if="error" class="boot">
      <div class="boot-card err">
        <p>{{ error }}</p>
        <button class="tb-btn" @click="$emit('exit')">返回</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { extractEpubTextPages } from '../lib/epubText.js'
import EpubReader from './EpubReader.vue'
import PdfReader from './PdfReader.vue'

const props = defineProps({
  bookId: { type: String, required: true },
  fileUrl: { type: String, required: true },
  bookTitle: { type: String, default: '' },
  bookAuthor: { type: String, default: '' },
  format: { type: String, default: 'epub' }, // epub | pdf
  initialPage: { type: Number, default: 0 },
  initial: { type: Object, default: null },
  theme: { type: String, default: 'cursor' } // cursor | vscode | terminal
})

const emit = defineEmits(['exit', 'progress', 'theme-change'])

const rootEl = ref(null)
const paneEl = ref(null)
const readerRef = ref(null)
const loading = ref(true)
const error = ref('')
const mode = ref('text') // text | viewer
const pages = ref([])
const page = ref(0)
const sidebarOpen = ref(true)
const chatOpen = ref(true)
const fontPx = ref(14)
const activeFile = ref('docs/brief.md')
const viewerPercent = ref(0)
const viewerPage = ref(1)
const viewerTotal = ref(0)

const FAKE_TREE = [
  { path: 'src', name: 'src', folder: true, depth: 0 },
  { path: 'src/agent', name: 'agent', folder: true, depth: 1 },
  { path: 'src/agent/runner.ts', name: 'runner.ts', folder: false, depth: 2 },
  { path: 'src/agent/prompts.ts', name: 'prompts.ts', folder: false, depth: 2 },
  { path: 'src/utils', name: 'utils', folder: true, depth: 1 },
  { path: 'src/utils/http.ts', name: 'http.ts', folder: false, depth: 2 },
  { path: 'docs', name: 'docs', folder: true, depth: 0 },
  { path: 'docs/brief.md', name: 'brief.md', folder: false, depth: 1 },
  { path: 'docs/changelog.md', name: 'changelog.md', folder: false, depth: 1 },
  { path: 'package.json', name: 'package.json', folder: false, depth: 0 },
  { path: 'README.md', name: 'README.md', folder: false, depth: 0 }
]

const fakeFiles = FAKE_TREE
const softTabs = ['src/agent/runner.ts', 'src/utils/http.ts']

const themeLabel = computed(() => ({
  cursor: 'Cursor',
  vscode: 'VS Code',
  terminal: 'Terminal'
}[props.theme] || props.theme))

const modeClass = computed(() => (mode.value === 'viewer' ? 'is-viewer' : 'is-text'))
const projectName = computed(() => (props.theme === 'cursor' ? 'WORKSPACE' : 'APP'))
const branchLabel = computed(() => (props.theme === 'cursor' ? '⎇ main*' : 'main*'))
const camouflageName = computed(() => 'workspace-notes')
const userHost = computed(() => 'allen@macbook')

const windowTitle = computed(() => {
  const file = activeFile.value.split('/').pop()
  if (props.theme === 'cursor') return `${file} — ${projectName.value} — Cursor`
  return `${file} — ${projectName.value} — Visual Studio Code`
})

const termTitle = computed(() => `${userHost.value} — ${mode.value === 'viewer' ? 'preview' : 'less'} — 80x24`)

const totalPages = computed(() => pages.value.length)
const pageText = computed(() => pages.value[page.value] || '')
const percent = computed(() => {
  if (mode.value === 'viewer') return Math.round(viewerPercent.value || 0)
  if (!totalPages.value) return 0
  return Math.min(100, Math.round(((page.value + 1) / totalPages.value) * 1000) / 10)
})

const statusLabel = computed(() => {
  if (viewerTotal.value) return `${viewerPage.value} / ${viewerTotal.value}`
  return `${percent.value}%`
})

const pageLines = computed(() => (pageText.value ? pageText.value.split('\n') : ['']))
const lineCount = computed(() => Math.max(pageLines.value.length, 24))

const decoratedPage = computed(() => {
  const body = pageText.value || ''
  return [
    `<!-- ${camouflageName.value} | chunk ${page.value + 1} -->`,
    '',
    body,
    '',
    `<!-- end chunk ${page.value + 1} / ${totalPages.value || '?'} -->`
  ].join('\n')
})

const pagePreview = computed(() => {
  const t = pageText.value.replace(/\s+/g, ' ').trim()
  return t.slice(0, 160) + (t.length > 160 ? '…' : '')
})

const viewerInitial = computed(() => props.initial || null)

let oldTitle = ''

onMounted(async () => {
  oldTitle = document.title
  applyDocTitle()
  rootEl.value?.focus()

  // PDF 直接走内嵌阅读器
  if (props.format === 'pdf') {
    mode.value = 'viewer'
    activeFile.value = 'docs/brief.pdf'
    loading.value = false
    await nextTick()
    rootEl.value?.focus()
    return
  }

  try {
    const data = await extractEpubTextPages(props.fileUrl, { charsPerPage: 1000 })
    pages.value = data.pages || []
    if (!pages.value.length) {
      // 扫描版 / 纯图片 EPUB：回退到内嵌阅读器
      mode.value = 'viewer'
      activeFile.value = 'docs/preview.bin.md'
      loading.value = false
      await nextTick()
      rootEl.value?.focus()
      return
    }
    const start = Math.min(Math.max(0, props.initialPage | 0), pages.value.length - 1)
    page.value = start
    mode.value = 'text'
    loading.value = false
    emitProgress()
  } catch (err) {
    // 解析失败也回退到阅读器，而不是直接报错挡住
    console.warn('[disguise] text extract failed, fallback to viewer', err)
    mode.value = 'viewer'
    activeFile.value = 'docs/preview.bin.md'
    loading.value = false
    await nextTick()
    rootEl.value?.focus()
  }
})

onBeforeUnmount(() => {
  document.title = oldTitle || '书架 · 电子书阅读平台'
})

watch(
  () => props.theme,
  () => {
    applyDocTitle()
  }
)

watch(page, () => {
  applyDocTitle()
  emitProgress()
  if (paneEl.value) paneEl.value.scrollTop = 0
})

function applyDocTitle() {
  document.title = props.theme === 'terminal' ? termTitle.value : windowTitle.value
}

function emitProgress() {
  if (mode.value !== 'text') return
  emit('progress', {
    percent: percent.value,
    page: page.value + 1,
    totalPages: totalPages.value,
    location: `disguise:${page.value}`,
    chapter: '',
    kind: 'disguise'
  })
  try {
    localStorage.setItem('disguise_page_' + props.bookId, String(page.value))
  } catch {
    /* ignore */
  }
}

function onViewerProgress(p) {
  viewerPercent.value = p.percent || 0
  viewerPage.value = p.page || 1
  viewerTotal.value = p.totalPages || 0
  emit('progress', {
    ...p,
    kind: p.kind || props.format
  })
}

function next() {
  if (mode.value === 'viewer') {
    readerRef.value?.nextPage?.() || readerRef.value?.next?.()
    return
  }
  if (page.value < totalPages.value - 1) page.value += 1
}

function prev() {
  if (mode.value === 'viewer') {
    readerRef.value?.prevPage?.() || readerRef.value?.prev?.()
    return
  }
  if (page.value > 0) page.value -= 1
}

function onKey(e) {
  const k = e.key
  if (k === 'Escape' || k === 'q') {
    e.preventDefault()
    emit('exit')
    return
  }
  if (k === 'ArrowDown' || k === 'ArrowRight' || k === 'PageDown' || k === 'j' || k === 'J' || (k === ' ' && !e.shiftKey)) {
    e.preventDefault()
    next()
  } else if (k === 'ArrowUp' || k === 'ArrowLeft' || k === 'PageUp' || k === 'k' || k === 'K' || (k === ' ' && e.shiftKey)) {
    e.preventDefault()
    prev()
  } else if (k === '+' || k === '=') {
    fontPx.value = Math.min(22, fontPx.value + 1)
  } else if (k === '-' || k === '_') {
    fontPx.value = Math.max(12, fontPx.value - 1)
  } else if (k === 't' || k === 'T') {
    cycleTheme()
  }
}

function cycleTheme() {
  const order = ['cursor', 'vscode', 'terminal']
  const i = order.indexOf(props.theme)
  const nextTheme = order[(i + 1) % order.length]
  emit('theme-change', nextTheme)
}

function fileIcon(path) {
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return '🟦'
  if (path.endsWith('.js')) return '🟨'
  if (path.endsWith('.md')) return '📝'
  if (path.endsWith('.json')) return '🧱'
  if (path.endsWith('.pdf')) return '📕'
  return '📄'
}

defineExpose({ next, prev })
</script>

<style scoped>
.disguise {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  outline: none;
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  user-select: text;
}

.titlebar, .term-chrome {
  height: 38px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  background: #2c2c2c;
  border-bottom: 1px solid #0006;
  flex-shrink: 0;
}
.traffic { display: flex; gap: 7px; width: 60px; }
.c { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
.c.red { background: #ff5f57; }
.c.yellow { background: #febc2e; }
.c.green { background: #28c840; }
.titlebar-center { flex: 1; text-align: center; }
.win-title, .term-title { font-size: 12px; color: #bbb; }
.titlebar-right { display: flex; gap: 6px; }
.tb-btn {
  border: 1px solid #555;
  background: #3a3a3a;
  color: #ddd;
  font-size: 11px;
  border-radius: 5px;
  padding: 3px 8px;
  cursor: pointer;
}
.tb-btn:hover { background: #4a4a4a; }
.tb-btn.danger { border-color: #744; color: #f8b; }

.ide-body { flex: 1; display: flex; min-height: 0; }
.activity {
  width: 48px;
  background: #333;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  gap: 4px;
  flex-shrink: 0;
}
.act {
  width: 40px;
  height: 40px;
  border: none;
  background: transparent;
  color: #999;
  font-size: 16px;
  border-radius: 8px;
  cursor: default;
}
.act.active { color: #fff; background: #444; }
.act-spacer { flex: 1; }

.sidebar {
  width: 220px;
  background: #252526;
  border-right: 1px solid #1a1a1a;
  overflow: auto;
  flex-shrink: 0;
  font-size: 12px;
}
.side-head {
  padding: 10px 14px 4px;
  font-size: 10px;
  letter-spacing: 0.08em;
  color: #999;
}
.side-project {
  padding: 4px 14px 10px;
  font-weight: 600;
  color: #ddd;
}
.tree { list-style: none; margin: 0; padding: 0 0 16px; }
.tree li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  cursor: default;
  color: #ccc;
}
.tree li.folder { color: #bbb; }
.tree li.active { background: #094771; color: #fff; }
.tree .ico { width: 14px; text-align: center; font-size: 11px; }
.tree .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.editor { flex: 1; display: flex; flex-direction: column; min-width: 0; background: #1e1e1e; }
.tabs {
  display: flex;
  align-items: center;
  background: #252526;
  border-bottom: 1px solid #1a1a1a;
  height: 35px;
  overflow: hidden;
}
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  height: 100%;
  font-size: 12px;
  color: #bbb;
  border-right: 1px solid #1a1a1a;
  background: #2d2d2d;
}
.tab.active { background: #1e1e1e; color: #fff; }
.tab.dim { opacity: 0.55; }
.tab em { font-style: normal; opacity: 0.5; margin-left: 4px; }
.tabs-grow { flex: 1; }
.tab-hint { font-size: 11px; color: #666; padding-right: 12px; white-space: nowrap; }

.code-pane {
  flex: 1;
  display: flex;
  overflow: auto;
  min-height: 0;
  background: #1e1e1e;
}
.gutter {
  width: 52px;
  flex-shrink: 0;
  padding: 16px 8px;
  text-align: right;
  color: #858585;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  line-height: 1.65;
  user-select: none;
  border-right: 1px solid #2a2a2a;
}
.gutter span { display: block; }
.code {
  margin: 0;
  padding: 16px 18px;
  flex: 1;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  line-height: 1.65;
  color: #d4d4d4;
}
.vscode .code { color: #ce9178; }
.cursor .code { color: #c8c8c8; }

.viewer-pane {
  position: relative;
  flex: 1;
  min-height: 0;
  background: #111;
  overflow: hidden;
}
.viewer-mask-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 5;
  height: 22px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  font-size: 11px;
  color: #8a8a8a;
  background: linear-gradient(#1e1e1e, transparent);
  pointer-events: none;
}
.viewer-pane :deep(.epub-wrap),
.viewer-pane :deep(.pdf-wrap) {
  height: 100%;
  background: #1e1e1e;
}
.viewer-pane :deep(.nav-arrow) {
  opacity: 0.35;
}
.viewer-pane :deep(.book-spine) {
  display: none;
}

.statusbar {
  height: 24px;
  background: #007acc;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  font-size: 11px;
  flex-shrink: 0;
}
.cursor .statusbar { background: #0e639c; }
.sb-left, .sb-right { display: flex; gap: 14px; }

.chat {
  width: 300px;
  background: #181818;
  border-left: 1px solid #2a2a2a;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.chat-head {
  height: 35px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid #2a2a2a;
  font-size: 12px;
  color: #ddd;
}
.mini { background: none; border: none; color: #888; cursor: pointer; font-size: 16px; }
.chat-body { flex: 1; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.bubble { border-radius: 10px; padding: 10px 12px; font-size: 12px; line-height: 1.55; }
.bubble.user { align-self: flex-end; background: #2b2b2b; color: #ddd; max-width: 90%; }
.bubble.ai { align-self: stretch; background: #1f1f1f; border: 1px solid #333; color: #ccc; }
.ai-quote {
  margin: 8px 0;
  padding: 8px;
  background: #111;
  border-left: 2px solid #0e639c;
  white-space: pre-wrap;
  word-break: break-word;
  color: #9cdcfe;
  font-size: 11px;
  max-height: 160px;
  overflow: hidden;
}
.chat-input {
  margin: 10px;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  justify-content: space-between;
  color: #777;
  font-size: 12px;
}

.disguise.terminal { background: #0c0c0c; color: #d6ffd6; }
.term-chrome { background: #1a1a1a; }
.term-body {
  flex: 1;
  overflow: auto;
  padding: 14px 16px 24px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  background: #0c0c0c;
}
.term-viewer {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #0c0c0c;
}
.term-pad { padding: 10px 16px 0; }
.terminal-viewer {
  margin: 8px 12px 12px;
  border: 1px solid #1f3a1f;
  border-radius: 6px;
}
.term-line { font-size: 12px; margin-bottom: 4px; }
.term-line.dim { color: #6a9; opacity: 0.85; }
.term-pre {
  margin: 12px 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.7;
  color: #c8f7c8;
}
.term-prompt {
  color: #7f7;
  font-weight: 700;
}

.boot {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5;
}
.boot-card {
  background: #222;
  border: 1px solid #444;
  border-radius: 10px;
  padding: 24px 28px;
  text-align: center;
  color: #ddd;
  min-width: 220px;
}
.boot-card.err { color: #f8b; }
.spin { font-size: 28px; animation: spin 1s linear infinite; margin-bottom: 8px; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 900px) {
  .sidebar, .chat { display: none; }
  .tab-hint { display: none; }
}
</style>
