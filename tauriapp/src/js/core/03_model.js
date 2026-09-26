
/**
 * 数据结构
 * 自动拆分模块
 * 保持全局兼容模式
 */

function createDefaultData() {
  return {
    theme: 'light',
    settings: {
      apiHost: DEFAULT_API_HOST,
      apiKey: '',
      bgImage: '',
      compressThreshold: COMPRESS_THRESHOLD,
      speakerMode: true,
      syncToken: '',
      cloudSyncHost: '',
      autoTopic: false,
      chatNotification: false,
      photoNotification: false,
      autoTopicInterval: 10,
      autoTopicMaxCount: 5,
      // 功能提示词自定义（设置 → 数据 → 功能提示词调整），空字符串表示使用默认值
      promptOverrides: { memory: '', 'continue': '', photo: '' },
      comfyui: {
        enabled: false,
        serverUrl: 'http://127.0.0.1:8188',
        workflowJson: '',
        nodeIds: { prompt: '', width: '', height: '' },
        defaultWidth: 512,
        defaultHeight: 768,
        timeout: 300
      },
      // 当前使用的图像供应商（可扩展更多）
      imageProvider: 'comfyui',
      // 硅基流动 SiliconFlow
      siliconflow: {
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
      }
    },
    chats: {},       // { id: { name, bgImage, messages: [], spVersions: [] } }
    chatOrder: [],   // 聊天 ID 有序列表
    chatCounter: 0,  // 自增计数器
    characters: []   // 角色图库 [{ id, name, avatar, description }]
  };
}

function createChat(id, name) {
  return {
    name: name,
    bgImage: '',
    characters: [],      // [{ name, avatar }] 关联角色图库，创建后不可修改
    messages: [],        // [{ role, content }]
    spVersions: [        // System Prompt 版本列表
      { version: 0, content: '', lastIndex: -1 } // 初始空版本
    ],
    spViewIndex: 0,      // 当前查看的版本索引（在 spVersions 数组中的索引）
    photos: []           // 相册 [{ id, dataUrl, prompt, characterName, createdAt }]
  };
}

