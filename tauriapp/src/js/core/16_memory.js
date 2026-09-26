
/**
 * 摘要压缩（动态 System Prompt）
 * 自动拆分模块
 * 保持全局兼容模式
 */

function getCurrentSpVersion() {
  if (!currentChatId || !appData.chats[currentChatId]) return { content: '', lastIndex: -1 };
  var chat = appData.chats[currentChatId];
  var vi = chat.spViewIndex;
  if (vi >= 0 && vi < chat.spVersions.length) {
    return chat.spVersions[vi];
  }
  return chat.spVersions[0] || { content: '', lastIndex: -1 };
}

/**
 * 清理并修复 AI 返回的 system_prompt
 * 1. 去除 ```...``` 代码块包裹
 * 2. 如果 AI 返回了 JSON 格式（如 {"system_prompt": "..."}），提取其中的值
 * 3. 去除多余的前导文字（AI 可能输出 "好的，这是..." 之类的）
 * 4. 如果缺少 # 任务定义 或 # 回复样例，从 previousSp 中补充
 */
function cleanAndRepairSp(raw, previousSp) {
  if (!raw) return raw;

  var cleaned = raw.trim();

  // 第一步：去除 ```...``` 代码块包裹（支持 ```json、```markdown 等）
  cleaned = cleaned.replace(/^```[a-zA-Z]*\s*\n?/i, '');
  cleaned = cleaned.replace(/\n?```\s*$/i, '');
  cleaned = cleaned.trim();

  // 第二步：检测并提取 JSON 格式的内容
  // AI 可能返回 {"system_prompt": "..."} 或 {"content": "..."} 等 JSON 结构
  if (/^[\{\[]/.test(cleaned)) {
    try {
      var jsonObj = JSON.parse(cleaned);
      // 尝试常见字段名
      var extracted = jsonObj.system_prompt || jsonObj.systemPrompt
        || jsonObj.content || jsonObj.prompt || jsonObj.text || '';
      if (extracted && typeof extracted === 'string') {
        cleaned = extracted.trim();
      }
    } catch (e) {
      // JSON 解析失败，尝试正则提取 system_prompt 值
      var spMatch = cleaned.match(/"system_prompt"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
      if (spMatch) {
        try {
          // 将 JSON 字符串中的转义序列还原
          cleaned = JSON.parse('"' + spMatch[1] + '"').trim();
        } catch (e2) {
          // 正则提取也失败，保留原文本
        }
      }
    }
  }

  // 第三步：去除多余的前导文字，截取从第一个 # 标题开始
  var firstHeadingIdx = cleaned.search(/^#\s+/m);
  if (firstHeadingIdx > 0) {
    cleaned = cleaned.substring(firstHeadingIdx).trim();
  }

  // 第四步：从 previousSp 提取各 section，补充缺失部分
  var prevTaskDef = extractSection(previousSp, '任务定义');
  var prevReplyExample = extractSection(previousSp, '回复样例');

  // 检查是否缺少 # 任务定义
  var hasTaskDef = /^#\s*任务定义/m.test(cleaned);
  if (!hasTaskDef && prevTaskDef) {
    cleaned = '# 任务定义\n' + prevTaskDef + '\n\n' + cleaned;
  }

  // 检查是否缺少 # 回复样例
  var hasReplyExample = /^#\s*回复样例/m.test(cleaned);
  if (!hasReplyExample && prevReplyExample) {
    cleaned = cleaned.trimEnd() + '\n\n# 回复样例\n' + prevReplyExample;
  }

  return cleaned;
}

/**
 * 从 system_prompt 文本中提取指定 section 的内容（不含标题行）
 */
function extractSection(spText, sectionName) {
  if (!spText) return '';
  var regex = new RegExp(`^#\\s*${sectionName}\\s*\\n([\\s\\S]*?)(?=^#\\s|$(?!\\n))`, 'm');
  var match = spText.match(regex);
  return match ? match[1].trim() : '';
}

/**
 * 从 system_prompt 文本中删除指定 section（含标题行）
 */
function removeSection(spText, sectionName) {
  if (!spText) return '';
  var regex = new RegExp(`^#\\s*${sectionName}\\s*\\n([\\s\\S]*?)(?=^#\\s|$)`, 'm');
  return spText.replace(regex, '').replace(/\n{3,}/g, '\n\n').trim();
}

function checkCompress() {
  if (!currentChatId) return;
  var chat = appData.chats[currentChatId];
  var sp = getCurrentSpVersion();
  var threshold = appData.settings.compressThreshold || COMPRESS_THRESHOLD;
  // 计算从 sp.lastIndex 之后有多少条消息
  var msgCount = chat.messages.length - (sp.lastIndex + 1);
  if (msgCount >= threshold) {
    compressChat();
  }
}

async function compressChat() {
  if (!currentChatId || isCompressing) return;
  var chat = appData.chats[currentChatId];
  var apiKey = appData.settings.apiKey;
  if (!apiKey) return; // 没有 key 无法压缩

  var sp = getCurrentSpVersion();
  var startIdx = sp.lastIndex + 1;
  var msgsToCompress = chat.messages.slice(startIdx);

  if (msgsToCompress.length === 0) return;

  // 锁定界面
  isCompressing = true;
  document.getElementById('compressOverlay').classList.add('show');

  var apiHost = appData.settings.apiHost || DEFAULT_API_HOST;
  var url = apiHost.replace(/\/+$/, '') + '/chat/completions';

  // 构建压缩请求
  var compressMessages = [];
  if (sp.content) {
    compressMessages.push({ role: 'system', content: sp.content });
  }
  for (var m of msgsToCompress) {
    compressMessages.push({ role: m.role, content: m.content });
  }
  compressMessages.push({
    role: 'user',
    content: getMemoryPrompt()
  });

  // 记录压缩日志
  addProgramLog(LOG_TYPE_MEMORY, {
    summary: '触发记忆压缩',
    chatName: chat.name + LOG_NAME_MEMORY,
    detail: compressMessages
  });

  try {
    var response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: compressMessages,
        stream: false
      })
    });

    if (!response.ok) throw new Error('压缩请求失败');

    var result = await response.json();
    var summary = result.choices?.[0]?.message?.content || '';

    if (summary) {
      // 清理并修复 AI 返回的 system_prompt
      summary = cleanAndRepairSp(summary, sp.content);

      // 如果当前查看的不是最新版本，删除当前版本之后的所有版本
      var currentVi = chat.spViewIndex;
      chat.spVersions = chat.spVersions.slice(0, currentVi + 1);

      // 新增一个版本
      var newVersion = chat.spVersions[chat.spVersions.length - 1].version + 1;
      chat.spVersions.push({
        version: newVersion,
        content: summary,
        lastIndex: chat.messages.length - 1
      });
      chat.spViewIndex = chat.spVersions.length - 1;
      saveData();
      updateSpDisplay();
      showToast('记忆已更新至 v' + newVersion, 'success');
    }
  } catch (e) {
    console.error('压缩失败', e);
    showToast('记忆整理失败', 'error');
  } finally {
    // 关闭遮罩，让用户看到界面
    document.getElementById('compressOverlay').classList.remove('show');
    // updateSpDisplay 在成功分支已调用，淡入动画 200ms；等动画结束后再解锁
    setTimeout(() => {
      isCompressing = false;
    }, 400);
  }
}

