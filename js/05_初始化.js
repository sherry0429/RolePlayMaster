
/**
 * 初始化
 * 自动拆分模块
 * 保持全局兼容模式
 */

// 移动端视口高度修复（解决 100vh 含地址栏的问题）
function setAppHeight() {
  document.documentElement.style.setProperty('--app-height', window.innerHeight + 'px');
}

async function init() {
  // 视口高度修复
  setAppHeight();
  window.addEventListener('resize', setAppHeight);
  window.addEventListener('orientationchange', () => setTimeout(setAppHeight, 100));

  var hasData = await loadData();
  // 主题
  applyTheme(appData.theme);
  // 设置表单
  document.getElementById('apiHost').value = appData.settings.apiHost || DEFAULT_API_HOST;
  document.getElementById('apiKey').value = appData.settings.apiKey || '';
  document.getElementById('compressThreshold').value = appData.settings.compressThreshold || COMPRESS_THRESHOLD;
  // 新设置项
  document.getElementById('speakerMode').checked = appData.settings.speakerMode !== false;
  document.getElementById('autoTopic').checked = !!appData.settings.autoTopic;
  document.getElementById('chatNotification').checked = !!appData.settings.chatNotification;
  document.getElementById('autoTopicInterval').value = appData.settings.autoTopicInterval || 10;
  document.getElementById('autoTopicMaxCount').value = appData.settings.autoTopicMaxCount || 5;
  toggleAutoTopicConfig();
  // autoTopic checkbox 联动
  document.getElementById('autoTopic').addEventListener('change', toggleAutoTopicConfig);
  document.getElementById('syncToken').value = appData.settings.syncToken || '';
  document.getElementById('cloudSyncHost').value = appData.settings.cloudSyncHost || '';
  // 加载 ComfyUI 设置
  loadComfyuiSettings();
  // 全局背景
  applyBgImage(appData.settings.bgImage);
  // 聊天列表
  renderChatList();
  // 背景图片状态
  updateBgImageStatus();
  // 如果有聊天，选中第一个
  if (appData.chatOrder.length > 0) {
    selectChat(appData.chatOrder[0]);
  } else {
    updateUIForNoChat();
  }
  // 输入框自动高度
  var input = document.getElementById('userInput');
  input.addEventListener('input', autoResizeInput);
  input.addEventListener('keydown', handleInputKeydown);
  // 点击输入框时，桌面端自动折叠侧边栏（沉浸式聊天体验）
  input.addEventListener('focus', () => {
    if (window.innerWidth > 768) {
      document.getElementById('sidebar').classList.add('collapsed');
      localStorage.setItem('sidebarCollapsed', 'true');
    }
  });
  // 检查 URL 中的分享数据
  checkShareData();

  // 桌面端：读取侧边栏状态
  if (window.innerWidth > 768) {
    var collapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (collapsed) {
      document.getElementById('sidebar').classList.add('collapsed');
    }
  }

  // 首次启动且无数据时，尝试从 default.txt 加载
  if (!hasData) {
    await loadDefaultData();
  }

  // ---- PWA: 注册 Service Worker ----
  registerServiceWorker();
  // ---- PWA: 处理安装提示 ----
  initPwaInstall();
  // ---- 自动找话题 & 通知 ----
  initAutoTopic();
  initChatNotification();
  // ---- 页面可见性监听 ----
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // ---- 聊天通知权限请求（用户勾选时触发） ----
  var chatNotifCheckbox = document.getElementById('chatNotification');
  if (chatNotifCheckbox) {
    chatNotifCheckbox.addEventListener('change', async (e) => {
      if (e.target.checked) {
        var granted = await requestNotificationPermission();
        if (!granted) {
          e.target.checked = false;
          appData.settings.chatNotification = false;
          saveData();
        }
      } else {
        // 用户取消勾选，注销 Push 订阅
        await unsubscribePush();
        appData.settings.chatNotification = false;
        saveData();
      }
    });
  }
}

