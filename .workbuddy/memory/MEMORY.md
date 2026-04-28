# SimpleGirlFriend 项目记忆

## 项目概述
- 单文件 AI 聊天网页应用（index.html），所有CSS/HTML/JS在一个文件中，已改造为 PWA
- 支持：主题切换（明/暗）、流式输出、动态System Prompt（带摘要压缩）、数据导入导出、分享链接
- 使用 DeepSeek API，数据存 localStorage

## 关键技术决策
- 弹框编辑消息（非行内编辑），用 showTextareaModal
- System Prompt 版本化：压缩生成新版本可翻页查看；编辑时原地更新当前版本（不创建新版本）
- 分享链接使用 gzip 压缩 + base64url 编码（v2格式），兼容旧版纯base64（v1/无前缀）
- 移动端视口修复：使用 100dvh + JS --app-height 变量双重保障
- 背景图片：使用文件上传（非URL输入），自动压缩为 Data URL 存储（最大1920px, JPEG 0.7质量）
- 移动端侧边栏遮罩必须与sidebar在同一stacking context内（app-container内），否则z-index stacking context导致遮罩盖住sidebar

## PWA 相关
- manifest.json：standalone模式，shortcuts支持"新建聊天"（action=new参数）
- sw.js：Cache-First静态资源缓存，Navigation请求网络优先降级离线，版本更新提示刷新
- icons/ 目录：8种尺寸（72/96/128/144/152/192/384/512）
- index.html：已添加所有必要meta（manifest、apple-touch-icon、theme-color等）
- 安装横幅：beforeinstallprompt 触发，底部悬浮条，用户可手动安装

## UI/UX 规范
- 快捷指令按钮（/记忆、/继续）在输入框上方，可直接点击
- 左侧边栏：chat-list-section 和 sp-section 均使用 flex:1 动态分配空间
- 移动端 sp-section 最小高度 80px，桌面端 100px

## 已知问题
- 移动端 100vh 含地址栏高度，需用 100dvh + JS fallback 修复（已修复）
- PWA 需 HTTPS 或 localhost 才能安装（本地用 file:// 打开 SW 不会生效）

## 新增功能（v2）
- 角色图库：右上角🎭按钮打开右侧抽屉，瀑布流展示，分页加载（每页20个），支持新增/编辑/删除角色（头像+名称+简介）
- 说话人区分：默认开启，用【角色名】正则拆分AI消息为多段展示，匹配角色图库头像；history messages 中仍为一条
- 云端同步：设置中填写 syncToken，POST/GET `https://poecurrency.top/api/v1/chat_sync`，Bearer token 认证
  - 同步到云端（导出）：POST，body: `{ data: base64 }`
  - 从云端同步（导入）：GET，解析返回数据后执行导入
  - applyImportedData() 函数复用导入后UI刷新逻辑
- 自动找话题：可选开启，10分钟无操作+页面不可见时触发AI请求，让随机角色发起话题或闲聊
- 聊天通知：可选开启，自动话题触发消息时弹出系统通知（含角色头像、名称、内容截断50字）
- 所有新数据（characters数组、新settings字段）均已纳入导入/导出/分享兼容
- .gitignore：忽略 .workbuddy/、*.bak、*.bak2 等
- default.txt 首次启动：localStorage 无数据时 fetch 同目录 default.txt 并导入（base64/JSON 自动识别），导入时清除 syncToken

