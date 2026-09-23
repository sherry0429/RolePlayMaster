
/**
 * 消息分页渲染
 * 自动拆分模块
 * 保持全局兼容模式
 */

var renderedMessageCount = 20; // 当前渲染的消息数量
var MESSAGE_PAGE_SIZE = 20; // 每次加载的消息数量

function initAutoTopic() {
  if (autoTopicTimer) {
    clearInterval(autoTopicTimer);
    autoTopicTimer = null;
  }
  if (autoTopicCountdownTimer) {
    clearInterval(autoTopicCountdownTimer);
    autoTopicCountdownTimer = null;
  }
  autoTopicCount = 0;
  isAutoTopicRunning = false;
  if (appData.settings.autoTopic) {
    // 每秒检查一次是否需要触发（支持小数分钟，最小0.1=6秒）
    autoTopicTimer = setInterval(checkAutoTopic, 1000);
    // 每秒更新倒计时显示
    updateCountdownDisplay();
    autoTopicCountdownTimer = setInterval(updateCountdownDisplay, 1000);
  } else {
    // 隐藏倒计时
    var countdownEl = document.getElementById('autoTopicCountdown');
    if (countdownEl) countdownEl.style.display = 'none';
  }
}

function resetAutoTopicTimer() {
  lastActivityTime = Date.now();
  updateCountdownDisplay();
}

// 更新自动话题倒计时显示
function updateCountdownDisplay() {
  var countdownEl = document.getElementById('autoTopicCountdown');
  if (!countdownEl) return;

  // 如果自动话题未开启，隐藏倒计时
  if (!appData.settings.autoTopic) {
    countdownEl.style.display = 'none';
    return;
  }

  // 如果没有当前聊天，隐藏倒计时
  if (!currentChatId || !appData.chats[currentChatId]) {
    countdownEl.style.display = 'none';
    return;
  }

  var maxCount = appData.settings.autoTopicMaxCount || 5;
  var countText = `${autoTopicCount}/${maxCount}`;

  // 如果达到触发上限，显示"已达上限"并隐藏
  if (autoTopicCount >= maxCount) {
    countdownEl.style.display = 'none';
    return;
  }

  // 计算剩余时间
  var intervalMin = appData.settings.autoTopicInterval || 10;
  var intervalMs = intervalMin * 60 * 1000;
  var idleMs = Date.now() - lastActivityTime;
  var remainingMs = intervalMs - idleMs;

  if (remainingMs <= 0) {
    countdownEl.textContent = `⏱️ 即将开始新话题 (${countText})`;
    countdownEl.style.display = 'inline-block';
    return;
  }

  // 计算分秒
  var remainingSec = Math.ceil(remainingMs / 1000);
  var minutes = Math.floor(remainingSec / 60);
  var seconds = remainingSec % 60;

  // 智能显示：如果间隔小于1分钟，只显示秒
  var timeText;
  if (minutes > 0) {
    timeText = `${minutes}分${seconds}秒`;
  } else {
    timeText = `${seconds}秒`;
  }
  countdownEl.textContent = `⏱️ ${timeText} (${countText})`;
  countdownEl.style.display = 'inline-block';
}

function handleVisibilityChange() {
  // 页面可见性变化时，更新倒计时显示
  updateCountdownDisplay();
  
  // 如果页面变为可见，立即检查是否需要触发自动话题
  // 修复移动端浏览器后台节流 setInterval 导致的问题
  if (!document.hidden) {
    checkAutoTopic();
  }
}

function checkAutoTopic() {
  if (!appData.settings.autoTopic) return;
  if (!currentChatId || !appData.chats[currentChatId]) return;
  if (isStreaming || isCompressing || isAutoTopicRunning) return;
  // 检查触发次数上限
  var maxCount = appData.settings.autoTopicMaxCount || 5;
  if (autoTopicCount >= maxCount) return;
  // 检查是否已经超过指定分钟无操作
  var intervalMin = appData.settings.autoTopicInterval || 10;
  var idleMs = Date.now() - lastActivityTime;
  if (idleMs < intervalMin * 60 * 1000) return;
  // 触发自动话题
  triggerAutoTopic();
}

async function triggerAutoTopic() {
  // 互斥锁：防止并发触发（async 等待期间 setInterval 可能再次调用）
  if (isAutoTopicRunning) return;
  isAutoTopicRunning = true;

  // 立即重置活动时间和递增计数，防止 await 期间被重复触发
  var realAwayMs = Date.now() - lastActivityTime;
  lastActivityTime = Date.now();
  autoTopicCount++;
  updateCountdownDisplay();

  // 保存当前聊天ID，防止异步等待期间用户切换聊天导致渲染错误
  var chatIdAtStart = currentChatId;
  var chat = appData.chats[chatIdAtStart];
  if (!chat) { isAutoTopicRunning = false; return; }

  var apiKey = appData.settings.apiKey;
  if (!apiKey) { isAutoTopicRunning = false; return; }

  var apiHost = appData.settings.apiHost || DEFAULT_API_HOST;
  var url = apiHost.replace(/\/+$/, '') + '/chat/completions';

  // 构建消息列表
  var sp = getCurrentSpVersion();
  var messages = [];
  if (sp.content) {
    messages.push({ role: 'system', content: sp.content });
  }
  var startIdx = sp.lastIndex + 1;
  for (var i = startIdx; i < chat.messages.length; i++) {
    messages.push({ role: chat.messages[i].role, content: chat.messages[i].content });
  }

  // 构建自动话题提示 - 优先使用聊天框关联的角色，避免发散到角色图库全部角色
  var charNames = [];
  if (chat.characters && chat.characters.length > 0) {
    charNames = chat.characters.map(c => c.name).filter(Boolean);
  } else {
    // 兼容旧版：聊天框没有角色属性时，回退到从 system prompt 提取
    var spContent = sp.content || '';
    var speakerNames = extractSpeakerNames(spContent);
    charNames = speakerNames;
  }
  var charHint = charNames.length > 0
    ? `可选角色有：${charNames.join('、')}。`
    : '';

  // 格式化时间间隔显示
  var formatDuration = (ms) => {
    var totalSec = Math.round(ms / 1000);
    if (totalSec < 60) return `${totalSec}秒`;
    var totalMin = Math.round(totalSec / 60);
    if (totalMin < 60) return `${totalMin}分钟`;
    var hours = Math.floor(totalMin / 60);
    var mins = totalMin % 60;
    return mins > 0 ? `${hours}小时${mins}分钟` : `${hours}小时`;
  };
  var awayText = formatDuration(realAwayMs);

  messages.push({
    role: 'user',
    content: `[系统提示：用户已经离开很久了，${buildAutoTopicPrompt(charHint)}]`
  });

  // 记录自动话题日志
  addProgramLog(LOG_TYPE_AUTO_TOPIC, {
    summary: '自动发起话题',
    chatName: chat.name + LOG_NAME_AUTO_TOPIC,
    detail: messages
  });

  try {
    var response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: messages,
        stream: false
      })
    });

    if (!response.ok) throw new Error('自动话题请求失败');

    var result = await response.json();
    var content = result.choices?.[0]?.message?.content || '';

    if (content) {
      chat.messages.push({ role: 'assistant', content: content });
      saveData();
      // 只有当用户没有切换聊天时，才重新渲染消息
      if (currentChatId === chatIdAtStart) {
        renderMessages();
      }
      // 发送通知
      if (appData.settings.chatNotification) {
        sendChatNotification(content);
      }
    }
  } catch (e) {
    console.error('自动话题失败', e);
  } finally {
    isAutoTopicRunning = false;
  }
}

// ==================== 聊天通知（Web Push 版）====================
var notificationPermissionGranted = false;
var serviceWorkerRegistration = null;
var pushSubscription = null; // 当前的 PushSubscription 对象

// ── 工具：将 VAPID 公钥（base64url）转换为 Uint8Array ──
function urlBase64ToUint8Array(base64String) {
  var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  var rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// ── 初始化：获取 SW 注册 + 恢复已有 Push 订阅 ──
function initChatNotification() {
  if (!('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) {
    console.warn('[通知] 当前环境不支持 Push 通知');
    return;
  }

  navigator.serviceWorker.ready.then(async registration => {
    serviceWorkerRegistration = registration;
    console.log('[通知] SW 就绪');

    // 恢复已有订阅（刷新页面后不需要重新订阅）
    pushSubscription = await registration.pushManager.getSubscription();
    if (pushSubscription) {
      console.log('[通知] 已有 Push 订阅，无需重新订阅');
      notificationPermissionGranted = true;
    }
  }).catch(err => {
    console.warn('[通知] SW ready 失败', err);
  });

  // 检查已有权限状态
  if (Notification.permission === 'granted') {
    notificationPermissionGranted = true;
  }

  // 监听 SW 推送的心跳消息（页面可见时由页面负责触发 autoTopic）
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data && event.data.type === 'PUSH_HEARTBEAT') {
      console.log('[通知] 收到心跳，尝试触发 autoTopic');
      // 复用已有的自动话题逻辑：只在页面可见且空闲时触发
      if (appData && appData.settings && appData.settings.autoTopic) {
        var maxCount = appData.settings.autoTopicMaxCount || 5;
        if (autoTopicCount < maxCount) {
          triggerAutoTopic();
        }
      }
    }
  });
}

// ── 平台检测 ──
function checkNotificationPlatformSupport() {
  if (!('Notification' in window) || !('PushManager' in window)) {
    showToast('当前浏览器不支持推送通知', 'error');
    return false;
  }
  // iOS 需要添加到主屏幕
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  var isStandalone = window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
  if (isIOS && !isStandalone) {
    showToast('iOS 需先将应用添加到主屏幕，再开启通知', 'error');
    return false;
  }
  return true;
}

// ── 当用户勾选"聊天通知"时调用 ──
async function requestNotificationPermission() {
  if (!checkNotificationPlatformSupport()) return false;

  if (Notification.permission === 'denied') {
    showToast('通知权限已被拒绝，请在浏览器/系统设置中手动允许', 'error');
    return false;
  }

  // 请求通知权限（必须在用户手势中调用）
  var permission = Notification.permission;
  if (permission !== 'granted') {
    try {
      permission = await Notification.requestPermission();
    } catch (e) {
      console.error('[通知] requestPermission 失败', e);
      return false;
    }
  }
  if (permission !== 'granted') {
    showToast('通知权限被拒绝', 'error');
    return false;
  }
  notificationPermissionGranted = true;

  // 订阅 Push
  await subscribePush();
  return notificationPermissionGranted;
}

// ── 向服务器注册 Push 订阅 ──
async function subscribePush() {
  if (!serviceWorkerRegistration) {
    console.warn('[通知] SW 未就绪，无法订阅 Push');
    return;
  }

  var token = appData.settings.syncToken;
  if (!token) {
    showToast('请先在设置中填写同步 Token，用于绑定推送', 'error');
    return;
  }

  try {
    // 1. 拿到服务器的 VAPID 公钥
    var keyResp = await fetch(`${getCloudHost()}/api/push/vapid-public-key`);
    if (!keyResp.ok) throw new Error('获取 VAPID 公钥失败: ' + keyResp.status);
    var { publicKey } = await keyResp.json();

    // 2. 订阅（若已订阅则先取消旧的）
    var existing = await serviceWorkerRegistration.pushManager.getSubscription();
    if (existing) await existing.unsubscribe();

    pushSubscription = await serviceWorkerRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
    console.log('[通知] Push 订阅成功', pushSubscription.endpoint);

    // 3. 上报订阅到服务器
    var regResp = await fetch(`${getCloudHost()}/api/push/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        token,
        subscription: pushSubscription.toJSON()
      })
    });
    if (!regResp.ok) throw new Error('上报订阅失败: ' + regResp.status);

    showToast('推送通知已启用 ✅', 'success');
  } catch (e) {
    console.error('[通知] subscribePush 失败', e);
    showToast('Push 订阅失败: ' + e.message, 'error');
    notificationPermissionGranted = false;
  }
}

// ── 取消 Push 订阅（用户取消勾选时调用）──
async function unsubscribePush() {
  if (!pushSubscription) return;
  var endpoint = pushSubscription.endpoint;
  try {
    await pushSubscription.unsubscribe();
    pushSubscription = null;
    notificationPermissionGranted = false;

    var token = appData.settings.syncToken;
    if (token) {
      fetch(`${getCloudHost()}/api/push/unsubscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ endpoint })
      }).catch(() => {});
    }
    console.log('[通知] Push 订阅已取消');
  } catch (e) {
    console.error('[通知] unsubscribePush 失败', e);
  }
}

// ── 页面可见时展示 AI 生成的通知（autoTopic 触发后调用）──
async function sendChatNotification(content) {
  if (!appData.settings.chatNotification) return;
  if (!notificationPermissionGranted) return;
  if (!serviceWorkerRegistration) return;

  // 从内容中提取说话人
  var speakerName = '';
  var speakerAvatar = null;
  var speakerMatch = content.match(/【(.+?)】/);
  if (speakerMatch) {
    speakerName = speakerMatch[1];
    var charInfo = findCharacter(speakerName);
    // 【方案B修复】icon 不支持 data URL，只使用真实路径
    if (charInfo && charInfo.avatar && !charInfo.avatar.startsWith('data:')) {
      speakerAvatar = charInfo.avatar;
    }
  }

  var displayContent = content.length > 50 ? content.slice(0, 50) + '...' : content;
  displayContent = displayContent.replace(/【.+?】/g, '').trim();

  var title = speakerName ? `${speakerName} 发来了消息` : 'AI Chat 新消息';
  var options = {
    body: displayContent,
    icon: speakerAvatar || 'icons/icon-192.png', // 已过滤 data URL
    badge: 'icons/icon-96.png',
    tag: 'aichat-notification',
    renotify: true,
    requireInteraction: false,
    silent: false
  };

  console.log('[通知] 发送前台通知', title);

  try {
    // 通过 SW 发送（支持 PWA 后台）
    await serviceWorkerRegistration.showNotification(title, options);
    // SW 通知不会自动关闭，手动清理
    setTimeout(() => {
      serviceWorkerRegistration.getNotifications({ tag: 'aichat-notification' })
        .then(ns => ns.forEach(n => n.close()));
    }, 5000);
  } catch (e) {
    console.error('[通知] 通知发送失败', e);
  }
}

