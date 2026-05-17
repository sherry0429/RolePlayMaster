
/**
 * 相册功能
 * 自动拆分模块
 * 保持全局兼容模式
 * 
 * 每个聊天拥有独立的相册，存储使用拍照功能生成的图片。
 * 支持打开相册抽屉、查看图片、删除图片、下载图片。
 */

/**
 * 打开相册抽屉
 */
function openAlbumDrawer() {
  var backdrop = document.getElementById('albumBackdrop');
  var drawer = document.getElementById('albumDrawer');
  var chatName = document.getElementById('albumChatName');

  if (!currentChatId) {
    showToast('请先选择一个聊天', 'error');
    return;
  }

  var chat = appData.chats[currentChatId];
  if (!chat) {
    showToast('聊天不存在', 'error');
    return;
  }

  chatName.textContent = chat.name;
  backdrop.classList.add('show');
  drawer.classList.add('open');
  renderAlbumPhotos();
}

/**
 * 关闭相册抽屉
 */
function closeAlbumDrawer() {
  document.getElementById('albumBackdrop').classList.remove('show');
  document.getElementById('albumDrawer').classList.remove('open');
}

/**
 * 渲染当前聊天的照片
 */
function renderAlbumPhotos() {
  var body = document.getElementById('albumDrawerBody');
  if (!currentChatId) {
    body.innerHTML = '<div class="album-empty">请先选择一个聊天</div>';
    return;
  }

  var chat = appData.chats[currentChatId];
  if (!chat || !chat.photos || chat.photos.length === 0) {
    body.innerHTML = '<div class="album-empty">暂无照片，点击「📷 拍照」拍摄第一张</div>';
    return;
  }

  var photos = chat.photos.slice().reverse(); // 最新的在前
  var html = '<div class="album-drawer-photos">';

  for (var i = 0; i < photos.length; i++) {
    var photo = photos[i];
    var timeStr = '';
    if (photo.createdAt) {
      var d = new Date(photo.createdAt);
      timeStr = d.getFullYear() + '-' + padNum(d.getMonth() + 1) + '-' + padNum(d.getDate()) + ' ' + padNum(d.getHours()) + ':' + padNum(d.getMinutes());
    }
    var charTag = photo.characterName ? '<span class="album-photo-char">' + escHtml(photo.characterName) + '</span>' : '';

    html += '<div class="album-photo-card" data-photo-id="' + escHtml(photo.id) + '">';
    if (photo.dataUrl) {
      var thumbSrc = photo.thumbUrl || photo.dataUrl;
      html += '<img src="' + thumbSrc + '" alt="照片" class="album-photo-img" onclick="zoomPhoto(\'' + escHtml(photo.id) + '\')" loading="lazy">';
    } else {
      html += '<div class="album-photo-placeholder" onclick="copyPhotoPrompt(\'' + escHtml(photo.id) + '\')">📷<br><small>' + escHtml(photo.prompt || '').slice(0, 30) + '</small></div>';
    }
    html += '<div class="album-photo-info">';
    html += '<div class="album-photo-time">' + timeStr + '</div>';
    html += charTag;
    html += '</div>';
    html += '<div class="album-photo-actions">';
    html += '<button class="album-photo-btn" onclick="copyPhotoPrompt(\'' + escHtml(photo.id) + '\')" title="复制 Prompt">📋</button>';
    if (photo.dataUrl) {
      html += '<button class="album-photo-btn" onclick="downloadAlbumPhoto(\'' + escHtml(photo.id) + '\')" title="下载">⬇️</button>';
    }
    html += '<button class="album-photo-btn album-photo-del-btn" onclick="deleteAlbumPhoto(\'' + escHtml(photo.id) + '\')" title="删除">🗑️</button>';
    html += '</div>';
    html += '</div>';
  }

  html += '</div>';
  body.innerHTML = html;
}

/**
 * 数字补零
 */
function padNum(n) {
  return n < 10 ? '0' + n : '' + n;
}

/**
 * 在相册中查看指定照片（从聊天区域点击图片时调用）
 */
function viewPhotoInAlbum(photoId) {
  openAlbumDrawer();
  // 高亮对应照片
  setTimeout(function() {
    var card = document.querySelector('.album-photo-card[data-photo-id="' + photoId + '"]');
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('album-photo-highlight');
      setTimeout(function() {
        card.classList.remove('album-photo-highlight');
      }, 2000);
    }
  }, 300);
}

/**
 * 删除相册中的一张照片
 */
function deleteAlbumPhoto(photoId) {
  if (!currentChatId) return;
  var chat = appData.chats[currentChatId];
  if (!chat || !chat.photos) return;

  if (!confirm('确定要删除这张照片吗？不可恢复。')) return;

  // 从数据中删除
  var idx = -1;
  for (var i = 0; i < chat.photos.length; i++) {
    if (chat.photos[i].id === photoId) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return;

  chat.photos.splice(idx, 1);
  saveData();

  // 从聊天区域移除
  var msgEl = document.querySelector('.photo-message[data-photo-id="' + photoId + '"]');
  if (msgEl) msgEl.remove();

  // 重新渲染相册
  renderAlbumPhotos();
  showToast('照片已删除', 'success');
}

/**
 * 下载相册中的一张照片
 */
function downloadAlbumPhoto(photoId) {
  if (!currentChatId) return;
  var chat = appData.chats[currentChatId];
  if (!chat || !chat.photos) return;

  var photo = null;
  for (var i = 0; i < chat.photos.length; i++) {
    if (chat.photos[i].id === photoId) {
      photo = chat.photos[i];
      break;
    }
  }
  if (!photo || !photo.dataUrl) {
    showToast('照片数据不可用', 'error');
    return;
  }

  var a = document.createElement('a');
  a.href = photo.dataUrl;
  a.download = 'photo_' + (photo.characterName || 'unknown') + '_' + (photo.createdAt || Date.now()) + '.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('照片已下载', 'success');
}

/**
 * 清空当前聊天的所有照片
 */
function clearAllAlbumPhotos() {
  if (!currentChatId) return;
  var chat = appData.chats[currentChatId];
  if (!chat || !chat.photos || chat.photos.length === 0) {
    showToast('暂无照片可清空', 'info');
    return;
  }

  if (!confirm('确定要清空当前聊天的所有照片吗？此操作不可恢复！')) return;

  chat.photos = [];
  saveData();

  // 从聊天区域移除所有照片消息
  var photoEls = document.querySelectorAll('.photo-message');
  photoEls.forEach(function(el) { el.remove(); });

  // 重新渲染相册
  renderAlbumPhotos();
  showToast('所有照片已清空', 'success');
}

// 点击相册遮罩关闭
document.getElementById('albumBackdrop').addEventListener('click', closeAlbumDrawer);

/**
 * 复制照片的生成 prompt 到剪贴板
 */
function copyPhotoPrompt(photoId) {
  if (!currentChatId) return;
  var chat = appData.chats[currentChatId];
  if (!chat || !chat.photos) return;

  var photo = null;
  for (var i = 0; i < chat.photos.length; i++) {
    if (chat.photos[i].id === photoId) {
      photo = chat.photos[i];
      break;
    }
  }
  if (!photo || !photo.prompt) {
    showToast('未找到该照片的 prompt', 'error');
    return;
  }

  // 复制到剪贴板
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(photo.prompt).then(function() {
      showToast('Prompt 已复制到剪贴板', 'success');
    }).catch(function() {
      fallbackCopy(photo.prompt);
    });
  } else {
    fallbackCopy(photo.prompt);
  }
}

/**
 * 回退复制方案
 */
function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast('Prompt 已复制到剪贴板', 'success');
  } catch (e) {
    showToast('复制失败，请手动复制', 'error');
  }
  document.body.removeChild(ta);
}

