/** 高亮色板：PDF 用 rgba 叠加，EPUB 用 svg fill + opacity */
export const HIGHLIGHT_COLORS = [
  { key: 'yellow', label: '黄', fill: 'rgba(250, 204, 21, 0.45)', solid: '#f5c518' },
  { key: 'green', label: '绿', fill: 'rgba(52, 199, 123, 0.40)', solid: '#22b573' },
  { key: 'blue', label: '蓝', fill: 'rgba(79, 110, 247, 0.34)', solid: '#4f6ef7' },
  { key: 'pink', label: '粉', fill: 'rgba(236, 72, 153, 0.32)', solid: '#e8478f' },
  { key: 'purple', label: '紫', fill: 'rgba(147, 51, 234, 0.30)', solid: '#8b3fe0' }
]

const MAP = Object.fromEntries(HIGHLIGHT_COLORS.map((c) => [c.key, c]))

export function colorOf(key) {
  return MAP[key] || MAP.yellow
}
