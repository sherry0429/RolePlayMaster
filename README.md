# SimpleGirlFriend

单文件 AI 聊天 PWA -- 所有代码在 `index.html` 中，零依赖，零构建，即开即用。

每个聊天拥有独立的 System Prompt、背景图片和角色配置。单角色对话或多角色群聊均可。

---

## 核心特性

- **聊天级独立配置** -- 每个聊天独立设置 System Prompt、背景图片；聊天间互不干扰
- **角色图库与群聊** -- 管理角色头像/名称/简介，多角色群聊时 AI 回复以 `【角色名】` 区分说话人，自动匹配头像
- **动态 System Prompt** -- 聊天超过阈值（默认 300 条）自动触发摘要压缩，生成新版本，历史版本可回溯查看
- **数据本地化** -- 所有数据存储在浏览器 localStorage，不上传任何服务器
- **可选云端同步** -- 自建同步 API，Bearer Token 认证，跨设备同步数据
- **多 AI 供应商** -- 默认 DeepSeek，可替换 API Host 和 Key，兼容 OpenAI Chat Completions 格式的任何供应商
- **明暗主题** -- Light / Dark 切换，支持自定义背景图片（全局或聊天级）
- **导入 / 导出 / 分享** -- JSON 导出备份；分享链接使用 gzip 压缩 + base64url 编码，仅含配置不含聊天记录
- **PWA** -- 可安装到桌面，Service Worker 离线缓存，支持 Web Push 通知
- **自动找话题** -- 可选开启，页面不可见时定期由 AI 触发角色发起话题
- **聊天通知** -- 可选开启，自动话题触发时弹出系统通知

---

## 截图

### 明亮模式
![Light Mode](screenshots/chat-light.png)

### 暗黑模式
![Dark Mode](screenshots/chat-dark.png)

### 角色图库
![Character Gallery](screenshots/gallery.png)

### 群聊
![Group Chat](screenshots/group-chat.png)

### 设置
![Settings](screenshots/settings.png)

---

## 快速开始

1. 下载 `index.html`
2. 用浏览器打开（本地 `file://` 即可运行，PWA 功能需 HTTPS 或 localhost）
3. 在设置中填入 API Host 和 API Key
4. 开始聊天

```bash
# 或克隆仓库
git clone https://github.com/sherry0429/SimpleGirlFriend.git
cd SimpleGirlFriend
# 直接打开 index.html
```

---

## 配置

### API 设置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| API Host | AI 服务 API 地址 | `https://api.deepseek.com` |
| API Key | API 密钥 | -- |
| 压缩阈值 | 触发摘要压缩的消息条数 | 300 |
| 说话人区分 | AI 回复中 `【角色名】` 自动拆分展示 | 开启 |
| 自动找话题 | 页面不可见时 AI 定期触发角色发起话题 | 关闭 |
| 聊天通知 | 自动话题触发时弹出系统通知 | 关闭 |

只要是兼容 OpenAI Chat Completions 格式的 API 都可直接使用：DeepSeek、OpenAI、Moonshot、GLM 等。

### 云端同步

默认不同步任何数据到云端。需要跨设备同步时：

1. 部署 `server.py`（见下方"服务端部署"）
2. 在设置中填写**同步 Token** 和**云端同步地址**
3. 点击"同步到云端"或"从云端拉取"

数据通过 Bearer Token 认证，POST/GET `{host}/api/v1/chat_sync`。

### 角色与群聊

1. 点击右上角按钮打开角色图库
2. 新增角色：上传头像、填写名称和简介
3. 在 System Prompt 中设定多角色场景
4. AI 回复中使用 `【角色名】` 格式即可自动拆分展示，匹配角色头像
5. 图库内"群聊"按钮：多选角色后一键建群，自动生成 SP 模板

---

## 项目结构

```
SimpleGirlFriend/
├── index.html          # 全部代码（HTML + CSS + JS）
├── server.py           # 云端同步 & Push 通知服务端（Python, 270 行）
├── manifest.json       # PWA 配置
├── sw.js               # Service Worker（离线缓存 + Push 处理）
├── default.txt         # 首次启动默认数据（可选，base64 或 JSON）
├── icons/              # PWA 图标（8 种尺寸：72-512px）
├── screenshots/        # 截图
├── project.md          # 项目需求说明
└── README.md
```

---

## 技术细节

### 单文件架构

所有 HTML/CSS/JS 写在 `index.html` 中，零外部依赖，零构建步骤。数据结构：

```javascript
{
  theme: "light" | "dark",
  settings: {
    apiHost, apiKey, bgImage, compressThreshold,
    speakerMode, syncToken, cloudSyncHost,
    autoTopic, chatNotification, autoTopicInterval, autoTopicMaxCount
  },
  chats: { [id]: { name, bgImage, messages[], spVersions[], spViewIndex } },
  chatOrder: [],    // 聊天 ID 有序列表
  chatCounter: 0,   // 自增计数器
  characters: []    // 角色图库 [{ id, name, avatar, description }]
}
```

### 流式输出

使用 SSE（Server-Sent Events）实现逐字输出，支持 AbortController 中断。

### 动态 System Prompt

- 聊天消息数超过阈值时，自动将所有聊天内容发送给 AI 提取摘要
- 摘要融合进 System Prompt，生成新版本（版本号递增）
- 每次请求只发送当前 System Prompt 版本 + 该版本之后的增量消息
- 编辑 System Prompt 时原地更新当前版本（不创建新版本）
- 历史版本可翻页查看；若在旧版本后触发了新压缩，旧版本之后的所有版本被删除

### 分享链接

使用 gzip 压缩 + base64url 编码（v2 格式），兼容旧版纯 base64（v1/无前缀）。分享仅包含配置和角色数据，不含聊天记录和 API Key。

### PWA

- `manifest.json`：standalone 模式，shortcuts 支持"新建聊天"
- `sw.js`：Cache-First 静态资源缓存，Navigation 请求网络优先降级离线
- 移动端视口：`100dvh` + JS `--app-height` 变量双重保障，解决 100vh 含地址栏高度问题
- 安装横幅：`beforeinstallprompt` 触发，底部悬浮条

### 自动找话题

开启后，空闲超过设定间隔（默认 10 分钟）时，AI 以随机角色身份发起话题。无论用户是否在页面上，只要满足触发条件就会自动触发。有触发次数上限（默认 5 次），用户发送消息后重置计数。

### 聊天通知

开启后，自动话题触发时弹出系统通知，包含角色名称和内容截断（50 字）。依赖 Web Push API，需配置服务端 VAPID 密钥。

---

## 服务端部署

`server.py` 提供云端同步和 Web Push 通知后端，基于 Flask + pywebpush，共 270 行。

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/chat_sync` | 上传/覆盖同步数据 |
| GET | `/api/v1/chat_sync` | 拉取同步数据 |
| GET | `/api/push/vapid-public-key` | 获取 VAPID 公钥 |
| POST | `/api/push/subscribe` | 注册 Push 订阅 |
| POST | `/api/push/unsubscribe` | 注销 Push 订阅 |
| POST | `/api/push/heartbeat` | 触发心跳推送 |

### 本地运行

```bash
pip install flask pywebpush

# 生成 VAPID 密钥对（首次）
python -c "from pywebpush import generate_vapid_keys; print(generate_vapid_keys())"

# 启动服务
export VAPID_PRIVATE_KEY="<private-key>"
export VAPID_PUBLIC_KEY="<public-key>"
export SGF_AUTH_TOKEN="<your-secret-token>"
python server.py
```

服务默认监听 `0.0.0.0:5100`。数据存储在 `./data/` 目录下。

### 阿里云部署示例

以下以阿里云 ECS（Ubuntu 22.04）为例，使用 systemd + Nginx 反向代理部署。

#### 1. 安装依赖

```bash
sudo apt update
sudo apt install python3-pip nginx -y
pip3 install flask pywebpush gunicorn
```

#### 2. 部署代码

```bash
# 将 server.py 上传到服务器
scp server.py root@<your-ecs-ip>:/opt/sgf-server/

# 创建数据目录
ssh root@<your-ecs-ip> "mkdir -p /opt/sgf-server/data"
```

#### 3. 生成 VAPID 密钥

```bash
ssh root@<your-ecs-ip>
cd /opt/sgf-server
python3 -c "from pywebpush import generate_vapid_keys; print(generate_vapid_keys())"
# 记录输出的 private_key 和 public_key
```

#### 4. 创建 systemd 服务

```bash
cat > /etc/systemd/system/sgf-server.service << 'EOF'
[Unit]
Description=SimpleGirlFriend Cloud Sync Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/sgf-server
Environment=VAPID_PRIVATE_KEY=<your-private-key>
Environment=VAPID_PUBLIC_KEY=<your-public-key>
Environment=SGF_AUTH_TOKEN=<your-secret-token>
Environment=SGF_DATA_DIR=/opt/sgf-server/data
ExecStart=/usr/local/bin/gunicorn -w 2 -b 127.0.0.1:5100 server:app
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable sgf-server
sudo systemctl start sgf-server
```

#### 5. 配置 Nginx 反向代理（含 HTTPS）

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /etc/nginx/ssl/your-domain.pem;
    ssl_certificate_key /etc/nginx/ssl/your-domain.key;

    location / {
        proxy_pass http://127.0.0.1:5100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

#### 6. 心跳定时任务（可选）

若需要服务端定时推送心跳以触发客户端自动话题：

```bash
# 每 5 分钟推送一次心跳
crontab -e
# 添加：
*/5 * * * * curl -s -X POST https://your-domain.com/api/push/heartbeat -H "X-Heartbeat-Secret: <your-secret-token>" > /dev/null 2>&1
```

#### 7. 客户端配置

在 SimpleGirlFriend 设置中：
- 云端同步地址填写 `https://your-domain.com`
- 同步 Token 填写 `<your-secret-token>`

---

## License

MIT
