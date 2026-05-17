// 模块: 重放功能

    let isReplaying = false;
let _replayGen = 0; // 代际计数器，每次 start/stop 递增，异步循环检测代际是否一致来决定是否继续

function toggleReplay() {
  if (isReplaying) {
    stopReplay();
  } else {
    startReplay();
  }
}

/**
 * 将消息列表展开为"回放单元"列表
 * 用户消息 → 一个单元（type: 'user'）
 * AI 消息（无说话人标签）→ 一个单元（type: 'ai'）
 * AI 消息（有说话人标签）→ 拆为多个单元（type: 'speaker'），包括 preamble
 */
function buildReplayUnits(messages) {
  const speakerMode = appData.settings.speakerMode !== false;
  const units = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'user') {
      units.push({ type: 'user', msgIdx: i, content: msg.content });
    } else if (speakerMode && hasSpeakerTags(msg.content)) {
      // 拆分为说话人段落
      const segments = parseSpeakerSegments(msg.content);
      // 检查【】之前是否有 preamble
      const firstBracket = msg.content.indexOf('【');
      if (firstBracket > 0) {
        const preamble = msg.content.slice(0, firstBracket).trim();
        if (preamble) {
          units.push({ type: 'speaker', msgIdx: i, speaker: null, text: preamble });
        }
      }
      for (const seg of segments) {
        units.push({ type: 'speaker', msgIdx: i, speaker: seg.speaker, text: seg.text });
      }
    } else {
      units.push({ type: 'ai', msgIdx: i, content: msg.content });
    }
  }
  return units;
}

async function startReplay() {
  if (!currentChatId || !appData.chats[currentChatId]) {
    showToast('请先选择一个聊天', 'error');
    return;
  }
  const chat = appData.chats[currentChatId];
  if (!chat.messages || chat.messages.length === 0) {
    showToast('当前聊天没有消息', 'error');
    return;
  }
  if (isStreaming || isCompressing) {
    showToast('请等待当前操作完成', 'error');
    return;
  }

  // 递增代际，使之前可能仍在运行的旧循环失效
  const myGen = ++_replayGen;
  isReplaying = true;

  // 更新按钮状态
  const btn = document.getElementById('replayBtn');
  btn.innerHTML = '⏹';
  btn.title = '停止重放';
  btn.classList.add('replaying');

  // 禁用输入
  document.getElementById('userInput').disabled = true;
  document.getElementById('sendBtn').disabled = true;

  // 清空聊天区域
  const area = document.getElementById('chatArea');
  area.innerHTML = '';

  const messages = chat.messages;
  const units = buildReplayUnits(messages);
  const total = units.length;
  const progressBar = document.getElementById('replayProgress');

  // 当前正在构建的 AI 消息容器（同一 msgIdx 的 speaker 段落共用一个 message 容器）
  let currentAiMsgIdx = -1;
  let currentAiMsgEl = null;

  for (let i = 0; i < total; i++) {
    // 代际不一致说明已被 stop 或被新的 start 取代，立即退出
    if (myGen !== _replayGen) break;

    const unit = units[i];

    // 更新进度条
    const pct = Math.round(((i + 1) / total) * 100);
    progressBar.style.width = pct + '%';

    if (unit.type === 'user') {
      // 关闭上一个 AI 消息容器
      currentAiMsgIdx = -1;
      currentAiMsgEl = null;

      // 用户消息：即时出现
      appendReplayUserMessage(unit.content, unit.msgIdx);
      scrollToBottom();
      await replayDelay(350, myGen);
      if (myGen !== _replayGen) break;

    } else if (unit.type === 'ai') {
      // 关闭上一个 AI 消息容器
      currentAiMsgIdx = -1;
      currentAiMsgEl = null;

      // 普通AI消息：先显示打字指示器
      showReplayTyping('🤖');
      scrollToBottom();

      const typingMs = Math.min(500 + unit.content.length * 8, 2200);
      await replayDelay(typingMs, myGen);
      if (myGen !== _replayGen) break;

      removeReplayTyping();
      appendReplayAiMessage(unit.content, unit.msgIdx);
      scrollToBottom();
      await replayDelay(350, myGen);

    } else if (unit.type === 'speaker') {
      // 说话人段落：需要与同一 msgIdx 的其他段落共用一个 message 容器
      if (currentAiMsgIdx !== unit.msgIdx || !currentAiMsgEl) {
        // 新的 AI 消息容器
        currentAiMsgIdx = unit.msgIdx;
        currentAiMsgEl = createReplayAiMsgContainer(unit.msgIdx);
        area.appendChild(currentAiMsgEl);
      }

      // 先显示该说话人的打字指示器
      const typingAvatar = unit.speaker
        ? (findCharacter(unit.speaker)?.avatar
          ? `<img src="${escHtml(findCharacter(unit.speaker).avatar)}" alt="${escHtml(unit.speaker)}">`
          : escHtml(unit.speaker.charAt(0)))
        : '🤖';
      showReplayTyping(typingAvatar);
      scrollToBottom();

      const typingMs = Math.min(400 + unit.text.length * 10, 1800);
      await replayDelay(typingMs, myGen);
      if (myGen !== _replayGen) break;

      removeReplayTyping();

      // 追加说话人段落到当前消息容器
      appendReplaySpeakerSegment(currentAiMsgEl, unit);
      scrollToBottom();
      await replayDelay(300, myGen);
    }
  }

  // 只有当前代际仍一致时才执行收尾（避免 stop 后的旧循环也执行收尾）
  if (myGen === _replayGen) {
    finishReplay();
  }
}

function stopReplay() {
  // 递增代际使当前运行的异步循环失效
  _replayGen++;
  finishReplay();
  // 恢复正常消息渲染
  renderMessages();
}

function finishReplay() {
  isReplaying = false;

  const btn = document.getElementById('replayBtn');
  btn.innerHTML = '🔄';
  btn.title = '重放';
  btn.classList.remove('replaying');

  // 恢复输入
  document.getElementById('userInput').disabled = false;
  document.getElementById('sendBtn').disabled = false;

  // 隐藏进度条
  const progressBar = document.getElementById('replayProgress');
  progressBar.style.width = '0';
}

/**
 * 创建 AI 消息的外层容器（供说话人段落共用）
 */
function createReplayAiMsgContainer(msgIdx) {
  const div = document.createElement('div');
  div.className = 'message ai';
  div.dataset.idx = msgIdx;

  const avatarDiv = document.createElement('div');
  avatarDiv.className = 'msg-avatar';
  avatarDiv.textContent = '🤖';

  const bodyDiv = document.createElement('div');
  bodyDiv.className = 'msg-body';

  div.appendChild(avatarDiv);
  div.appendChild(bodyDiv);
  return div;
}

/**
 * 在聊天区域追加一条用户消息
 */
function appendReplayUserMessage(content, msgIdx) {
  const area = document.getElementById('chatArea');
  const contentHtml = escHtml(content);
  area.insertAdjacentHTML('beforeend', `
    <div class="message user" data-idx="${msgIdx}">
      <div class="msg-avatar">👤</div>
      <div class="msg-body">
        <div class="msg-bubble">${contentHtml}</div>
      </div>
    </div>`);
}

/**
 * 在聊天区域追加一条普通 AI 消息（无说话人标签）
 */
function appendReplayAiMessage(content, msgIdx) {
  const area = document.getElementById('chatArea');
  const contentHtml = renderMarkdown(content);
  area.insertAdjacentHTML('beforeend', `
    <div class="message ai" data-idx="${msgIdx}">
      <div class="msg-avatar">🤖</div>
      <div class="msg-body">
        <div class="msg-bubble">${contentHtml}</div>
      </div>
    </div>`);
}

/**
 * 在 AI 消息容器内追加一个说话人段落
 */
function appendReplaySpeakerSegment(msgEl, unit) {
  const bodyDiv = msgEl.querySelector('.msg-body');
  if (!bodyDiv) return;

  const segEl = document.createElement('div');
  segEl.className = 'speaker-segment';

  // 头像
  const avatarDiv = document.createElement('div');
  avatarDiv.className = 'msg-avatar';
  if (unit.speaker) {
    const charInfo = findCharacter(unit.speaker);
    if (charInfo && charInfo.avatar) {
      avatarDiv.innerHTML = `<img src="${escHtml(charInfo.avatar)}" alt="${escHtml(unit.speaker)}">`;
    } else {
      avatarDiv.innerHTML = `<span>${escHtml(unit.speaker.charAt(0))}</span>`;
    }
  } else {
    avatarDiv.textContent = '🤖';
  }

  // 内容
  const contentDiv = document.createElement('div');
  if (unit.speaker) {
    const nameDiv = document.createElement('div');
    nameDiv.className = 'speaker-name';
    nameDiv.textContent = unit.speaker;
    contentDiv.appendChild(nameDiv);
  }
  const bubbleDiv = document.createElement('div');
  bubbleDiv.className = 'speaker-bubble';
  bubbleDiv.innerHTML = renderMarkdown(unit.text);
  contentDiv.appendChild(bubbleDiv);

  segEl.appendChild(avatarDiv);
  segEl.appendChild(contentDiv);
  bodyDiv.appendChild(segEl);
}

/**
 * 显示重放时的打字指示器，avatarHtml 可以是 emoji 或 <img> 标签
 */
function showReplayTyping(avatarHtml) {
  const area = document.getElementById('chatArea');
  const avatar = avatarHtml || '🤖';
  area.insertAdjacentHTML('beforeend', `
    <div class="message ai" id="replayTyping">
      <div class="msg-avatar">${avatar}</div>
      <div class="msg-body">
        <div class="msg-bubble">
          <div class="typing-indicator"><span></span><span></span><span></span></div>
        </div>
      </div>
    </div>`);
}

/**
 * 移除打字指示器
 */
function removeReplayTyping() {
  const el = document.getElementById('replayTyping');
  if (el) el.remove();
}

/**
 * 可中断的延迟函数，代际不一致时立即返回
 */
function replayDelay(ms, gen) {
  return new Promise(resolve => {
    // 如果代际已经不一致，立即返回
    if (gen !== _replayGen) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    // 每 50ms 检查代际是否被更改
    const check = setInterval(() => {
      if (gen !== _replayGen) { clearInterval(check); clearTimeout(timer); resolve(); }
    }, 50);
  });
}



    window.toggleReplay = toggleReplay;
window.buildReplayUnits = buildReplayUnits;
window.startReplay = startReplay;
window.stopReplay = stopReplay;
window.finishReplay = finishReplay;
window.createReplayAiMsgContainer = createReplayAiMsgContainer;
window.appendReplayUserMessage = appendReplayUserMessage;
window.appendReplayAiMessage = appendReplayAiMessage;
window.appendReplaySpeakerSegment = appendReplaySpeakerSegment;
window.showReplayTyping = showReplayTyping;
window.removeReplayTyping = removeReplayTyping;
window.replayDelay = replayDelay;