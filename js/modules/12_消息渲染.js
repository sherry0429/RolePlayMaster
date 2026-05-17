/**
     * 模块: 消息渲染
     * 该文件由自动拆分工具生成
     * 后续建议继续手动细化
     */

    import { state } from '../core/state.js';
    import * as CONSTANTS from '../core/constants.js';

    // 渲染消息（只渲染最近 renderedMessageCount 条）
function renderMessages(shouldScrollToBottom = true) {
  const area = document.getElementById('chatArea');
  if (!currentChatId || !appData.chats[currentChatId]) {
    area.innerHTML = '<div class="welcome-msg">👋 欢迎使用 AI Chat<br>点击左侧 + 开始新对话</div>';
    return;
  }
  const chat = appData.chats[currentChatId];
  if (chat.messages.length === 0) {
    area.innerHTML = '<div class="welcome-msg">💬 开始新的对话吧</div>';
    return;
  }

  const speakerMode = appData.settings.speakerMode !== false;
  const totalMessages = chat.messages.length;
  // 计算实际渲染的消息范围
  const renderCount = Math.min(renderedMessageCount, totalMessages);
  const startIndex = Math.max(0, totalMessages - renderCount);

  let html = '';

  // 如果还有更多历史消息未渲染，显示"加载更多"提示
  if (startIndex > 0) {
    html += `<div class="load-more" id="loadMoreBtn" onclick="loadMoreMessages()">
      📜 向上滚动或点击加载更早的消息（还剩 ${startIndex} 条）
    </div>`;
  }

  // 只渲染最近的消息
  for (let idx = startIndex; idx < totalMessages; idx++) {
    const msg = chat.messages[idx];
    const isUser = msg.role === 'user';
    const avatar = isUser ? '👤' : '🤖';
    const cls = isUser ? 'user' : 'ai';
    const contentHtml = isUser ? escHtml(msg.content) : renderMarkdown(msg.content);

    // 说话人区分：仅对 AI 消息生效
    if (!isUser && speakerMode && hasSpeakerTags(msg.content)) {
      html += `
        <div class="message ${cls}" data-idx="${idx}">
          <div class="msg-avatar">${avatar}</div>
          <div class="msg-body">
            ${renderSpeakerSegments(msg.content, idx)}
            <div class="msg-actions">
              <button class="msg-action-btn" onclick="editMessage(${idx})">✏️ 编辑</button>
              <button class="msg-action-btn del" onclick="deleteMessage(${idx})">🗑️ 删除</button>
            </div>
          </div>
        </div>`;
    } else {
      html += `
        <div class="message ${cls}" data-idx="${idx}">
          <div class="msg-avatar">${avatar}</div>
          <div class="msg-body">
            <div class="msg-bubble">${contentHtml}</div>
            <div class="msg-actions">
              <button class="msg-action-btn" onclick="editMessage(${idx})">✏️ 编辑</button>
              <button class="msg-action-btn del" onclick="deleteMessage(${idx})">🗑️ 删除</button>
            </div>
          </div>
        </div>`;
    }
  }

  // 保存当前滚动位置（用于加载更多时保持位置）
  const oldScrollHeight = area.scrollHeight;
  const oldScrollTop = area.scrollTop;

  area.innerHTML = html;

  if (shouldScrollToBottom) {
    scrollToBottom();
  } else {
    // 加载更多消息时，保持滚动位置
    requestAnimationFrame(() => {
      area.scrollTop = area.scrollHeight - oldScrollHeight + oldScrollTop;
    });
  }
}

// 加载更多历史消息
function loadMoreMessages() {
  const chat = appData.chats[currentChatId];
  if (!chat) return;

  // 增加渲染数量
  renderedMessageCount = Math.min(renderedMessageCount + MESSAGE_PAGE_SIZE, chat.messages.length);
  renderMessages(false);
}

// 重置消息渲染数量（切换聊天或发送新消息时调用）
function resetRenderedCount() {
  renderedMessageCount = MESSAGE_PAGE_SIZE;
}

/**
 * 检测消息中是否包含【】说话人标记
 */
function hasSpeakerTags(content) {
  return /【.+?】/.test(content);
}

/**
 * 将带【说话人】的消息拆分为多个说话人段落展示
 */
function renderSpeakerSegments(content, msgIdx) {
  // 匹配【说话人】以及后续内容（到下一个【说话人】或末尾）
  const regex = /【(.+?)】([\s\S]*?)(?=【.+?】|$)/g;
  let match;
  let segments = [];
  let lastIndex = 0;

  while ((match = regex.exec(content)) !== null) {
    const speaker = match[1];
    const text = match[2].trim();
    if (text) {
      segments.push({ speaker, text });
    }
    lastIndex = regex.lastIndex;
  }

  // 如果没有匹配到任何段落，返回原始渲染
  if (segments.length === 0) {
    return `<div class="msg-bubble">${renderMarkdown(content)}</div>`;
  }

  // 检查【】之前是否有内容
  const firstMatch = content.indexOf('【');
  let html = '';
  if (firstMatch > 0) {
    const preamble = content.slice(0, firstMatch).trim();
    if (preamble) {
      html += `<div class="speaker-segment">
        <div class="msg-avatar">🤖</div>
        <div><div class="speaker-bubble">${renderMarkdown(preamble)}</div></div>
      </div>`;
    }
  }

  // 渲染每个说话人段落
  segments.forEach(seg => {
    const charInfo = findCharacter(seg.speaker);
    const avatarHtml = charInfo && charInfo.avatar
      ? `<img src="${escHtml(charInfo.avatar)}" alt="${escHtml(seg.speaker)}">`
      : `<span>${escHtml(seg.speaker.charAt(0))}</span>`;

    html += `<div class="speaker-segment">
      <div class="msg-avatar">${avatarHtml}</div>
      <div>
        <div class="speaker-name">${escHtml(seg.speaker)}</div>
        <div class="speaker-bubble">${renderMarkdown(seg.text)}</div>
      </div>
    </div>`;
  });

  return html;
}

/**
 * 在角色图库中查找匹配名称的角色
 */
function findCharacter(name) {
  if (!appData.characters) return null;
  return appData.characters.find(c => c.name === name) || null;
}

function scrollToBottom() {
  const area = document.getElementById('chatArea');
  // 使用双重 requestAnimationFrame 确保浏览器已完成布局计算
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      area.scrollTop = area.scrollHeight;
    });
  });
}