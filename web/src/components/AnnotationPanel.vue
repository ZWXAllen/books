<template>
  <aside class="panel" :class="{ open }">
    <div class="p-head">
      <div class="tabs">
        <button class="tab" :class="{ active: tab === 'notes' }" @click="tab = 'notes'">
          批注 <em>{{ annotations.length }}</em>
        </button>
        <button v-if="toc && toc.length" class="tab" :class="{ active: tab === 'toc' }" @click="tab = 'toc'">
          目录
        </button>
      </div>
      <div class="head-actions">
        <button
          v-if="tab === 'notes' && annotations.length"
          class="btn btn-ghost btn-icon export-btn"
          @click="exportMarkdownNotes(book, annotations)"
          title="导出 Markdown 读书笔记"
        >
          📥
        </button>
        <button class="btn btn-ghost btn-icon" @click="$emit('close')" title="收起">✕</button>
      </div>
    </div>

    <div v-if="tab === 'notes'" class="p-body">
      <div v-if="!annotations.length" class="empty">
        <div class="e-ico">✎</div>
        <p>还没有划线或批注</p>
        <span>阅读时选中文字即可添加</span>
      </div>

      <div
        v-for="a in annotations"
        :key="a.id"
        class="note-item"
        :class="{ active: a.id === activeId }"
        @click="$emit('goto', a)"
      >
        <div class="n-top">
          <span class="n-dot" :style="{ background: colorOf(a.color).solid }"></span>
          <span class="n-loc">{{ locationLabel(a) }}</span>
          <span class="n-time">{{ formatTime(a.updatedAt || a.createdAt) }}</span>
          <div class="n-actions">
            <button class="mini" title="编辑" @click.stop="$emit('edit', a)">✎</button>
            <button class="mini danger" title="删除" @click.stop="$emit('remove', a)">🗑</button>
          </div>
        </div>
        <p class="n-quote">{{ a.text }}</p>
        <p v-if="a.note" class="n-note">{{ a.note }}</p>
      </div>
    </div>

    <div v-else class="p-body">
      <div
        v-for="(item, i) in toc"
        :key="i"
        class="toc-item"
        :style="{ paddingLeft: 12 + (item.depth || 0) * 14 + 'px' }"
        @click="$emit('toc', item)"
      >
        {{ item.label }}
      </div>
    </div>
  </aside>
</template>

<script setup>
import { ref } from 'vue'
import { colorOf } from '../constants.js'
import { exportMarkdownNotes } from '../lib/sync.js'

const props = defineProps({
  book: { type: Object, default: null },
  annotations: { type: Array, default: () => [] },
  toc: { type: Array, default: () => [] },
  open: Boolean,
  activeId: { type: String, default: '' },
  format: { type: String, default: 'pdf' }
})

defineEmits(['goto', 'edit', 'remove', 'close', 'toc'])

const tab = ref('notes')

function locationLabel(a) {
  if (a.chapter) return a.chapter
  if (a.page) return `第 ${a.page} 页`
  return '—'
}

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const pad = (n) => String(n).padStart(2, '0')
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `${d.getMonth() + 1}/${d.getDate()}`
}
</script>

<style scoped>
.panel {
  width: 320px;
  flex-shrink: 0;
  background: var(--surface);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.p-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 8px 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.export-btn {
  font-size: 14px;
  color: var(--text-2);
}

.export-btn:hover {
  color: var(--accent);
}


.tabs {
  display: flex;
  gap: 4px;
}

.tab {
  padding: 6px 12px;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 550;
  color: var(--text-2);
}

.tab em {
  font-style: normal;
  font-size: 11px;
  opacity: 0.6;
  margin-left: 2px;
}

.tab.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.p-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}

.empty {
  text-align: center;
  padding: 56px 16px;
  color: var(--text-3);
}

.e-ico {
  font-size: 30px;
  margin-bottom: 10px;
  opacity: 0.5;
}

.empty p {
  margin: 0 0 4px;
  font-size: 13px;
  color: var(--text-2);
}

.empty span {
  font-size: 11.5px;
}

.note-item {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
}

.note-item:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}

.note-item.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.n-top {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.n-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}

.n-loc {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-2);
}

.n-time {
  font-size: 10.5px;
  color: var(--text-3);
}

.n-actions {
  margin-left: auto;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s;
}

.note-item:hover .n-actions {
  opacity: 1;
}

.mini {
  font-size: 11px;
  padding: 2px 5px;
  border-radius: 5px;
  color: var(--text-3);
}

.mini:hover {
  background: var(--surface-2);
  color: var(--text);
}

.mini.danger:hover {
  background: var(--danger-soft);
  color: var(--danger);
}

.n-quote {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-2);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.n-note {
  margin: 8px 0 0;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}

.toc-item {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  color: var(--text-2);
}

.toc-item:hover {
  background: var(--surface-2);
  color: var(--text);
}
</style>
