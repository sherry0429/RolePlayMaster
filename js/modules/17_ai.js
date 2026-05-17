// 模块: 流式 AI 请求

    async function requestAI() {
  if (isStreaming || isCompressing) return;
  const chat = appData.chats[currentChatId];
  if (!chat) return;

  const apiKey = appData.settings.apiKey;
  if (!apiKey) {
    showToast('请先设置 API Key', 'error');
    return;
  }

  const apiHost = appData.settings.apiHost || DEFAULT_API_HOST;
  const url = apiHost.replace(/\/+$/, '') + '/chat/completions';

  // 构建消息列表：当前 system prompt + sp 版本索引后的消息
  const sp = getCurrentSpVersion();
  const messages = [];
  if (sp.content) {
    messages.push({ role: 'system', content: sp.content });
  }
  // 从 sp.lastIndex + 1 开始取消息
  const startIdx = sp.lastIndex + 1;
  for (let i = startIdx; i < chat.messages.length; i++) {
    messages.push({ role: chat.messages[i].role, content: chat.messages[i].content });
  }

  // 记录本次请求日志（深拷贝，最多保留 3 条）
  requestLog.push({
    time: new Date().toLocaleString(),
    chatId: currentChatId,
    chatName: chat.name,
    messages: JSON.parse(JSON.stringify(messages))
  });
  if (requestLog.length > 3) {
    requestLog = requestLog.slice(-3);
  }

  // 添加 AI 占位消息
  chat.messages.push({ role: 'assistant', content: '' });
  const aiMsgIdx = chat.messages.length - 1;
  saveData();
  renderMessages();

  isStreaming = true;
  _streamingScrolledOnce = false; // 重置首次滚动标记
  document.getElementById('sendBtn').style.display = 'none';
  document.getElementById('stopBtn').style.display = 'flex';
  abortController = new AbortController();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: messages,
        stream: true
      }),
      signal: abortController.signal
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API 错误 ${response.status}: ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;

        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            chat.messages[aiMsgIdx].content += delta;
            updateStreamingMessage(aiMsgIdx, chat.messages[aiMsgIdx].content);
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      showToast('已中断请求');
    } else {
      console.error('AI 请求失败', e);
      showToast('请求失败: ' + e.message, 'error');
      // 如果 AI 消息为空，移除它
      if (chat.messages[aiMsgIdx] && !chat.messages[aiMsgIdx].content.trim()) {
        chat.messages.splice(aiMsgIdx, 1);
      }
    }
  } finally {
    isStreaming = false;
    _streamingCache = null; // 清除流式增量缓存
    document.getElementById('sendBtn').style.display = 'flex';
    document.getElementById('stopBtn').style.display = 'none';
    abortController = null;
    saveData();
    renderMessages();
    // 检查是否需要摘要压缩
    checkCompress();
  }
}

// 流式阶段增量更新：记录已渲染的 segment 摘要，避免重绘已完成的气泡
let _streamingCache = null; // { msgIdx, segments: [{speaker, textLen}] }
let _streamingScrolledOnce = false; // 当前流式输出是否已触发过首次自动滚动

function updateStreamingMessage(idx, content) {
  const msgEl = document.querySelector(`.message[data-idx="${idx}"] .msg-body`);
  if (!msgEl) return;

  const speakerMode = appData.settings.speakerMode !== false;

  if (speakerMode && hasSpeakerTags(content)) {
    // 解析当前内容为 segment 列表
    const newSegments = parseSpeakerSegments(content);

    if (newSegments.length === 0) {
      // 没有 segment，回退到普通渲染
      const bubble = msgEl.querySelector('.msg-bubble');
      if (bubble) bubble.innerHTML = renderMarkdown(content);
      _streamingCache = null;
      if (!_streamingScrolledOnce) { scrollToBottom(); _streamingScrolledOnce = true; }
      return;
    }

    // 确保 msg-actions 存在
    let actionsEl = msgEl.querySelector('.msg-actions');
    if (!actionsEl) {
      actionsEl = document.createElement('div');
      actionsEl.className = 'msg-actions';
      actionsEl.innerHTML = `<button class="msg-action-btn" onclick="editMessage(${idx})">✏️ 编辑</button><button class="msg-action-btn del" onclick="deleteMessage(${idx})">🗑️ 删除</button>`;
      msgEl.appendChild(actionsEl);
    }

    const prevCache = _streamingCache;
    const isNewMessage = !prevCache || prevCache.msgIdx !== idx;

    if (isNewMessage) {
      // 新消息：清空并渲染所有 segment
      // 移除旧的 speaker-segment 和 msg-bubble
      msgEl.querySelectorAll('.speaker-segment, .msg-bubble').forEach(el => el.remove());
      // 重新添加 preamble（【】之前的内容）
      const firstBracket = content.indexOf('【');
      if (firstBracket > 0) {
        const preamble = content.slice(0, firstBracket).trim();
        if (preamble) {
          const segEl = createSpeakerSegmentEl('🤖', null, preamble, idx);
          msgEl.insertBefore(segEl, actionsEl);
        }
      }
      // 添加所有 segment
      newSegments.forEach((seg, i) => {
        const segEl = createSpeakerSegmentEl(null, seg.speaker, seg.text, idx);
        segEl.dataset.segIdx = i;
        msgEl.insertBefore(segEl, actionsEl);
      });
      _streamingCache = { msgIdx: idx, segments: newSegments.map(s => ({ speaker: s.speaker, textLen: s.text.length })) };
      // 首次渲染 segment 时触发一次自动滚动
      if (!_streamingScrolledOnce) { scrollToBottom(); _streamingScrolledOnce = true; }
    } else {
      // 同一条消息的增量更新
      const prevSegments = prevCache.segments;
      const segEls = msgEl.querySelectorAll('.speaker-segment');
      const actionsAnchor = actionsEl;

      // 处理 preamble（第一个无 data-seg-idx 的 segment）
      // 检查是否有 preamble 变化（一般不会有，因为【】之前的内容在流式阶段不会增加）

      // 更新/添加 segment
      for (let i = 0; i < newSegments.length; i++) {
        const newSeg = newSegments[i];
        const prevSeg = prevSegments[i];

        if (i < prevSegments.length && prevSeg.speaker === newSeg.speaker) {
          // 已存在的 segment：只更新最后一个的文字（如果长度变了）
          const segEl = msgEl.querySelector(`.speaker-segment[data-seg-idx="${i}"]`);
          if (segEl) {
            segEl.classList.add('no-anim'); // 增量更新时不重播动画
            if (newSeg.text.length !== prevSeg.textLen) {
              const bubbleEl = segEl.querySelector('.speaker-bubble');
              if (bubbleEl) {
                bubbleEl.innerHTML = renderMarkdown(newSeg.text);
              }
            }
          }
        } else if (i < prevSegments.length) {
          // speaker 变了（流式中间插入了新的【】），需要重建此 segment
          const segEl = msgEl.querySelector(`.speaker-segment[data-seg-idx="${i}"]`);
          if (segEl) {
            segEl.classList.add('no-anim');
            const charInfo = findCharacter(newSeg.speaker);
            const avatarHtml = charInfo && charInfo.avatar
              ? `<img src="${escHtml(charInfo.avatar)}" alt="${escHtml(newSeg.speaker)}">`
              : `<span>${escHtml(newSeg.speaker.charAt(0))}</span>`;
            segEl.querySelector('.msg-avatar').innerHTML = avatarHtml;
            segEl.querySelector('.speaker-name').textContent = newSeg.speaker;
            const bubbleEl = segEl.querySelector('.speaker-bubble');
            if (bubbleEl) bubbleEl.innerHTML = renderMarkdown(newSeg.text);
          }
        } else {
          // 新增 segment：追加 DOM
          const segEl = createSpeakerSegmentEl(null, newSeg.speaker, newSeg.text, idx);
          segEl.dataset.segIdx = i;
          msgEl.insertBefore(segEl, actionsAnchor);
        }
      }

      // 删除多余的旧 segment（不会常见，但防御性处理）
      const existingSegEls = msgEl.querySelectorAll('.speaker-segment[data-seg-idx]');
      existingSegEls.forEach(el => {
        const si = parseInt(el.dataset.segIdx);
        if (si >= newSegments.length) el.remove();
      });

      _streamingCache.segments = newSegments.map(s => ({ speaker: s.speaker, textLen: s.text.length }));
    }
  } else {
    // 普通消息（无说话人标签）：只更新 bubble 内容
    const bubble = msgEl.querySelector('.msg-bubble');
    if (bubble) {
      bubble.innerHTML = renderMarkdown(content);
    }
    _streamingCache = null;
  }

  // 只有首次才自动滚动，后续增量更新不滚动，避免消息一直往下刷
  if (!_streamingScrolledOnce) { scrollToBottom(); _streamingScrolledOnce = true; }
}

/**
 * 解析说话人段落（纯数据，不生成 HTML）
 */
function parseSpeakerSegments(content) {
  const regex = /【(.+?)】([\s\S]*?)(?=【.+?】|$)/g;
  let match;
  const segments = [];
  while ((match = regex.exec(content)) !== null) {
    const speaker = match[1];
    const text = match[2].trim();
    if (text) {
      segments.push({ speaker, text });
    }
  }
  return segments;
}

/**
 * 创建单个 speaker-segment 的 DOM 元素（流式阶段用）
 */
function createSpeakerSegmentEl(fallbackAvatar, speaker, text, msgIdx) {
  const div = document.createElement('div');
  div.className = 'speaker-segment';

  const avatarDiv = document.createElement('div');
  avatarDiv.className = 'msg-avatar';

  if (speaker) {
    const charInfo = findCharacter(speaker);
    if (charInfo && charInfo.avatar) {
      avatarDiv.innerHTML = `<img src="${escHtml(charInfo.avatar)}" alt="${escHtml(speaker)}">`;
    } else {
      avatarDiv.innerHTML = `<span>${escHtml(speaker.charAt(0))}</span>`;
    }
  } else {
    avatarDiv.textContent = fallbackAvatar || '🤖';
  }

  const contentDiv = document.createElement('div');

  if (speaker) {
    const nameDiv = document.createElement('div');
    nameDiv.className = 'speaker-name';
    nameDiv.textContent = speaker;
    contentDiv.appendChild(nameDiv);
  }

  const bubbleDiv = document.createElement('div');
  bubbleDiv.className = 'speaker-bubble';
  bubbleDiv.innerHTML = renderMarkdown(text);
  contentDiv.appendChild(bubbleDiv);

  div.appendChild(avatarDiv);
  div.appendChild(contentDiv);

  return div;
}

function stopStreaming() {
  if (abortController) {
    abortController.abort();
  }
}



    window.requestAI = requestAI;
window.updateStreamingMessage = updateStreamingMessage;
window.parseSpeakerSegments = parseSpeakerSegments;
window.createSpeakerSegmentEl = createSpeakerSegmentEl;
window.stopStreaming = stopStreaming;