
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

  // 情绪动画 function calling：聊天中的角色配有动画时，下发 show_emotion 工具，
  // emotion 参数用 enum 限定为当前角色已有的情绪（不含待机，待机自动回退）。
  var emotionTool = (typeof buildEmotionTool === 'function') ? buildEmotionTool(chat) : null;
  var requestBody = {
    model: DEFAULT_MODEL,
    messages: messages,
    stream: true
  };
  if (emotionTool) {
    requestBody.tools = [emotionTool.tool];
    requestBody.tool_choice = 'auto';
    // 使用说明作为临时 system 消息追加（不写入聊天记录、不参与记忆压缩）
    var hintPos = (messages[0] && messages[0].role === 'system') ? 1 : 0;
    requestBody.messages.splice(hintPos, 0, { role: 'system', content: emotionTool.hint });
  }

  // AI 自动拍照（function call）：开关开启且图像生成可用时注入 take_photo 工具
  // （与 show_emotion 共用同一套 tool_calls 聚合通道，见 tool_registry.js）
  var photoToolEnabled = shouldInjectPhotoTool();
  if (photoToolEnabled) {
    requestBody.tools = requestBody.tools || [];
    requestBody.tools.push(TAKE_PHOTO_TOOL);
  }

  // 流式返回中的 tool_calls 增量（按 index 分片拼装）
  var pendingToolCalls = [];

  try {
    var response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody),
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
          var delta = json.choices?.[0]?.delta;
          var deltaContent = delta?.content;
          if (deltaContent) {
            chat.messages[aiMsgIdx].content += deltaContent;
            updateStreamingMessage(aiMsgIdx, chat.messages[aiMsgIdx].content);
          }
          // tool_calls 分片：{ index, id?, function: { name?, arguments? } }
          var tcDeltas = delta?.tool_calls;
          if (tcDeltas) {
            for (var ti = 0; ti < tcDeltas.length; ti++) {
              var tcd = tcDeltas[ti];
              var slot = (tcd.index !== undefined) ? tcd.index : pendingToolCalls.length;
              if (!pendingToolCalls[slot]) pendingToolCalls[slot] = { name: '', args: '' };
              if (tcd.function && tcd.function.name) pendingToolCalls[slot].name += tcd.function.name;
              if (tcd.function && tcd.function.arguments) pendingToolCalls[slot].args += tcd.function.arguments;
            }
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

    // AI 自动拍照：take_photo 工具调用（先于情绪处理，空占位消息由各自逻辑清理）
    if (photoToolEnabled) {
      handlePhotoToolCalls(chat, pendingToolCalls, aiMsgIdx);
    }

    // 情绪动画触发：解析模型给出的 show_emotion 调用并入队
    if (pendingToolCalls.length) {
      handleEmotionToolCalls(chat, pendingToolCalls, aiMsgIdx);
    }

    // 日志：AI 回复完成（正文 + 本次使用的工具调用），与「AI 对话请求」配对
    addProgramLog(LOG_TYPE_REQUEST, {
      summary: pendingToolCalls.length
        ? 'AI 回复完成（含 ' + pendingToolCalls.length + ' 次工具调用）'
        : 'AI 回复完成',
      chatName: chat.name,
      detail: {
        content: (chat.messages[aiMsgIdx] && chat.messages[aiMsgIdx].content) || '（仅工具调用，无正文）',
        toolCalls: pendingToolCalls.map(function (c) {
          return { name: c.name, arguments: c.args };
        })
      }
    });

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
  // 全局匹配所有 photo trigger
  var triggerRegex = /<trigger\s+type="photo"\s+character="([^"]+)"\s*\/>/g;

  var characters = [];
  var match;

  // 提取所有角色
  while ((match = triggerRegex.exec(content)) !== null) {
    characters.push(match[1]);
  }

  // 删除所有 trigger 标签
  var cleanContent = content
    .replace(triggerRegex, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    cleanContent,
    triggerCharacters: characters
  };
}


// ==================== 情绪动画 function calling ====================

/**
 * 构建 show_emotion 工具（仅当聊天中的角色配有动画时返回）。
 * emotion 参数用 enum 限定为当前聊天角色已有的情绪（不含待机 —— 待机是回退态）；
 * 群聊时 character 参数用 enum 限定为聊天关联的角色名。
 */
function buildEmotionTool(chat) {
  if (typeof AnimPlayer === 'undefined') return null;
  var chars = (chat.characters && chat.characters.length) ? chat.characters : getChatAvatars();
  var emotionSet = {};
  var nameSet = [];
  var hasAny = false;
  chars.forEach(function (c) {
    if (!c || !c.name) return;
    if (nameSet.indexOf(c.name) < 0) nameSet.push(c.name);
    var lib = findCharacter(c.name);
    if (!lib) return;
    var metas = charAnimations(lib.id);
    Object.keys(metas).forEach(function (e) {
      if (e !== ANIM_IDLE_EMOTION) { emotionSet[e] = true; hasAny = true; }
    });
  });
  if (!hasAny) return null;

  var emotions = Object.keys(emotionSet);
  var multi = nameSet.length > 1;
  var tool = {
    type: 'function',
    function: {
      name: 'show_emotion',
      description: '让角色播放一段情绪/动作动画（约2秒，播放完自动回到待机）。' +
        '在回复文字的同时按需调用，不要为了调用而调用；一次调用表达一种情绪。',
      parameters: {
        type: 'object',
        properties: {
          emotion: {
            type: 'string',
            enum: emotions,
            description: '要播放的情绪/动作，只能从列表中选择'
          },
          character: multi
            ? { type: 'string', enum: nameSet, description: '角色名（群聊必填，指明是哪个角色做这个表情）' }
            : { type: 'string', description: '角色名，单角色聊天可省略' }
        },
        required: ['emotion']
      }
    }
  };
  var hint = '【情绪动画】当前聊天支持以下情绪动画：' + emotions.join('、') + '。' +
    '当角色的情绪或动作与列表明显匹配时，在回复的同时调用 show_emotion 播放动画' +
    (multi ? '，群聊必须通过 character 参数指明角色' : '') +
    '。列表之外的情绪不要调用（系统会自动回退到待机动画），也不必每条回复都调用。';
  return { tool: tool, hint: hint };
}

/**
 * 处理模型输出的 show_emotion 调用：
 * 校验角色/情绪 → 加入该角色（按角色 ID 命名空间）的动画队列；
 * 找不到对应动画 → 回退待机（不入队），仅记日志。
 */
function handleEmotionToolCalls(chat, calls, aiMsgIdx) {
  if (!chat) return;
  for (var i = 0; i < calls.length; i++) {
    var call = calls[i];
    if (!call || call.name !== 'show_emotion') continue;
    var args = {};
    try { args = JSON.parse(call.args || '{}'); } catch (e) { /* 参数不完整，忽略 */ }
    var emotion = String(args.emotion || '').trim();
    if (!emotion) continue;

    var targets = [];
    if (args.character) {
      targets = [String(args.character)];
    } else if (chat.characters && chat.characters.length) {
      targets = chat.characters.map(function (c) { return c.name; });
    } else {
      targets = getChatAvatars().map(function (c) { return c.name; }).filter(Boolean);
    }

    for (var t = 0; t < targets.length; t++) {
      var lib = findCharacter(targets[t]);
      if (!lib) continue;
      var ok = (typeof AnimPlayer !== 'undefined') && AnimPlayer.trigger(lib.id, emotion);
      addProgramLog(LOG_TYPE_INFO, {
        summary: '情绪动画（' + targets[t] + ' → ' + emotion + '）',
        chatName: chat.name,
        detail: ok ? '已加入该角色的动画队列' : '该角色没有此情绪的动画，回退待机'
      });
      if (!ok) break;   // 该角色没这个动画，不必对同一目标重复尝试
    }
  }

  // 模型只调了工具、没输出文字时，移除空占位消息
  if (chat.messages[aiMsgIdx] && !chat.messages[aiMsgIdx].content.trim()) {
    chat.messages.splice(aiMsgIdx, 1);
  }
}
