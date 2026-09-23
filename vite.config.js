// 确保本地开发代理不被环境变量中的 HTTP_PROXY / HTTPS_PROXY 拦截
const localHosts = '127.0.0.1,localhost'
process.env.NO_PROXY = process.env.NO_PROXY ? `${process.env.NO_PROXY},${localHosts}` : localHosts
process.env.no_proxy = process.env.no_proxy ? `${process.env.no_proxy},${localHosts}` : localHosts

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  root: 'web',
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./web/src', import.meta.url))
    }
  },
  define: {
    // epubjs 内部会引用 global
    global: 'globalThis'
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5178',
        changeOrigin: true
      }
    }
  },
  optimizeDeps: {
    include: ['epubjs', 'pdfjs-dist']
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000
  }
})
