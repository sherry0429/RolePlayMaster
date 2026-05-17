
/**
 * 背景图片上传
 * 自动拆分模块
 * 保持全局兼容模式
 */

function handleBgImageUpload(event, isChatBg) {
  var file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('请选择图片文件', 'error');
    return;
  }
  var reader = new FileReader();
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
  var img = new Image();
  img.onload = () => {
    var MAX_SIZE = 1920;
    var w = img.width, h = img.height;
    if (w > MAX_SIZE || h > MAX_SIZE) {
      var ratio = Math.min(MAX_SIZE / w, MAX_SIZE / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
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
  var bgStatus = document.getElementById('bgImageStatus');
  var clearBgBtn = document.getElementById('clearBgBtn');

  if (bgStatus) {
    var hasBg = !!(appData.settings.bgImage);
    bgStatus.textContent = hasBg ? '✅ 已设置' : '未设置';
    if (clearBgBtn) clearBgBtn.style.display = hasBg ? 'inline-block' : 'none';
  }
}

