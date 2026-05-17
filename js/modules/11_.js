// 模块: 聊天管理

    function renderChatList() {
  const container = document.getElementById('chatList');
  let html = '';
  for (const id of appData.chatOrder) {
    const chat = appData.chats[id];
    if (!chat) continue;
    const active = id === currentChatId ? 'active' : '';
    // 渲染角色头像（最多显示3个，多余显示+N）
    let avatarHtml = '';
    const chars = chat.characters || [];
    if (chars.length > 0) {
      const showChars = chars.slice(0, 3);
      const extraCount = chars.length - showChars.length;
      const avatars = showChars.map(c => {
        if (c.avatar) {
          return `<img src="${escHtml(c.avatar)}" alt="${escHtml(c.name)}" class="chat-avatar-img">`;
        }
        return `<span class="chat-avatar-placeholder">${escHtml(c.name.charAt(0) || '?')}</span>`;
      }).join('');
      const extraBadge = extraCount > 0 ? `<span class="chat-avatar-extra">+${extraCount}</span>` : '';
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
  const id = 'chat_' + Date.now() + '_' + appData.chatCounter;
  const name = '聊天' + appData.chatCounter;
  appData.chats[id] = createChat(id, name);
  appData.chatOrder.push(id);
  saveData();
  selectChat(id);
  renderChatList();
  showToast(`已创建「${name}」`);
  // 确保输入区域可见并聚焦
  requestAnimationFrame(() => {
    const inputArea = document.querySelector('.input-area');
    if (inputArea) inputArea.scrollIntoView(false);
  });
}

function selectChat(id) {
  if (!appData.chats[id]) return;
  // 如果正在重放，先停止
  if (isReplaying) stopReplay();
  currentChatId = id;
  const chat = appData.chats[id];
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

function editChat(id) {
  const chat = appData.chats[id];
  if (!chat) return;
  const overlay = document.getElementById('modalOverlay');
  const content = document.getElementById('modalContent');
  content.style.maxWidth = '440px';

  const hasBg = !!(chat.bgImage);
  let bgPreview = hasBg
    ? `<img src="${chat.bgImage}" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px;margin-top:6px;">`
    : '<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">未设置（将使用角色图片或全局背景）</div>';

  // 角色属性区域
  let charSectionHtml = '';
  const chars = chat.characters || [];
  if (chars.length > 0) {
    // 已设置角色，只读显示
    const charTags = chars.map(c => {
      if (c.avatar) {
        return `<span class="chat-char-tag"><img src="${escHtml(c.avatar)}" class="chat-char-tag-avatar">${escHtml(c.name)}</span>`;
      }
      return `<span class="chat-char-tag">${escHtml(c.name)}</span>`;
    }).join('');
    charSectionHtml = `<div class="form-group"><label>关联角色</label><div class="chat-char-tags">${charTags}</div><div style="font-size:11px;color:var(--text-secondary);margin-top:4px;">角色已锁定，不可修改</div></div>`;
  } else {
    // 旧版聊天，允许选择角色（设置一次后锁定）
    const allChars = appData.characters || [];
    if (allChars.length > 0) {
      const charOptions = allChars.map((c, i) => {
        const avatarHtml = c.avatar
          ? `<img src="${escHtml(c.avatar)}" class="chat-char-tag-avatar">`
          : '';
        return `<label class="chat-char-check"><input type="checkbox" value="${i}" data-char-select>${avatarHtml}${escHtml(c.name)}</label>`;
      }).join('');
      charSectionHtml = `<div class="form-group"><label>关联角色 <span style="font-size:11px;color:var(--text-secondary);">（设置后不可修改）</span></label><div class="chat-char-checks">${charOptions}</div></div>`;
    }
  }

  let html = '<h3>编辑聊天</h3>';
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
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('请选择图片文件', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    compressImage(e.target.result, (compressedUrl) => {
      const overlay = document.getElementById('modalOverlay');
      overlay._editChatBg = compressedUrl;
      const preview = document.getElementById('editChatBgPreview');
      if (preview) {
        preview.innerHTML = `<img src="${compressedUrl}" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px;margin-top:6px;">`;
      }
      const clearBtn = document.getElementById('editChatBgClearBtn');
      if (clearBtn) clearBtn.style.display = '';
    });
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function clearEditChatBg(chatId) {
  const overlay = document.getElementById('modalOverlay');
  overlay._editChatBg = '';
  const preview = document.getElementById('editChatBgPreview');
  if (preview) {
    preview.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">未设置（将使用角色图片或全局背景）</div>';
  }
  const clearBtn = document.getElementById('editChatBgClearBtn');
  if (clearBtn) clearBtn.style.display = 'none';
}

function saveEditChat(id) {
  const chat = appData.chats[id];
  if (!chat) return;
  const nameInput = document.getElementById('editChatNameInput');
  const newName = nameInput ? nameInput.value.trim() : '';
  const newBg = document.getElementById('modalOverlay')._editChatBg;

  if (!newName) {
    showToast('请输入聊天名称', 'error');
    return;
  }

  chat.name = newName;
  chat.bgImage = newBg || '';

  // 处理旧版聊天的角色关联（仅当 characters 为空时允许设置，设置后锁定）
  if (!chat.characters || chat.characters.length === 0) {
    const checkedBoxes = document.querySelectorAll('[data-char-select]:checked');
    if (checkedBoxes.length > 0) {
      chat.characters = [...checkedBoxes].map(cb => {
        const charIdx = parseInt(cb.value);
        const c = appData.characters[charIdx];
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

function deleteChat(id) {
  const chat = appData.chats[id];
  if (!chat) return;
  if (!confirm(`确定删除「${chat.name}」吗？此操作不可撤销。`)) return;
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



    window.renderChatList = renderChatList;
window.newChat = newChat;
window.selectChat = selectChat;
window.editChat = editChat;
window.handleEditChatBgUpload = handleEditChatBgUpload;
window.clearEditChatBg = clearEditChatBg;
window.saveEditChat = saveEditChat;
window.deleteChat = deleteChat;
window.updateUIForNoChat = updateUIForNoChat;