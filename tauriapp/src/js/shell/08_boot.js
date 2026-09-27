/**
 * 06_boot.js —— 桌面版启动流程
 *
 * 与网页版的区别：
 * - 不注册 Service Worker、不初始化 Web Push（桌面窗口不需要）
 * - 不构造网页版的侧边栏 / 顶栏 / 输入区 DOM，改为装配化身气泡外壳
 * - 首次启动会把内置角色库（characters_default.json）导入本地存储
 */

async function shellBoot() {
  console.log('[RolePlayMaster·Desktop] booting…');

  // ---- 1. 加载本地数据（IndexedDB，与网页版同一套数据结构与存储键）----
  await loadData();

  // ---- 2. 主题 ----
  applyTheme(appData.theme || 'light');

  // ---- 3. 桌面外壳外观（置顶状态、化身尺寸、气泡不透明度）----
  applyShellOptionStyles();
  applyShellWindowPrefs();

  // ---- 4. 首次启动：导入内置角色库 ----
  if (!appData.characters || appData.characters.length === 0) {
    await seedDefaultCharacters();
  }

  // ---- 5. 回填设置表单（对应网页版 init() 中的表单初始化）----
  fillSettingsForm();

  // ---- 6. 事件装配 ----
  initBubble();
  initContextMenu();
  initPanels();
  try { initIdleHide(); } catch (e) { /* ignore */ }
  initShareBaseOption();
  bindSettingsInteractions();

  // ---- 7. 首次渲染（优先回到上次使用的聊天）----
  renderChatList();
  if (appData.chatOrder && appData.chatOrder.length > 0) {
    var lastId = ShellPrefs.get('lastChatId', '');
    var firstId = (lastId && appData.chats[lastId]) ? lastId : appData.chatOrder[0];
    selectChat(firstId);
  } else {
    updateUIForNoChat();
  }

  // ---- 8. 自动找话题 & 页面可见性 ----
  initAutoTopic();
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // ---- 9. 按当前化身尺寸收紧窗口（收起态紧贴化身）----
  shellSyncAvatarWindowSize();

  // ---- 10. URL 中的分享数据（桌面端一般不会出现，保留兼容）----
  try { checkShareData(); } catch (e) { /* ignore */ }

  console.log('[RolePlayMaster·Desktop] ready');

}

/** 首次启动导入内置角色库 */
async function seedDefaultCharacters() {
  try {
    var resp = await fetch('characters_default.json');
    if (!resp.ok) return;
    var data = await resp.json();
    if (!data || !Array.isArray(data.characters) || data.characters.length === 0) return;
    appData.characters = data.characters
      .filter(function (c) { return c && c.name; })
      .map(function (c, i) {
        return {
          id: c.id || ('char_default_' + i),
          name: c.name,
          avatar: c.avatar || '',
          description: c.description || ''
        };
      });
    await saveData();
    console.log('[RolePlayMaster·Desktop] 已导入内置角色库：' + appData.characters.length + ' 个角色');
  } catch (e) {
    console.warn('内置角色库导入跳过', e);
  }
}

/** 把 appData.settings 回填到设置面板（对应网页版 init 中的表单初始化） */
function fillSettingsForm() {
  var s = appData.settings || {};
  setValue('apiHost', s.apiHost || DEFAULT_API_HOST);
  setValue('apiKey', s.apiKey || '');
  setValue('compressThreshold', s.compressThreshold || COMPRESS_THRESHOLD);
  setChecked('speakerMode', s.speakerMode !== false);
  setChecked('useSpxFormat', s.useSpxFormat !== false);
  setChecked('autoPhotoTool', !!s.autoPhotoTool);
  setChecked('autoTopic', !!s.autoTopic);
  setChecked('chatNotification', !!s.chatNotification);
  setChecked('photoNotification', !!s.photoNotification);
  setValue('autoTopicInterval', s.autoTopicInterval || 10);
  setValue('autoTopicMaxCount', s.autoTopicMaxCount || 5);
  setValue('syncToken', s.syncToken || '');
  setValue('cloudSyncHost', s.cloudSyncHost || '');

  try { loadComfyuiSettings(); } catch (e) { /* ignore */ }
  try { toggleAutoTopicConfig(); } catch (e) { /* ignore */ }
  try { updateBgImageStatus(); } catch (e) { /* ignore */ }
  try { updatePhotoFeatureVisibility(); } catch (e) { /* ignore */ }
}

function setValue(id, v) {
  var el = document.getElementById(id);
  if (el) el.value = v;
}
function setChecked(id, v) {
  var el = document.getElementById(id);
  if (el) el.checked = !!v;
}

/** 设置面板的联动事件 */
function bindSettingsInteractions() {
  var autoTopic = document.getElementById('autoTopic');
  if (autoTopic) {
    autoTopic.addEventListener('change', function () {
      try { toggleAutoTopicConfig(); } catch (e) { /* ignore */ }
    });
  }

  // 记住上次使用的聊天，下次启动直接回到它
  window.addEventListener('beforeunload', function () {
    if (currentChatId) ShellPrefs.set('lastChatId', currentChatId);
  });
}

// 选择聊天时顺便记住（包装一次 selectChat 的最外层，便于持久化）
(function rememberCurrentChat() {
  var inner = selectChat;
  selectChat = function (id) {
    inner(id);
    if (id) ShellPrefs.set('lastChatId', id);
  };
})();

// ==================== 入口 ====================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', shellBoot);
} else {
  shellBoot();
}
