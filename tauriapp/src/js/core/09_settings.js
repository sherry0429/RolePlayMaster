
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
  // 保存前的旧值快照（用于 diff 日志；密钥/令牌不落明文）
  var old = JSON.parse(JSON.stringify(appData.settings));

  appData.settings.apiHost = document.getElementById('apiHost').value.trim() || DEFAULT_API_HOST;
  appData.settings.apiKey = document.getElementById('apiKey').value.trim();
  // 摘要压缩阈值
  var threshold = parseInt(document.getElementById('compressThreshold').value, 10);
  appData.settings.compressThreshold = (threshold >= 10) ? threshold : COMPRESS_THRESHOLD;
  // 新设置项
  appData.settings.speakerMode = document.getElementById('speakerMode').checked;
  appData.settings.autoTopic = document.getElementById('autoTopic').checked;
  appData.settings.chatNotification = document.getElementById('chatNotification').checked;
  // 拍照完成系统通知（设置 → 图像第一行）
  appData.settings.photoNotification = document.getElementById('photoNotification').checked;
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
  // 生成超时（秒）
  var to = parseInt(document.getElementById('comfyuiTimeout').value, 10);
  appData.settings.comfyui.timeout = (to >= 10 && to <= 3600) ? to : 300;

  // 硅基流动 SiliconFlow
  var sfEnabledEl = document.getElementById('siliconflowEnabled');
  var sf = appData.settings.siliconflow;
  sf.enabled = !!(sfEnabledEl && sfEnabledEl.checked);
  var sfKeyEl = document.getElementById('siliconflowApiKey');
  if (sfKeyEl) sf.apiKey = sfKeyEl.value.trim();
  // 模型固定为 Tongyi-MAI/Z-Image-Turbo（只支持这一个）
  sf.model = (typeof SILICONFLOW_MODEL !== 'undefined') ? SILICONFLOW_MODEL : sf.model;
  var sfHostEl = document.getElementById('siliconflowApiHost');
  if (sfHostEl) sf.apiHost = sfHostEl.value.trim() || 'https://api.siliconflow.cn';
  var sfW = parseInt((document.getElementById('siliconflowWidth') || {}).value, 10);
  sf.defaultWidth = (sfW >= 64 && sfW <= 4096) ? sfW : 1024;
  var sfH = parseInt((document.getElementById('siliconflowHeight') || {}).value, 10);
  sf.defaultHeight = (sfH >= 64 && sfH <= 4096) ? sfH : 1024;
  var sfSteps = parseInt((document.getElementById('siliconflowSteps') || {}).value, 10);
  sf.steps = (sfSteps >= 1 && sfSteps <= 100) ? sfSteps : 8;
  var sfNeg = document.getElementById('siliconflowNegative');
  if (sfNeg) sf.negativePrompt = sfNeg.value.trim();
  var sfTo = parseInt((document.getElementById('siliconflowTimeout') || {}).value, 10);
  sf.timeout = (sfTo >= 10 && sfTo <= 3600) ? sfTo : 120;

  // 供应商互斥：勾了谁就用谁（都没勾时保持原选择）
  if (sf.enabled) {
    setActiveImageProvider('siliconflow');
  } else if (appData.settings.comfyui.enabled) {
    setActiveImageProvider('comfyui');
  } else {
    sf.enabled = false;
    appData.settings.comfyui.enabled = false;
  }
  // 重新初始化自动话题和通知
  initAutoTopic();
  initChatNotification();
  // 更新拍照功能可见性
  updatePhotoFeatureVisibility();
  // 如果消息正在显示，重新渲染以应用说话人区分
  if (currentChatId) renderMessages();
  saveData();
  // 日志：记录发生变化的设置项（apiKey / syncToken 只记「已修改」，不记值）
  logSettingsDiff(old, appData.settings);
  showToast('设置已保存', 'success');
}

/**
 * 对比保存前后的设置，把变化的项写入程序日志。
 * 敏感字段（apiKey / syncToken）只记录「已修改」，不记录具体值。
 */
function logSettingsDiff(oldS, newS) {
  var changes = [];
  function add(field, o, n) {
    if (o !== n) changes.push({ field: field, from: o, to: n });
  }
  add('apiHost', oldS.apiHost, newS.apiHost);
  if (oldS.apiKey !== newS.apiKey) changes.push({ field: 'apiKey', from: '(hidden)', to: '(已修改，长度 ' + String(newS.apiKey || '').length + ')' });
  add('compressThreshold', oldS.compressThreshold, newS.compressThreshold);
  add('speakerMode', oldS.speakerMode, newS.speakerMode);
  add('autoTopic', oldS.autoTopic, newS.autoTopic);
  add('chatNotification', oldS.chatNotification, newS.chatNotification);
  add('photoNotification', oldS.photoNotification, newS.photoNotification);
  add('autoTopicInterval', oldS.autoTopicInterval, newS.autoTopicInterval);
  add('autoTopicMaxCount', oldS.autoTopicMaxCount, newS.autoTopicMaxCount);
  if (oldS.syncToken !== newS.syncToken) changes.push({ field: 'syncToken', from: '(hidden)', to: '(已修改，长度 ' + String(newS.syncToken || '').length + ')' });
  add('cloudSyncHost', oldS.cloudSyncHost, newS.cloudSyncHost);
  var oc = oldS.comfyui || {}, nc = newS.comfyui || {};
  add('comfyui.enabled', oc.enabled, nc.enabled);
  add('comfyui.serverUrl', oc.serverUrl, nc.serverUrl);
  add('comfyui.nodeIds.prompt', oc.nodeIds && oc.nodeIds.prompt, nc.nodeIds && nc.nodeIds.prompt);
  add('comfyui.nodeIds.width', oc.nodeIds && oc.nodeIds.width, nc.nodeIds && nc.nodeIds.width);
  add('comfyui.nodeIds.height', oc.nodeIds && oc.nodeIds.height, nc.nodeIds && nc.nodeIds.height);
  add('comfyui.defaultWidth', oc.defaultWidth, nc.defaultWidth);
  add('comfyui.defaultHeight', oc.defaultHeight, nc.defaultHeight);
  add('comfyui.timeout', oc.timeout, nc.timeout);
  add('imageProvider', oldS.imageProvider, newS.imageProvider);
  var os = oldS.siliconflow || {}, ns = newS.siliconflow || {};
  add('siliconflow.enabled', os.enabled, ns.enabled);
  if (os.apiKey !== ns.apiKey) changes.push({ field: 'siliconflow.apiKey', from: '(hidden)', to: '(已修改，长度 ' + String(ns.apiKey || '').length + ')' });
  add('siliconflow.apiHost', os.apiHost, ns.apiHost);
  add('siliconflow.model', os.model, ns.model);
  add('siliconflow.defaultWidth', os.defaultWidth, ns.defaultWidth);
  add('siliconflow.defaultHeight', os.defaultHeight, ns.defaultHeight);
  add('siliconflow.steps', os.steps, ns.steps);
  add('siliconflow.guidance', os.guidance, ns.guidance);
  add('siliconflow.negativePrompt', os.negativePrompt, ns.negativePrompt);
  add('siliconflow.timeout', os.timeout, ns.timeout);

  if (changes.length === 0) return;
  addProgramLog(LOG_TYPE_SYSTEM, {
    summary: '修改设置（' + changes.length + ' 项）',
    detail: { changes: changes }
  });
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
  document.getElementById('comfyuiTimeout').value = c.timeout || 300;
  // 硅基流动
  var sf = appData.settings.siliconflow || {};
  var sfEnabledEl = document.getElementById('siliconflowEnabled');
  if (sfEnabledEl) sfEnabledEl.checked = !!sf.enabled;
  var set = function (id, val) { var el = document.getElementById(id); if (el) el.value = val; };
  set('siliconflowApiKey', sf.apiKey || '');
  set('siliconflowApiHost', sf.apiHost || 'https://api.siliconflow.cn');
  set('siliconflowModel', sf.model || 'Tongyi-MAI/Z-Image-Turbo');
  set('siliconflowWidth', sf.defaultWidth || 1024);
  set('siliconflowHeight', sf.defaultHeight || 1024);
  set('siliconflowSteps', sf.steps || 8);
  set('siliconflowNegative', sf.negativePrompt || '');
  set('siliconflowTimeout', sf.timeout || 120);
  // 图像子 Tab：默认停在当前使用的供应商
  if (typeof switchImageProviderTab === 'function') switchImageProviderTab(activeImageProviderId());
  if (c.workflowJson) {
    document.getElementById('comfyuiWorkflowStatus').textContent = '✅ 已上传';
    document.getElementById('comfyuiWorkflowStatus').style.color = 'var(--success)';
  } else {
    document.getElementById('comfyuiWorkflowStatus').textContent = '未上传';
    document.getElementById('comfyuiWorkflowStatus').style.color = '';
  }
  // 更新拍照功能可见性
  if (typeof updatePhotoFeatureVisibility === 'function') {
    updatePhotoFeatureVisibility();
  }
}

// 更新拍照功能可见性（根据 ComfyUI 是否启用）
function updatePhotoFeatureVisibility() {
  var comfyuiEnabled = appData.settings.comfyui && appData.settings.comfyui.enabled;
  var photoBtn = document.getElementById('photoActionBtn');
  var albumBtn = document.getElementById('albumBtn');

  if (photoBtn) {
    photoBtn.style.display = comfyuiEnabled ? '' : 'none';
  }
  if (albumBtn) {
    albumBtn.style.display = comfyuiEnabled ? '' : 'none';
  }
}

// ==================== 功能提示词调整（设置 → 数据） ====================

var PROMPT_ADJUST_META = {
  memory: {
    title: '记忆功能调整',
    desc: '「🧠 记忆」按钮 / /记忆 命令触发时，发送给 AI 的记忆压缩指令。'
  },
  'continue': {
    title: '继续功能调整',
    desc: '「▶ 继续」按钮 / /继续 命令触发时，附带发送给 AI 的控制提示词（不会进入聊天记录）。留空则直接以已有上下文继续。'
  },
  photo: {
    title: '拍照功能调整',
    desc: '拍照请求发送给 AI 的指令模板。占位符：${photoBody}＝角色推算正文（单角色/多角色自动切换）、${roleList}＝涉及角色列表、${appearanceGuide}＝角色外貌设定参考。'
  }
};

var _promptAdjustType = null;

/* 打开功能提示词调整弹框 */
function openPromptAdjust(type) {
  var meta = PROMPT_ADJUST_META[type];
  if (!meta || !appData.settings.promptOverrides) return;
  _promptAdjustType = type;

  var override = getPromptOverride(type);
  var def = getDefaultPromptText(type);
  var current = (override !== '') ? override : def;

  var overlay = document.getElementById('modalOverlay');
  var content = document.getElementById('modalContent');
  content.style.maxWidth = '680px';

  var html = '<h3>' + escHtml(meta.title) + '</h3>';
  html += '<p class="hint" style="margin:0 0 6px;">' + escHtml(meta.desc) + '</p>';
  if (override !== '') {
    html += '<p class="hint" style="margin:0 0 6px;color:#e6a23c;">当前为自定义值，点击「重置」可恢复默认。</p>';
  } else {
    html += '<p class="hint" style="margin:0 0 6px;">当前为默认值。</p>';
  }
  html += '<textarea id="promptAdjustTextarea" style="width:100%;min-height:300px;max-height:55vh;padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);color:var(--text-primary);font-size:12px;line-height:1.5;resize:vertical;font-family:monospace;">' + escHtml(current) + '</textarea>';
  html += '<div class="modal-btns">';
  html += '<button class="btn-sm btn-primary" onclick="savePromptAdjust()">保存</button>';
  html += '<button class="btn-sm btn-ghost" onclick="resetPromptAdjust()">重置</button>';
  html += '<button class="btn-sm btn-ghost" onclick="closeModal()">取消</button>';
  html += '</div>';

  content.innerHTML = html;
  overlay.classList.add('show');
  overlay._onConfirm = null;
}

/* 保存自定义提示词（与默认一致或为空时视为使用默认值） */
function savePromptAdjust() {
  if (!_promptAdjustType) {
    closeModal();
    return;
  }
  var ta = document.getElementById('promptAdjustTextarea');
  var val = ta ? ta.value : '';
  var def = getDefaultPromptText(_promptAdjustType);
  var trimmed = val.trim();
  appData.settings.promptOverrides[_promptAdjustType] = (trimmed === '' || trimmed === def.trim()) ? '' : val;
  saveData();
  addProgramLog(LOG_TYPE_SYSTEM, {
    summary: (appData.settings.promptOverrides[_promptAdjustType] !== '' ? '自定义' : '恢复默认') + PROMPT_ADJUST_META[_promptAdjustType].title
  });
  closeModal();
  showToast(appData.settings.promptOverrides[_promptAdjustType] !== '' ? '已保存自定义提示词' : '与默认一致，已使用默认提示词', 'success');
  _promptAdjustType = null;
}

/* 重置为默认值：清空自定义并回填默认文本（弹框保持打开，方便确认） */
function resetPromptAdjust() {
  if (!_promptAdjustType) return;
  appData.settings.promptOverrides[_promptAdjustType] = '';
  var ta = document.getElementById('promptAdjustTextarea');
  if (ta) ta.value = getDefaultPromptText(_promptAdjustType);
  saveData();
  addProgramLog(LOG_TYPE_SYSTEM, {
    summary: '重置' + PROMPT_ADJUST_META[_promptAdjustType].title
  });
  showToast('已重置为默认值', 'success');
}

