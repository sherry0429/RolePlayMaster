/**
     * 模块: 存储
     * 该文件由自动拆分工具生成
     * 后续建议继续手动细化
     */

    import { state } from '../core/state.js';
    import * as CONSTANTS from '../core/constants.js';

    async function loadData() {
  try {
    // 先尝试从 IndexedDB 加载
    let data = await getFromDB(STORAGE_KEY);

    if (data) {
      appData = data;
      // 兼容性补全
      if (!appData.chatOrder) appData.chatOrder = [];
      if (!appData.chatCounter) appData.chatCounter = 0;
      if (!appData.settings) appData.settings = { apiHost: DEFAULT_API_HOST, apiKey: '', bgImage: '' };
      if (!appData.settings.compressThreshold) appData.settings.compressThreshold = COMPRESS_THRESHOLD;
      if (appData.settings.speakerMode === undefined) appData.settings.speakerMode = true;
      if (appData.settings.syncToken === undefined) appData.settings.syncToken = '';
      if (appData.settings.autoTopic === undefined) appData.settings.autoTopic = false;
      if (appData.settings.chatNotification === undefined) appData.settings.chatNotification = false;
      if (appData.settings.autoTopicInterval === undefined) appData.settings.autoTopicInterval = 10;
      if (appData.settings.autoTopicMaxCount === undefined) appData.settings.autoTopicMaxCount = 5;
      if (appData.settings.cloudSyncHost === undefined) appData.settings.cloudSyncHost = '';
      if (!appData.characters) appData.characters = [];
      // 兼容旧版：为每个聊天补全 characters 字段
      if (appData.chats) {
        for (const id of Object.keys(appData.chats)) {
          if (appData.chats[id].characters === undefined) {
            appData.chats[id].characters = [];
          }
        }
      }
      return true; // IndexedDB 有数据
    }

    // IndexedDB 没有数据，尝试 localStorage（向后兼容）
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      appData = JSON.parse(raw);
      // 兼容性补全
      if (!appData.chatOrder) appData.chatOrder = [];
      if (!appData.chatCounter) appData.chatCounter = 0;
      if (!appData.settings) appData.settings = { apiHost: DEFAULT_API_HOST, apiKey: '', bgImage: '' };
      if (!appData.settings.compressThreshold) appData.settings.compressThreshold = COMPRESS_THRESHOLD;
      if (appData.settings.speakerMode === undefined) appData.settings.speakerMode = true;
      if (appData.settings.syncToken === undefined) appData.settings.syncToken = '';
      if (appData.settings.autoTopic === undefined) appData.settings.autoTopic = false;
      if (appData.settings.chatNotification === undefined) appData.settings.chatNotification = false;
      if (appData.settings.autoTopicInterval === undefined) appData.settings.autoTopicInterval = 10;
      if (appData.settings.autoTopicMaxCount === undefined) appData.settings.autoTopicMaxCount = 5;
      if (appData.settings.cloudSyncHost === undefined) appData.settings.cloudSyncHost = '';
      if (!appData.characters) appData.characters = [];
      // 兼容旧版：为每个聊天补全 characters 字段
      if (appData.chats) {
        for (const id of Object.keys(appData.chats)) {
          if (appData.chats[id].characters === undefined) {
            appData.chats[id].characters = [];
          }
        }
      }

      // 迁移到 IndexedDB
      await saveToDB(STORAGE_KEY, appData);
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem('useIndexedDB', 'true');
      console.log('[DB] 已从 localStorage 迁移数据到 IndexedDB');

      return true; // localStorage 有数据
    }

    // 都没有数据，创建默认数据
    appData = createDefaultData();
    return false; // 首次启动，无数据
  } catch (e) {
    console.error('数据加载失败', e);
    appData = createDefaultData();
    return false;
  }
}

/* 尝试从 default.txt 加载默认数据（首次启动时） */
async function loadDefaultData() {
  try {
    const resp = await fetch('default.txt');
    if (!resp.ok) return; // 文件不存在或加载失败，静默跳过
    const rawText = (await resp.text()).trim();
    if (!rawText) return;

    let data;
    // 尝试 base64 解码
    try {
      const jsonStr = base64ToJson(rawText);
      data = JSON.parse(jsonStr);
    } catch (b64Err) {
      // base64 失败，尝试直接 JSON
      try {
        data = JSON.parse(rawText);
      } catch (jsonErr) {
        console.warn('default.txt 格式无效，跳过');
        return;
      }
    }

    if (!data.chats || !data.settings) {
      console.warn('default.txt 数据格式不完整，跳过');
      return;
    }

    // 兼容性补全
    if (!data.chatOrder) data.chatOrder = Object.keys(data.chats);
    if (!data.chatCounter) data.chatCounter = data.chatOrder.length;
    if (!data.theme) data.theme = 'light';
    if (!data.characters) data.characters = [];
    if (data._shareLite) {
      data = expandShareData(data);
    }
    // 清除敏感信息（如 syncToken）
    if (data.settings) data.settings.syncToken = '';

    applyImportedData(data);
    console.log('已从 default.txt 加载默认数据');
  } catch (e) {
    console.warn('加载 default.txt 失败，跳过', e);
  }
}

async function saveData() {
  try {
    await saveToDB(STORAGE_KEY, appData);
  } catch (e) {
    console.error('数据保存失败', e);
    showToast('数据保存失败', 'error');
  }
}