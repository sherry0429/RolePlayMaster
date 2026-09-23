
/**
 * 角色选择模式（建群）
 * 自动拆分模块
 * 保持全局兼容模式
 */

var charSelectMode = false;
var charSelectedIndices = new Set();

function toggleCharSelectMode() {
  charSelectMode = !charSelectMode;
  var btn = document.getElementById('charSelectModeBtn');
  var bar = document.getElementById('charSelectBar');

  if (charSelectMode) {
    btn.classList.add('active');
    btn.textContent = '👥 选择中';
    bar.classList.add('show');
    charSelectedIndices.clear();
    updateCharSelectInfo();
  } else {
    btn.classList.remove('active');
    btn.textContent = '👥 群聊';
    bar.classList.remove('show');
    charSelectedIndices.clear();
  }
  // 重新渲染图库以更新卡片样式
  galleryCurrentPage = 0;
  renderGalleryContent();
}

function cancelCharSelect() {
  charSelectMode = false;
  charSelectedIndices.clear();
  var btn = document.getElementById('charSelectModeBtn');
  var bar = document.getElementById('charSelectBar');
  btn.classList.remove('active');
  btn.textContent = '👥 群聊';
  bar.classList.remove('show');
  galleryCurrentPage = 0;
  renderGalleryContent();
}

function toggleCharSelect(idx) {
  if (!charSelectMode) return;
  if (charSelectedIndices.has(idx)) {
    charSelectedIndices.delete(idx);
  } else {
    charSelectedIndices.add(idx);
  }
  // 更新对应卡片的 class（无需全量重渲染）
  var waterfall = document.getElementById('galleryWaterfall');
  if (!waterfall) return;
  var cards = waterfall.querySelectorAll('.gallery-card');
  cards.forEach(card => {
    var onclick = card.getAttribute('onclick') || '';
    var match = onclick.match(/toggleCharSelect\((\d+)\)/);
    if (match) {
      var cardIdx = parseInt(match[1]);
      if (charSelectedIndices.has(cardIdx)) {
        card.classList.add('selected');
      } else {
        card.classList.remove('selected');
      }
    }
  });
  updateCharSelectInfo();
}

function updateCharSelectInfo() {
  var info = document.getElementById('charSelectInfo');
  var btn = document.getElementById('charSelectConfirmBtn');
  var count = charSelectedIndices.size;
  if (count === 0) {
    info.textContent = '未选择角色';
    btn.disabled = true;
  } else {
    var names = [...charSelectedIndices].map(i => (appData.characters[i] || {}).name).filter(Boolean);
    info.textContent = `已选 ${count} 人：${names.join('、')}`;
    btn.disabled = false;
  }
}

async function confirmCharSelect() {
  if (charSelectedIndices.size === 0) return;
  var selectedChars = [...charSelectedIndices]
    .map(i => appData.characters[i])
    .filter(Boolean);

  if (selectedChars.length === 0) return;

  // 关闭选择模式和图库抽屉
  var wasSelectMode = charSelectMode;
  cancelCharSelect();
  closeGalleryDrawer();

  // 创建新聊天
  appData.chatCounter++;
  var id = 'chat_' + Date.now() + '_' + appData.chatCounter;
  var chatName = selectedChars.map(c => c.name).join(' & ');
  appData.chats[id] = createChat(id, chatName);
  // 关联角色：将选中角色的 name/avatar 写入聊天属性，创建后不可修改
  appData.chats[id].characters = selectedChars.map(c => ({ name: c.name, avatar: c.avatar || '' }));
  appData.chatOrder.push(id);

  // 自动生成 System Prompt
  var spContent = generateGroupSystemPrompt(selectedChars);
  appData.chats[id].spVersions[0].content = spContent;

  saveData();
  selectChat(id);
  renderChatList();
  showToast(`群聊「${chatName}」已创建`);

  // 确保输入区域可见
  requestAnimationFrame(() => {
    var inputArea = document.querySelector('.input-area');
    if (inputArea) inputArea.scrollIntoView(false);
  });

  // 如果有 API Key，自动让 AI 生成角色设定和开场
  var apiKey = appData.settings.apiKey;
  if (apiKey) {
    await autoInitGroupChat(id, selectedChars);
  }
}

function generateGroupSystemPrompt(selectedChars) {
  var charDescList = selectedChars.map(c => {
    var lines = [`- ${c.name}`];
    if (c.description) {
      lines.push(`  - 身份：${c.description}`);
    } else {
      lines.push(`  - 外貌：（待补充）`);
      lines.push(`  - 身份：（待补充）`);
      lines.push(`  - 性格：（待补充）`);
    }
    return lines.join('\n');
  }).join('\n');

  var charNames = selectedChars.map(c => c.name).join('、');

  // 动态判断是否包含自动拍照触发（仅 ComfyUI 启用时）
  var photoTrigger = '';
  if (appData.settings.comfyui && appData.settings.comfyui.enabled) {
    photoTrigger = PROMPT_AUTO_PHOTO_TRIGGER;
  }

  return `# 任务定义
你现在是一个多角色扮演模拟引擎，负责驱动一个叙事世界。你的任务是：
- 严格遵循指定角色的身份、性格、知识背景和说话风格。
- 用户：根据关系和性格有对应亲密称呼，默认为你。
- 推动符合当前世界观下的合理剧情发展。
- 在需要时自动完成各角色之间的对话、必要时包括行动和内在心理描写。
- 回复时以角色名字用【】开头。回复消息除了角色名字用【】包括外，不要再使用【】。
- ${photoTrigger}

# 角色设定
${charDescList}

# 背景故事
（待AI生成）

# 当前状态
无

# 回复样例
（待AI生成）
`;
}

async function autoInitGroupChat(chatId, selectedChars) {
  var chat = appData.chats[chatId];
  if (!chat) return;

  var apiKey = appData.settings.apiKey;
  if (!apiKey) return;

  var apiHost = appData.settings.apiHost || DEFAULT_API_HOST;
  var url = apiHost.replace(/\/+$/, '') + '/chat/completions';

  var charDescList = selectedChars.map(c => {
    var lines = [`- ${c.name}`];
    if (c.description) {
      lines.push(`  - 身份：${c.description}`);
    }
    return lines.join('\n');
  }).join('\n');

  var initPrompt = buildGroupInitPrompt(charDescList);

  var messages = [
    { role: 'system', content: chat.spVersions[0].content },
    { role: 'user', content: initPrompt }
  ];

  // 显示加载状态
  isCompressing = true;
  document.getElementById('compressOverlay').classList.add('show');
  document.querySelector('.compress-text').textContent = '🎭 正在初始化群聊...';

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

    if (!response.ok) throw new Error('初始化请求失败');

    var result = await response.json();
    var content = result.choices?.[0]?.message?.content || '';

    if (content) {
      // 清理 AI 返回的内容：去除 markdown 包裹和多余人话
      content = cleanAndRepairSp(content, '');
      // autoInitGroupChat 的 fullSp 已硬编码任务定义，需要去掉 AI 可能自带的
      content = removeSection(content, '任务定义');

      // 更新 System Prompt 为完整版本
      var fullSp = `# 任务定义
你现在是一个多角色扮演模拟引擎，负责驱动一个叙事世界。你的任务是：
- 严格遵循指定角色的身份、性格、知识背景和说话风格。
- 用户：根据关系和性格有对应亲密称呼，默认为你。
- 推动符合当前世界观下的合理剧情发展。
- 在需要时自动完成各角色之间的对话、必要时包括行动和内在心理描写。
- 回复时以角色名字用【】开头。如果是旁白则直接加在文本开始或结尾。除角色名外消息内不再存在【】字符
- ${PROMPT_AUTO_PHOTO_TRIGGER}

${content}

# 当前状态
无
`;

      chat.spVersions[0].content = fullSp;
      saveData();
      if (currentChatId === chatId) {
        updateSpDisplay();
      }
    }
  } catch (e) {
    console.error('自动初始化群聊失败', e);
    // 失败也不阻塞，用户可以手动编辑 SP
  } finally {
    document.getElementById('compressOverlay').classList.remove('show');
    document.querySelector('.compress-text').textContent = '🧠 正在整理记忆...';
    setTimeout(() => {
      isCompressing = false;
    }, 400);
  }
}

// ===== 云端同步进度条 =====
function showSyncProgress(label) {
  var container = document.getElementById('syncProgressContainer');
  var fill = document.getElementById('syncProgressFill');
  var text = document.getElementById('syncProgressLabel');
  if (container) container.style.display = 'block';
  if (container) container.classList.add('active');
  if (fill) fill.style.width = '0%';
  if (text) text.textContent = label || '同步中...';
}

function updateSyncProgress(percent, label) {
  var fill = document.getElementById('syncProgressFill');
  var text = document.getElementById('syncProgressLabel');
  if (fill) fill.style.width = Math.min(100, Math.max(0, percent)) + '%';
  if (text && label) text.textContent = label;
}

function hideSyncProgress() {
  var container = document.getElementById('syncProgressContainer');
  if (container) {
    container.style.display = 'none';
    container.classList.remove('active');
    var fill = document.getElementById('syncProgressFill');
    if (fill) fill.style.width = '0%';
  }
}

// ===== 图片压缩工具 =====
function compressImageToDataUrl(dataUrl, maxSize, quality) {
  return new Promise(function (resolve) {
    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      resolve(dataUrl);
      return;
    }
    var img = new Image();
    img.onload = function () {
      var w = img.width, h = img.height;
      if (maxSize && (w > maxSize || h > maxSize)) {
        var ratio = Math.min(maxSize / w, maxSize / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = function () {
      resolve(dataUrl);
    };
    img.src = dataUrl;
  });
}

// Redesigned: simpler collect + compress
async function compressSyncData(data, onProgress) {
  var tasks = [];

  function addTask(dataUrl, quality, maxSize, applyFn) {
    if (dataUrl && dataUrl.startsWith('data:image/')) {
      tasks.push({ dataUrl: dataUrl, quality: quality, maxSize: maxSize, apply: applyFn });
    }
  }

  // 角色头像
  if (data.characters) {
    for (var i = 0; i < data.characters.length; i++) {
      (function (idx) {
        addTask(data.characters[idx].avatar, 0.7, 512, function (c) { data.characters[idx].avatar = c; });
      })(i);
    }
  }

  // 聊天照片
  if (data.chats) {
    var chatIds = Object.keys(data.chats);
    for (var ci = 0; ci < chatIds.length; ci++) {
      var chat = data.chats[chatIds[ci]];
      if (chat.photos) {
        for (var pi = 0; pi < chat.photos.length; pi++) {
          (function (cId, pIdx) {
            var p = data.chats[cId] && data.chats[cId].photos ? data.chats[cId].photos[pIdx] : null;
            if (!p) return;
            addTask(p.dataUrl, 0.65, 1920, function (c) {
              var ch = data.chats[cId];
              if (ch && ch.photos && ch.photos[pIdx]) ch.photos[pIdx].dataUrl = c;
            });
            addTask(p.thumbUrl, 0.5, 200, function (c) {
              var ch = data.chats[cId];
              if (ch && ch.photos && ch.photos[pIdx]) ch.photos[pIdx].thumbUrl = c;
            });
          })(chatIds[ci], pi);
        }
      }
    }
  }

  var total = tasks.length;
  if (total === 0) return;

  var batchSize = 5;
  for (var i = 0; i < total; i += batchSize) {
    var batch = tasks.slice(i, i + batchSize);
    var results = await Promise.all(batch.map(function (t) {
      return compressImageToDataUrl(t.dataUrl, t.maxSize, t.quality);
    }));
    for (var j = 0; j < batch.length; j++) {
      batch[j].apply(results[j]);
    }
    if (onProgress) {
      onProgress(Math.round(((i + batch.length) / total) * 100));
    }
  }
}

// ===== 文件大小格式化 =====
function formatSyncSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// ===== 同步到云端（带压缩 + 进度条） =====
async function syncToCloud() {
  var token = appData.settings.syncToken;
  if (!token) {
    showToast('请先在设置中填写同步 Token', 'error');
    return;
  }

  showSyncProgress('准备压缩图片...');

  try {
    // Step 1: 深拷贝并压缩图片 (0% - 40%)
    updateSyncProgress(5, '正在压缩图片...');
    var data = JSON.parse(JSON.stringify(appData));

    var imageCount = 0;
    if (data.characters) {
      for (var i = 0; i < data.characters.length; i++) {
        if (data.characters[i].avatar && data.characters[i].avatar.startsWith('data:image/')) imageCount++;
      }
    }
    if (data.chats) {
      var cids = Object.keys(data.chats);
      for (var ci = 0; ci < cids.length; ci++) {
        var ch = data.chats[cids[ci]];
        if (ch.photos) imageCount += ch.photos.length * 2; // dataUrl + thumbUrl
      }
    }

    if (imageCount > 0) {
      await compressSyncData(data, function (pct) {
        var overall = 5 + Math.round(pct * 0.35); // 5% - 40%
        updateSyncProgress(overall, '压缩图片 ' + pct + '%');
      });
    }

    // Step 2: JSON 序列化 (40% - 50%)
    updateSyncProgress(42, '正在序列化数据...');
    var json = JSON.stringify(data);

    // Step 3: Gzip 压缩 (50% - 75%)
    updateSyncProgress(50, '正在压缩数据...');
    var encoded;
    if (typeof CompressionStream !== 'undefined') {
      try {
        var blob = new Blob([json]);
        var cs = new CompressionStream('gzip');
        var stream = blob.stream().pipeThrough(cs);
        var compressed = await new Response(stream).arrayBuffer();
        encoded = 'v2:' + arrayBufferToBase64Url(compressed);
        updateSyncProgress(70, '压缩完成，准备上传...');
      } catch (e) {
        console.warn('Gzip 压缩失败，回退到 Base64', e);
        encoded = jsonToBase64(json);
      }
    } else {
      encoded = jsonToBase64(json);
    }

    var bodySize = new Blob([JSON.stringify({ data: encoded })]).size;
    updateSyncProgress(75, '上传中 (' + formatSyncSize(bodySize) + ')...');

    // Step 4: 上传 (75% - 100%)
    // 传输统一走 06_cloud.js：桌面端由原生侧代发（WebView 无法跨域），浏览器预览回退到 fetch。
    var response = await cloudRequest('POST', getChatSyncUrl(), token, JSON.stringify({ data: encoded }));

    if (!response.ok) {
      throw new Error('同步失败: ' + response.status + (response.body ? ' ' + response.body : ''));
    }

    updateSyncProgress(100, '同步完成');
    setTimeout(function () { hideSyncProgress(); }, 600);
    showToast('数据已同步到云端', 'success');
  } catch (e) {
    hideSyncProgress();
    console.error('云端同步失败', e);
    showToast('云端同步失败: ' + e.message, 'error');
  }
}

// ===== 从云端拉取（带解压 + 进度条） =====
async function syncFromCloud() {
  var token = appData.settings.syncToken;
  if (!token) {
    showToast('请先在设置中填写同步 Token', 'error');
    return;
  }

  showSyncProgress('正在从云端下载...');

  try {
    // Step 1: 下载 (0% - 80%)
    // 传输统一走 06_cloud.js：桌面端由原生侧代发（WebView 无法跨域），并由原生上报真实下载进度。
    var downloaded = await cloudRequest(
      'GET',
      getChatSyncUrl() + '?t=' + Date.now(),
      token,
      null,
      function (loaded, total) {
        if (total > 0) {
          updateSyncProgress(
            Math.round((loaded / total) * 78),
            '下载中 ' + formatSyncSize(loaded) + ' / ' + formatSyncSize(total)
          );
        } else if (loaded > 0) {
          updateSyncProgress(40, '下载中 ' + formatSyncSize(loaded) + '...');
        }
      }
    );

    if (!downloaded.ok) {
      throw new Error('拉取失败: ' + downloaded.status);
    }
    var rawText = downloaded.body;

    updateSyncProgress(80, '正在解析响应...');

    // Step 2: 解析响应
    var result;
    try {
      result = JSON.parse(rawText);
    } catch (e) {
      result = rawText;
    }
    var rawData = (result && typeof result === 'object' && result.data) ? result.data : (typeof result === 'string' ? result : JSON.stringify(result));

    // Step 3: 解压/解码 (80% - 95%)
    var data;
    if (typeof rawData === 'string' && rawData.startsWith('v2:')) {
      updateSyncProgress(85, '正在解压数据...');
      var jsonStr = await decompressText(rawData);
      data = JSON.parse(jsonStr);
      updateSyncProgress(92, '解压完成，正在校验...');
    } else {
      // 旧格式：base64 或纯 JSON
      updateSyncProgress(85, '正在解码数据...');
      try {
        var jsonStr = base64ToJson(String(rawData).trim());
        data = JSON.parse(jsonStr);
      } catch (e1) {
        try {
          data = JSON.parse(String(rawData).trim());
        } catch (e2) {
          throw new Error('无法解析云端数据');
        }
      }
    }

    updateSyncProgress(95, '正在校验数据...');

    // Step 4: 校验与兼容
    if (!data.chats || !data.settings) {
      throw new Error('云端数据格式无效');
    }

    if (!data.chatOrder) data.chatOrder = Object.keys(data.chats);
    if (!data.chatCounter) data.chatCounter = data.chatOrder.length;
    if (!data.theme) data.theme = 'light';
    if (!data.characters) data.characters = [];
    if (data.chats) {
      var chatKeys = Object.keys(data.chats);
      for (var k = 0; k < chatKeys.length; k++) {
        var c = data.chats[chatKeys[k]];
        if (c.characters === undefined) c.characters = [];
        if (c.photos === undefined) c.photos = [];
      }
    }
    if (!data.settings.comfyui) {
      data.settings.comfyui = { enabled: false, serverUrl: 'http://127.0.0.1:8188', workflowJson: '', nodeIds: { prompt: '', width: '', height: '' }, defaultWidth: 512, defaultHeight: 768 };
    }
    if (data._shareLite) {
      data = expandShareData(data);
    }

    updateSyncProgress(100, '下载完成');
    setTimeout(function () { hideSyncProgress(); }, 600);

    if (!(await confirmDialog('从云端拉取的数据将覆盖当前数据，确定继续吗？'))) return;

    applyImportedData(data);
    showToast('云端数据同步成功', 'success');
  } catch (e) {
    hideSyncProgress();
    console.error('云端同步失败', e);
    showToast('云端同步失败: ' + e.message, 'error');
  }
}

function applyImportedData(data) {
  appData = data;
  saveData();
  // 刷新界面
  applyTheme(appData.theme);
  document.getElementById('apiHost').value = appData.settings.apiHost || '';
  document.getElementById('apiKey').value = appData.settings.apiKey || '';
  document.getElementById('compressThreshold').value = appData.settings.compressThreshold || COMPRESS_THRESHOLD;
  document.getElementById('speakerMode').checked = appData.settings.speakerMode !== false;
  document.getElementById('autoTopic').checked = !!appData.settings.autoTopic;
  document.getElementById('chatNotification').checked = !!appData.settings.chatNotification;
  document.getElementById('autoTopicInterval').value = appData.settings.autoTopicInterval || 10;
  document.getElementById('autoTopicMaxCount').value = appData.settings.autoTopicMaxCount || 5;
  toggleAutoTopicConfig();
  document.getElementById('syncToken').value = appData.settings.syncToken || '';
  document.getElementById('cloudSyncHost').value = appData.settings.cloudSyncHost || '';
  loadComfyuiSettings();
  applyBgImage(appData.settings.bgImage);
  updateBgImageStatus();
  renderChatList();
  if (appData.chatOrder.length > 0) {
    selectChat(appData.chatOrder[0]);
  } else {
    currentChatId = null;
    updateUIForNoChat();
  }
  initAutoTopic();
  initChatNotification();
}

