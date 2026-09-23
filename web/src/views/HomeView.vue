<template>
  <div class="home">
    <header class="topbar">
      <div class="brand">
        <span class="logo">📚</span>
        <div>
          <h1>我的书架</h1>
          <p class="sub" :title="library.libraryDir">{{ library.libraryDir || '未设置书库目录' }}</p>
        </div>
      </div>

      <div class="actions">
        <div class="search">
          <span class="s-ico">🔍</span>
          <input v-model="library.keyword" class="s-input" placeholder="搜索书名、作者…" />
          <button v-if="library.keyword" class="s-clear" @click="library.keyword = ''">✕</button>
        </div>
        <select v-model="library.sort" class="input select">
          <option value="recent">最近阅读</option>
          <option value="title">按书名</option>
          <option value="author">按作者</option>
          <option value="progress">按进度</option>
        </select>
        <button class="btn btn-icon" :title="library.view === 'grid' ? '切换为列表' : '切换为网格'" @click="toggleView">
          {{ library.view === 'grid' ? '▦' : '☰' }}
        </button>
        <button class="btn" :disabled="library.scanning" @click="library.scan()">
          <span :class="{ spin: library.scanning }">⟳</span>
          {{ library.scanning ? scanLabel : '重新扫描' }}
        </button>
        <button class="btn" @click="showSettings = true">⚙ 设置</button>
      </div>
    </header>

    <!-- 统计条 -->
    <section class="stats" v-if="library.exists && library.books.length">
      <div class="stat"><b>{{ library.stats.total }}</b><span>全部藏书</span></div>
      <div class="stat"><b>{{ library.stats.reading }}</b><span>在读</span></div>
      <div class="stat"><b>{{ library.stats.finished }}</b><span>已读完</span></div>
      <div class="stat"><b>{{ library.stats.unread }}</b><span>未开始</span></div>
      <div class="stat wide" v-if="continueBook">
        <div class="cont">
          <span class="cont-label">继续阅读</span>
          <button class="cont-btn" @click="openBook(continueBook)">
            {{ continueBook.title }}
            <em>{{ Math.round(continueBook.progress.percent) }}%</em>
          </button>
        </div>
      </div>
    </section>

    <!-- 分类标签导航栏 -->
    <nav class="categories-bar" v-if="library.exists && library.books.length && library.categories.length > 1">
      <button
        v-for="c in library.categories"
        :key="c.key"
        class="cat-chip"
        :class="{ active: (library.category || 'all') === c.key }"
        @click="library.setCategory(c.key)"
      >
        <span class="cat-label">{{ c.label }}</span>
        <span class="cat-count">{{ c.count }}</span>
      </button>
    </nav>

    <!-- 加载 / 空态 -->
    <div v-if="library.loading && !library.books.length" class="placeholder">
      <div class="ph-spin spin">⟳</div>
      <p>正在扫描书库…</p>
    </div>

    <div v-else-if="!library.exists" class="placeholder">
      <div class="ph-ico">📂</div>
      <h2>还没有设置书库目录</h2>
      <p>选择一个存放电子书的文件夹，我会自动扫描其中的 PDF 与 EPUB。</p>
      <button class="btn btn-primary" @click="showSettings = true">选择目录</button>
    </div>

    <div v-else-if="!library.books.length" class="placeholder">
      <div class="ph-ico">🗂️</div>
      <h2>这个目录里还没有电子书</h2>
      <p>{{ library.libraryDir }}</p>
      <div class="ph-actions">
        <button class="btn btn-primary" @click="showSettings = true">换个目录</button>
        <button class="btn" :disabled="library.scanning" @click="library.scan()">重新扫描</button>
      </div>
    </div>

    <div v-else-if="!library.filtered.length" class="placeholder">
      <div class="ph-ico">🔍</div>
      <h2>没有匹配的书籍</h2>
      <p>当前分类或关键词下未找到书籍</p>
      <button class="btn btn-primary" @click="clearFilter">重置筛选</button>
    </div>

    <!-- 书架 -->
    <template v-else>
      <div class="section-head">
        <h2>{{ sectionTitle }}</h2>
        <span class="count">{{ library.filtered.length }} 本</span>
      </div>

      <div v-if="library.view === 'grid'" class="grid">
        <BookCard v-for="b in library.filtered" :key="b.id" :book="b" @open="openBook" />
      </div>

      <div v-else class="list">
        <div v-for="b in library.filtered" :key="b.id" class="list-row" @click="openBook(b)">
          <div class="lr-cover">
            <img v-if="b.coverUrl" :src="b.coverUrl" :alt="b.title" loading="lazy" />
            <div v-else class="lr-fallback">{{ b.format.toUpperCase() }}</div>
          </div>
          <div class="lr-main">
            <h3>{{ b.title }}</h3>
            <p>{{ b.author || '未知作者' }} · {{ b.format.toUpperCase() }}
              <template v-if="b.pageCount"> · {{ b.pageCount }} {{ b.format === 'epub' ? '章' : '页' }}</template>
            </p>
            <p class="lr-path">{{ b.relPath }}</p>
          </div>
          <div class="lr-progress">
            <template v-if="b.progress.percent > 0">
              <div class="mini-bar"><i :style="{ width: b.progress.percent + '%' }"></i></div>
              <span :class="{ done: b.progress.percent >= 99.5 }">
                {{ b.progress.percent >= 99.5 ? '已读完' : Math.round(b.progress.percent) + '%' }}
              </span>
            </template>
            <span v-else class="muted">未开始</span>
          </div>
        </div>
      </div>
    </template>

    <!-- 扫描进度 -->
    <transition name="fade">
      <div v-if="library.scanning" class="scan-toast">
        <div class="st-bar">
          <i :style="{ width: scanPercent + '%' }"></i>
        </div>
        <div class="st-text">
          正在扫描 {{ library.scanState.done }}/{{ library.scanState.total || '?' }}
          <span v-if="library.scanState.current" class="st-file">· {{ library.scanState.current }}</span>
        </div>
      </div>
    </transition>

    <!-- 封面生成进度 -->
    <transition name="fade">
      <div v-if="library.coverJob" class="scan-toast">
        <div class="st-bar">
          <i :style="{ width: coverPercent + '%' }"></i>
        </div>
        <div class="st-text">
          正在生成 PDF 封面 {{ library.coverJob.done }}/{{ library.coverJob.total }}
          <span class="st-file">· {{ library.coverJob.current }}</span>
          <button class="st-cancel" @click="library.cancelCoverJob()">停止</button>
        </div>
      </div>
    </transition>

    <transition name="fade">
      <div v-if="library.error" class="error-toast" @click="library.error = ''">
        {{ library.error }} <span class="close">✕</span>
      </div>
    </transition>

    <SettingsDialog
      v-if="showSettings"
      :library-dir="library.libraryDir"
      @close="showSettings = false"
      @saved="onDirSaved"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useLibraryStore } from '../stores/library.js'
import BookCard from '../components/BookCard.vue'
import SettingsDialog from '../components/SettingsDialog.vue'

const library = useLibraryStore()
const router = useRouter()
const showSettings = ref(false)

const continueBook = computed(() => {
  const list = library.books.filter((b) => (b.progress?.percent || 0) > 0 && (b.progress?.percent || 0) < 99.5)
  if (!list.length) return null
  return list.sort((a, b) => (b.progress.updatedAt || 0) - (a.progress.updatedAt || 0))[0]
})

const scanPercent = computed(() => {
  const { done, total } = library.scanState
  if (!total) return 8
  return Math.round((done / total) * 100)
})

const scanLabel = computed(() => {
  const { done, total } = library.scanState
  return total ? `${done}/${total}` : '扫描中'
})

const coverPercent = computed(() => {
  const job = library.coverJob
  if (!job || !job.total) return 0
  return Math.round((job.done / job.total) * 100)
})

const sectionTitle = computed(() => {
  if (library.keyword) return `搜索结果 · ${library.filtered.length}`
  const cat = library.categories.find((c) => c.key === library.category)
  if (cat && cat.key !== 'all') return `${cat.label}书籍`
  return '全部书籍'
})

function clearFilter() {
  library.keyword = ''
  library.setCategory('all')
}

function toggleView() {
  library.view = library.view === 'grid' ? 'list' : 'grid'
  localStorage.setItem('shelf-view', library.view)
}

function openBook(book) {
  router.push({ name: 'reader', params: { id: book.id } })
}

async function onDirSaved() {
  showSettings.value = false
  await library.scan()
}

onMounted(async () => {
  const saved = localStorage.getItem('shelf-view')
  if (saved === 'grid' || saved === 'list') library.view = saved
  await library.load()
  // PDF 封面在浏览器端渲染一次后缓存到服务端
  library.generateMissingCovers()
})
</script>

<style scoped>
.home {
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 22px 36px 80px;
  box-sizing: border-box;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  padding-bottom: 18px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.logo {
  font-size: 30px;
  line-height: 1;
}

.brand h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text);
}
.sub {
  margin: 2px 0 0;
  font-size: 11.5px;
  color: var(--text-3);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  max-width: 600px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.search {
  position: relative;
  display: flex;
  align-items: center;
}

.s-ico {
  position: absolute;
  left: 10px;
  font-size: 12px;
  opacity: 0.55;
  pointer-events: none;
}

.s-input {
  height: 36px;
  width: 230px;
  padding: 0 28px 0 32px;
  border-radius: 20px;
  border: 1px solid var(--border);
  background: var(--surface);
  outline: none;
  font-size: 13px;
  transition: border-color 0.15s, box-shadow 0.15s, width 0.2s cubic-bezier(0.2, 0.8, 0.3, 1);
}

.s-input:focus {
  width: 280px;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.s-clear {
  position: absolute;
  right: 8px;
  font-size: 11px;
  color: var(--text-3);
  padding: 2px;
}

.select {
  height: 36px;
  width: auto;
  padding: 0 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}

/* 统计条 */
.stats {
  display: flex;
  gap: 10px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}
.stat {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 18px;
  min-width: 96px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.03);
  transition: all 0.2s ease;
}

.stat:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}

.stat b {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.stat span {
  font-size: 11.5px;
  color: var(--text-3);
}

.stat.wide {
  flex: 1;
  min-width: 260px;
  justify-content: center;
  background: linear-gradient(135deg, #eef2ff 0%, #f7f9ff 100%);
  border-color: #dbe2fe;
  box-shadow: 0 1px 3px rgba(79, 110, 247, 0.05);
}

.cont {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.cont-label {
  font-size: 11px;
  font-weight: 650;
  color: var(--accent);
  letter-spacing: 0.02em;
}

.cont-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 600;
  text-align: left;
  min-width: 0;
}

.cont-btn em {
  font-style: normal;
  font-size: 11.5px;
  color: var(--accent);
  background: #fff;
  padding: 1px 7px;
  border-radius: 10px;
  flex-shrink: 0;
}

.cont-btn:hover {
  color: var(--accent);
}

.categories-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 22px;
  overflow-x: auto;
  padding: 4px 2px 8px;
  scrollbar-width: none;
}

.categories-bar::-webkit-scrollbar {
  display: none;
}

.cat-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 16px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 550;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  transition: all 0.2s cubic-bezier(0.2, 0.8, 0.3, 1);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.cat-chip:hover {
  color: var(--text);
  border-color: var(--border-strong);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

.cat-chip.active {
  background: var(--accent);
  color: #ffffff;
  border-color: var(--accent);
  box-shadow: 0 4px 12px rgba(79, 110, 247, 0.28);
}

.cat-chip .cat-count {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--text-3);
  transition: all 0.2s ease;
}

.cat-chip.active .cat-count {
  background: rgba(255, 255, 255, 0.25);
  color: #ffffff;
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 14px;
}

.section-head h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 650;
}

.count {
  font-size: 12px;
  color: var(--text-3);
}

/* 网格 */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 26px 22px;
  width: 100%;
}

/* 列表 */
.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.list-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}

.list-row:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}

.lr-cover {
  width: 40px;
  height: 58px;
  border-radius: 5px;
  overflow: hidden;
  background: var(--surface-3);
  flex-shrink: 0;
}

.lr-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.lr-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8.5px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(150deg, #64748b, #1e293b);
}

.lr-main {
  flex: 1;
  min-width: 0;
}

.lr-main h3 {
  margin: 0 0 2px;
  font-size: 13.5px;
  font-weight: 620;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lr-main p {
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
}

.lr-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px !important;
  opacity: 0.75;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lr-progress {
  width: 130px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
  font-size: 11.5px;
  font-weight: 650;
  color: var(--accent);
}

.lr-progress .done {
  color: var(--success);
}

.mini-bar {
  flex: 1;
  height: 4px;
  border-radius: 3px;
  background: var(--surface-3);
  overflow: hidden;
}

.mini-bar i {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
}

.muted {
  color: var(--text-3);
  font-weight: 400;
}

/* 占位 */
.placeholder {
  text-align: center;
  padding: 90px 20px;
  color: var(--text-2);
}

.ph-ico {
  font-size: 46px;
  margin-bottom: 14px;
}

.ph-spin {
  font-size: 34px;
  color: var(--accent);
  margin-bottom: 12px;
  display: inline-block;
}

.placeholder h2 {
  margin: 0 0 8px;
  font-size: 17px;
  color: var(--text);
}

.placeholder p {
  margin: 0 0 20px;
  font-size: 13px;
  color: var(--text-3);
  word-break: break-all;
}

.ph-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}

/* Toast */
.scan-toast,
.error-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  padding: 12px 18px;
  min-width: 300px;
  z-index: 900;
}

.st-bar {
  height: 4px;
  border-radius: 3px;
  background: var(--surface-3);
  overflow: hidden;
  margin-bottom: 8px;
}

.st-bar i {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.st-text {
  font-size: 12px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.st-file {
  color: var(--text-3);
}

.st-cancel {
  margin-left: 10px;
  font-size: 11.5px;
  color: var(--accent);
  text-decoration: underline;
}

.error-toast {
  bottom: auto;
  top: 20px;
  background: #fff4f3;
  border-color: #f6c9c5;
  color: #8f2820;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.error-toast .close {
  opacity: 0.5;
}
</style>
