import { ref, computed } from 'vue'
import { api } from '../api.js'

/**
 * 管理一本书的划线 / 批注。
 * 数据结构：
 *  { id, type:'pdf'|'epub', text, color, note, createdAt, updatedAt,
 *    groupId?,                 // 跨页划线同属一个 group
 *    page?, rects?,            // PDF：页码 + 相对页面比例矩形
 *    cfi?,                     // EPUB：CFI range
 *    chapter? }                // EPUB：所在章节标题（用于列表展示）
 */
export function useAnnotations(bookId) {
  const annotations = ref([])
  const loading = ref(false)
  const error = ref('')

  const sorted = computed(() =>
    [...annotations.value].sort((a, b) => {
      const pa = a.page || a.order || 0
      const pb = b.page || b.order || 0
      if (pa !== pb) return pa - pb
      return (a.createdAt || 0) - (b.createdAt || 0)
    })
  )

  const withNotes = computed(() => sorted.value.filter((a) => (a.note || '').trim()))

  async function load() {
    loading.value = true
    try {
      annotations.value = await api.listAnnotations(bookId)
    } catch (err) {
      error.value = err.message
    } finally {
      loading.value = false
    }
  }

  /** segments: [{ page, rects, text }] 或 [{ cfi, text }] */
  async function createMany(payloads) {
    const groupId = payloads.length > 1 ? `g_${Date.now().toString(36)}` : undefined
    const created = []
    for (const p of payloads) {
      const item = await api.createAnnotation(bookId, { ...p, groupId })
      annotations.value.push(item)
      created.push(item)
    }
    return created
  }

  async function update(id, patch) {
    const target = annotations.value.find((a) => a.id === id)
    if (!target) return
    const ids = target.groupId
      ? annotations.value.filter((a) => a.groupId === target.groupId).map((a) => a.id)
      : [id]
    for (const aid of ids) {
      const updated = await api.updateAnnotation(bookId, aid, patch)
      const idx = annotations.value.findIndex((a) => a.id === aid)
      if (idx !== -1) annotations.value[idx] = updated
    }
  }

  async function remove(id) {
    const target = annotations.value.find((a) => a.id === id)
    if (!target) return
    const ids = target.groupId
      ? annotations.value.filter((a) => a.groupId === target.groupId).map((a) => a.id)
      : [id]
    for (const aid of ids) {
      await api.deleteAnnotation(bookId, aid)
      annotations.value = annotations.value.filter((a) => a.id !== aid)
    }
  }

  return { annotations, sorted, withNotes, loading, error, load, createMany, update, remove }
}
