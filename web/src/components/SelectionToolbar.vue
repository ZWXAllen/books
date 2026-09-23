<template>
  <transition name="pop">
    <div
      v-if="visible"
      class="sel-toolbar"
      :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
      @mousedown.prevent
    >
      <div class="quote" :title="text">{{ short }}</div>
      <div class="row">
        <button
          v-for="c in HIGHLIGHT_COLORS"
          :key="c.key"
          class="dot"
          :style="{ background: c.solid }"
          :title="`划线（${c.label}）`"
          @click="$emit('highlight', c.key)"
        ></button>
        <span class="sep"></span>
        <button class="tb-btn" @click="$emit('note')" title="划线并添加备注">✎ 备注</button>
        <button class="tb-btn" @click="$emit('copy')" title="复制文字">⧉</button>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { computed } from 'vue'
import { HIGHLIGHT_COLORS } from '../constants.js'

const props = defineProps({
  visible: Boolean,
  anchor: { type: Object, default: () => ({ x: 0, y: 0 }) },
  text: { type: String, default: '' }
})

defineEmits(['highlight', 'note', 'copy'])

const short = computed(() => (props.text.length > 34 ? props.text.slice(0, 34) + '…' : props.text))

const pos = computed(() => {
  const W = 300
  const H = 84
  const vw = window.innerWidth
  let x = props.anchor.x - W / 2
  x = Math.max(12, Math.min(x, vw - W - 12))
  let y = props.anchor.y - H - 10
  if (y < 8) y = props.anchor.y + 22
  return { x, y }
})
</script>

<style scoped>
.sel-toolbar {
  position: fixed;
  z-index: 1200;
  width: 300px;
  background: #23262e;
  color: #fff;
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(10, 14, 24, 0.35);
  padding: 9px 10px;
  user-select: none;
}

.quote {
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.62);
  margin-bottom: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.22);
  transition: transform 0.12s ease, border-color 0.12s;
}

.dot:hover {
  transform: scale(1.16);
  border-color: rgba(255, 255, 255, 0.8);
}

.sep {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.18);
  margin: 0 3px;
}

.tb-btn {
  color: rgba(255, 255, 255, 0.9);
  font-size: 12.5px;
  padding: 4px 9px;
  border-radius: 6px;
  white-space: nowrap;
}

.tb-btn:hover {
  background: rgba(255, 255, 255, 0.14);
}

.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.14s ease, transform 0.14s ease;
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.97);
}
</style>
