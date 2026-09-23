/**
 * 云端同步与数据备份模块 (基于 GitHub Secret Gist)
 * 权限最小化：仅需 gist 权限，绝不触碰任何代码库 (repo)
 */

const GIST_TOKEN_KEY = 'ebook_gist_token'
const GIST_ID_KEY = 'ebook_gist_id'
const GIST_USER_KEY = 'ebook_gist_user'
const GIST_FILENAME = 'ebook-shelf-notes.json'
const GIST_DESC = 'Ebook Shelf - 阅读笔记与进度同步 (Private)'

export const ONE_CLICK_TOKEN_URL =
  'https://github.com/settings/tokens/new?description=Ebook%20Shelf%20Sync&scopes=gist&default_expires_at=90'

export function getSyncState() {
  return {
    token: localStorage.getItem(GIST_TOKEN_KEY) || '',
    gistId: localStorage.getItem(GIST_ID_KEY) || '',
    username: localStorage.getItem(GIST_USER_KEY) || '',
    isConfigured: !!(localStorage.getItem(GIST_TOKEN_KEY) && localStorage.getItem(GIST_ID_KEY))
  }
}

export function clearSyncConfig() {
  localStorage.removeItem(GIST_TOKEN_KEY)
  localStorage.removeItem(GIST_ID_KEY)
  localStorage.removeItem(GIST_USER_KEY)
}

/** 收集所有本地书籍的笔记与阅读进度数据 */
export function collectLocalData() {
  const annotations = {}
  const progress = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key.startsWith('ebook_ann_')) {
      const bookId = key.replace('ebook_ann_', '')
      try {
        annotations[bookId] = JSON.parse(localStorage.getItem(key))
      } catch {
        /* ignore */
      }
    } else if (key.startsWith('ebook_prog_')) {
      const bookId = key.replace('ebook_prog_', '')
      try {
        progress[bookId] = JSON.parse(localStorage.getItem(key))
      } catch {
        /* ignore */
      }
    }
  }
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    annotations,
    progress
  }
}

/** 将云端数据恢复写入本地 localStorage */
export function restoreLocalData(data) {
  if (!data || typeof data !== 'object') return false
  if (data.annotations) {
    for (const [bookId, list] of Object.entries(data.annotations)) {
      if (Array.isArray(list)) {
        localStorage.setItem('ebook_ann_' + bookId, JSON.stringify(list))
      }
    }
  }
  if (data.progress) {
    for (const [bookId, p] of Object.entries(data.progress)) {
      if (p && typeof p === 'object') {
        localStorage.setItem('ebook_prog_' + bookId, JSON.stringify(p))
      }
    }
  }
  return true
}

/** 连接并验证 GitHub Token，自动查找或创建 Secret Gist */
export async function connectGist(rawToken) {
  const token = (rawToken || '').trim()
  if (!token) throw new Error('Token 不能为空')

  // 1. 验证用户身份
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json'
    }
  })
  if (!userRes.ok) {
    if (userRes.status === 401) throw new Error('Token 无效或已过期，请重新创建')
    throw new Error(`连接 GitHub 失败 (${userRes.status})`)
  }
  const user = await userRes.json()
  const username = user.login || 'GitHub 用户'

  // 2. 检查是否已有专属的 Secret Gist
  let gistId = ''
  let remoteData = null
  const listRes = await fetch('https://api.github.com/gists?per_page=50', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json'
    }
  })
  if (listRes.ok) {
    const gists = await listRes.json()
    const target = gists.find(
      (g) => g.files?.[GIST_FILENAME] || g.description === GIST_DESC
    )
    if (target) {
      gistId = target.id
      const file = target.files?.[GIST_FILENAME]
      if (file?.raw_url) {
        try {
          const raw = await (await fetch(file.raw_url)).json()
          remoteData = raw
        } catch {
          /* ignore */
        }
      }
    }
  }

  // 3. 若没有，则新建一个私有 Secret Gist
  if (!gistId) {
    const initialContent = JSON.stringify(collectLocalData(), null, 2)
    const createRes = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        description: GIST_DESC,
        public: false, // 私有 Gist，仅自己可见
        files: {
          [GIST_FILENAME]: { content: initialContent }
        }
      })
    })
    if (!createRes.ok) {
      throw new Error(`创建 Secret Gist 失败 (${createRes.status})，请确认 Token 是否具有 gist 权限`)
    }
    const created = await createRes.json()
    gistId = created.id
  } else if (remoteData) {
    // 恢复云端数据到本地
    restoreLocalData(remoteData)
  }

  // 4. 保存配置到本地
  localStorage.setItem(GIST_TOKEN_KEY, token)
  localStorage.setItem(GIST_ID_KEY, gistId)
  localStorage.setItem(GIST_USER_KEY, username)

  return { success: true, username, gistId, pulled: !!remoteData }
}

/** 推送本地最新笔记与进度至云端 Gist */
export async function pushToGist() {
  const { token, gistId } = getSyncState()
  if (!token || !gistId) return false

  const content = JSON.stringify(collectLocalData(), null, 2)
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      description: GIST_DESC,
      files: {
        [GIST_FILENAME]: { content }
      }
    })
  })
  return res.ok
}

/** 从云端 Gist 拉取并覆盖恢复本地 */
export async function pullFromGist() {
  const { token, gistId } = getSyncState()
  if (!token || !gistId) throw new Error('尚未绑定 Gist Token')

  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json'
    }
  })
  if (!res.ok) throw new Error(`拉取失败 (${res.status})`)
  const gist = await res.json()
  const file = gist.files?.[GIST_FILENAME]
  if (!file?.content) {
    if (file?.raw_url) {
      const raw = await (await fetch(file.raw_url)).json()
      restoreLocalData(raw)
      return true
    }
    throw new Error('未找到笔记数据文件')
  }
  const data = JSON.parse(file.content)
  restoreLocalData(data)
  return true
}

/** 触发文件下载 */
function triggerDownload(fileName, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** 导出当前书籍的 Markdown 读书笔记 */
export function exportMarkdownNotes(book, annotations = []) {
  const title = book?.title || '读书笔记'
  const author = book?.author ? `作者：${book.author}\n` : ''
  const dateStr = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })

  let md = `# 《${title}》读书笔记\n\n`
  md += `> ${author}导出时间：${dateStr}\n`
  md += `> 批注统计：共 ${annotations.length} 条划线与笔记\n\n---\n\n`

  if (!annotations.length) {
    md += `*暂无划线与批注内容*\n`
  } else {
    annotations.forEach((a, i) => {
      const pageText = a.page ? `第 ${a.page} 页` : (a.cfi ? '章节位置' : `条目 ${i + 1}`)
      const time = a.updatedAt ? new Date(a.updatedAt).toLocaleString('zh-CN') : ''
      md += `### ${i + 1}. ${pageText}${time ? ` · ${time}` : ''}\n\n`
      md += `> ${a.text || ''}\n\n`
      if (a.note) {
        md += `💬 **批注思考**：\n\n${a.note}\n\n`
      }
      md += `---\n\n`
    })
  }

  const safeFileName = `${title.replace(/[/\\?%*:|"<>]/g, '_')}_读书笔记.md`
  triggerDownload(safeFileName, md, 'text/markdown;charset=utf-8')
}

/** 导出全部数据的 JSON 备份 */
export function exportBackupJson() {
  const data = collectLocalData()
  const date = new Date().toISOString().slice(0, 10)
  triggerDownload(`ebook_shelf_backup_${date}.json`, JSON.stringify(data, null, 2), 'application/json')
}

/** 从上传的 JSON 文件恢复 */
export async function importBackupJson(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result)
        const ok = restoreLocalData(data)
        if (ok) resolve(true)
        else reject(new Error('数据格式不合法'))
      } catch (err) {
        reject(new Error('无法解析 JSON 文件：' + err.message))
      }
    }
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsText(file)
  })
}
