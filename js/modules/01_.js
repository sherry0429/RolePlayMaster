// 模块: 常量

    const DEFAULT_API_HOST = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
const COMPRESS_THRESHOLD = 300; // 每超过多少条消息触发一次摘要压缩
const STORAGE_KEY = 'aichat_data'; // IndexedDB 主键（原 localStorage 主键，已迁移）
const DEFAULT_CLOUD_HOST = 'https://poecurrency.top';

// 获取云端同步基础地址
function getCloudHost() {
  const host = (appData?.settings?.cloudSyncHost || DEFAULT_CLOUD_HOST).trim();
  return host.endsWith('/') ? host.slice(0, -1) : host;
}
// 获取云端同步 API URL
function getChatSyncUrl() {
  return getCloudHost() + '/api/v1/chat_sync';
}

// ==================== IndexedDB 存储（替代 localStorage，解决大小限制）====================
const DB_NAME = 'SimpleGirlFriendDB';
const DB_VERSION = 1;
const DB_STORE_NAME = 'appData';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(DB_STORE_NAME)) {
        db.createObjectStore(DB_STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

async function getFromDB(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([DB_STORE_NAME], 'readonly');
      const store = transaction.objectStore(DB_STORE_NAME);
      const request = store.get(key);

      request.onsuccess = (event) => {
        const result = event.target.result;
        resolve(result ? result.value : null);
      };
      request.onerror = (event) => reject(event.target.error);
    });
  } catch (e) {
    console.error('IndexedDB 读取失败', e);
    return null;
  }
}

async function saveToDB(key, value) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([DB_STORE_NAME], 'readwrite');
      const store = transaction.objectStore(DB_STORE_NAME);
      const request = store.put({ key, value });

      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
    });
  } catch (e) {
    console.error('IndexedDB 保存失败', e);
    throw e;
  }
}

async function deleteFromDB(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([DB_STORE_NAME], 'readwrite');
      const store = transaction.objectStore(DB_STORE_NAME);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
    });
  } catch (e) {
    console.error('IndexedDB 删除失败', e);
    throw e;
  }
}

// 从 localStorage 迁移到 IndexedDB（向后兼容）
async function migrateFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      await saveToDB(STORAGE_KEY, data);
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem('useIndexedDB', 'true');
      console.log('[DB] 已从 localStorage 迁移数据到 IndexedDB');
    }
  } catch (e) {
    console.error('迁移失败', e);
  }
}



    window.getCloudHost = getCloudHost;
window.getChatSyncUrl = getChatSyncUrl;
window.openDB = openDB;
window.getFromDB = getFromDB;
window.saveToDB = saveToDB;
window.deleteFromDB = deleteFromDB;
window.migrateFromLocalStorage = migrateFromLocalStorage;