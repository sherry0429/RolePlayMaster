/**
     * 模块: 分享链接（精简版：不含聊天记录）
     * 该文件由自动拆分工具生成
     * 后续建议继续手动细化
     */

    import { state } from '../core/state.js';
    import * as CONSTANTS from '../core/constants.js';


/**
 * 构建精简的分享数据：
 * - 总配置（theme, settings）
 * - 每个聊天框的：名称、背景图、最新 system_prompt
 * - 不含聊天记录（messages）、不含历史 sp 版本
 */
function buildShareLiteData() {
  const lite = {
    _shareLite: true,
    theme: appData.theme,
    settings: { ...appData.settings },
    // 不含 apiKey 的敏感信息
    chats: {},
    chatOrder: [...appData.chatOrder],
    chatCounter: appData.chatCounter,
    characters: JSON.parse(JSON.stringify(appData.characters || []))
  };
  // 复制 settings 但清除 apiKey 等敏感信息
  delete lite.settings.apiKey;
  delete lite.settings.syncToken;

  for (const id of appData.chatOrder) {
    const chat = appData.chats[id];
    if (!chat) continue;
    // 只保留最新 system prompt 版本
    const latestSp = chat.spVersions[chat.spVersions.length - 1] || { version: 0, content: '', lastIndex: -1 };
    lite.chats[id] = {
      name: chat.name,
      bgImage: chat.bgImage,
      characters: chat.characters || [],  // 保留角色关联
      messages: [],  // 不分享聊天记录
      spVersions: [{ version: latestSp.version, content: latestSp.content, lastIndex: -1 }],
      spViewIndex: 0
    };
  }
  return lite;
}

/**
 * 将精简分享数据展开为完整结构（用于导入时）
 */
function expandShareData(liteData) {
  const full = createDefaultData();
  full.theme = liteData.theme || 'light';
  full.settings = { ...full.settings, ...liteData.settings };
  full.chatOrder = liteData.chatOrder || [];
  full.chatCounter = liteData.chatCounter || 0;
  full.characters = liteData.characters || [];

  for (const id of full.chatOrder) {
    const chat = liteData.chats[id];
    if (!chat) continue;
    full.chats[id] = {
      name: chat.name,
      bgImage: chat.bgImage || '',
      characters: chat.characters || [],
      messages: [],
      spVersions: chat.spVersions || [{ version: 0, content: '', lastIndex: -1 }],
      spViewIndex: 0
    };
  }
  return full;
}

async function shareLink() {
  try {
    const liteData = buildShareLiteData();
    const json = JSON.stringify(liteData);
    const encoded = await compressText(json);
    const url = window.location.origin + window.location.pathname + '#share=' + encoded;

    // 尝试使用剪贴板 API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        showToast('分享链接已复制（仅配置，不含聊天记录）', 'success');
      }).catch(() => {
        fallbackCopy(url);
      });
    } else {
      fallbackCopy(url);
    }
  } catch (e) {
    showToast('生成分享链接失败', 'error');
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast('分享链接已复制（仅配置，不含聊天记录）', 'success');
  } catch (e) {
    showModal('分享链接', text, null, true);
  }
  document.body.removeChild(ta);
}

async function checkShareData() {
  const hash = window.location.hash;
  if (hash.startsWith('#share=')) {
    const encoded = hash.slice(7);
    try {
      const jsonStr = await decompressText(encoded);
      const data = JSON.parse(jsonStr);

      // 判断是精简版还是完整版
      const isLite = data._shareLite === true;
      const desc = isLite ? '配置和 System Prompt（不含聊天记录）' : '完整数据';

      if (!data.chats || !data.settings) {
        throw new Error('无效的分享数据');
      }

      if (confirm(`检测到分享数据（${desc}），是否导入？这将覆盖当前数据。`)) {
        if (isLite) {
          appData = expandShareData(data);
        } else {
          appData = data;
          if (!appData.chatOrder) appData.chatOrder = Object.keys(appData.chats);
          if (!appData.chatCounter) appData.chatCounter = appData.chatOrder.length;
          if (!appData.theme) appData.theme = 'light';
          if (!appData.characters) appData.characters = [];
          // 兼容旧版：为每个聊天补全 characters 字段
          if (appData.chats) {
            for (const id of Object.keys(appData.chats)) {
              if (appData.chats[id].characters === undefined) {
                appData.chats[id].characters = [];
              }
            }
          }
        }
        saveData();
        applyImportedData(data);
        showToast('分享数据导入成功', 'success');
      }
      // 清除 hash
      history.replaceState(null, '', window.location.pathname);
    } catch (e) {
      console.error('分享数据解析失败', e);
      showToast('分享数据解析失败: ' + e.message, 'error');
    }
  }
}