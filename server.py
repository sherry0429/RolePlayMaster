"""
SimpleGirlFriend Cloud Sync Server
===================================
为 SimpleGirlFriend PWA 提供云端同步和 Push 通知后端。

依赖:
    pip install flask pywebpush

运行:
    python server.py

生产部署（阿里云示例）见 README。

API 端点:
    POST /api/v1/chat_sync          - 上传/覆盖同步数据
    GET  /api/v1/chat_sync          - 拉取同步数据
    GET  /api/push/vapid-public-key - 获取 VAPID 公钥
    POST /api/push/subscribe        - 注册 Push 订阅
    POST /api/push/unsubscribe      - 注销 Push 订阅
    POST /api/push/heartbeat        - 触发心跳推送（可由 cron 调用）
"""

import os
import json
import base64
from datetime import datetime, timezone

from flask import Flask, request, jsonify
from pywebpush import webpush, WebPushException

# ──────────────────────────────────────────────
# 配置：修改以下值以适配你的部署环境
# ──────────────────────────────────────────────

# 服务监听地址和端口
HOST = "0.0.0.0"
PORT = 5100

# 数据存储目录（存放同步数据和推送订阅）
DATA_DIR = os.environ.get("SGF_DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))

# VAPID 配置：用于 Web Push 认证
# 生成方式: python -c "from pywebpush import generate_vapid_keys; print(generate_vapid_keys())"
# 或使用 openssl:
#   openssl ecparam -name prime256v1 -genkey -noout -out vapid_private.pem
#   openssl ec -in vapid_private.pem -pubout -out vapid_public.pem
#   然后将 PEM 转为 base64url 格式填入下方
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_CLAIMS = {"sub": "mailto:your-email@example.com"}

# Bearer Token 认证：所有 /api/ 端点均需携带此 token
# 生产环境务必通过环境变量注入，不要硬编码
AUTH_TOKEN = os.environ.get("SGF_AUTH_TOKEN", "change-me-in-production")

# ──────────────────────────────────────────────
# Flask 应用
# ──────────────────────────────────────────────

app = Flask(__name__)

os.makedirs(DATA_DIR, exist_ok=True)


def _auth_check():
    """验证 Bearer Token，返回 True 通过，False 拒绝。"""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:] == AUTH_TOKEN
    return False


def _sync_path(token):
    """根据 token 生成同步数据文件路径。"""
    # 用 token 的 hex 摘要作为文件名，避免路径注入
    import hashlib
    h = hashlib.sha256(token.encode()).hexdigest()[:32]
    return os.path.join(DATA_DIR, f"sync_{h}.json")


def _subs_path():
    """推送订阅存储路径。"""
    return os.path.join(DATA_DIR, "push_subscriptions.json")


def _load_subscriptions():
    """加载所有推送订阅。"""
    path = _subs_path()
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def _save_subscriptions(subs):
    """保存推送订阅列表。"""
    with open(_subs_path(), "w", encoding="utf-8") as f:
        json.dump(subs, f, ensure_ascii=False, indent=2)


# ──────────────────────────────────────────────
# 云端同步 API
# ──────────────────────────────────────────────

@app.route("/api/v1/chat_sync", methods=["POST"])
def sync_upload():
    """
    上传同步数据。
    请求:
        Headers: Authorization: Bearer <token>
        Body: { "data": "<base64-encoded-app-data>" }
    响应:
        200 { "ok": true }
        401 { "error": "unauthorized" }
    """
    if not _auth_check():
        return jsonify({"error": "unauthorized"}), 401

    body = request.get_json(silent=True)
    if not body or "data" not in body:
        return jsonify({"error": "missing data field"}), 400

    token = request.headers["Authorization"][7:]
    path = _sync_path(token)

    payload = {
        "data": body["data"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    return jsonify({"ok": True})


@app.route("/api/v1/chat_sync", methods=["GET"])
def sync_download():
    """
    拉取同步数据。
    请求:
        Headers: Authorization: Bearer <token>
    响应:
        200 { "data": "<base64>", "updated_at": "..." }
        401 { "error": "unauthorized" }
        404 { "error": "no data" }
    """
    if not _auth_check():
        return jsonify({"error": "unauthorized"}), 401

    token = request.headers["Authorization"][7:]
    path = _sync_path(token)

    if not os.path.exists(path):
        return jsonify({"error": "no data"}), 404

    with open(path, "r", encoding="utf-8") as f:
        payload = json.load(f)

    return jsonify(payload)


# ──────────────────────────────────────────────
# Web Push 通知 API
# ──────────────────────────────────────────────

@app.route("/api/push/vapid-public-key", methods=["GET"])
def vapid_public_key():
    """返回 VAPID 公钥，供客户端订阅时使用。"""
    return jsonify({"publicKey": VAPID_PUBLIC_KEY})


@app.route("/api/push/subscribe", methods=["POST"])
def push_subscribe():
    """
    注册 Push 订阅。
    请求:
        Headers: Authorization: Bearer <token>
        Body: { "token": "<user-token>", "subscription": { ... } }
    """
    if not _auth_check():
        return jsonify({"error": "unauthorized"}), 401

    body = request.get_json(silent=True) or {}
    sub = body.get("subscription")
    if not sub:
        return jsonify({"error": "missing subscription"}), 400

    subs = _load_subscriptions()
    # 用 endpoint 去重
    endpoint = sub.get("endpoint", "")
    subs = [s for s in subs if s.get("endpoint") != endpoint]
    subs.append(sub)
    _save_subscriptions(subs)

    return jsonify({"ok": True})


@app.route("/api/push/unsubscribe", methods=["POST"])
def push_unsubscribe():
    """
    注销 Push 订阅。
    请求:
        Headers: Authorization: Bearer <token>
        Body: { "endpoint": "<push-endpoint-url>" }
    """
    if not _auth_check():
        return jsonify({"error": "unauthorized"}), 401

    body = request.get_json(silent=True) or {}
    endpoint = body.get("endpoint", "")
    if endpoint:
        subs = _load_subscriptions()
        subs = [s for s in subs if s.get("endpoint") != endpoint]
        _save_subscriptions(subs)

    return jsonify({"ok": True})


@app.route("/api/push/heartbeat", methods=["POST"])
def push_heartbeat():
    """
    触发心跳推送。可由外部 cron 或定时任务调用。
    所有已注册的 Push 订阅都会收到一条 heartbeat 类型推送。
    客户端 SW 收到后根据页面可见性决定是否触发 autoTopic。
    """
    # 心跳接口可用简单 secret 保护，也可不鉴权
    secret = request.headers.get("X-Heartbeat-Secret", "")
    if secret != AUTH_TOKEN:
        return jsonify({"error": "unauthorized"}), 401

    subs = _load_subscriptions()
    success = 0
    for sub in subs:
        try:
            webpush(
                subscription_info=sub,
                data=json.dumps({
                    "type": "heartbeat",
                    "title": "AI Chat",
                    "body": "角色们想和你说话了",
                }),
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims=VAPID_CLAIMS,
                ttl=300,
            )
            success += 1
        except WebPushException as e:
            app.logger.warning("Push failed for %s: %s", sub.get("endpoint", "?"), e)
            # 如果订阅过期，移除
            if e.response and e.response.status_code in (404, 410):
                subs.remove(sub)
                _save_subscriptions(subs)

    return jsonify({"pushed": success, "total": len(subs)})


# ──────────────────────────────────────────────
# 入口
# ──────────────────────────────────────────────

if __name__ == "__main__":
    if not VAPID_PRIVATE_KEY or not VAPID_PUBLIC_KEY:
        print("[WARN] VAPID keys not configured. Push notifications will not work.")
        print("       Set VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY environment variables,")
        print("       or generate them with:")
        print("         python -c \"from pywebpush import generate_vapid_keys; print(generate_vapid_keys())\"")
    print(f"[INFO] Auth token: {'(from env)' if os.environ.get('SGF_AUTH_TOKEN') else '(default: change-me-in-production)'}")
    print(f"[INFO] Data directory: {DATA_DIR}")
    print(f"[INFO] Listening on http://{HOST}:{PORT}")
    app.run(host=HOST, port=PORT, debug=False)
