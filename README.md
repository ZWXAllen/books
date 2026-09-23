# Ebook Shelf (在线电子书书架)

支持 **PDF** 与 **EPUB** 格式的现代化在线读书平台，已完成纯静态改造，支持一键部署到 **GitHub Pages** 免费托管。

---

## 🌟 核心特性

- 📖 **左右双页对开布局**：仿真纸质书展开效果，居中装订书脊与真实纸张微阴影，沉浸式阅读体验。
- ⌨️ **快捷键翻页**：支持键盘 `←` / `→`、`PageUp` / `PageDown`、`Space` / `Shift+Space` 丝滑翻页。
- 📱 **双视图切换**：顶栏支持一键切换 `📖 双页` / `📄 单页` 视图。
- 🏷️ **智能分类与标签过滤**：
  - 自动根据 `library/` 下的子文件夹名称建立分类（如 `library/技术/`、`library/文学/`、`library/理财/`）；
  - 支持 EPUB `<dc:subject>` 与 PDF 元数据主题识别；
  - 首页胶囊标签栏一键过滤不同类别书籍。
- 💾 **无服务器纯静态运行**：
  - 阅读进度（精确到页码与百分比）、字号与排版偏好自动保存在读者本地浏览器的 `localStorage` 中；
  - 支持划线高亮与阅读批注。
- 🚀 **GitHub 直连自动部署**：只要在仓库中上传书籍，GitHub Actions 自动构建并发布到 GitHub Pages。

---

## 📚 如何在 GitHub 添加新书？

1. **直接上传或推送书籍文件**：
   - 将电子书（`.pdf` 或 `.epub`）放入 `library/` 目录下；
   - 建议按分类建立子文件夹，例如：
     - `library/技术/深入理解计算机系统.pdf`
     - `library/理财/金钱心理学.epub`
     - `library/文学/老人与海.epub`
2. **提交并推送到 GitHub**：
   ```bash
   git add library/
   git commit -m "feat: 添加新书籍"
   git push
   ```
3. GitHub Actions 会自动触发构建，将新书加入静态书单、提取封面并重新发布上线。

---

## ⚙️ 如何开启 GitHub Pages？

在 GitHub 仓库主页：
1. 点击顶部 **Settings**（仓库设置）；
2. 在左侧菜单点击 **Pages**；
3. 在 **Build and deployment** 下方的 **Source** 选择框中，选择 **GitHub Actions**；
4. 随后每次代码推送到 `main` 分支，工作流就会自动打包并上线，你的访问地址为：
   `https://<你的GitHub用户名>.github.io/<仓库名称>/`

---

## 💻 本地运行与开发

```bash
# 安装依赖
npm install

# 启动本地开发服务（热重载 + 本地代理）
npm run dev

# 构建纯静态产物（包含静态书单生成与书籍打包）
npm run build
```
