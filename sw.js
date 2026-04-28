// Service Worker for AI Chat PWA
const CACHE_NAME = 'ai-chat-v1';
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
