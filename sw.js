// Service Worker for AI Chat PWA
const CACHE_NAME = 'ai-chat-v2';
const OFFLINE_URL = './index.html';

// 预缓存的资源列表
const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// ==================== Install ====================
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => {
      // 强制新 SW 立即激活，无需等待页面刷新
      return self.skipWaiting();
    })
  );
});

// ==================== Activate ====================
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    }).then(() => {
      // 立即接管所有客户端
      return self.clients.claim();
    })
  );
});

// ==================== Fetch ====================
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 只处理同源请求，跨域请求（API 调用）直接走网络
  if (url.origin !== self.location.origin) {
    return;
  }

  // 对于 HTML 导航请求：网络优先，离线时返回缓存
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(OFFLINE_URL);
      })
    );
    return;
  }

  // 对于 JS 文件：网络优先（保证 F5 能拿到最新版本），离线回退到缓存
  if (/\.js(\?|$)/.test(url.pathname)) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseClone);
        });
        return response;
      }).catch(() => {
        return caches.match(event.request);
      })
    );
    return;
  }

  // 对于其他静态资源：缓存优先，没有缓存则网络请求并缓存
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        // 只缓存成功响应
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseClone);
        });
        return response;
      }).catch(() => {
        // 静态资源也找不到时，返回 index.html 兜底
        return caches.match(OFFLINE_URL);
      });
    })
  );
});

// ==================== Message ====================
// 支持页面强制更新 SW
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ==================== Notification Click ====================
// 当用户点击通知时，打开或聚焦应用窗口
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const urlToOpen = new URL('/', self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // 如果已有打开的窗口，则聚焦
      for (const client of clientList) {
        if (client.url.origin === self.location.origin && 'focus' in client) {
          return client.focus();
        }
      }
      // 否则打开新窗口
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});


// ==================== Push ====================
// 服务器定时推送的心跳到达时，展示通知或通知页面 JS 触发 AI 生成
self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch (e) {
    payload = { title: 'AI Chat', body: event.data.text(), type: 'message' };
  }

  // 心跳类型：通知所有客户端页面去触发 autoTopic
  if (payload.type === 'heartbeat') {
    // 先告知已打开的页面（页面可见时由页面自己决定是否触发）
    const notifyClients = self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        for (const client of clientList) {
          client.postMessage({ type: 'PUSH_HEARTBEAT' });
        }
        return clientList;
      });

    // 如果没有可见窗口，则弹出通知
    event.waitUntil(
      notifyClients.then(clientList => {
        const hasVisible = clientList.some(c => c.visibilityState === 'visible');
        if (hasVisible) return; // 页面在前台，交给页面处理，不弹通知
        return self.registration.showNotification(payload.title || 'AI Chat', {
          body: payload.body || '角色们想和你说话了',
          icon: payload.icon || 'icons/icon-192.png',
          badge: 'icons/icon-96.png',
          tag: 'aichat-heartbeat',
          renotify: false,
          data: { type: 'heartbeat' }
        });
      })
    );
    return;
  }

  // message 类型：直接展示通知内容
  event.waitUntil(
    self.registration.showNotification(payload.title || 'AI Chat', {
      body: payload.body || '',
      icon: payload.icon || 'icons/icon-192.png',
      badge: 'icons/icon-96.png',
      tag: payload.tag || 'aichat-notification',
      renotify: true,
      data: payload
    })
  );
});
