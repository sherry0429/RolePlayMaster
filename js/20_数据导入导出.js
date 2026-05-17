
/**
 * 数据导入导出
 * 自动拆分模块
 * 保持全局兼容模式
 */

// 工具函数：JSON ↔ Base64 互转（支持中文）
function jsonToBase64(jsonStr) {
  // 先用 encodeURIComponent 处理中文，再 btoa
  return btoa(unescape(encodeURIComponent(jsonStr)));
}

function base64ToJson(b64Str) {
  // atob 解码后再用 decodeURIComponent 恢复中文
  return decodeURIComponent(escape(atob(b64Str.trim())));
}

// ---- 压缩/解压工具（gzip + base64url） ----
function arrayBufferToBase64Url(buffer) {
  var bytes = new Uint8Array(buffer);
  var binary = '';
  for (var i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToArrayBuffer(b64url) {
  var b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  var binary = atob(b64);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function compressText(text) {
  if (typeof CompressionStream !== 'undefined') {
    try {
      var blob = new Blob([text]);
      var cs = new CompressionStream('gzip');
      var stream = blob.stream().pipeThrough(cs);
      var compressed = await new Response(stream).arrayBuffer();
      return 'v2:' + arrayBufferToBase64Url(compressed);
    } catch (e) {
      console.warn('CompressionStream 失败，回退到 base64', e);
    }
  }
  return 'v1:' + jsonToBase64(text);
}

async function decompressText(encoded) {
  if (encoded.startsWith('v2:')) {
    var b64 = encoded.slice(3);
    var compressed = base64UrlToArrayBuffer(b64);
    if (typeof DecompressionStream !== 'undefined') {
      var blob = new Blob([compressed]);
      var ds = new DecompressionStream('gzip');
      var stream = blob.stream().pipeThrough(ds);
      return await new Response(stream).text();
    }
    throw new Error('浏览器不支持解压缩');
  }
  if (encoded.startsWith('v1:')) {
    return base64ToJson(encoded.slice(3));
  }
  // 旧格式（无前缀）：直接 base64
  return base64ToJson(encoded);
}

function exportDataAsFile() {
  try {
    var json = JSON.stringify(appData);
    var base64 = jsonToBase64(json);
    var blob = new Blob([base64], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = `aichat_backup_${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('数据已导出（Base64 编码）', 'success');
  } catch (e) {
    console.error('导出失败', e);
    showToast('导出失败: ' + e.message, 'error');
  }
}

function importData() {
  document.getElementById('importFile').click();
}

function handleImport(event) {
  var file = event.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = (e) => {
    try {
      var rawText = e.target.result.trim();
      var data;

      // 尝试 base64 解码
      try {
        var jsonStr = base64ToJson(rawText);
        data = JSON.parse(jsonStr);
      } catch (b64Err) {
        // base64 失败，尝试直接解析为 JSON（兼容旧格式）
        try {
          data = JSON.parse(rawText);
        } catch (jsonErr) {
          throw new Error('文件格式无效，无法解析');
        }
      }

      if (!data.chats || !data.settings) {
        throw new Error('无效的数据格式');
      }

      // 兼容性补全
      if (!data.chatOrder) data.chatOrder = Object.keys(data.chats);
      if (!data.chatCounter) data.chatCounter = data.chatOrder.length;
      if (!data.theme) data.theme = 'light';
      if (!data.characters) data.characters = [];
      if (!data.settings.speakerMode) data.settings.speakerMode = true;
      if (!data.settings.syncToken) data.settings.syncToken = '';
      if (!data.settings.autoTopic) data.settings.autoTopic = false;
      if (!data.settings.chatNotification) data.settings.chatNotification = false;
      if (data.settings.autoTopicInterval === undefined) data.settings.autoTopicInterval = 10;
      if (data.settings.autoTopicMaxCount === undefined) data.settings.autoTopicMaxCount = 5;
      // 兼容新版：补全 comfyui 设置
      if (!data.settings.comfyui) {
        data.settings.comfyui = { enabled: false, serverUrl: 'http://127.0.0.1:8188', workflowJson: '', nodeIds: { prompt: '', width: '', height: '' }, defaultWidth: 512, defaultHeight: 768 };
      }
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
      // 如果是分享精简数据（_shareLite 标记），需要转换为完整结构
      if (data._shareLite) {
        data = expandShareData(data);
      }

      appData = data;
      saveData();
      applyImportedData(data);
      showToast('数据导入成功', 'success');
    } catch (err) {
      showToast('导入失败: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
  // 重置 input 以允许重复导入同一文件
  event.target.value = '';
}

