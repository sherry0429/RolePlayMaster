/**
 * 05_overrides.js —— 网页版逻辑 → 桌面外壳的适配层
 *
 * 网页版 30 个逻辑模块被原样复用（业务逻辑完全一致）。
 * 本文件只做三件事：
 *   1) 补上被移除模块（重放 / 侧边栏 / 初始化）遗留的全局符号，避免引用报错；
 *   2) 把「直接操作聊天区 DOM」的渲染函数替换为化身气泡版的渲染；
 *   3) 把依赖浏览器下载行为的导入导出换成原生文件对话框。
 * 除此之外不改动任何业务逻辑。
 */

// ==================== 1. 兼容垫片 ====================
// 网页版的「重放」在桌面版中被移除，但其它模块会引用到这些符号
var isReplaying = false;
var _replayGen = 0;
function stopReplay() {}
function toggleReplay() {}
// 侧边栏被面板取代
function toggleSidebar() {}
function closeSidebar() {}
// 移动端视口修正无需在桌面窗口使用
function setAppHeight() {}

// ==================== 2. 渲染层替换 ====================

/**
 * 网页版把消息渲染进 #chatArea；桌面版渲染进气泡浮层（最近 5 条）
 */
function renderMessages(shouldScrollToBottom) {
  renderAvatar();
  renderBubbleMessages();
  renderBubble();
  if (shouldScrollToBottom === false) return;
  scrollBubblePanelToBottom();
}

/** 聊天区不再存在，滚动语义转移到浮层 */
function scrollToBottom() {
  scrollBubblePanelToBottom();
}

/** 流式增量更新改为更新浮层中对应的一行 */
function updateStreamingMessage(idx, content) {
  updateBubbleStreaming(idx, content);
}

/** 桌面窗口是透明的，不绘制背景图（设置项仍保留以便与网页版数据互通） */
function applyBgImage() {}
function applyChatBgImage() {}

// 桌面版没有 Web Push：把通知相关实现置空，避免无意义的权限请求
function initChatNotification() {}
function requestNotificationPermission() { return Promise.resolve(false); }
function subscribePush() { return Promise.resolve(); }
function unsubscribePush() { return Promise.resolve(); }
function sendChatNotification() {}
function checkNotificationPlatformSupport() { return false; }

/**
 * 拍照按钮可见性：沿用网页版「未启用 ComfyUI 时隐藏拍照入口」的策略，
 * 但相册按钮在桌面版始终可见（设置面板里需要随时查看当前聊天相册）
 */
function updatePhotoFeatureVisibility() {
  var comfyuiEnabled = !!(appData.settings.comfyui && appData.settings.comfyui.enabled);
  var photoBtn = document.getElementById('photoActionBtn');
  if (photoBtn) photoBtn.style.display = comfyuiEnabled ? '' : 'none';
  var albumBtn = document.getElementById('albumBtn');
  if (albumBtn) albumBtn.style.display = '';
}

/** 统一的外壳刷新入口 */
function refreshShell() {
  renderAvatar();
  renderBubbleMessages();
  renderBubble();
  updateSpDisplaySafe();
  try { updatePhotoFeatureVisibility(); } catch (e) { /* ignore */ }
  applyShellOptionStyles();
}

// ==================== 3. 包装切换类函数 ====================

var _legacySelectChat = selectChat;
selectChat = function (id) {
  _legacySelectChat(id);
  _bubbleSeenCount = 0;
  renderAvatar();
  refreshShell();
};

var _legacyUpdateUIForNoChat = updateUIForNoChat;
updateUIForNoChat = function () {
  _legacyUpdateUIForNoChat();
  _bubbleSeenCount = 0;
  refreshShell();
};

var _legacyApplyImportedData = applyImportedData;
applyImportedData = function (data) {
  _avatarSignature = '';   // 强制化身重绘
  _legacyApplyImportedData(data);
  _bubbleSeenCount = 0;
  refreshShell();
  closeBubblePanel();
};

// 抽屉/模态框关闭后，若没有其它面板打开则还原窗口
['closeLogDrawer', 'closeAlbumDrawer', 'closeGalleryDrawer', 'closeModal', 'closePhotoCharSelect'].forEach(function (fnName) {
  if (typeof window[fnName] !== 'function') return;
  var original = window[fnName];
  window[fnName] = function () {
    var r = original.apply(null, arguments);
    setTimeout(maybeExitPanelMode, 0);
    return r;
  };
});

// 打开抽屉时把窗口切到面板模式（抽屉内容较宽，小窗口装不下）。
// 模态框（角色表单 / 重置确认 / 拍照选人）现在是全局浮层，就地显示即可，不必放大窗口。
['openLogDrawer', 'openGalleryDrawer', 'openAlbumDrawer'].forEach(function (fnName) {
  if (typeof window[fnName] !== 'function') return;
  var original = window[fnName];
  window[fnName] = function () {
    var def = calcPanelSize();
    shellEnterPanelMode({ w: def.w, h: def.h });
    var r = original.apply(null, arguments);
    return r;
  };
});

// ==================== 4. 导入导出 → 原生文件对话框 ====================

/** 剪贴板（带降级） */
function copyText(text, okMessage) {
  function done() { showToast(okMessage || '已复制到剪贴板', 'success'); }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(function () { legacyCopy(text, done); });
  } else {
    legacyCopy(text, done);
  }
}
function legacyCopy(text, onOk) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    if (onOk) onOk();
  } catch (e) {
    showModal('复制内容', text, null, true);
  }
  document.body.removeChild(ta);
}

/** 导出全部数据（原生保存对话框） */
function exportDataAsFile() {
  try {
    var base64 = jsonToBase64(JSON.stringify(appData));
    var name = 'aichat_backup_' + new Date().toISOString().slice(0, 10) + '.txt';
    shellSaveText(base64, name, 'RolePlayMaster 备份', ['txt']).then(function (ok) {
      if (ok) showToast('数据已导出（Base64 编码）', 'success');
    });
  } catch (e) {
    console.error('导出失败', e);
    showToast('导出失败: ' + e.message, 'error');
  }
}

/** 导入数据（原生打开对话框） */
function importData() {
  shellOpenText('RolePlayMaster 备份', ['txt', 'json']).then(function (rawText) {
    if (rawText === null || rawText === undefined) return;
    importDataFromText(rawText);
  });
}

/** 与网页版 handleImport 完全一致的解析与兼容补全 */
function importDataFromText(rawText) {
  try {
    rawText = String(rawText).trim();
    var data;
    try {
      data = JSON.parse(base64ToJson(rawText));
    } catch (b64Err) {
      data = JSON.parse(rawText);
    }
    if (!data.chats || !data.settings) throw new Error('无效的数据格式');

    if (!data.chatOrder) data.chatOrder = Object.keys(data.chats);
    if (!data.chatCounter) data.chatCounter = data.chatOrder.length;
    if (!data.theme) data.theme = 'light';
    if (!data.characters) data.characters = [];
    if (!data.settings.speakerMode) data.settings.speakerMode = true;
    if (!data.settings.syncToken) data.settings.syncToken = '';
    if (!data.settings.autoTopic) data.settings.autoTopic = false;
    if (!data.settings.chatNotification) data.settings.chatNotification = false;
    if (data.settings.autoTopicInterval === undefined) data.settings.autoTopicInterval = 10;
    if (data.settings.autoTopicMaxCount === undefined) data.settings.autoTopicMaxCount = 5;
    if (!data.settings.comfyui) {
      data.settings.comfyui = {
        enabled: false, serverUrl: 'http://127.0.0.1:8188', workflowJson: '',
        nodeIds: { prompt: '', width: '', height: '' }, defaultWidth: 512, defaultHeight: 768
      };
    }
    for (var id of Object.keys(data.chats)) {
      if (data.chats[id].characters === undefined) data.chats[id].characters = [];
      if (data.chats[id].photos === undefined) data.chats[id].photos = [];
    }
    if (data._shareLite) data = expandShareData(data);

    appData = data;
    saveData();
    applyImportedData(data);
    showToast('数据导入成功', 'success');
  } catch (err) {
    console.error('导入失败', err);
    showToast('导入失败: ' + err.message, 'error');
  }
}

/** 导出角色（原生保存对话框） */
function exportCharacters() {
  var chars = appData.characters || [];
  if (chars.length === 0) {
    showToast('没有角色可导出', 'error');
    return;
  }
  var payload = {
    type: 'SimpleGirlFriend_characters',
    version: 1,
    exportTime: new Date().toISOString(),
    characters: JSON.parse(JSON.stringify(chars))
  };
  var name = 'characters_' + new Date().toISOString().slice(0, 10) + '.json';
  shellSaveText(JSON.stringify(payload, null, 2), name, '角色数据', ['json']).then(function (ok) {
    if (ok) showToast('已导出 ' + chars.length + ' 个角色', 'success');
  });
}

/** 导入角色（原生打开对话框） */
function importCharacters() {
  shellOpenText('角色数据', ['json']).then(function (rawText) {
    if (rawText === null || rawText === undefined) return;
    importCharactersFromText(rawText);
  });
}

/** 与网页版 handleCharImport 完全一致的合并逻辑 */
function importCharactersFromText(rawText) {
  try {
    var data = JSON.parse(String(rawText).trim());
    if (!data.characters || !Array.isArray(data.characters)) {
      throw new Error('无效的角色数据格式，需要包含 characters 数组');
    }
    var validChars = data.characters.filter(function (c) { return c && c.name; });
    if (validChars.length === 0) throw new Error('未找到有效角色数据');

    if (!appData.characters) appData.characters = [];
    var added = 0, updated = 0;
    for (var char of validChars) {
      var existIdx = appData.characters.findIndex(function (c) { return c.name === char.name; });
      if (existIdx >= 0) {
        appData.characters[existIdx] = Object.assign({}, appData.characters[existIdx], {
          name: char.name,
          avatar: char.avatar || appData.characters[existIdx].avatar || '',
          description: char.description !== undefined ? char.description : appData.characters[existIdx].description
        });
        updated++;
      } else {
        appData.characters.push({
          id: char.id || (Date.now() + '_' + Math.random().toString(36).substr(2, 6)),
          name: char.name,
          avatar: char.avatar || '',
          description: char.description || ''
        });
        added++;
      }
    }
    saveData();
    galleryCurrentPage = 0;
    renderGalleryContent();
    refreshShell();
    showToast('角色导入完成：新增 ' + added + ' 个，更新 ' + updated + ' 个', 'success');
  } catch (err) {
    showToast('角色导入失败: ' + err.message, 'error');
  }
}

/** 相册照片下载（原生保存对话框） */
function downloadAlbumPhoto(photoId) {
  if (!currentChatId) return;
  var chat = appData.chats[currentChatId];
  if (!chat || !chat.photos) return;

  var photo = null;
  for (var i = 0; i < chat.photos.length; i++) {
    if (chat.photos[i].id === photoId) { photo = chat.photos[i]; break; }
  }
  if (!photo || !photo.dataUrl) {
    showToast('照片数据不可用', 'error');
    return;
  }
  var name = 'photo_' + (photo.characterName || 'unknown') + '_' + (photo.createdAt || Date.now()) + '.png';
  shellSaveBinary(photo.dataUrl, name);
}

/**
 * 分享链接：桌面版没有「网页地址」，因此用「分享链接基址」拼装，
 * 基址默认取云端同步地址（即网页版部署位置）。
 */
async function shareLink() {
  try {
    var liteData = buildShareLiteData();
    var encoded = await compressText(JSON.stringify(liteData));
    var base = (ShellPrefs.get('shareBase', '') || getCloudHost() || DEFAULT_CLOUD_HOST).replace(/\/+$/, '');
    var url = base + '/#share=' + encoded;
    copyText(url, '分享链接已复制（仅配置与 System Prompt，不含聊天记录）');
  } catch (e) {
    console.error('生成分享链接失败', e);
    showToast('生成分享链接失败: ' + e.message, 'error');
  }
}

// ==================== 5. 设置面板：分享基址 ====================

function initShareBaseOption() {
  var input = document.getElementById('optShareBase');
  if (!input) return;
  input.value = ShellPrefs.get('shareBase', '');
  input.addEventListener('change', function () {
    ShellPrefs.set('shareBase', input.value.trim());
    showToast('分享链接基址已保存', 'success');
  });
}
