
/**
 * 存储
 * 自动拆分模块
 * 保持全局兼容模式
 */

async function loadData() {
  try {
    // 先尝试从 IndexedDB 加载
    var data = await getFromDB(STORAGE_KEY);

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
      if (appData.settings.useSpxFormat === undefined) appData.settings.useSpxFormat = true;
      if (appData.settings.autoPhotoTool === undefined) appData.settings.autoPhotoTool = false;
      // 兼容新版：功能提示词自定义
      if (!appData.settings.promptOverrides) {
        appData.settings.promptOverrides = { memory: '', 'continue': '', photo: '' };
      }
      // 兼容新版：补全 comfyui 设置
      if (!appData.settings.comfyui) {
        appData.settings.comfyui = { enabled: false, serverUrl: 'http://127.0.0.1:8188', workflowJson: '', nodeIds: { prompt: '', width: '', height: '' }, defaultWidth: 512, defaultHeight: 768, timeout: 300 };
      }
      if (appData.settings.comfyui.timeout === undefined) appData.settings.comfyui.timeout = 300;
      // 兼容新版：图像供应商（默认 ComfyUI）+ 硅基流动配置
      if (!appData.settings.imageProvider) appData.settings.imageProvider = 'comfyui';
      if (!appData.settings.siliconflow) {
        appData.settings.siliconflow = {
          enabled: false,
          apiHost: 'https://api.siliconflow.cn',
          apiKey: '',
          model: 'Tongyi-MAI/Z-Image-Turbo',
          defaultWidth: 1024,
          defaultHeight: 1024,
          steps: 8,
          guidance: 7.5,
          negativePrompt: '',
          timeout: 120
        };
      }
      if (!appData.characters) appData.characters = [];
      // 兼容旧版：为每个聊天补全 characters 和 photos 字段
      if (appData.chats) {
        for (var id of Object.keys(appData.chats)) {
          if (appData.chats[id].characters === undefined) {
            appData.chats[id].characters = [];
          }
          if (appData.chats[id].photos === undefined) {
            appData.chats[id].photos = [];
          }
          migrateChatSpVersions(appData.chats[id]);
        }
      }
      return true; // IndexedDB 有数据
    }

    // IndexedDB 没有数据，尝试 localStorage（向后兼容）
    var raw = localStorage.getItem(STORAGE_KEY);
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
      if (appData.settings.useSpxFormat === undefined) appData.settings.useSpxFormat = true;
      if (appData.settings.autoPhotoTool === undefined) appData.settings.autoPhotoTool = false;
      // 兼容新版：功能提示词自定义
      if (!appData.settings.promptOverrides) {
        appData.settings.promptOverrides = { memory: '', 'continue': '', photo: '' };
      }
      // 兼容新版：补全 comfyui 设置
      if (!appData.settings.comfyui) {
        appData.settings.comfyui = { enabled: false, serverUrl: 'http://127.0.0.1:8188', workflowJson: '', nodeIds: { prompt: '', width: '', height: '' }, defaultWidth: 512, defaultHeight: 768, timeout: 300 };
      }
      if (appData.settings.comfyui.timeout === undefined) appData.settings.comfyui.timeout = 300;
      // 兼容新版：图像供应商（默认 ComfyUI）+ 硅基流动配置
      if (!appData.settings.imageProvider) appData.settings.imageProvider = 'comfyui';
      if (!appData.settings.siliconflow) {
        appData.settings.siliconflow = {
          enabled: false,
          apiHost: 'https://api.siliconflow.cn',
          apiKey: '',
          model: 'Tongyi-MAI/Z-Image-Turbo',
          defaultWidth: 1024,
          defaultHeight: 1024,
          steps: 8,
          guidance: 7.5,
          negativePrompt: '',
          timeout: 120
        };
      }
      if (!appData.characters) appData.characters = [];
      // 兼容旧版：为每个聊天补全 characters 和 photos 字段
      if (appData.chats) {
        for (var id of Object.keys(appData.chats)) {
          if (appData.chats[id].characters === undefined) {
            appData.chats[id].characters = [];
          }
          if (appData.chats[id].photos === undefined) {
            appData.chats[id].photos = [];
          }
          migrateChatSpVersions(appData.chats[id]);
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
    var resp = await fetch('default.txt');
    if (!resp.ok) return; // 文件不存在或加载失败，静默跳过
    var rawText = (await resp.text()).trim();
    if (!rawText) return;

    var data;
    // 尝试 base64 解码
    try {
      var jsonStr = base64ToJson(rawText);
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

