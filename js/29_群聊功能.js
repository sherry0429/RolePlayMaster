
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

  return `# 任务定义
你现在是一个多角色扮演模拟引擎，负责驱动一个叙事世界。你的任务是：
- 严格遵循指定角色的身份、性格、知识背景和说话风格。
- 用户：根据关系和性格有对应亲密称呼，默认为你。
- 推动符合当前世界观下的合理剧情发展。
- 在需要时自动完成各角色之间的对话、必要时包括行动和内在心理描写。
- 回复时以角色名字用【】开头。如果是旁白则直接加在文本结尾。回复消息除了角色名字用【】包括外，不要再使用【】。
- ${PROMPT_AUTO_PHOTO_TRIGGER}

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

async function syncToCloud() {
  var token = appData.settings.syncToken;
  if (!token) {
    showToast('请先在设置中填写同步 Token', 'error');
    return;
  }
  try {
    showToast('正在同步到云端...', 'success');
    var json = JSON.stringify(appData);
    var base64 = jsonToBase64(json);
    var response = await fetch(getChatSyncUrl(), {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ data: base64 })
    });
    if (!response.ok) {
      var errText = await response.text().catch(() => '');
      throw new Error('同步失败: ' + response.status + (errText ? ' ' + errText : ''));
    }
    showToast('数据已同步到云端', 'success');
  } catch (e) {
    console.error('云端同步失败', e);
    showToast('云端同步失败: ' + e.message, 'error');
  }
}

async function syncFromCloud() {
  var token = appData.settings.syncToken;
  if (!token) {
    showToast('请先在设置中填写同步 Token', 'error');
    return;
  }
  try {
    showToast('正在从云端拉取数据...', 'success');
    var response = await fetch(getChatSyncUrl() + '?t=' + Date.now(), {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });
    if (!response.ok) {
      var errText = await response.text().catch(() => '');
      throw new Error('拉取失败: ' + response.status + (errText ? ' ' + errText : ''));
    }
    var result = await response.json();
    // 支持两种响应格式：{ data: "base64..." } 或直接 base64 字符串
    var rawText = (result && result.data) ? result.data : (typeof result === 'string' ? result : JSON.stringify(result));
    var data;
    try {
      // 先尝试 base64 解码
      var jsonStr = base64ToJson(rawText.trim());
      data = JSON.parse(jsonStr);
    } catch (e1) {
      // 再尝试直接 JSON 解析
      try {
        data = JSON.parse(rawText.trim());
      } catch (e2) {
        throw new Error('无法解析云端数据');
      }
    }

    if (!data.chats || !data.settings) {
      throw new Error('云端数据格式无效');
    }

    // 兼容性补全
    if (!data.chatOrder) data.chatOrder = Object.keys(data.chats);
    if (!data.chatCounter) data.chatCounter = data.chatOrder.length;
    if (!data.theme) data.theme = 'light';
    if (!data.characters) data.characters = [];
    // 兼容旧版：为每个聊天补全 characters 和 photos 字段
    if (data.chats) {
      for (var id of Object.keys(data.chats)) {
        if (data.chats[id].characters === undefined) {
          data.chats[id].characters = [];
        }
        if (data.chats[id].photos === undefined) {
          data.chats[id].photos = [];
        }
      }
    }
    // 兼容新版：补全 comfyui 设置
    if (!data.settings.comfyui) {
      data.settings.comfyui = { enabled: false, serverUrl: 'http://127.0.0.1:8188', workflowJson: '', nodeIds: { prompt: '', width: '', height: '' }, defaultWidth: 512, defaultHeight: 768 };
    }
    if (data._shareLite) {
      data = expandShareData(data);
    }

    if (!confirm('从云端拉取的数据将覆盖当前数据，确定继续吗？')) return;

    applyImportedData(data);
    showToast('云端数据同步成功', 'success');
  } catch (e) {
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

