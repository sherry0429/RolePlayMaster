
/**
 * 设置区
 * 自动拆分模块
 * 保持全局兼容模式
 */

function toggleSettings() {
  var toggle = document.getElementById('settingsToggle');
  var form = document.getElementById('settingsForm');
  toggle.classList.toggle('open');
  form.classList.toggle('open');
}

function toggleAutoTopicConfig() {
  var config = document.getElementById('autoTopicConfig');
  var checked = document.getElementById('autoTopic').checked;
  config.style.display = checked ? '' : 'none';
}

function saveSettings() {
  appData.settings.apiHost = document.getElementById('apiHost').value.trim() || DEFAULT_API_HOST;
  appData.settings.apiKey = document.getElementById('apiKey').value.trim();
  // 摘要压缩阈值
  var threshold = parseInt(document.getElementById('compressThreshold').value, 10);
  appData.settings.compressThreshold = (threshold >= 10) ? threshold : COMPRESS_THRESHOLD;
  // 新设置项
  appData.settings.speakerMode = document.getElementById('speakerMode').checked;
  appData.settings.autoTopic = document.getElementById('autoTopic').checked;
  appData.settings.chatNotification = document.getElementById('chatNotification').checked;
  // 自动话题配置
  var interval = parseFloat(document.getElementById('autoTopicInterval').value);
  appData.settings.autoTopicInterval = (interval >= 0.1) ? interval : 10;
  var maxCount = parseInt(document.getElementById('autoTopicMaxCount').value, 10);
  appData.settings.autoTopicMaxCount = (maxCount >= 1) ? maxCount : 5;
  appData.settings.syncToken = document.getElementById('syncToken').value.trim();
  appData.settings.cloudSyncHost = document.getElementById('cloudSyncHost').value.trim();
  // ComfyUI 设置
  appData.settings.comfyui.enabled = document.getElementById('comfyuiEnabled').checked;
  appData.settings.comfyui.serverUrl = document.getElementById('comfyuiServerUrl').value.trim() || 'http://127.0.0.1:8188';
  appData.settings.comfyui.nodeIds.prompt = document.getElementById('comfyuiPromptNodeId').value.trim();
  appData.settings.comfyui.nodeIds.width = document.getElementById('comfyuiWidthNodeId').value.trim();
  appData.settings.comfyui.nodeIds.height = document.getElementById('comfyuiHeightNodeId').value.trim();
  var w = parseInt(document.getElementById('comfyuiDefaultWidth').value, 10);
  appData.settings.comfyui.defaultWidth = (w >= 64 && w <= 2048) ? w : 512;
  var h = parseInt(document.getElementById('comfyuiDefaultHeight').value, 10);
  appData.settings.comfyui.defaultHeight = (h >= 64 && h <= 2048) ? h : 768;
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
  var overlay = document.getElementById('modalOverlay');
  var content = document.getElementById('modalContent');
  content.style.maxWidth = '400px';

  var html = '<h3>⚠️ 重置所有数据</h3>';
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
    programLog = [];
    isPhotoShooting = false;
    photoAbortController = null;
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
    // 重置 ComfyUI 表单
    document.getElementById('comfyuiEnabled').checked = false;
    document.getElementById('comfyuiServerUrl').value = 'http://127.0.0.1:8188';
    document.getElementById('comfyuiPromptNodeId').value = '';
    document.getElementById('comfyuiWidthNodeId').value = '';
    document.getElementById('comfyuiHeightNodeId').value = '';
    document.getElementById('comfyuiDefaultWidth').value = 512;
    document.getElementById('comfyuiDefaultHeight').value = 768;
    document.getElementById('comfyuiWorkflowStatus').textContent = '未上传';
    document.getElementById('comfyuiWorkflowStatus').style.color = '';
    toggleAutoTopicConfig();
    initAutoTopic();
    initChatNotification();
    showToast('所有数据已重置为初始状态', 'success');
  } catch (e) {
    console.error('重置失败', e);
    showToast('重置失败: ' + e.message, 'error');
  }
}

// ComfyUI 工作流上传处理
function handleComfyuiWorkflowUpload(event) {
  var file = event.target.files[0];
  if (!file) return;
  if (!file.name.endsWith('.json')) {
    showToast('请选择 JSON 格式的工作流文件', 'error');
    return;
  }
  var reader = new FileReader();
  reader.onload = (e) => {
    try {
      var text = e.target.result;
      // JSON 校验
      JSON.parse(text);
      // 保存 minified 版本
      var minified = JSON.stringify(JSON.parse(text));
      appData.settings.comfyui.workflowJson = minified;
      document.getElementById('comfyuiWorkflowStatus').textContent = '✅ ' + file.name;
      document.getElementById('comfyuiWorkflowStatus').style.color = 'var(--success)';
      showToast('工作流上传成功，请设置节点 ID', 'success');
    } catch (err) {
      showToast('JSON 格式无效: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// 加载 ComfyUI 设置到表单
function loadComfyuiSettings() {
  var c = appData.settings.comfyui || {};
  document.getElementById('comfyuiEnabled').checked = !!c.enabled;
  document.getElementById('comfyuiServerUrl').value = c.serverUrl || 'http://127.0.0.1:8188';
  document.getElementById('comfyuiPromptNodeId').value = (c.nodeIds && c.nodeIds.prompt) || '';
  document.getElementById('comfyuiWidthNodeId').value = (c.nodeIds && c.nodeIds.width) || '';
  document.getElementById('comfyuiHeightNodeId').value = (c.nodeIds && c.nodeIds.height) || '';
  document.getElementById('comfyuiDefaultWidth').value = c.defaultWidth || 512;
  document.getElementById('comfyuiDefaultHeight').value = c.defaultHeight || 768;
  if (c.workflowJson) {
    document.getElementById('comfyuiWorkflowStatus').textContent = '✅ 已上传';
    document.getElementById('comfyuiWorkflowStatus').style.color = 'var(--success)';
  } else {
    document.getElementById('comfyuiWorkflowStatus').textContent = '未上传';
    document.getElementById('comfyuiWorkflowStatus').style.color = '';
  }
}

