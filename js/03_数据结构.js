
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
      autoTopicInterval: 10,
      autoTopicMaxCount: 5
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
    spViewIndex: 0       // 当前查看的版本索引（在 spVersions 数组中的索引）
  };
}

