
/**
 * 常量
 * 自动拆分模块
 * 保持全局兼容模式
 */

var DEFAULT_API_HOST = 'https://api.deepseek.com';
var DEFAULT_MODEL = 'deepseek-chat';
var COMPRESS_THRESHOLD = 300; // 每超过多少条消息触发一次摘要压缩
var STORAGE_KEY = 'aichat_data'; // IndexedDB 主键（原 localStorage 主键，已迁移）
var DEFAULT_CLOUD_HOST = 'https://poecurrency.top';

// 获取云端同步基础地址
function getCloudHost() {
  var host = (appData?.settings?.cloudSyncHost || DEFAULT_CLOUD_HOST).trim();
  return host.endsWith('/') ? host.slice(0, -1) : host;
}
// 获取云端同步 API URL
function getChatSyncUrl() {
  return getCloudHost() + '/api/v1/chat_sync';
}

// ==================== IndexedDB 存储（替代 localStorage，解决大小限制）====================
var DB_NAME = 'SimpleGirlFriendDB';
var DB_VERSION = 1;
var DB_STORE_NAME = 'appData';

function openDB() {
  return new Promise((resolve, reject) => {
    var request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      var db = event.target.result;
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
    var db = await openDB();
    return new Promise((resolve, reject) => {
      var transaction = db.transaction([DB_STORE_NAME], 'readonly');
      var store = transaction.objectStore(DB_STORE_NAME);
      var request = store.get(key);

      request.onsuccess = (event) => {
        var result = event.target.result;
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
    var db = await openDB();
    return new Promise((resolve, reject) => {
      var transaction = db.transaction([DB_STORE_NAME], 'readwrite');
      var store = transaction.objectStore(DB_STORE_NAME);
      var request = store.put({ key, value });

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
    var db = await openDB();
    return new Promise((resolve, reject) => {
      var transaction = db.transaction([DB_STORE_NAME], 'readwrite');
      var store = transaction.objectStore(DB_STORE_NAME);
      var request = store.delete(key);

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
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      var data = JSON.parse(raw);
      await saveToDB(STORAGE_KEY, data);
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem('useIndexedDB', 'true');
      console.log('[DB] 已从 localStorage 迁移数据到 IndexedDB');
    }
  } catch (e) {
    console.error('迁移失败', e);
  }
}

