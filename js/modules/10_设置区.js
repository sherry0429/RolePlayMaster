/**
     * 模块: 设置区
     * 该文件由自动拆分工具生成
     * 后续建议继续手动细化
     */

    import { state } from '../core/state.js';
    import * as CONSTANTS from '../core/constants.js';

    function toggleSettings() {
  const toggle = document.getElementById('settingsToggle');
  const form = document.getElementById('settingsForm');
  toggle.classList.toggle('open');
  form.classList.toggle('open');
}

function toggleAutoTopicConfig() {
  const config = document.getElementById('autoTopicConfig');
  const checked = document.getElementById('autoTopic').checked;
  config.style.display = checked ? '' : 'none';
}

function saveSettings() {
  appData.settings.apiHost = document.getElementById('apiHost').value.trim() || DEFAULT_API_HOST;
  appData.settings.apiKey = document.getElementById('apiKey').value.trim();
  // 摘要压缩阈值
  const threshold = parseInt(document.getElementById('compressThreshold').value, 10);
  appData.settings.compressThreshold = (threshold >= 10) ? threshold : COMPRESS_THRESHOLD;
  // 新设置项
  appData.settings.speakerMode = document.getElementById('speakerMode').checked;
  appData.settings.autoTopic = document.getElementById('autoTopic').checked;
  appData.settings.chatNotification = document.getElementById('chatNotification').checked;
  // 自动话题配置
  const interval = parseFloat(document.getElementById('autoTopicInterval').value);
  appData.settings.autoTopicInterval = (interval >= 0.1) ? interval : 10;
  const maxCount = parseInt(document.getElementById('autoTopicMaxCount').value, 10);
  appData.settings.autoTopicMaxCount = (maxCount >= 1) ? maxCount : 5;
  appData.settings.syncToken = document.getElementById('syncToken').value.trim();
  appData.settings.cloudSyncHost = document.getElementById('cloudSyncHost').value.trim();
  // 重新初始化自动话题和通知
  initAutoTopic();
  initChatNotification();
  // 如果消息正在显示，重新渲染以应用说话人区分
  if (currentChatId) renderMessages();
  saveData();
  showToast('设置已保存', 'success');
}

function resetSettings() {
  // 弹出确认提示
  const overlay = document.getElementById('modalOverlay');
  const content = document.getElementById('modalContent');
  content.style.maxWidth = '400px';

  let html = '<h3>⚠️ 重置所有数据</h3>';
  html += '<div style="color:var(--text-secondary);font-size:14px;line-height:1.6;margin-bottom:12px;">';
  html += '此操作将<strong style="color:var(--danger)">清空所有数据</strong>，包括：';
  html += '<ul style="margin:8px 0;padding-left:20px;">';
  html += '<li>所有聊天记录和 System Prompt</li>';
  html += '<li>所有角色图库数据</li>';
  html += '<li>所有设置（API Key、背景图等）</li>';
  html += '<li>IndexedDB 和 localStorage 中的全部数据</li>';
  html += '</ul>';
  html += '页面将恢复到最初始状态，此操作<strong style="color:var(--danger)">不可撤销</strong>。';
  html += '</div>';
  html += '<div class="modal-btns">';
  html += '<button class="btn-sm btn-danger" onclick="confirmResetAll()">确认重置</button>';
  html += '<button class="btn-sm btn-ghost" onclick="closeModal()">取消</button>';
  html += '</div>';

  content.innerHTML = html;
  overlay.classList.add('show');
  overlay._onConfirm = null;
}

async function confirmResetAll() {
  closeModal();
  try {
    // 清空 IndexedDB
    await deleteFromDB(STORAGE_KEY);
    // 清空 localStorage 中所有相关数据
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('useIndexedDB');
    localStorage.removeItem('sidebarCollapsed');
    // 删除整个 IndexedDB 数据库
    indexedDB.deleteDatabase(DB_NAME);
    // 重置内存数据为默认值
    appData = createDefaultData();
    currentChatId = null;
    isStreaming = false;
    isCompressing = false;
    _streamingCache = null;
    _streamingScrolledOnce = false;
    abortController = null;
    requestLog = [];
    // 重新初始化 UI
    document.getElementById('currentChatName').textContent = 'AI Chat';
    document.getElementById('chatArea').innerHTML = '<div class="welcome-msg">👋 欢迎使用 AI Chat<br>点击左侧 + 开始新对话</div>';
    applyBgImage('');
    updateBgImageStatus();
    renderChatList();
    updateSpDisplay();
    // 重置设置表单
    document.getElementById('apiHost').value = DEFAULT_API_HOST;
    document.getElementById('apiKey').value = '';
    document.getElementById('compressThreshold').value = COMPRESS_THRESHOLD;
    document.getElementById('speakerMode').checked = true;
    document.getElementById('autoTopic').checked = false;
    document.getElementById('chatNotification').checked = false;
    document.getElementById('autoTopicInterval').value = 10;
    document.getElementById('autoTopicMaxCount').value = 5;
    document.getElementById('syncToken').value = '';
    document.getElementById('cloudSyncHost').value = '';
    toggleAutoTopicConfig();
    initAutoTopic();
    initChatNotification();
    showToast('所有数据已重置为初始状态', 'success');
  } catch (e) {
    console.error('重置失败', e);
    showToast('重置失败: ' + e.message, 'error');
  }
}