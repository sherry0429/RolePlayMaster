# core 模块对照表

`js/core/` 下的文件是从网页版（`../../js/`）**原样复制**过来的业务模块，
除了文件名之外内容基本未改。需要同步网页版的修复时，按下表覆盖对应文件即可。

但有两处**有意改动**，覆盖之后需要重新应用（下表列出全部受影响的位置）。

---

## 有意改动 ①：`confirm()` → `confirmDialog()`

Tauri 的 WebView 不支持浏览器原生 `window.confirm()`（macOS 上恒返回 false），
会让网页版里所有 `if (!confirm(...)) return;` 形式的二次确认「点了没反应」。
因此 6 个文件里的 **7 处** `confirm(...)` 被改成 `await confirmDialog(...)`，
并把所在函数标记为 `async`：

| 文件 | 函数 |
|---|---|
| `29_album.js` | `deleteAlbumPhoto` / `clearAllAlbumPhotos` |
| `10_chat.js` | `deleteChat` |
| `12_message_edit.js` | `deleteMessage` |
| `23_gallery.js` | `deleteCharacter` |
| `25_group.js` | `syncFromCloud` |
| `19_share.js` | `checkShareData` |

## 有意改动 ③：被外壳「遮蔽」的两个函数（core 文件本身未改）

有两个网页版函数在桌面版的输入栏场景下不适用，但**没有改 core 文件**，
而是在 `shell/05_overrides.js` 里重新声明了一遍（外壳脚本后加载，会覆盖同名全局函数）：

| 网页版函数（core） | 桌面版行为 | 原因 |
|---|---|---|
| `handleInputKeydown` | 回车发送前先判断 `e.isComposing \|\| e.keyCode === 229` | 中文输入法选词时也会触发 Enter，不拦住会把没上屏的半成品直接发出去 |
| `autoResizeInput` | 输入框自增高上限由 120px 收到 72px | 输入栏常驻在化身上方，空间有限 |

从网页版同步 `13_send.js` 时，这两处不需要重新应用（改动在外壳里），
但如果网页版这两个函数的逻辑有其它变化，记得同步到 `shell/05_overrides.js`。

## 有意改动 ②：云端同步的传输层

桌面端 WebView 的来源是 `tauri://localhost`，访问 `https://poecurrency.top` 属于**跨域**；
带 `Authorization` 头的请求会先触发 CORS 预检，而该服务端不处理预检、也不返回
`Access-Control-Allow-Origin`，于是请求被内核直接拦截（表现为「网络错误」）。
网页版与接口同源，所以不存在这个问题。

因此 `25_group.js` 里**两处传输调用点**改为走 `shell/06_cloud.js` 的统一入口
`cloudRequest(...)`：桌面端由原生侧代发，浏览器预览回退到 `fetch`。

| 文件 | 函数 | 原实现 | 现实现 |
|---|---|---|---|
| `25_group.js` | `syncToCloud` | `fetch(getChatSyncUrl(), {...})` | `cloudRequest('POST', getChatSyncUrl(), token, body)` |
| `25_group.js` | `syncFromCloud` | `XMLHttpRequest` + `onprogress` | `cloudRequest('GET', ..., onProgress)` |

> 另注：`27_autotopic.js` 里的 Web Push 订阅接口（`/api/push/*`）同样会跨域，
> 但它依赖 Service Worker，桌面端不会触发，因此未改。

---

| 桌面版 `js/core/` | 网页版 `js/` | 职责 |
|---|---|---|
| `00_prompts.js` | `00_prompts.js` | 提示词集中管理（记忆/拍照/群聊/自动话题） |
| `01_constants.js` | `01_常量.js` | 常量与 IndexedDB 底层封装 |
| `02_state.js` | `02_全局状态.js` | 全局状态变量 |
| `03_model.js` | `03_数据结构.js` | 默认数据结构与 `createChat` |
| `04_storage.js` | `04_存储.js` | `loadData` / `saveData` |
| `05_utils.js` | `26_工具函数.js` | `escHtml` / `renderMarkdown` |
| `06_theme.js` | `07_主题.js` | 主题切换 |
| `07_background.js` | `08_背景图片.js` | 背景图与角色图回退、`extractSpeakerNames` |
| `08_bg_upload.js` | `09_背景图片上传.js` | 背景图上传、`compressImage` |
| `09_settings.js` | `10_设置区.js` | 设置保存/重置、ComfyUI 设置、拍照入口可见性 |
| `10_chat.js` | `11_聊天管理.js` | 聊天增删改查、SP 解析辅助函数 |
| `11_message_render.js` | `12_消息渲染.js` | 消息渲染、说话人拆分、`findCharacter` |
| `12_message_edit.js` | `14_消息编辑与删除.js` | 消息编辑/删除（编辑后截断后续） |
| `13_send.js` | `15_发送消息.js` | 发送消息与 `/记忆` `/继续` `/拍照` 指令 |
| `14_quick_commands.js` | `16_快捷指令.js` | `triggerMemory` / `triggerContinue` |
| `15_stream.js` | `17_流式AI请求.js` | 流式请求核心 `requestAI`、拍照触发标签解析 |
| `16_memory.js` | `18_system_prompt记忆功能.js` | 记忆压缩 `compressChat`、SP 清理修复 |
| `17_sp_panel.js` | `19_system_prompt显示与编辑.js` | SP 显示、版本前后切换、编辑 |
| `18_io.js` | `20_数据导入导出.js` | 导入导出与 gzip/base64 编解码工具 |
| `19_share.js` | `21_分享链接.js` | 分享精简数据构建与展开 |
| `20_log.js` | `23_log抽屉.js` | 程序日志记录与渲染 |
| `21_modal.js` | `24_模态框.js` | 通用模态框 / 大文本编辑框 |
| `22_toast.js` | `25_toast通知.js` | Toast 通知 |
| `23_gallery.js` | `27_角色图库.js` | 角色图库瀑布流 |
| `24_characters.js` | `28_角色导入导出.js` | 角色表单、头像上传、角色导入导出 |
| `25_group.js` | `29_群聊功能.js` | 群聊 SP 生成与初始化、云端同步、图片压缩 |
| `26_autotopic_state.js` | `30_自动找话题.js` | 自动话题的 5 个状态变量 |
| `27_autotopic.js` | `31_消息分页渲染.js` | 自动找话题、分页常量、Web Push（桌面版已置空） |
| `28_photo.js` | `33_拍照功能.js` | 拍照流程与 ComfyUI 调用 |
| `29_album.js` | `34_相册功能.js` | 相册查看/删除/下载 |

## 未移植的模块

| 网页版 `js/` | 原因 |
|---|---|
| `05_初始化.js` | 桌面版有自己的启动流程（`shell/08_boot.js`） |
| `06_pwa.js` | 桌面应用不需要 Service Worker / 安装提示 |
| `13_重放功能.js` | 按需求移除重放功能 |
| `22_侧边栏.js` | 移动端侧边栏被桌面面板取代 |
| `32_启动.js`、`main.js` | 由 `shell/08_boot.js` 接管入口 |
| `core/`（原目录） | 原项目中的死代码，未被 `index.html` 引用 |

被移除模块遗留的全局符号（`isReplaying` / `stopReplay` / `closeSidebar` 等）
统一在 `js/shell/05_overrides.js` 顶部以空实现补齐。
