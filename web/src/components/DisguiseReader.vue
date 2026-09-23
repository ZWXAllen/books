<template>
  <div class="disguise" :class="theme" tabindex="0" ref="rootEl" @keydown="onKey">
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
          <button class="tb-btn" title="切换主题" @click.stop="cycleTheme">{{ themeLabel }}</button>
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
            <li v-for="f in fakeFiles" :key="f.path" :class="{ active: f.path === activeFile, folder: f.folder }" @click="!f.folder && (activeFile = f.path)">
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
            <div class="tab-hint">↑↓ / PgUp PgDn 翻页 · Esc 退出</div>
          </div>

          <div class="code-pane" ref="paneEl">
            <div class="gutter">
              <span v-for="n in lineCount" :key="n">{{ n }}</span>
            </div>
            <pre class="code" :style="{ fontSize: fontPx + 'px' }"><code>{{ decoratedPage }}</code></pre>
          </div>

          <div class="statusbar">
            <div class="sb-left">
              <span>{{ branchLabel }}</span>
              <span>Ln {{ page + 1 }}, Col 1</span>
              <span>{{ percent }}%</span>
            </div>
            <div class="sb-right">
              <span>UTF-8</span>
              <span>Markdown</span>
              <span>{{ theme === 'cursor' ? 'Cursor Tab' : 'Prettier' }}</span>
              <span>{{ page + 1 }} / {{ totalPages || '…' }}</span>
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
              <p>好的，我先按文件上下文阅读。当前这段可以理解成业务说明：</p>
              <pre class="ai-quote">{{ pagePreview }}</pre>
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
      <div class="term-body" ref="paneEl">
        <div class="term-line dim">{{ userHost }}:~/work/app$ less docs/brief.md</div>
        <div class="term-line dim"># {{ camouflageName }} — page {{ page + 1 }}/{{ totalPages || '?' }} ({{ percent }}%)</div>
        <div class="term-line dim"># keys: j/k ↑↓ PgUp/PgDn  next/prev · q Esc quit</div>
        <pre class="term-pre" :style="{ fontSize: fontPx + 'px' }">{{ pageText }}</pre>
        <div class="term-prompt">:</div>
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { extractEpubTextPages } from '../lib/epubText.js'
const props = defineProps({
  bookId: { type: String, required: true },
  fileUrl: { type: String, required: true },
  bookTitle: { type: String, default: '' },
  bookAuthor: { type: String, default: '' },
  initialPage: { type: Number, default: 0 },
  theme: { type: String, default: 'cursor' } // cursor | vscode | terminal
})

const emit = defineEmits(['exit', 'progress', 'theme-change'])

const rootEl = ref(null)
const paneEl = ref(null)
const loading = ref(true)
const error = ref('')
const pages = ref([])
const page = ref(0)
const sidebarOpen = ref(true)
const chatOpen = ref(true)
const fontPx = ref(14)
const activeFile = ref('docs/brief.md')

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

const projectName = computed(() => (props.theme === 'cursor' ? 'WORKSPACE' : 'APP'))
const branchLabel = computed(() => (props.theme === 'cursor' ? '⎇ main*' : 'main*'))
const camouflageName = computed(() => 'workspace-notes')
const userHost = computed(() => 'allen@macbook')

const windowTitle = computed(() => {
  const file = activeFile.value.split('/').pop()
  if (props.theme === 'cursor') return `${file} — ${projectName.value} — Cursor`
  return `${file} — ${projectName.value} — Visual Studio Code`
})

const termTitle = computed(() => `${userHost.value} — less — 80x24`)

const totalPages = computed(() => pages.value.length)
const pageText = computed(() => pages.value[page.value] || '')
const percent = computed(() => {
  if (!totalPages.value) return 0
  return Math.min(100, Math.round(((page.value + 1) / totalPages.value) * 1000) / 10)
})

const pageLines = computed(() => (pageText.value ? pageText.value.split('\n') : ['']))
const lineCount = computed(() => Math.max(pageLines.value.length, 24))

const decoratedPage = computed(() => {
  // 伪装成 markdown / 注释文档，避免一眼看出是小说排版
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

let oldTitle = ''

onMounted(async () => {
  oldTitle = document.title
  applyDocTitle()
  rootEl.value?.focus()

  try {
    const data = await extractEpubTextPages(props.fileUrl, { charsPerPage: 1000 })
    pages.value = data.pages
    if (!pages.value.length) throw new Error('未能从这本书提取到文本（可能是扫描版/纯图片 EPUB）')
    const start = Math.min(Math.max(0, props.initialPage | 0), pages.value.length - 1)
    page.value = start
    loading.value = false
    emitProgress()
  } catch (err) {
    error.value = err.message || String(err)
    loading.value = false
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
  // 滚回顶部
  if (paneEl.value) paneEl.value.scrollTop = 0
})

function applyDocTitle() {
  document.title = props.theme === 'terminal' ? termTitle.value : windowTitle.value
}

function emitProgress() {
  emit('progress', {
    percent: percent.value,
    page: page.value + 1,
    totalPages: totalPages.value,
    location: `disguise:${page.value}`,
    chapter: '',
    kind: 'disguise'
  })
  // 本地额外存伪装页码，方便下次接着看
  try {
    localStorage.setItem('disguise_page_' + props.bookId, String(page.value))
  } catch {
    /* ignore */
  }
}

function next() {
  if (page.value < totalPages.value - 1) page.value += 1
}

function prev() {
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

/* ---- shared title ---- */
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

/* ---- ide layout ---- */
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
.vscode .code { color: #ce9178; } /* 字符串色，更像代码 */
.cursor .code { color: #c8c8c8; }

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

/* ---- terminal ---- */
.disguise.terminal { background: #0c0c0c; color: #d6ffd6; }
.term-chrome { background: #1a1a1a; }
.term-body {
  flex: 1;
  overflow: auto;
  padding: 14px 16px 24px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  background: #0c0c0c;
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

/* ---- boot ---- */
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
