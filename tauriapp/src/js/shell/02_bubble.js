/**
 * 02_bubble.js —— 气泡与消息浮层
 *
 * - 气泡：贴在化身左上角，显示最近一条消息预览；右侧向下箭头 = 网页版的「继续」
 * - 消息浮层：点击气泡后展开，展示最近 5 条消息，并可直接在内部输入继续聊天
 */

var BUBBLE_MESSAGE_LIMIT = 5;   // 浮层展示的最近消息条数
var _bubbleSeenCount = 0;       // 已读消息条数（用于未读小圆点）
var _bubblePanelOpen = false;

// ==================== 气泡 ====================

/** 生成气泡预览文案 */
function buildBubblePreview() {
  if (!currentChatId || !appData.chats[currentChatId]) return '点击开始';
  var chat = appData.chats[currentChatId];
  if (!chat.messages || chat.messages.length === 0) return '开始新的对话…';

  for (var i = chat.messages.length - 1; i >= 0; i--) {
    var raw = stripTriggerTags(chat.messages[i].content || '');
    if (!raw.trim()) continue;
    // 【角色名】→「角色名：」，让小气泡里的预览更像一句对话
    var text = raw.replace(/【(.+?)】/g, '$1：').replace(/\s+/g, ' ').trim();
    return text.length > 22 ? text.slice(0, 22) + '…' : text;
  }
  return '开始新的对话…';
}

function renderBubble() {
  var bubble = document.getElementById('bubble');
  var textEl = document.getElementById('bubbleText');
  if (!bubble || !textEl) return;

  textEl.textContent = buildBubblePreview();

  var chat = currentChatId ? appData.chats[currentChatId] : null;
  var total = chat && chat.messages ? chat.messages.length : 0;
  // 浮层关闭且出现了新消息 → 闪烁提示
  bubble.classList.toggle('has-new', !_bubblePanelOpen && total > _bubbleSeenCount);
  bubble.classList.toggle('typing', !!isStreaming);
}

// ==================== 消息浮层 ====================

/** 把消息正文转成浮层里易读的短文本（【角色】高亮） */
function bpFormatBody(content, isUser) {
  var clean = stripTriggerTags(content || '');
  if (isUser) return escHtml(clean).replace(/\n/g, '<br>');
  var html = renderMarkdown(clean);
  // 【角色名】渲染成醒目的说话人标签
  html = html.replace(/【(.+?)】/g, '<b class="bp-speaker">$1</b>');
  return html;
}

/** 在角色图库中查找说话人，用于展示小头像 */
function bpSpeakerAvatar(name) {
  var c = findCharacter(name);
  if (c && c.avatar) return c.avatar;
  return '';
}

function bpRowHtml(entry) {
  if (entry.type === 'photo') {
    var p = entry.photo;
    var img = p.thumbUrl || p.dataUrl;
    var inner = img
      ? '<img src="' + img + '" alt="照片" onclick="zoomPhoto(\'' + escHtml(p.id) + '\')">'
      : '<div style="font-size:11.5px;opacity:.75;padding:4px 2px;">📷 ' + escHtml((p.prompt || '').slice(0, 40)) + '</div>';
    return '<div class="bp-row photo">' +
      '<div class="bp-row-head"><span>📷 ' + escHtml(p.characterName || '照片') + '</span></div>' +
      '<div class="bp-row-body">' + inner + '</div></div>';
  }

  var msg = entry.msg;
  var isUser = msg.role === 'user';
  var content = stripTriggerTags(msg.content || '');
  var speakerMode = appData.settings.speakerMode !== false;

  var headHtml = '';
  if (isUser) {
    headHtml = '<div class="bp-row-head"><span>🧑 我</span></div>';
  } else {
    var speaker = '';
    if (speakerMode && hasSpeakerTags(content)) {
      var segs = parseSpeakerSegments(content);
      if (segs.length > 0) speaker = segs[0].speaker;
    }
    if (speaker) {
      var av = bpSpeakerAvatar(speaker);
      headHtml = '<div class="bp-row-head">' +
        (av ? '<img class="bp-row-avatar" src="' + escHtml(av) + '" alt="">' : '') +
        '<span>' + escHtml(speaker) + '</span></div>';
    } else {
      headHtml = '<div class="bp-row-head"><span>🤖 AI</span></div>';
    }
  }

  var body = bpFormatBody(content, isUser);
  if (!body && isStreaming && entry.isLast) {
    body = '<span class="bp-cursor">&nbsp;</span>';
  }

  return '<div class="bp-row' + (isUser ? ' user' : '') + '" data-idx="' + entry.idx + '">' +
    headHtml +
    '<div class="bp-row-body">' + body + '</div></div>';
}

function renderBubbleMessages() {
  var box = document.getElementById('bpMessages');
  var nameEl = document.getElementById('bpChatName');
  var badgeEl = document.getElementById('bpSpBadge');
  if (!box) return;

  if (!currentChatId || !appData.chats[currentChatId]) {
    if (nameEl) nameEl.textContent = '未选择聊天';
    if (badgeEl) badgeEl.textContent = 'v0';
    box.innerHTML = '<div class="bp-empty">还没有聊天<br>右键化身 → 「创建聊天（群聊）」开始</div>';
    return;
  }

  var chat = appData.chats[currentChatId];
  if (nameEl) nameEl.textContent = chat.name || '未命名';
  if (badgeEl) {
    var sp = getCurrentSpVersion();
    badgeEl.textContent = 'v' + (sp.version || 0);
  }

  var messages = chat.messages || [];
  var total = messages.length;
  var startIdx = Math.max(0, total - BUBBLE_MESSAGE_LIMIT);

  var entries = [];
  for (var i = startIdx; i < total; i++) {
    entries.push({ type: 'msg', idx: i, msg: messages[i], isLast: i === total - 1 });
    if (chat.photos && chat.photos.length) {
      chat.photos
        .filter(function (p) { return p.afterMessageIndex === i; })
        .forEach(function (p) { entries.push({ type: 'photo', photo: p }); });
    }
  }
  // 末尾照片（无 afterMessageIndex 或位于最后一条消息之后）
  if (chat.photos && chat.photos.length) {
    chat.photos
      .filter(function (p) { return p.afterMessageIndex === undefined || p.afterMessageIndex >= total; })
      .slice(-2)
      .forEach(function (p) { entries.push({ type: 'photo', photo: p }); });
  }

  if (entries.length === 0) {
    box.innerHTML = '<div class="bp-empty">还没有消息，说点什么吧</div>';
    return;
  }

  box.innerHTML = entries.map(bpRowHtml).join('');
  scrollBubblePanelToBottom();
}

function scrollBubblePanelToBottom() {
  var box = document.getElementById('bpMessages');
  if (!box) return;
  requestAnimationFrame(function () {
    box.scrollTop = box.scrollHeight;
  });
}

/** 流式增量更新：只改写对应行的正文 */
function updateBubbleStreaming(idx, content) {
  var box = document.getElementById('bpMessages');
  if (!box) return;
  var row = box.querySelector('.bp-row[data-idx="' + idx + '"] .bp-row-body');
  if (!row) {
    // 该消息不在最近 5 条窗口内（极少见），整体重绘
    renderBubbleMessages();
    return;
  }
  var clean = stripTriggerTags(content || '');
  var body = bpFormatBody(clean, false);
  row.innerHTML = body ? body + '<span class="bp-cursor">&nbsp;</span>' : '<span class="bp-cursor">&nbsp;</span>';
  renderBubble();
}

// ==================== 展开 / 收起 ====================

function openBubblePanel() {
  var panel = document.getElementById('bubblePanel');
  if (!panel) return;
  _bubblePanelOpen = true;
  panel.classList.add('open');
  document.body.classList.add('chat-open');   // 化身缩小，为消息列表让出空间
  shellSyncAvatarWindowSize();                // 窗口随之变高，容纳消息列表
  renderBubbleMessages();

  var chat = currentChatId ? appData.chats[currentChatId] : null;
  _bubbleSeenCount = chat && chat.messages ? chat.messages.length : 0;
  renderBubble();

  // 每次打开都刷新 SP 版本徽标（可能刚做过记忆压缩）
  updateSpDisplaySafe();

  setTimeout(function () {
    var input = document.getElementById('userInput');
    if (input && !isStreaming) {
      try { input.focus(); } catch (e) { /* ignore */ }
    }
  }, 60);
}

function closeBubblePanel() {
  var panel = document.getElementById('bubblePanel');
  if (!panel) return;
  _bubblePanelOpen = false;
  panel.classList.remove('open');
  document.body.classList.remove('chat-open');
  shellSyncAvatarWindowSize();
}

function toggleBubblePanel() {
  if (_bubblePanelOpen) closeBubblePanel();
  else openBubblePanel();
}

/** 展开状态下重绘（消息变化后调用） */
function refreshBubblePanel() {
  if (!_bubblePanelOpen) return;
  renderBubbleMessages();
  var chat = currentChatId ? appData.chats[currentChatId] : null;
  _bubbleSeenCount = chat && chat.messages ? chat.messages.length : 0;
}

/** updateSpDisplay 在无聊天时也会安全执行 */
function updateSpDisplaySafe() {
  try { updateSpDisplay(); } catch (e) { /* ignore */ }
}

// ==================== 事件装配 ====================

function initBubble() {
  var bubble = document.getElementById('bubble');
  var arrow = document.getElementById('bubbleArrow');
  var closeBtn = document.getElementById('bpClose');
  var input = document.getElementById('userInput');

  if (bubble) {
    bubble.addEventListener('click', function (e) {
      if (e.target === arrow) return;   // 箭头单独处理
      toggleBubblePanel();
    });
    // 右键气泡同样弹出菜单
    bubble.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openContextMenu(e.clientX, e.clientY);
    });
  }

  if (arrow) {
    arrow.addEventListener('click', function (e) {
      e.stopPropagation();
      triggerContinue();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeBubblePanel();
    });
  }

  if (input) {
    input.addEventListener('input', autoResizeInput);
    input.addEventListener('keydown', handleInputKeydown);
  }
}
