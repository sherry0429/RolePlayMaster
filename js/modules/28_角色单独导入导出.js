/**
     * 模块: 角色单独导入导出
     * 该文件由自动拆分工具生成
     * 后续建议继续手动细化
     */

    import { state } from '../core/state.js';
    import * as CONSTANTS from '../core/constants.js';

    function exportCharacters() {
  const chars = appData.characters || [];
  if (chars.length === 0) {
    showToast('没有角色可导出', 'error');
    return;
  }
  try {
    // 导出为 JSON，头像已经是 base64 Data URL，直接保留
    const exportData = {
      type: 'SimpleGirlFriend_characters',
      version: 1,
      exportTime: new Date().toISOString(),
      characters: JSON.parse(JSON.stringify(chars))
    };
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `characters_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`已导出 ${chars.length} 个角色`, 'success');
  } catch (e) {
    console.error('角色导出失败', e);
    showToast('角色导出失败: ' + e.message, 'error');
  }
}

function importCharacters() {
  document.getElementById('charImportFile').click();
}

function handleCharImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const rawText = e.target.result.trim();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch (jsonErr) {
        throw new Error('JSON 格式无效');
      }

      // 验证格式
      if (!data.characters || !Array.isArray(data.characters)) {
        throw new Error('无效的角色数据格式，需要包含 characters 数组');
      }

      // 验证每个角色至少有 name
      const validChars = data.characters.filter(c => c && c.name);
      if (validChars.length === 0) {
        throw new Error('未找到有效角色数据');
      }

      // 检查重复：同名角色询问是否覆盖
      if (!appData.characters) appData.characters = [];
      let added = 0, updated = 0;
      for (const char of validChars) {
        const existIdx = appData.characters.findIndex(c => c.name === char.name);
        if (existIdx >= 0) {
          // 同名覆盖
          appData.characters[existIdx] = {
            ...appData.characters[existIdx],
            name: char.name,
            avatar: char.avatar || appData.characters[existIdx].avatar || '',
            description: char.description !== undefined ? char.description : appData.characters[existIdx].description
          };
          updated++;
        } else {
          // 新增
          appData.characters.push({
            id: char.id || Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            name: char.name,
            avatar: char.avatar || '',
            description: char.description || ''
          });
          added++;
        }
      }

      saveData();
      galleryCurrentPage = 0;
      renderGalleryContent();
      if (currentChatId) renderMessages();
      showToast(`角色导入完成：新增 ${added} 个，更新 ${updated} 个`, 'success');
    } catch (err) {
      showToast('角色导入失败: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function showCharacterForm(idx, charData) {
  const overlay = document.getElementById('modalOverlay');
  const content = document.getElementById('modalContent');
  const isEdit = idx >= 0;
  const name = charData ? charData.name : '';
  const desc = charData ? charData.description : '';
  const avatar = charData ? charData.avatar : '';

  let avatarPreview = avatar
    ? `<img src="${escHtml(avatar)}" alt="avatar">`
    : `<span>${name ? escHtml(name.charAt(0)) : '?'}</span>`;

  let html = `<h3>${isEdit ? '编辑角色' : '新增角色'}</h3>`;
  html += `<div class="character-form">`;
  html += `<div class="avatar-upload-area">
    <div class="avatar-preview" id="charAvatarPreview">${avatarPreview}</div>
    <div>
      <button class="btn-sm btn-primary" onclick="document.getElementById('charAvatarFile').click()">📷 上传头像</button>
      ${avatar ? '<button class="btn-sm btn-danger" onclick="clearCharAvatar()" style="margin-left:4px;">🗑️</button>' : ''}
    </div>
    <input type="file" id="charAvatarFile" accept="image/*" style="display:none" onchange="handleCharAvatarUpload(event)">
  </div>`;
  html += `<input type="text" id="charNameInput" placeholder="角色名称" value="${escHtml(name)}">`;
  html += `<textarea id="charDescInput" placeholder="角色简介">${escHtml(desc)}</textarea>`;
  html += `</div>`;
  html += `<div class="modal-btns">`;
  html += `<button class="btn-sm btn-primary" onclick="saveCharacterForm(${idx})">保存</button>`;
  html += `<button class="btn-sm btn-ghost" onclick="closeModal()">取消</button>`;
  html += `</div>`;

  content.innerHTML = html;
  content.style.maxWidth = '440px';
  overlay.classList.add('show');

  // 临时存储头像数据
  overlay._charAvatar = avatar || '';

  // 聚焦名称输入框
  setTimeout(() => {
    const nameInput = document.getElementById('charNameInput');
    if (nameInput) nameInput.focus();
  }, 50);
}

function handleCharAvatarUpload(event) {
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
      overlay._charAvatar = compressedUrl;
      const preview = document.getElementById('charAvatarPreview');
      if (preview) {
        preview.innerHTML = `<img src="${compressedUrl}" alt="avatar">`;
      }
    });
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function clearCharAvatar() {
  const overlay = document.getElementById('modalOverlay');
  overlay._charAvatar = '';
  const preview = document.getElementById('charAvatarPreview');
  if (preview) {
    const nameInput = document.getElementById('charNameInput');
    preview.innerHTML = `<span>${nameInput ? escHtml(nameInput.value.charAt(0) || '?') : '?'}</span>`;
  }
}

function saveCharacterForm(idx) {
  const name = document.getElementById('charNameInput').value.trim();
  const desc = document.getElementById('charDescInput').value.trim();
  const avatar = document.getElementById('modalOverlay')._charAvatar || '';

  if (!name) {
    showToast('请输入角色名称', 'error');
    return;
  }

  if (idx >= 0) {
    // 编辑
    appData.characters[idx] = { ...appData.characters[idx], name, description: desc, avatar };
  } else {
    // 新增
    appData.characters.push({
      id: 'char_' + Date.now(),
      name,
      description: desc,
      avatar
    });
  }

  saveData();
  closeModal();
  // 刷新图库
  galleryCurrentPage = 0;
  if (document.getElementById('galleryDrawer').classList.contains('open')) {
    renderGalleryContent();
  }
  // 重新渲染聊天消息以更新头像
  if (currentChatId) renderMessages();
  showToast(idx >= 0 ? '角色已更新' : '角色已添加', 'success');
}