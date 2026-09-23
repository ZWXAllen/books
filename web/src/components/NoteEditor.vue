<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal" style="max-width: 560px">
      <div class="modal-head">
        <h3>{{ isNew ? '添加备注' : '编辑批注' }}</h3>
        <button class="btn btn-ghost btn-icon" @click="$emit('close')">✕</button>
      </div>

      <div class="modal-body">
        <div class="quote-box">
          <span class="q-mark">“</span>
          <p>{{ quote || '（无选中文字）' }}</p>
        </div>

        <div class="field">
          <label>颜色</label>
          <div class="colors">
            <button
              v-for="c in HIGHLIGHT_COLORS"
              :key="c.key"
              class="c-dot"
              :class="{ active: color === c.key }"
              :style="{ background: c.solid }"
              @click="color = c.key"
            ></button>
          </div>
        </div>

        <div class="field">
          <label>备注</label>
          <textarea
            ref="taEl"
            v-model="text"
            class="input area"
            rows="5"
            placeholder="写下你的想法…（⌘/Ctrl + Enter 保存）"
            @keydown.meta.enter="save"
            @keydown.ctrl.enter="save"
          ></textarea>
        </div>
      </div>

      <div class="modal-foot">
        <button v-if="!isNew" class="btn btn-danger" style="margin-right: auto" @click="$emit('delete')">
          删除批注
        </button>
        <button class="btn" @click="$emit('close')">取消</button>
        <button class="btn btn-primary" @click="save">保存</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { HIGHLIGHT_COLORS } from '../constants.js'

const props = defineProps({
  quote: { type: String, default: '' },
  note: { type: String, default: '' },
  colorKey: { type: String, default: 'yellow' },
  isNew: Boolean
})

const emit = defineEmits(['save', 'close', 'delete'])

const text = ref(props.note)
const color = ref(props.colorKey)
const taEl = ref(null)

function save() {
  emit('save', { note: text.value, color: color.value })
}

onMounted(() => {
  nextTick(() => taEl.value?.focus())
})
</script>

<style scoped>
.quote-box {
  position: relative;
  background: var(--surface-2);
  border-left: 3px solid var(--accent);
  border-radius: 0 8px 8px 0;
  padding: 12px 14px 12px 16px;
  max-height: 160px;
  overflow: auto;
}

.quote-box p {
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
  color: var(--text-2);
  white-space: pre-wrap;
}

.q-mark {
  display: none;
}

.colors {
  display: flex;
  gap: 10px;
}

.c-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  outline: 2px solid transparent;
  transition: transform 0.12s, outline-color 0.12s;
}

.c-dot:hover {
  transform: scale(1.1);
}

.c-dot.active {
  outline-color: var(--accent);
  transform: scale(1.06);
}

.area {
  height: auto;
  padding: 10px 12px;
  resize: vertical;
  line-height: 1.6;
}
</style>
