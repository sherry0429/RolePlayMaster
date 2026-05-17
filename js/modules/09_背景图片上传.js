/**
     * 模块: 背景图片上传
     * 该文件由自动拆分工具生成
     * 后续建议继续手动细化
     */

    import { state } from '../core/state.js';
    import * as CONSTANTS from '../core/constants.js';

    function handleBgImageUpload(event, isChatBg) {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('请选择图片文件', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    compressImage(e.target.result, (compressedUrl) => {
      if (isChatBg) {
        if (currentChatId && appData.chats[currentChatId]) {
          appData.chats[currentChatId].bgImage = compressedUrl;
          applyChatBgImage(compressedUrl);
        }
      } else {
        appData.settings.bgImage = compressedUrl;
        applyBgImage(compressedUrl);
        if (currentChatId) applyChatBgImage(appData.chats[currentChatId]?.bgImage);
      }
      updateBgImageStatus();
      saveData();
      showToast('背景图片已更新', 'success');
    });
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function compressImage(dataUrl, callback) {
  const img = new Image();
  img.onload = () => {
    const MAX_SIZE = 1920;
    let w = img.width, h = img.height;
    if (w > MAX_SIZE || h > MAX_SIZE) {
      const ratio = Math.min(MAX_SIZE / w, MAX_SIZE / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    callback(canvas.toDataURL('image/jpeg', 0.7));
  };
  img.onerror = () => callback(dataUrl);
  img.src = dataUrl;
}

function clearBgImage() {
  appData.settings.bgImage = '';
  applyBgImage('');
  if (currentChatId) applyChatBgImage(appData.chats[currentChatId]?.bgImage);
  updateBgImageStatus();
  saveData();
  showToast('全局背景已清除');
}

function updateBgImageStatus() {
  const bgStatus = document.getElementById('bgImageStatus');
  const clearBgBtn = document.getElementById('clearBgBtn');

  if (bgStatus) {
    const hasBg = !!(appData.settings.bgImage);
    bgStatus.textContent = hasBg ? '✅ 已设置' : '未设置';
    if (clearBgBtn) clearBgBtn.style.display = hasBg ? 'inline-block' : 'none';
  }
}