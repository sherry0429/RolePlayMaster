# SimpleGirlFriend 🌸

一个轻量级的 AI 聊天 Web 应用——所有代码在单个 HTML 文件中，即开即用。

A lightweight AI chat web app — all code in a single HTML file, ready to use.

---

## ✨ 特性 / Features

- 🔒 **数据完全本地化** — 所有聊天数据存储在浏览器 localStorage 中，不上传任何服务器
- ☁️ **可选云端同步** — 支持自定义同步 API，跨设备同步数据
- 🤖 **多 AI 供应商** — 默认 DeepSeek，可自由替换 API Host 和 Key，兼容 OpenAI 格式的任何供应商
- 👥 **群聊 & 角色扮演** — 支持多角色群聊，AI 回复中用【角色名】区分说话人，自动匹配角色头像
- 🎭 **角色图库** — 独立的角色管理系统，支持头像、名称、简介，瀑布流展示
- 🌓 **明暗主题** — Light / Dark 一键切换，支持自定义背景图片
- 📱 **移动端适配** — 响应式设计，完美支持手机浏览
- 🔄 **动态 System Prompt** — 聊天超过阈值自动压缩摘要，版本化管理，可回溯查看
- 📤 **导入 / 导出 / 分享** — JSON 导出备份，分享链接一键导入（gzip 压缩，链接更短）
- 📲 **PWA 支持** — 可安装到桌面，离线可用

---

## 🖼️ 截图 / Screenshots

### 明亮模式 / Light Mode
![Light Mode](screenshots/chat-light.png)

### 暗黑模式 / Dark Mode
![Dark Mode](screenshots/chat-dark.png)

### 角色图库 / Character Gallery
![Character Gallery](screenshots/gallery.png)

### 群聊 / Group Chat
![Group Chat](screenshots/group-chat.png)

### 设置 / Settings
![Settings](screenshots/settings.png)

---

## 🚀 快速开始 / Quick Start

1. 下载 `index.html`
2. 用浏览器打开
3. 在设置中填入你的 API Host 和 API Key
4. 开始聊天！

```bash
# 或者克隆仓库
git clone https://github.com/sherry0429/SimpleGirlFriend.git
cd SimpleGirlFriend
# 直接打开 index.html 即可
```

---

## ⚙️ 配置说明 / Configuration

### API 设置 / API Settings

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| API Host | AI 服务的 API 地址 | `https://api.deepseek.com/v1/chat/completions` |
| API Key | 你的 API 密钥 | — |

> 💡 只要是兼容 OpenAI Chat Completions 格式的 API，都可以直接使用。例如：DeepSeek、OpenAI、Moonshot、GLM 等。

### 云端同步 / Cloud Sync

默认不同步任何数据到云端。如果你需要跨设备同步：

1. 在设置中填写 **同步 Token**
2. 点击「☁️ 同步」按钮拉取云端数据
3. 数据通过 Bearer Token 认证，POST/GET `your-api-endpoint/chat_sync`

> ⚠️ 你需要自己实现同步 API 服务端。客户端已内置同步逻辑。

### 角色与群聊 / Characters & Group Chat

1. 点击右上角 🎭 按钮打开角色图库
2. 新增角色：上传头像、填写名称和简介
3. 在 System Prompt 中设定多角色场景
4. AI 回复中使用 `【角色名】` 格式即可自动拆分展示，匹配角色头像

---

## 📂 项目结构 / Project Structure

```
SimpleGirlFriend/
├── index.html          # 全部代码（HTML + CSS + JS）
├── manifest.json       # PWA 配置
├── sw.js               # Service Worker（离线缓存）
├── icons/              # PWA 图标（8 种尺寸）
├── screenshots/        # 截图
├── project.md          # 项目需求说明
└── README.md           # 本文件
```

---

## 🔧 技术细节 / Technical Details

- **单文件架构** — 所有 HTML/CSS/JS 写在 `index.html` 中，零依赖，零构建
- **流式输出** — 使用 SSE（Server-Sent Events）实现逐字输出
- **动态 System Prompt** — 超过阈值自动触发摘要压缩，生成新版本，历史版本可回溯
- **分享链接** — 使用 gzip 压缩 + base64url 编码（v2 格式），兼容旧版纯 base64
- **PWA** — Cache-First 静态资源缓存，Navigation 请求网络优先降级离线
- **数据存储** — 全部使用 localStorage，无任何外部数据库

---

## 📄 License

MIT
