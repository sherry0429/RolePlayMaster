
/**
 * 聊天管理
 * 自动拆分模块
 * 保持全局兼容模式
 */

function renderChatList() {
  var container = document.getElementById('chatList');
  var html = '';
  for (var id of appData.chatOrder) {
    var chat = appData.chats[id];
    if (!chat) continue;
    var active = id === currentChatId ? 'active' : '';
    // 渲染角色头像（最多显示3个，多余显示+N）
    var avatarHtml = '';
    var chars = chat.characters || [];
    if (chars.length > 0) {
      var showChars = chars.slice(0, 3);
      var extraCount = chars.length - showChars.length;
      var avatars = showChars.map(c => {
        if (c.avatar) {
          return `<img src="${escHtml(c.avatar)}" alt="${escHtml(c.name)}" class="chat-avatar-img">`;
        }
        return `<span class="chat-avatar-placeholder">${escHtml(c.name.charAt(0) || '?')}</span>`;
      }).join('');
      var extraBadge = extraCount > 0 ? `<span class="chat-avatar-extra">+${extraCount}</span>` : '';
      avatarHtml = `<div class="chat-avatars">${avatars}${extraBadge}</div>`;
    }
    html += `
      <div class="chat-item ${active}" onclick="selectChat('${id}')">
        ${avatarHtml}
        <span class="chat-name">${escHtml(chat.name)}</span>
        <div class="chat-actions">
          <button class="chat-action-btn" onclick="event.stopPropagation();editChat('${id}')" title="编辑">✏️</button>
          <button class="chat-action-btn" onclick="event.stopPropagation();deleteChat('${id}')" title="删除">🗑️</button>
        </div>
      </div>`;
  }
  html += `<button class="new-chat-btn" onclick="newChat()">➕ 新建聊天</button>`;
  container.innerHTML = html;
}

function newChat() {
  appData.chatCounter++;
  var id = 'chat_' + Date.now() + '_' + appData.chatCounter;
  var name = '聊天' + appData.chatCounter;
  appData.chats[id] = createChat(id, name);
  appData.chatOrder.push(id);
  saveData();
  selectChat(id);
  renderChatList();
  showToast(`已创建「${name}」`);
  // 确保输入区域可见并聚焦
  requestAnimationFrame(() => {
    var inputArea = document.querySelector('.input-area');
    if (inputArea) inputArea.scrollIntoView(false);
  });
}

function selectChat(id) {
  if (!appData.chats[id]) return;
  // 如果正在重放，先停止
  if (isReplaying) stopReplay();
  currentChatId = id;
  var chat = appData.chats[id];
  // SP 旧格式懒迁移（Markdown+XML 混合格式 → SPX，原文存 legacyContent）
  if (migrateChatSpVersions(chat)) saveData();
  // 重置消息渲染数量
  resetRenderedCount();
  // 更新顶部名称
  document.getElementById('currentChatName').textContent = chat.name;
  // 更新聊天专属背景
  applyChatBgImage(chat.bgImage);
  updateBgImageStatus();
  // 渲染消息
  renderMessages();
  // 更新 System Prompt 显示
  updateSpDisplay();
  // 更新列表激活态
  renderChatList();
  // 移动端关闭侧边栏
  closeSidebar();
}

// ===== SP 解析辅助函数 =====
// SPX 结构化读取统一走 sp_format.js（parseSp / getSpIdentityFields / getSpCharacterNames），
// 此处仅保留旧格式兜底与表单组装逻辑。

function extractCharIdentityFromSP(spContent, charName) {
  if (!spContent || !charName) return '';
  var fields = getSpIdentityFields(spContent, charName);
  var parts = [];
  if (fields.identity) parts.push('身份：' + fields.identity);
  if (fields.personality) parts.push('性格：' + fields.personality);
  return parts.join('\n');
}

function findAllCharNamesInSP(spContent) {
  if (!spContent) return [];
  return getSpCharacterNames(spContent);
}

function findNewCharsInSP(spContent, existingChars) {
  var allNames = findAllCharNamesInSP(spContent);
  var existingNames = existingChars.map(function(c) { return c.name; });
  return allNames.filter(function(n) { return existingNames.indexOf(n) === -1; });
}

function openEditAssociatedChar(chatId, charIdx) {
  var chat = appData.chats[chatId];
  if (!chat) return;
  var chars = chat.characters || [];
  var charInfo = chars[charIdx];
  if (!charInfo) return;

  var allChars = appData.characters || [];
  var globalIdx = allChars.findIndex(function(c) { return c.name === charInfo.name; });

  var latestSp = chat.spVersions[chat.spVersions.length - 1];
  var spContent = latestSp ? latestSp.content : '';

  var desc = extractCharIdentityFromSP(spContent, charInfo.name);

  // 记录来源聊天，用于保存后同步到 chat.characters
  var overlay = document.getElementById('modalOverlay');
  overlay._fromChatId = chatId;
  overlay._fromCharIdx = charIdx;
  overlay._isNewFromSP = false;

  if (globalIdx >= 0) {
    showCharacterForm(globalIdx, { name: charInfo.name, description: desc || allChars[globalIdx].description, avatar: allChars[globalIdx].avatar });
  } else {
    showCharacterForm(-1, { name: charInfo.name, description: desc, avatar: charInfo.avatar || '' });
  }
}

function openCreateNewCharFromSP(chatId, charName) {
  var chat = appData.chats[chatId];
  if (!chat) return;

  var latestSp = chat.spVersions[chat.spVersions.length - 1];
  var spContent = latestSp ? latestSp.content : '';

  var desc = extractCharIdentityFromSP(spContent, charName);

  // 记录来源聊天，用于保存后同步到 chat.characters
  var overlay = document.getElementById('modalOverlay');
  overlay._fromChatId = chatId;
  overlay._fromCharIdx = -1;
  overlay._isNewFromSP = true;

  showCharacterForm(-1, { name: charName, description: desc, avatar: '' });
}

// ===== editChat =====

function editChat(id) {
  var chat = appData.chats[id];
  if (!chat) return;
  var overlay = document.getElementById('modalOverlay');
  var content = document.getElementById('modalContent');
  content.style.maxWidth = '440px';

  var hasBg = !!(chat.bgImage);
  var bgPreview = hasBg
    ? `<img src="${chat.bgImage}" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px;margin-top:6px;">`
    : '<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">未设置（将使用角色图片或全局背景）</div>';

  // 角色属性区域
  var charSectionHtml = '';
  var chars = chat.characters || [];
  var latestSp = chat.spVersions[chat.spVersions.length - 1];
  var spContent = latestSp ? latestSp.content : '';

  if (chars.length > 0) {
    // 已关联角色：可点击编辑，从 SP 提取身份和性格
    var charTags = chars.map(function(c, i) {
      var avatarHtml = c.avatar
        ? `<img src="${escHtml(c.avatar)}" class="chat-char-tag-avatar">`
        : `<span class="chat-char-tag-avatar-placeholder">${escHtml(c.name.charAt(0) || '?')}</span>`;
      return '<span class="chat-char-tag clickable" onclick="event.stopPropagation();openEditAssociatedChar(\'' + id + '\', ' + i + ')">' + avatarHtml + escHtml(c.name) + '</span>';
    }).join('');

    // 识别 SP 中未被关联的新角色（红色标记）
    var newCharsFromSP = findNewCharsInSP(spContent, chars);
    var newCharTags = newCharsFromSP.map(function(nc) {
      return '<span class="chat-char-tag chat-char-tag-new clickable" onclick="event.stopPropagation();openCreateNewCharFromSP(\'' + id + '\', \'' + escHtml(nc) + '\')"><span class="chat-char-tag-avatar-placeholder new-char"></span>' + escHtml(nc) + '</span>';
    }).join('');

    charSectionHtml = '<div class="form-group"><label>关联角色</label><div class="chat-char-tags">' + charTags + newCharTags + '</div><div style="font-size:11px;color:var(--text-secondary);margin-top:4px;">点击角色可编辑，红色角色为 SP 中未关联的新角色</div></div>';
  } else {
    // 旧版聊天，允许选择角色（设置一次后锁定）
    var allChars = appData.characters || [];
    if (allChars.length > 0) {
      var charOptions = allChars.map(function(c, i) {
        var avatarHtml = c.avatar
          ? '<img src="' + escHtml(c.avatar) + '" class="chat-char-tag-avatar">'
          : '';
        return '<label class="chat-char-check"><input type="checkbox" value="' + i + '" data-char-select>' + avatarHtml + escHtml(c.name) + '</label>';
      }).join('');
      charSectionHtml = '<div class="form-group"><label>关联角色 <span style="font-size:11px;color:var(--text-secondary);">（设置后不可修改）</span></label><div class="chat-char-checks">' + charOptions + '</div></div>';
    }
  }

  var html = '<h3>编辑聊天</h3>';
  html += '<div class="character-form">';
  html += '<div class="form-group"><label>聊天名称</label>';
  html += `<input type="text" id="editChatNameInput" value="${escHtml(chat.name)}">`;
  html += '</div>';
  html += charSectionHtml;
  html += '<div class="form-group"><label>聊天背景图片</label>';
  html += '<div style="display:flex;gap:8px;align-items:center;">';
  html += '<button class="btn-sm btn-primary" onclick="document.getElementById(\'editChatBgFile\').click()">📷 上传</button>';
  html += `<button class="btn-sm btn-danger" onclick="clearEditChatBg('${id}')" id="editChatBgClearBtn" style="${hasBg ? '' : 'display:none;'}">🗑️ 清除</button>`;
  html += '</div>';
  html += `<div id="editChatBgPreview">${bgPreview}</div>`;
  html += `<input type="file" id="editChatBgFile" accept="image/*" style="display:none" onchange="handleEditChatBgUpload(event, '${id}')">`;
  html += '</div>';
  html += '</div>';
  html += '<div class="modal-btns">';
  html += `<button class="btn-sm btn-primary" onclick="saveEditChat('${id}')">保存</button>`;
  html += '<button class="btn-sm btn-ghost" onclick="closeModal()">取消</button>';
  html += '</div>';

  content.innerHTML = html;
  overlay.classList.add('show');
  overlay._onConfirm = null;
  // 临时存储背景图数据
  overlay._editChatBg = chat.bgImage || '';
}

function handleEditChatBgUpload(event, chatId) {
  var file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('请选择图片文件', 'error');
    return;
  }
  var reader = new FileReader();
  reader.onload = (e) => {
    compressImage(e.target.result, (compressedUrl) => {
      var overlay = document.getElementById('modalOverlay');
      overlay._editChatBg = compressedUrl;
      var preview = document.getElementById('editChatBgPreview');
      if (preview) {
        preview.innerHTML = `<img src="${compressedUrl}" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px;margin-top:6px;">`;
      }
      var clearBtn = document.getElementById('editChatBgClearBtn');
      if (clearBtn) clearBtn.style.display = '';
    });
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function clearEditChatBg(chatId) {
  var overlay = document.getElementById('modalOverlay');
  overlay._editChatBg = '';
  var preview = document.getElementById('editChatBgPreview');
  if (preview) {
    preview.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">未设置（将使用角色图片或全局背景）</div>';
  }
  var clearBtn = document.getElementById('editChatBgClearBtn');
  if (clearBtn) clearBtn.style.display = 'none';
}

function saveEditChat(id) {
  var chat = appData.chats[id];
  if (!chat) return;
  var nameInput = document.getElementById('editChatNameInput');
  var newName = nameInput ? nameInput.value.trim() : '';
  var newBg = document.getElementById('modalOverlay')._editChatBg;

  if (!newName) {
    showToast('请输入聊天名称', 'error');
    return;
  }

  chat.name = newName;
  chat.bgImage = newBg || '';

  // 处理旧版聊天的角色关联（仅当 characters 为空时允许设置，设置后锁定）
  if (!chat.characters || chat.characters.length === 0) {
    var checkedBoxes = document.querySelectorAll('[data-char-select]:checked');
    if (checkedBoxes.length > 0) {
      chat.characters = [...checkedBoxes].map(cb => {
        var charIdx = parseInt(cb.value);
        var c = appData.characters[charIdx];
        return c ? { name: c.name, avatar: c.avatar || '' } : null;
      }).filter(Boolean);
    }
  }

  if (id === currentChatId) {
    document.getElementById('currentChatName').textContent = chat.name;
    applyChatBgImage(chat.bgImage);
  }

  saveData();
  renderChatList();
  closeModal();
  showToast('聊天已更新', 'success');
}

async function deleteChat(id) {
  var chat = appData.chats[id];
  if (!chat) return;
  if (!(await confirmDialog(`确定删除「${chat.name}」吗？此操作不可撤销。`))) return;
  delete appData.chats[id];
  appData.chatOrder = appData.chatOrder.filter(i => i !== id);
  saveData();
  if (id === currentChatId) {
    if (appData.chatOrder.length > 0) {
      selectChat(appData.chatOrder[0]);
    } else {
      currentChatId = null;
      updateUIForNoChat();
    }
  }
  renderChatList();
  showToast('已删除');
}

function updateUIForNoChat() {
  document.getElementById('currentChatName').textContent = 'AI Chat';
  document.getElementById('chatArea').innerHTML = `
    <div class="welcome-msg" id="welcomeMsg">
      👋 欢迎使用 AI Chat<br>点击左侧 + 开始新对话
    </div>`;
  applyChatBgImage('');
  updateBgImageStatus();
  updateSpDisplay();
}

