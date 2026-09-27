
/**
 * 背景图片
 * 自动拆分模块
 * 保持全局兼容模式
 */

function applyBgImage(url) {
  var layer = document.getElementById('bg-layer');
  if (url && url.trim()) {
    layer.style.backgroundImage = `url(${url})`;
    layer.style.backgroundSize = 'cover';
    layer.style.backgroundPosition = 'center';
    layer.style.opacity = '0.15';
  } else {
    // 全局背景未设置时，用当前聊天角色缺省背景
    var fallbackUrl = getChatCharacterImage();
    if (fallbackUrl) {
      layer.style.backgroundImage = `url(${fallbackUrl})`;
      layer.style.backgroundSize = 'cover';
      layer.style.backgroundPosition = 'center';
      layer.style.opacity = '0.12';
    } else {
      layer.style.backgroundImage = 'none';
      layer.style.opacity = '0';
    }
  }
}

function applyChatBgImage(url) {
  var layer = document.getElementById('bg-layer');
  // 优先级：聊天专属背景 > 全局背景 > 当前聊天角色缺省背景
  var finalUrl = (url && url.trim()) ? url : appData.settings.bgImage;
  if (finalUrl && finalUrl.trim()) {
    layer.style.backgroundImage = `url(${finalUrl})`;
    layer.style.backgroundSize = 'cover';
    layer.style.backgroundPosition = 'center';
    layer.style.opacity = '0.15';
  } else {
    // 缺省背景：从当前聊天的 system_prompt 提取角色名，匹配角色图库图片
    var fallbackUrl = getChatCharacterImage();
    if (fallbackUrl) {
      layer.style.backgroundImage = `url(${fallbackUrl})`;
      layer.style.backgroundSize = 'cover';
      layer.style.backgroundPosition = 'center';
      layer.style.opacity = '0.12'; // 缺省背景稍淡一点
    } else {
      layer.style.backgroundImage = 'none';
      layer.style.opacity = '0';
    }
  }
}

/**
 * 从当前聊天的关联角色或 system_prompt 中获取角色图片
 * 优先使用 chat.characters（已关联角色），回退到从 system_prompt 提取
 */
function getChatCharacterImage() {
  if (!currentChatId || !appData.chats[currentChatId]) return null;

  var chat = appData.chats[currentChatId];

  // 优先使用聊天框关联的角色
  if (chat.characters && chat.characters.length > 0) {
    var chars = chat.characters.filter(c => c.avatar);
    if (chars.length > 0) {
      return chars[Math.floor(Math.random() * chars.length)].avatar;
    }
  }

  // 回退：从 system_prompt 中提取【角色名】匹配角色图库
  if (!appData.characters || appData.characters.length === 0) return null;
  var sp = getCurrentSpVersion();
  var spContent = sp.content || '';
  var speakerNames = extractSpeakerNames(spContent);

  var matchedChars = speakerNames
    .map(name => appData.characters.find(c => c.name === name && c.avatar))
    .filter(Boolean);

  if (matchedChars.length > 0) {
    return matchedChars[Math.floor(Math.random() * matchedChars.length)].avatar;
  }

  return null;
}

/**
 * 从文本中提取角色名（去重）
 * SPX 格式走 sp_format.js 结构化解析；普通文本（AI 回复等）扫描【】标记
 */
function extractSpeakerNames(text) {
  if (isSpFormat(text)) {
    return getSpCharacterNames(text);
  }
  var names = new Set();
  var regex = /【(.+?)】/g;
  var match;
  while ((match = regex.exec(text)) !== null) {
    names.add(match[1]);
  }
  return Array.from(names);
}

