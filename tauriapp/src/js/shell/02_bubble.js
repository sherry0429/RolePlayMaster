/**
 * 02_bubble.js —— 输入栏 · 消息气泡堆 · 消息浮层
 *
 * 自上而下的三层结构：
 *   1) 消息气泡堆（#bubbleStack）：化身正上方，最近 6 个气泡；
 *      越靠上越旧、越透明，越靠下越新、越清晰。
 *      粒度跟随「说话人区分」：开启时一个气泡 = 一个说话人的一段话；
 *   2) 输入栏（#bubble）：常驻可输入，回车即发送；
 *      右侧是「继续」（▼）与「打开聊天窗」（☰）；
 *   3) 消息浮层（#bubblePanel）：点 ☰ 才展开，用于回看、滚动历史与快捷指令。
 */

var BUBBLE_MESSAGE_LIMIT = 5;    // 浮层展示的最近消息条数
var BUBBLE_STACK_LIMIT = 6;      // 气泡堆展示的最近气泡数（每条最多 6 行）
                                 // 屏幕装不下 6 个长气泡时，从最旧的那条开始淡出
var _bubbleSeenCount = 0;        // 已读消息条数（用于未读小圆点）
var _bubblePanelOpen = false;
var _stackSig = '';              // 气泡堆内容指纹，未变化时跳过重绘
var _streamingIdx = -1;          // 正在流式输出的消息下标

// ==================== 消息气泡堆 ====================

/**
 * 折叠空白，便于气泡里单行排版
 */
function stackCollapseWs(t) {
  return String(t || '').replace(/\s+/g, ' ').trim();
}

/**
 * 按说话人拆分消息内容。
 * 与 core 的 parseSpeakerSegments 规则一致，但**保留**第一个【】之前的正文
 * （core 版本会把那一段丢掉），返回 [{ speaker|null, text }]。
 */
function splitBySpeaker(raw) {
  var segs = parseSpeakerSegments(raw);
  var first = String(raw).indexOf('【');
  var lead = first > 0 ? String(raw).slice(0, first).trim() : '';
  if (lead) segs.unshift({ speaker: null, text: lead });
  return segs;
}

/** 取说话人的头像（用于气泡堆与浮层） */
function speakerFace(name) {
  if (!name) return '';
  var c = findCharacter(name);
  return (c && c.avatar) ? c.avatar : '';
}

/**
 * 取最近 N 个「气泡单元」。
 *
 * 气泡的粒度跟随设置里的「说话人区分」：
 *   - 开启且消息带【角色名】标记 → **一个气泡 = 一个说话人的一段话**
 *     （一条群聊 AI 回复里有几个说话人，就拆成几个气泡）；
 *   - 关闭，或这条消息没有标记 → 整条消息算一个气泡。
 *
 * 返回顺序：旧的在前（显示在最上方），新的在后。
 */
function collectRecentReplies(limit) {
  var chat = currentChatId ? appData.chats[currentChatId] : null;
  if (!chat || !chat.messages) return [];

  var speakerMode = appData.settings.speakerMode !== false;
  // 只有一个角色的聊天里，说话人没有歧义 —— 没带【】标记时也用它的头像
  var soloChar = (chat.characters && chat.characters.length === 1) ? chat.characters[0] : null;
  var soloFace = (soloChar && soloChar.avatar) ? soloChar.avatar : '';
  var out = [];

  // 从最新往前取，取够 limit 个单元为止
  for (var i = chat.messages.length - 1; i >= 0 && out.length < limit; i--) {
    var m = chat.messages[i];
    if (!m || m.role !== 'assistant') continue;
    var raw = stripTriggerTags(m.content || '');
    if (!raw.trim()) continue;

    if (speakerMode && hasSpeakerTags(raw)) {
      var segs = splitBySpeaker(raw);
      if (segs.length > 0) {
        // 同一段里可能有多个说话人：倒着取，保证最新的一段排在最后（最下方）
        for (var s = segs.length - 1; s >= 0 && out.length < limit; s--) {
          var segText = stackCollapseWs(segs[s].text);
          if (!segText) continue;
          var segWho = segs[s].speaker || '';
          out.push({
            idx: i, seg: s, speaker: segWho,
            face: segWho ? speakerFace(segWho) : soloFace,
            text: segText
          });
        }
        continue;
      }
    }

    // 未开启说话人区分 / 无标记：整条消息一个气泡
    out.push({ idx: i, seg: -1, speaker: '', face: soloFace, text: stackCollapseWs(raw) });
  }

  out.reverse();
  return out;
}

function renderBubbleStack() {
  var box = document.getElementById('bubbleStack');
  if (!box) return;

  var items = collectRecentReplies(BUBBLE_STACK_LIMIT);
  var sig = (isStreaming ? '1' : '0') + '|' +
    items.map(function (it) { return it.idx + '.' + it.seg + ':' + it.text.length; }).join(',');
  if (sig === _stackSig) {
    // 内容没变就不重排（流式期间会频繁触发），但仍要刷新「是否被截断」
    box.classList.toggle('clipped', box.scrollHeight > box.clientHeight + 1);
    return;
  }
  _stackSig = sig;

  if (items.length === 0) {
    box.innerHTML = '';
    box.classList.remove('clipped');
    return;
  }

  // 流式输出时，只有该消息的**最后一段**显示光标（同一条消息可能拆成多个气泡）
  var streamingPos = -1;
  if (isStreaming) {
    for (var p = items.length - 1; p >= 0; p--) {
      if (items[p].idx === _streamingIdx) { streamingPos = p; break; }
    }
  }

  var n = items.length;
  box.innerHTML = items.map(function (it, i) {
    // t: 0 = 最上（最旧）→ 1 = 最下（最新）；越往下越不透明
    var t = n === 1 ? 1 : i / (n - 1);
    var op = (0.35 + t * 0.65).toFixed(3);
    var typing = (i === streamingPos) ? ' typing' : '';
    // 说话人的位置直接放头像：多角色时主色是黑色，文字名会看不见
    var face = it.face
      ? '<img class="bs-face" src="' + escHtml(it.face) + '" alt="' + escHtml(it.speaker || '') + '">'
      : (it.speaker ? '<span class="bs-face bs-face-empty"></span>' : '');
    return '<div class="bs-item' + typing + '" style="opacity:' + op + '"' +
      ' data-idx="' + it.idx + '" data-seg="' + it.seg + '"' +
      (it.speaker ? ' title="' + escHtml(it.speaker) + '"' : '') + '>' +
      face +
      '<span class="bs-text">' + escHtml(it.text) + '</span>' +
      '</div>';
  }).join('');

  // 内容超出高度上限时才淡出顶部（否则最旧的那条会被无谓地吃掉）
  box.classList.toggle('clipped', box.scrollHeight > box.clientHeight + 1);
}

function renderBubble() {
  var bubble = document.getElementById('bubble');
  if (!bubble) return;

  var chat = currentChatId ? appData.chats[currentChatId] : null;
  var total = chat && chat.messages ? chat.messages.length : 0;
  // 浮层关闭且出现了新消息 → 小圆点闪烁提示
  bubble.classList.toggle('has-new', !_bubblePanelOpen && total > _bubbleSeenCount);
  bubble.classList.toggle('typing', !!isStreaming);

  renderBubbleStack();
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

/** 一条消息按「说话人区分」拆成若干段（用户消息永远只有一段） */
function bpMessageParts(msg, speakerMode) {
  if (!msg) return [{ speaker: null, text: '' }];
  var raw = stripTriggerTags(msg.content || '');
  if (msg.role === 'user') return [{ speaker: null, text: raw }];
  if (speakerMode && hasSpeakerTags(raw)) {
    var segs = splitBySpeaker(raw);
    if (segs.length > 0) return segs;
  }
  return [{ speaker: null, text: raw }];
}

/**
 * 浮层里的一行。
 * 说话人区分开启时，一条 AI 消息会拆成多行 —— 一行 = 一个说话人的一段话。
 */
function bpRowHtml(entry) {
  if (entry.type === 'photo') {
    var p = entry.photo;
    var img = p.thumbUrl || p.dataUrl;
    var inner = img
      ? '<img src="' + img + '" alt="照片" onclick="zoomPhoto(\'' + escHtml(p.id) + '\')">'
      : '<div style="font-size:11.5px;opacity:.75;padding:4px 2px;">' + escHtml((p.prompt || '').slice(0, 40)) + '</div>';
    return '<div class="bp-row photo">' +
      '<div class="bp-row-head"><span>' + escHtml(p.characterName || '照片') + '</span></div>' +
      '<div class="bp-row-body">' + inner + '</div></div>';
  }

  var headHtml;
  if (entry.isUser) {
    // 不带头像图也不带 emoji：一个圆形徽标里写「我」
    headHtml = '<div class="bp-row-head"><span class="bp-me">我</span></div>';
  } else if (entry.speaker) {
    var av = speakerFace(entry.speaker);
    headHtml = '<div class="bp-row-head">' +
      (av ? '<img class="bp-row-avatar" src="' + escHtml(av) + '" alt="">'
          : '<span class="bp-row-avatar bp-row-avatar-empty"></span>') +
      '<span>' + escHtml(entry.speaker) + '</span></div>';
  } else {
    headHtml = '<div class="bp-row-head"><span class="bp-row-role">AI</span></div>';
  }

  var body = bpFormatBody(entry.text, entry.isUser);
  if (!body && isStreaming && entry.isLast) {
    body = '<span class="bp-cursor">&nbsp;</span>';
  }

  return '<div class="bp-row' + (entry.isUser ? ' user' : '') + '"' +
    ' data-idx="' + entry.idx + '" data-seg="' + entry.seg + '">' +
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
  var speakerMode = appData.settings.speakerMode !== false;

  var entries = [];
  for (var i = startIdx; i < total; i++) {
    var msg = messages[i];
    if (!msg) continue;
    var parts = bpMessageParts(msg, speakerMode);

    for (var k = 0; k < parts.length; k++) {
      entries.push({
        type: 'msg',
        idx: i,
        seg: k,
        isUser: msg.role === 'user',
        speaker: parts[k].speaker || '',
        text: parts[k].text || '',
        isLast: i === total - 1 && k === parts.length - 1
      });
      // 照片挂在该条消息的最后一段之后
      if (k === parts.length - 1 && chat.photos && chat.photos.length) {
        chat.photos
          .filter(function (p) { return p.afterMessageIndex === i; })
          .forEach(function (p) { entries.push({ type: 'photo', photo: p }); });
      }
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

/** 流式增量更新：只改写对应行的正文；分段数变化时整块重绘 */
function updateBubbleStreaming(idx, content) {
  var box = document.getElementById('bpMessages');
  if (!box) return;

  var clean = stripTriggerTags(content || '');
  var speakerMode = appData.settings.speakerMode !== false;
  var parts = (speakerMode && hasSpeakerTags(clean))
    ? splitBySpeaker(clean)
    : [{ speaker: null, text: clean }];

  var rows = box.querySelectorAll('.bp-row[data-idx="' + idx + '"]');
  if (!rows.length || rows.length !== parts.length) {
    renderBubbleMessages();     // 分段数变了（例如刚出现新的说话人），整块重绘
    return;
  }

  var lastText = parts[parts.length - 1].text || '';
  var target = rows[rows.length - 1].querySelector('.bp-row-body');
  if (target) {
    var body = bpFormatBody(lastText, false);
    target.innerHTML = body
      ? body + '<span class="bp-cursor">&nbsp;</span>'
      : '<span class="bp-cursor">&nbsp;</span>';
  }
  renderBubble();
}

function scrollBubblePanelToBottom() {
  var box = document.getElementById('bpMessages');
  if (!box) return;
  requestAnimationFrame(function () {
    box.scrollTop = box.scrollHeight;
  });
}

// ==================== 展开 / 收起 ====================

function openBubblePanel() {
  var panel = document.getElementById('bubblePanel');
  if (!panel) return;
  _bubblePanelOpen = true;
  holdAvatarSize();                           // 化身改尺寸与窗口改尺寸必须同步（禁用过渡）
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
  holdAvatarSize();
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

/**
 * 展开/收起消息浮层时，化身尺寸会立刻变化。
 * 窗口尺寸是按「目标尺寸」算出来的，若化身的宽高过渡还在跑，
 * 就会出现窗口已缩小而化身还没缩、底部被裁掉的一瞬。这里临时关掉过渡。
 */
function holdAvatarSize() {
  document.body.classList.add('no-avatar-anim');
  clearTimeout(holdAvatarSize._t);
  holdAvatarSize._t = setTimeout(function () {
    document.body.classList.remove('no-avatar-anim');
  }, 360);
}

/** updateSpDisplay 在无聊天时也会安全执行 */
function updateSpDisplaySafe() {
  try { updateSpDisplay(); } catch (e) { /* ignore */ }
}

// ==================== 事件装配 ====================

function initBubble() {
  var bubble = document.getElementById('bubble');
  var arrow = document.getElementById('bubbleArrow');
  var menuBtn = document.getElementById('bubbleMenuBtn');
  var closeBtn = document.getElementById('bpClose');
  var input = document.getElementById('userInput');

  if (bubble) {
    // 输入栏常驻，点击即进入输入状态（不再需要先点开聊天窗）
    bubble.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('button')) return;
      if (input) { try { input.focus(); } catch (err) { /* ignore */ } }
    });
    // 右键输入栏同样弹出菜单
    bubble.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openContextMenu(e.clientX, e.clientY);
    });
  }

  // ☰ 才打开聊天窗
  if (menuBtn) {
    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleBubblePanel();
    });
  }

  // ▼ = 网页版的「继续」
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
