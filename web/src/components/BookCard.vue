<template>
  <article class="card" :class="{ 'is-reading': percent > 0 && !finished }" @click="$emit('open', book)">
    <div class="cover">
      <img v-if="book.coverUrl && !imgFailed" :src="book.coverUrl" :alt="book.title" loading="lazy" @error="imgFailed = true" />
      <div v-else class="cover-fallback" :style="fallbackStyle">
        <div class="cf-format">{{ book.format.toUpperCase() }}</div>
        <div class="cf-title">{{ book.title }}</div>
        <div class="cf-author">{{ book.author || book.fileName }}</div>
      </div>

      <span class="badge-format" :class="book.format">{{ book.format.toUpperCase() }}</span>
      <span v-if="finished" class="badge-finished">已读完</span>

      <div class="cover-progress" v-if="percent > 0">
        <div class="bar"><i :style="{ width: percent + '%' }"></i></div>
      </div>

    </div>

    <div class="meta">
      <h3 class="title" :title="book.title">{{ book.title }}</h3>
      <p class="author" :title="book.author || book.fileName">{{ book.author || '未知作者' }}</p>
      <div class="status">
        <template v-if="percent > 0">
          <div class="mini-bar"><i :style="{ width: percent + '%' }"></i></div>
          <span class="pct" :class="{ done: finished }">{{ finished ? '100%' : percent + '%' }}</span>
        </template>
        <template v-else>
          <span class="unread">未开始</span>
          <span v-if="book.pageCount" class="pages">{{ book.pageCount }} {{ book.format === 'epub' ? '章' : '页' }}</span>
        </template>
      </div>
    </div>
  </article>
</template>

<script setup>
import { computed, ref } from 'vue'

const props = defineProps({ book: { type: Object, required: true } })
defineEmits(['open'])

const imgFailed = ref(false)
const percent = computed(() => Math.round(props.book.progress?.percent || 0))
const finished = computed(() => percent.value >= 99.5)

const PALETTES = [
  ['#4f6ef7', '#7f4ff7'],
  ['#1f9d63', '#0f766e'],
  ['#e0483f', '#a83279'],
  ['#f59e0b', '#d946ef'],
  ['#0ea5e9', '#4f46e5'],
  ['#14b8a6', '#0f766e'],
  ['#8b5cf6', '#ec4899'],
  ['#64748b', '#1e293b']
]

const fallbackStyle = computed(() => {
  const key = props.book.title || props.book.fileName || ''
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  const [a, b] = PALETTES[h % PALETTES.length]
  return { backgroundImage: `linear-gradient(150deg, ${a}, ${b})` }
})
</script>

<style scoped>
.card {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  height: 100%;
}

.cover {
  position: relative;
  aspect-ratio: 2 / 3;
  border-radius: 10px;
  overflow: hidden;
  background: var(--surface-3);
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow:
    0 4px 14px rgba(15, 23, 42, 0.08),
    0 1px 3px rgba(15, 23, 42, 0.04);
  transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.3, 1), box-shadow 0.25s;
}

.card:hover .cover {
  transform: translateY(-6px);
  box-shadow:
    0 20px 36px rgba(15, 23, 42, 0.16),
    0 4px 10px rgba(15, 23, 42, 0.06);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cover-fallback {
  width: 100%;
  height: 100%;
  padding: 18px 16px;
  display: flex;
  flex-direction: column;
  color: #fff;
  position: relative;
}

.cf-format {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  opacity: 0.75;
}

.cf-title {
  margin-top: auto;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
}

.cf-author {
  margin-top: 8px;
  font-size: 12px;
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.badge-format {
  position: absolute;
  top: 10px;
  left: 10px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 2.5px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(8px);
  color: #2a2f3a;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
}

.badge-format.pdf {
  color: #b3261e;
}

.badge-format.epub {
  color: #1f6f45;
}

.badge-finished {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 10px;
  font-weight: 700;
  padding: 3px 7px;
  border-radius: 5px;
  background: rgba(31, 157, 99, 0.95);
  color: #fff;
}

.cover-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 14px 8px 7px;
  background: linear-gradient(to top, rgba(10, 14, 22, 0.62), transparent);
}

.cover-progress .bar,
.mini-bar {
  height: 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.35);
  overflow: hidden;
}

.cover-progress .bar i,
.mini-bar i {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: #fff;
  transition: width 0.35s ease;
}


.meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: 0 2px;
}

.title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.4;
  height: 2.8em;
  color: var(--text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
  transition: color 0.15s ease;
}

.card:hover .title {
  color: var(--accent);
}

.author {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.4;
  height: 1.4em;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  padding-top: 8px;
  height: 24px;
}

.mini-bar {
  flex: 1;
  height: 4px;
  background: var(--surface-3);
}

.mini-bar i {
  background: var(--accent);
}

.pct {
  font-size: 11px;
  font-weight: 650;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.pct.done {
  color: var(--success);
}

.unread {
  font-size: 11.5px;
  color: var(--text-3);
}

.pages {
  font-size: 11.5px;
  color: var(--text-3);
  margin-left: auto;
}
</style>
