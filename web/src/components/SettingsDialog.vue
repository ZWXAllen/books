<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal" style="max-width: 620px">
      <div class="modal-head">
        <h3>书库设置</h3>
        <button class="btn btn-ghost btn-icon" @click="$emit('close')" title="关闭">✕</button>
      </div>

      <div class="modal-body">
        <div class="field">
          <label>电子书目录</label>
          <div class="row">
            <input
              v-model="dir"
              class="input"
              placeholder="例如 /Users/you/Books"
              @keyup.enter="goTo(dir)"
            />
            <button class="btn" :disabled="browsing" @click="goTo(dir)">浏览</button>
          </div>
          <p class="hint">
            支持 <b>PDF</b> 与 <b>EPUB</b>，会递归扫描所有子目录。留空则使用默认目录。
          </p>
        </div>

        <div class="browser">
          <div class="browser-head">
            <button class="btn btn-ghost btn-icon" :disabled="!parent" @click="goTo(parent)" title="上一级">
              ↑
            </button>
            <span class="path" :title="current">{{ current || '—' }}</span>
            <button class="btn btn-ghost btn-icon" @click="goTo(home)" title="主目录">⌂</button>
          </div>
          <div class="browser-list">
            <div v-if="loading" class="browser-empty">读取中…</div>
            <div v-else-if="error" class="browser-empty">{{ error }}</div>
            <div v-else-if="!dirs.length" class="browser-empty">没有子目录</div>
            <button v-for="d in dirs" :key="d.path" class="dir-item" @click="goTo(d.path)">
              <span class="ico">📁</span>
              <span class="name">{{ d.name }}</span>
            </button>
          </div>
        </div>

        <p v-if="message" class="msg" :class="{ error: isError }">{{ message }}</p>
      </div>

      <div class="modal-foot">
        <button class="btn" @click="$emit('close')">取消</button>
        <button class="btn btn-primary" :disabled="saving || !dir" @click="save">
          {{ saving ? '保存中…' : '保存并扫描' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { api } from '../api.js'

const props = defineProps({ libraryDir: { type: String, default: '' } })
const emit = defineEmits(['close', 'saved'])

const dir = ref(props.libraryDir)
const current = ref('')
const parent = ref('')
const dirs = ref([])
const loading = ref(false)
const error = ref('')
const saving = ref(false)
const message = ref('')
const isError = ref(false)
const home = ref('')

onMounted(() => goTo(props.libraryDir || ''))

async function goTo(path) {
  loading.value = true
  error.value = ''
  message.value = ''
  try {
    const res = await api.listDir(path || undefined)
    current.value = res.dir
    parent.value = res.parent === res.dir ? '' : res.parent
    dirs.value = res.dirs
    home.value = home.value || res.dir
    if (!dir.value) dir.value = res.dir
  } catch (err) {
    error.value = err.message
    dirs.value = []
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  message.value = ''
  isError.value = false
  try {
    await api.setConfig(dir.value)
    emit('saved', dir.value)
  } catch (err) {
    message.value = err.message
    isError.value = true
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.row {
  display: flex;
  gap: 8px;
}

.row .input {
  flex: 1;
}

.browser {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface-2);
}

.browser-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.path {
  flex: 1;
  font-size: 12px;
  color: var(--text-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}

.browser-list {
  max-height: 220px;
  overflow: auto;
  padding: 4px;
}

.dir-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border-radius: 6px;
  text-align: left;
  font-size: 13px;
}

.dir-item:hover {
  background: var(--surface);
}

.ico {
  font-size: 14px;
}

.name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.browser-empty {
  padding: 20px;
  text-align: center;
  color: var(--text-3);
  font-size: 12.5px;
}

.msg {
  margin: 0;
  font-size: 12.5px;
  color: var(--success);
}

.msg.error {
  color: var(--danger);
}
</style>
