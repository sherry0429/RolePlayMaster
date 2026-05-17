
/**
 * 流式 AI 请求
 * 自动拆分模块
 * 保持全局兼容模式
 */

async function requestAI(extraMessages) {
  if (isStreaming || isCompressing) return;
  var chat = appData.chats[currentChatId];
  if (!chat) return;

  var apiKey = appData.settings.apiKey;
  if (!apiKey) {
    showToast('请先设置 API Key', 'error');
    return;
  }

  var apiHost = appData.settings.apiHost || DEFAULT_API_HOST;
  var url = apiHost.replace(/\/+$/, '') + '/chat/completions';

  // 构建消息列表：当前 system prompt + sp 版本索引后的消息
  var sp = getCurrentSpVersion();
  var messages = [];
  if (sp.content) {
    messages.push({ role: 'system', content: sp.content });
  }
  // 从 sp.lastIndex + 1 开始取消息
  var startIdx = sp.lastIndex + 1;
  for (var i = startIdx; i < chat.messages.length; i++) {
    messages.push({ role: chat.messages[i].role, content: chat.messages[i].content });
  }
  // 如果有额外上下文消息（不保存到 chat.messages），追加到最后
  if (extraMessages && extraMessages.length > 0) {
    for (var ei = 0; ei < extraMessages.length; ei++) {
      messages.push(extraMessages[ei]);
    }
  }

  // 记录本次请求日志
  addProgramLog(LOG_TYPE_REQUEST, {
    summary: 'AI 对话请求',
    chatName: chat.name,
    detail: messages
  });

  // 添加 AI 占位消息
  chat.messages.push({ role: 'assistant', content: '' });
  var aiMsgIdx = chat.messages.length - 1;
  saveData();
  renderMessages();

  isStreaming = true;
  _streamingScrolledOnce = false; // 重置首次滚动标记
  document.getElementById('sendBtn').style.display = 'none';
  document.getElementById('stopBtn').style.display = 'flex';
  abortController = new AbortController();

  try {
    var response = await fetch(url, {
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
      var errText = await response.text();
      throw new Error(`API 错误 ${response.status}: ${errText}`);
    }

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    while (true) {
      var { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (var line of lines) {
        var trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        var data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;

        try {
          var json = JSON.parse(data);
          var delta = json.choices?.[0]?.delta?.content;
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

    // 检查 AI 回复中是否有自动拍照触发标签（仅群聊场景）
    if (chat && chat.characters && chat.characters.length > 0 && chat.messages[aiMsgIdx] && chat.messages[aiMsgIdx].content) {
      var rawContent = chat.messages[aiMsgIdx].content;
      var parsed = extractAndStripPhotoTrigger(rawContent);
      if (parsed.triggerCharacters && parsed.triggerCharacters.length > 0) {
        // 有拍照触发：剥离标签后保存，异步触发拍照
        chat.messages[aiMsgIdx].content = parsed.cleanContent;
        var chars = parsed.triggerCharacters;
        for (var pi = 0; pi < chars.length; pi++) {
          var char = chars[pi];
          addProgramLog(LOG_TYPE_PHOTO, {
            summary: 'AI 自动触发拍照（' + char + '）',
            chatName: chat.name,
            detail: '由 AI 回复末尾的 trigger 标签自动触发，角色：' + char
          });
          showToast('📸 ' + char + ' 开始拍照...', 'success');
          // 每个拍照按顺序错开延迟，避免并发冲突
          (function(c) {
            setTimeout(function() {
              triggerTakePhoto(c);
            }, 100 + pi * 500);
          })(char);
        }
      }
    }

    saveData();
    renderMessages();
    // 检查是否需要摘要压缩
    checkCompress();
  }
}

// 流式阶段增量更新：记录已渲染的 segment 摘要，避免重绘已完成的气泡
var _streamingCache = null; // { msgIdx, segments: [{speaker, textLen}] }
var _streamingScrolledOnce = false; // 当前流式输出是否已触发过首次自动滚动

function updateStreamingMessage(idx, content) {
  // 剥离拍照触发标签（仅用于显示，不保存到 chat.messages）
  content = content.replace(/<trigger\s+type="photo"\s+character="[^"]*"\s*\/>/g, '').trim();
  if (!content) return;

  var msgEl = document.querySelector(`.message[data-idx="${idx}"] .msg-body`);
  if (!msgEl) return;

  var speakerMode = appData.settings.speakerMode !== false;

  if (speakerMode && hasSpeakerTags(content)) {
    // 解析当前内容为 segment 列表
    var newSegments = parseSpeakerSegments(content);

    if (newSegments.length === 0) {
      // 没有 segment，回退到普通渲染
      var bubble = msgEl.querySelector('.msg-bubble');
      if (bubble) bubble.innerHTML = renderMarkdown(content);
      _streamingCache = null;
      if (!_streamingScrolledOnce) { scrollToBottom(); _streamingScrolledOnce = true; }
      return;
    }

    // 确保 msg-actions 存在
    var actionsEl = msgEl.querySelector('.msg-actions');
    if (!actionsEl) {
      actionsEl = document.createElement('div');
      actionsEl.className = 'msg-actions';
      actionsEl.innerHTML = `<button class="msg-action-btn" onclick="editMessage(${idx})">✏️ 编辑</button><button class="msg-action-btn del" onclick="deleteMessage(${idx})">🗑️ 删除</button>`;
      msgEl.appendChild(actionsEl);
    }

    var prevCache = _streamingCache;
    var isNewMessage = !prevCache || prevCache.msgIdx !== idx;

    if (isNewMessage) {
      // 新消息：清空并渲染所有 segment
      // 移除旧的 speaker-segment 和 msg-bubble
      msgEl.querySelectorAll('.speaker-segment, .msg-bubble').forEach(el => el.remove());
      // 重新添加 preamble（【】之前的内容）
      var firstBracket = content.indexOf('【');
      if (firstBracket > 0) {
        var preamble = content.slice(0, firstBracket).trim();
        if (preamble) {
          var segEl = createSpeakerSegmentEl('🤖', null, preamble, idx);
          msgEl.insertBefore(segEl, actionsEl);
        }
      }
      // 添加所有 segment
      newSegments.forEach((seg, i) => {
        var segEl = createSpeakerSegmentEl(null, seg.speaker, seg.text, idx);
        segEl.dataset.segIdx = i;
        msgEl.insertBefore(segEl, actionsEl);
      });
      _streamingCache = { msgIdx: idx, segments: newSegments.map(s => ({ speaker: s.speaker, textLen: s.text.length })) };
      // 首次渲染 segment 时触发一次自动滚动
      if (!_streamingScrolledOnce) { scrollToBottom(); _streamingScrolledOnce = true; }
    } else {
      // 同一条消息的增量更新
      var prevSegments = prevCache.segments;
      var segEls = msgEl.querySelectorAll('.speaker-segment');
      var actionsAnchor = actionsEl;

      // 处理 preamble（第一个无 data-seg-idx 的 segment）
      // 检查是否有 preamble 变化（一般不会有，因为【】之前的内容在流式阶段不会增加）

      // 更新/添加 segment
      for (var i = 0; i < newSegments.length; i++) {
        var newSeg = newSegments[i];
        var prevSeg = prevSegments[i];

        if (i < prevSegments.length && prevSeg.speaker === newSeg.speaker) {
          // 已存在的 segment：只更新最后一个的文字（如果长度变了）
          var segEl = msgEl.querySelector(`.speaker-segment[data-seg-idx="${i}"]`);
          if (segEl) {
            segEl.classList.add('no-anim'); // 增量更新时不重播动画
            if (newSeg.text.length !== prevSeg.textLen) {
              var bubbleEl = segEl.querySelector('.speaker-bubble');
              if (bubbleEl) {
                bubbleEl.innerHTML = renderMarkdown(newSeg.text);
              }
            }
          }
        } else if (i < prevSegments.length) {
          // speaker 变了（流式中间插入了新的【】），需要重建此 segment
          var segEl = msgEl.querySelector(`.speaker-segment[data-seg-idx="${i}"]`);
          if (segEl) {
            segEl.classList.add('no-anim');
            var charInfo = findCharacter(newSeg.speaker);
            var avatarHtml = charInfo && charInfo.avatar
              ? `<img src="${escHtml(charInfo.avatar)}" alt="${escHtml(newSeg.speaker)}">`
              : `<span>${escHtml(newSeg.speaker.charAt(0))}</span>`;
            segEl.querySelector('.msg-avatar').innerHTML = avatarHtml;
            segEl.querySelector('.speaker-name').textContent = newSeg.speaker;
            var bubbleEl = segEl.querySelector('.speaker-bubble');
            if (bubbleEl) bubbleEl.innerHTML = renderMarkdown(newSeg.text);
          }
        } else {
          // 新增 segment：追加 DOM
          var segEl = createSpeakerSegmentEl(null, newSeg.speaker, newSeg.text, idx);
          segEl.dataset.segIdx = i;
          msgEl.insertBefore(segEl, actionsAnchor);
        }
      }

      // 删除多余的旧 segment（不会常见，但防御性处理）
      var existingSegEls = msgEl.querySelectorAll('.speaker-segment[data-seg-idx]');
      existingSegEls.forEach(el => {
        var si = parseInt(el.dataset.segIdx);
        if (si >= newSegments.length) el.remove();
      });

      _streamingCache.segments = newSegments.map(s => ({ speaker: s.speaker, textLen: s.text.length }));
    }
  } else {
    // 普通消息（无说话人标签）：只更新 bubble 内容
    var bubble = msgEl.querySelector('.msg-bubble');
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
  var regex = /【(.+?)】([\s\S]*?)(?=【.+?】|$)/g;
  var match;
  var segments = [];
  while ((match = regex.exec(content)) !== null) {
    var speaker = match[1];
    var text = match[2].trim();
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
  var div = document.createElement('div');
  div.className = 'speaker-segment';

  var avatarDiv = document.createElement('div');
  avatarDiv.className = 'msg-avatar';

  if (speaker) {
    var charInfo = findCharacter(speaker);
    if (charInfo && charInfo.avatar) {
      avatarDiv.innerHTML = `<img src="${escHtml(charInfo.avatar)}" alt="${escHtml(speaker)}">`;
    } else {
      avatarDiv.innerHTML = `<span>${escHtml(speaker.charAt(0))}</span>`;
    }
  } else {
    avatarDiv.textContent = fallbackAvatar || '🤖';
  }

  var contentDiv = document.createElement('div');

  if (speaker) {
    var nameDiv = document.createElement('div');
    nameDiv.className = 'speaker-name';
    nameDiv.textContent = speaker;
    contentDiv.appendChild(nameDiv);
  }

  var bubbleDiv = document.createElement('div');
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

/**
 * 从 AI 回复内容中提取并剥离拍照触发 XML 标签
 * 标签格式：<trigger type="photo" character="角色名" />
 * 标签必须在回复末尾才生效，支持多个标签连续出现（多角色场景）
 * @param {string} content - AI 原始回复内容
 * @returns {{ cleanContent: string, triggerCharacters: string[] }}
 */
function extractAndStripPhotoTrigger(content) {
  var triggerRegex = /<trigger\s+type="photo"\s+character="([^"]+)"\s*\/>\s*$/;
  var characters = [];
  var remaining = content;
  var match;

  // 循环剥离末尾的拍照标签，直到没有更多标签
  while ((match = remaining.match(triggerRegex)) !== null) {
    characters.unshift(match[1]); // unshift 保持标签从左到右的顺序
    remaining = remaining.replace(triggerRegex, '').trim();
  }

  return { cleanContent: remaining, triggerCharacters: characters };
}

