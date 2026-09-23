<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal" style="max-width: 640px">
      <div class="modal-head">
        <div class="head-tabs">
          <button
            class="tab-btn"
            :class="{ active: currentTab === 'sync' }"
            @click="currentTab = 'sync'"
          >
            ☁️ 笔记云同步 & 备份
          </button>
          <button
            class="tab-btn"
            :class="{ active: currentTab === 'dir' }"
            @click="currentTab = 'dir'"
          >
            📁 书库与目录
          </button>
        </div>
        <button class="btn btn-ghost btn-icon" @click="$emit('close')" title="关闭">✕</button>
      </div>

      <div class="modal-body">
        <!-- Tab 1: 云同步与数据备份 -->
        <div v-if="currentTab === 'sync'" class="sync-tab">
          <!-- 安全保障卡片 -->
          <div class="security-card">
            <div class="sec-title">
              <span class="sec-ico">🛡️</span>
              <b>权限最小化安全机制</b>
            </div>
            <p class="sec-desc">
              本工具仅需要 GitHub 的 <code>gist</code> 权限，<b>绝不需要且完全无权访问您的任何代码仓库 (repo)</b>。您的阅读笔记、划线和进度仅保存在您自己账号下的私密 Secret Gist 中，无任何第三方服务器中转。
            </p>
            <a :href="ONE_CLICK_TOKEN_URL" target="_blank" class="one-click-link">
              <span>🔑 一键打开 GitHub 申请 Token（已预勾选 gist）</span>
              <span class="arrow">↗</span>
            </a>
          </div>

          <!-- Token 输入与绑定 -->
          <div class="field">
            <label>GitHub Personal Access Token</label>
            <div class="row">
              <input
                v-model="tokenInput"
                class="input"
                type="password"
                placeholder="粘贴 ghp_xxx 或 github_pat_xxx"
                @keyup.enter="handleConnect"
              />
              <button
                class="btn btn-primary"
                :disabled="connecting || !tokenInput.trim()"
                @click="handleConnect"
              >
                {{ connecting ? '验证中…' : (syncState.isConfigured ? '重新绑定' : '绑定并同步') }}
              </button>
            </div>
            <p class="hint">
              点击上方链接后在 GitHub 页面滚到底部点击绿色按钮 <b>Generate token</b>，复制后粘贴回这里即可。
            </p>
          </div>

          <!-- 绑定状态 -->
          <div v-if="syncState.isConfigured" class="sync-status-box">
            <div class="ss-left">
              <span class="ss-dot"></span>
              <div class="ss-meta">
                <span class="ss-name">已连接账号：<b>@{{ syncState.username }}</b></span>
                <span class="ss-gist">私密 Gist ID：{{ syncState.gistId.slice(0, 10) }}…</span>
              </div>
            </div>
            <div class="ss-actions">
              <button class="btn btn-sm" :disabled="syncing" @click="handlePull">
                {{ syncing ? '同步中…' : '🔄 从云端拉取' }}
              </button>
              <button class="btn btn-sm" :disabled="syncing" @click="handlePush">
                {{ syncing ? '同步中…' : '⬆️ 备份到云端' }}
              </button>
              <button class="btn btn-ghost btn-sm danger" @click="handleUnbind">解绑</button>
            </div>
          </div>

          <div class="divider"></div>

          <!-- 本地离线备份与恢复 -->
          <div class="offline-backup">
            <label class="section-label">本地数据导出与恢复（兜底保障）</label>
            <p class="hint">即使不使用云同步，您也可以随时将全书笔记与进度导出为独立文件。</p>
            <div class="backup-row">
              <button class="btn" @click="exportBackupJson">📥 导出完整数据 (JSON)</button>
              <label class="btn file-btn">
                📤 从文件恢复 (JSON)
                <input type="file" accept=".json" @change="handleImportJson" style="display: none" />
              </label>
            </div>
          </div>

          <p v-if="syncMessage" class="msg" :class="{ error: isSyncError, success: isSyncSuccess }">
            {{ syncMessage }}
          </p>
        </div>

        <!-- Tab 2: 书库与本地目录 -->
        <div v-else class="dir-tab">
          <div class="field">
            <label>当前书库信息</label>
            <div class="dir-info-card">
              <div class="dic-item">
                <span class="dic-label">托管模式</span>
                <span class="dic-val badge">GitHub Pages 静态直连模式</span>
              </div>
              <div class="dic-item">
                <span class="dic-label">书籍存储</span>
                <span class="dic-val">仓库内的 <code>library/</code> 文件夹</span>
              </div>
            </div>
          </div>

          <div class="field" v-if="!isStaticMode">
            <label>本地开发目录选择</label>
            <div class="row">
              <input
                v-model="dir"
                class="input"
                placeholder="例如 /Users/you/Books"
                @keyup.enter="goTo(dir)"
              />
              <button class="btn" :disabled="loading" @click="goTo(dir)">浏览</button>
            </div>
          </div>

          <div class="browser" v-if="!isStaticMode">
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
      </div>

      <div class="modal-foot">
        <button class="btn" @click="$emit('close')">完成</button>
        <button
          v-if="currentTab === 'dir' && !isStaticMode"
          class="btn btn-primary"
          :disabled="saving || !dir"
          @click="save"
        >
          {{ saving ? '保存中…' : '保存并扫描' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { api } from '../api.js'
import {
  ONE_CLICK_TOKEN_URL,
  getSyncState,
  connectGist,
  pushToGist,
  pullFromGist,
  clearSyncConfig,
  exportBackupJson,
  importBackupJson
} from '../lib/sync.js'

const props = defineProps({ libraryDir: { type: String, default: '' } })
const emit = defineEmits(['close', 'saved'])

const currentTab = ref('sync')
const isStaticMode = ref(false)

/* ------------------------------ 同步状态 ------------------------------ */

const syncState = ref(getSyncState())
const tokenInput = ref(syncState.value.token)
const connecting = ref(false)
const syncing = ref(false)
const syncMessage = ref('')
const isSyncError = ref(false)
const isSyncSuccess = ref(false)

async function handleConnect() {
  connecting.value = true
  syncMessage.value = ''
  isSyncError.value = false
  isSyncSuccess.value = false
  try {
    const res = await connectGist(tokenInput.value)
    syncState.value = getSyncState()
    isSyncSuccess.value = true
    syncMessage.value = `✓ 成功连接至 GitHub @${res.username}！${res.pulled ? '已恢复云端笔记。' : '已初始化专属私密 Gist。'}`
    // 立即自动推一次最新本地笔记
    await pushToGist()
  } catch (err) {
    isSyncError.value = true
    syncMessage.value = err.message
  } finally {
    connecting.value = false
  }
}

async function handlePull() {
  syncing.value = true
  syncMessage.value = ''
  isSyncError.value = false
  try {
    await pullFromGist()
    isSyncSuccess.value = true
    syncMessage.value = '✓ 已从云端 Gist 拉取并更新本地笔记与进度'
  } catch (err) {
    isSyncError.value = true
    syncMessage.value = '拉取失败：' + err.message
  } finally {
    syncing.value = false
  }
}

async function handlePush() {
  syncing.value = true
  syncMessage.value = ''
  isSyncError.value = false
  try {
    const ok = await pushToGist()
    if (ok) {
      isSyncSuccess.value = true
      syncMessage.value = '✓ 本地笔记与进度已全部备份至云端 Gist'
    } else {
      throw new Error('网络请求异常')
    }
  } catch (err) {
    isSyncError.value = true
    syncMessage.value = '备份失败：' + err.message
  } finally {
    syncing.value = false
  }
}

function handleUnbind() {
  if (confirm('确定要解绑当前 GitHub Gist 吗？（本地已保存的笔记不会被删除）')) {
    clearSyncConfig()
    syncState.value = getSyncState()
    tokenInput.value = ''
    syncMessage.value = '已解绑'
    isSyncSuccess.value = false
  }
}

async function handleImportJson(e) {
  const file = e.target.files?.[0]
  if (!file) return
  try {
    await importBackupJson(file)
    alert('✓ 数据恢复成功！页面将自动刷新')
    window.location.reload()
  } catch (err) {
    alert('恢复失败：' + err.message)
  }
}

/* ------------------------------ 目录管理 ------------------------------ */

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

onMounted(async () => {
  const cfg = await api.getConfig()
  isStaticMode.value = !!cfg.static
  if (!isStaticMode.value) {
    goTo(props.libraryDir || '')
  }
})

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
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  border-bottom: 1px solid var(--border);
}

.head-tabs {
  display: flex;
  gap: 6px;
}

.tab-btn {
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 13.5px;
  font-weight: 550;
  color: var(--text-2);
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s;
}

.tab-btn:hover {
  color: var(--text);
  background: var(--surface-2);
}

.tab-btn.active {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: #dbe4fe;
}

.modal-body {
  padding: 20px 22px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 安全卡片 */
.security-card {
  background: linear-gradient(135deg, #f0fdf4 0%, #f6fef9 100%);
  border: 1px solid #bbf7d0;
  border-radius: var(--radius);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sec-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
  color: #166534;
}

.sec-desc {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: #15803d;
}

.sec-desc code {
  background: #dcfce7;
  padding: 1px 5px;
  border-radius: 4px;
  font-weight: 600;
}

.one-click-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  padding: 8px 14px;
  border-radius: 8px;
  background: #16a34a;
  color: #ffffff;
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  width: fit-content;
  box-shadow: 0 2px 6px rgba(22, 163, 74, 0.25);
  transition: all 0.15s;
}

.one-click-link:hover {
  background: #15803d;
  transform: translateY(-1px);
}

.row {
  display: flex;
  gap: 8px;
}

.row .input {
  flex: 1;
}

.field label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}

.hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-3);
  line-height: 1.5;
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

.btn.danger,
.danger {
  color: var(--danger);
}


.sync-status-box {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.ss-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ss-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 3px rgba(31, 157, 99, 0.2);
}

.ss-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ss-name {
  font-size: 13px;
  color: var(--text);
}

.ss-gist {
  font-size: 11px;
  color: var(--text-3);
  font-family: monospace;
}

.ss-actions {
  display: flex;
  gap: 6px;
}

.btn-sm {
  padding: 5px 10px;
  font-size: 12px;
  border-radius: 6px;
}

.divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}

.section-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 2px;
}

.backup-row {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}

.file-btn {
  cursor: pointer;
}

.dir-info-card {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dic-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
}

.dic-label {
  color: var(--text-3);
}

.dic-val.badge {
  background: var(--accent-soft);
  color: var(--accent);
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11.5px;
  font-weight: 600;
}

.msg.success {
  color: var(--success);
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  padding: 8px 12px;
  border-radius: 6px;
}

.msg.error {
  color: var(--danger);
  background: var(--danger-soft);
  padding: 8px 12px;
  border-radius: 6px;
}
</style>
