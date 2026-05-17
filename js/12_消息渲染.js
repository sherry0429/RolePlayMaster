
/**
 * 消息渲染
 * 自动拆分模块
 * 保持全局兼容模式
 */

// 渲染消息（只渲染最近 renderedMessageCount 条）
function renderMessages(shouldScrollToBottom = true) {
  var area = document.getElementById('chatArea');
  if (!currentChatId || !appData.chats[currentChatId]) {
    area.innerHTML = '<div class="welcome-msg">👋 欢迎使用 AI Chat<br>点击左侧 + 开始新对话</div>';
    return;
  }
  var chat = appData.chats[currentChatId];
  if (chat.messages.length === 0) {
    area.innerHTML = '<div class="welcome-msg">💬 开始新的对话吧</div>';
    return;
  }

  var speakerMode = appData.settings.speakerMode !== false;
  var totalMessages = chat.messages.length;
  // 计算实际渲染的消息范围
  var renderCount = Math.min(renderedMessageCount, totalMessages);
  var startIndex = Math.max(0, totalMessages - renderCount);

  var html = '';

  // 如果还有更多历史消息未渲染，显示"加载更多"提示
  if (startIndex > 0) {
    html += `<div class="load-more" id="loadMoreBtn" onclick="loadMoreMessages()">
      📜 向上滚动或点击加载更早的消息（还剩 ${startIndex} 条）
    </div>`;
  }

  // 只渲染最近的消息
  for (var idx = startIndex; idx < totalMessages; idx++) {
    var msg = chat.messages[idx];
    var isUser = msg.role === 'user';
    var avatar = isUser ? '👤' : '🤖';
    var cls = isUser ? 'user' : 'ai';
    var contentHtml = isUser ? escHtml(msg.content) : renderMarkdown(msg.content);

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
  var oldScrollHeight = area.scrollHeight;
  var oldScrollTop = area.scrollTop;

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
  var chat = appData.chats[currentChatId];
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
  var regex = /【(.+?)】([\s\S]*?)(?=【.+?】|$)/g;
  var match;
  var segments = [];
  var lastIndex = 0;

  while ((match = regex.exec(content)) !== null) {
    var speaker = match[1];
    var text = match[2].trim();
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
  var firstMatch = content.indexOf('【');
  var html = '';
  if (firstMatch > 0) {
    var preamble = content.slice(0, firstMatch).trim();
    if (preamble) {
      html += `<div class="speaker-segment">
        <div class="msg-avatar">🤖</div>
        <div><div class="speaker-bubble">${renderMarkdown(preamble)}</div></div>
      </div>`;
    }
  }

  // 渲染每个说话人段落
  segments.forEach(seg => {
    var charInfo = findCharacter(seg.speaker);
    var avatarHtml = charInfo && charInfo.avatar
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
  var area = document.getElementById('chatArea');
  // 使用双重 requestAnimationFrame 确保浏览器已完成布局计算
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      area.scrollTop = area.scrollHeight;
    });
  });
}

