/**
     * 模块: 背景图片
     * 该文件由自动拆分工具生成
     * 后续建议继续手动细化
     */

    import { state } from '../core/state.js';
    import * as CONSTANTS from '../core/constants.js';

    function applyBgImage(url) {
  const layer = document.getElementById('bg-layer');
  if (url && url.trim()) {
    layer.style.backgroundImage = `url(${url})`;
    layer.style.backgroundSize = 'cover';
    layer.style.backgroundPosition = 'center';
    layer.style.opacity = '0.15';
  } else {
    // 全局背景未设置时，用当前聊天角色缺省背景
    const fallbackUrl = getChatCharacterImage();
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
  const layer = document.getElementById('bg-layer');
  // 优先级：聊天专属背景 > 全局背景 > 当前聊天角色缺省背景
  const finalUrl = (url && url.trim()) ? url : appData.settings.bgImage;
  if (finalUrl && finalUrl.trim()) {
    layer.style.backgroundImage = `url(${finalUrl})`;
    layer.style.backgroundSize = 'cover';
    layer.style.backgroundPosition = 'center';
    layer.style.opacity = '0.15';
  } else {
    // 缺省背景：从当前聊天的 system_prompt 提取角色名，匹配角色图库图片
    const fallbackUrl = getChatCharacterImage();
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

  const chat = appData.chats[currentChatId];

  // 优先使用聊天框关联的角色
  if (chat.characters && chat.characters.length > 0) {
    const chars = chat.characters.filter(c => c.avatar);
    if (chars.length > 0) {
      return chars[Math.floor(Math.random() * chars.length)].avatar;
    }
  }

  // 回退：从 system_prompt 中提取【角色名】匹配角色图库
  if (!appData.characters || appData.characters.length === 0) return null;
  const sp = getCurrentSpVersion();
  const spContent = sp.content || '';
  const speakerNames = extractSpeakerNames(spContent);

  const matchedChars = speakerNames
    .map(name => appData.characters.find(c => c.name === name && c.avatar))
    .filter(Boolean);

  if (matchedChars.length > 0) {
    return matchedChars[Math.floor(Math.random() * matchedChars.length)].avatar;
  }

  return null;
}

/**
 * 从文本中提取【】括号内的角色名（去重）
 */
function extractSpeakerNames(text) {
  const names = new Set();
  const regex = /【(.+?)】/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    names.add(match[1]);
  }
  return Array.from(names);
}