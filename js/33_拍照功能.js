
/**
 * 拍照功能
 * 自动拆分模块
 * 保持全局兼容模式
 * 
 * 功能：不污染聊天记录，请求 AI 推算角色当前外貌，生成图像 prompt，
 * 调用 ComfyUI（如果启用）生成图片，直接渲染为图片消息。
 */

/**
 * 触发拍照（入口函数）
 * 点击「拍照」按钮或输入 /拍照 命令时调用
 */
async function triggerTakePhoto() {
  // 状态检查
  if (isStreaming || isCompressing || isPhotoShooting || isReplaying) {
    showToast('请等待当前操作完成', 'error');
    return;
  }
  if (!currentChatId) {
    showToast('请先开始一个对话', 'error');
    return;
  }
  var chat = appData.chats[currentChatId];
  if (!chat || chat.messages.length === 0) {
    showToast('请先发送一些消息再拍照', 'error');
    return;
  }

  var apiKey = appData.settings.apiKey;
  if (!apiKey) {
    showToast('请先设置 API Key', 'error');
    return;
  }

  isPhotoShooting = true;
  photoAbortController = new AbortController();

  // 显示拍摄进度条
  showPhotoProgress('🤳 正在构思画面...');

  try {
    // 1. 构建 AI 请求消息
    var sp = getCurrentSpVersion();
    var messages = buildPhotoRequestMessages(chat, sp);

    // 记录日志（仅用于调试）
    requestLog.push({
      time: new Date().toLocaleString(),
      chatId: currentChatId,
      chatName: chat.name + ' [拍照]',
      messages: JSON.parse(JSON.stringify(messages))
    });
    if (requestLog.length > 3) requestLog = requestLog.slice(-3);

    // 2. 发送 AI 请求，获取生成图像的 prompt
    var apiHost = appData.settings.apiHost || DEFAULT_API_HOST;
    var url = apiHost.replace(/\/+$/, '') + '/chat/completions';

    updatePhotoProgress('🧠 AI 正在分析角色外貌...');

    var response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: messages,
        stream: false
      }),
      signal: photoAbortController.signal
    });

    if (!response.ok) {
      var errText = await response.text();
      throw new Error('AI 请求失败: ' + response.status + ' ' + errText);
    }

    var result = await response.json();
    var aiContent = (result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) || '';
    if (!aiContent) {
      throw new Error('AI 返回内容为空');
    }

    // 3. 解析 AI 返回的 prompts（按分隔符分割）
    var prompts = parsePhotoPrompts(aiContent);
    if (prompts.length === 0) {
      // 如果解析失败，把整个内容当作一个 prompt
      prompts = [{ prompt: aiContent, characterName: extractPhotoCharacter(aiContent, chat) }];
    }

    // 4. 对每个 prompt 生成图片，每生成一张立即渲染
    var comfyuiEnabled = appData.settings.comfyui && appData.settings.comfyui.enabled;
    var photoShootIndex = chat.messages.length; // 记录拍照时的消息位置

    // 确保 photos 数组存在
    if (!chat.photos) chat.photos = [];

    for (var i = 0; i < prompts.length; i++) {
      var item = prompts[i];
      updatePhotoProgress('📸 ' + (item.characterName || '角色') + ' 正在拍摄 (' + (i + 1) + '/' + prompts.length + ')');

      var photoData = null;
      if (comfyuiEnabled && appData.settings.comfyui.workflowJson) {
        // 使用 ComfyUI 生成
        photoData = await callComfyUI(
          item.prompt,
          appData.settings.comfyui.defaultWidth || 512,
          appData.settings.comfyui.defaultHeight || 768,
          photoAbortController.signal
        );
      }

      if (photoData && photoData.dataUrl) {
        var photoObj = {
          id: 'photo_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2, 8),
          dataUrl: photoData.dataUrl,
          prompt: item.prompt,
          characterName: item.characterName || '',
          createdAt: Date.now(),
          afterMessageIndex: photoShootIndex // 记录拍摄时所处的消息位置
        };
        // 保存到相册
        chat.photos.push(photoObj);
        await saveData();
        // 立即渲染这张图片
        renderPhotoMessage(photoObj);
      } else {
        // ComfyUI 失败或未启用，使用文本提示占位
        var fallbackPhotoObj = {
          id: 'photo_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2, 8),
          dataUrl: '',
          prompt: item.prompt,
          characterName: item.characterName || '',
          createdAt: Date.now(),
          afterMessageIndex: photoShootIndex
        };
        chat.photos.push(fallbackPhotoObj);
        await saveData();
        // 即时渲染占位
        renderPhotoMessage(fallbackPhotoObj);
        showToast('图片生成失败（ComfyUI 未响应或未配置）', 'error');
      }
    }

    showToast('已拍摄 ' + prompts.length + ' 张照片', 'success');

  } catch (e) {
    if (e.name === 'AbortError') {
      showToast('拍照已取消');
    } else {
      console.error('拍照失败', e);
      showToast('拍照失败: ' + e.message, 'error');
    }
  } finally {
    isPhotoShooting = false;
    photoAbortController = null;
    hidePhotoProgress();
  }
}

/**
 * 构建拍照用的 AI 请求消息
 */
function buildPhotoRequestMessages(chat, sp) {
  var messages = [];

  // System Prompt
  if (sp && sp.content) {
    messages.push({ role: 'system', content: sp.content });
  }

  // 获取最近的消息（最多 20 条）
  var recentMessages = chat.messages.slice(-20);
  for (var i = 0; i < recentMessages.length; i++) {
    messages.push({
      role: recentMessages[i].role,
      content: recentMessages[i].content
    });
  }

  // 获取聊天关联的角色名
  var charNames = [];
  if (chat.characters && chat.characters.length > 0) {
    charNames = chat.characters.map(function(c) { return c.name; }).filter(Boolean);
  }

  // 获取角色外貌设定（从 SP 中提取）
  var appearanceHint = '';
  if (sp && sp.content) {
    // 尝试提取外貌描述
    var appearanceMatch = sp.content.match(/外貌[：:]([\s\S]*?)(?:\n\n|\n#{1,}|$)/);
    if (appearanceMatch) {
      appearanceHint = appearanceMatch[1].trim();
    }
  }

  var roleList = charNames.length > 0 ? '涉及角色：' + charNames.join('、') + '。' : '';
  var appearanceGuide = appearanceHint ? '角色外貌设定参考：' + appearanceHint : '';

  // 构建拍照指令
  var userContent = '[系统拍照指令]\n';
  userContent += '请根据以上对话中角色的外貌设定和当前聊天的剧情进展，推算每个涉及角色的当前外貌和状态。\n';
  userContent += roleList + '\n';
  userContent += appearanceGuide + '\n';
  userContent += '\n请为每个角色分别返回一段用于图像生成的 prompt（中文，一段描述性文字，不要用英文逗号分隔的词组格式）。\n';
  userContent += '如果有多个角色，用以下分隔符分隔每个角色的 prompt：\n---\n';
  userContent += '每个 prompt 的开头用【角色名】标记，例如：\n';
  userContent += '【林梦】一个穿着白色连衣裙的少女站在樱花树下，阳光透过花瓣洒在她柔顺的黑发上，她微微仰起头，眼神清澈而温柔，面带淡淡的微笑。\n---\n';
  userContent += '【苏晴】一个短发干练的职场女性，穿着深蓝色西装外套，站在落地窗前眺望城市夜景，手中端着一杯咖啡，神情专注而坚定。\n';
  userContent += '\n注意：请直接输出 prompt 内容，不要额外说明。prompt 要使用完整的中文句子描述，而不是标签式的词组。';

  messages.push({ role: 'user', content: userContent });

  return messages;
}

/**
 * 解析 AI 返回的多个 prompt
 * 格式：每段以【角色名】开头，多段用 --- 分隔
 */
function parsePhotoPrompts(content) {
  var prompts = [];

  // 尝试按 --- 分割
  var sections = content.split(/---+/);
  
  sections.forEach(function(section) {
    section = section.trim();
    if (!section) return;

    // 尝试提取【角色名】
    var nameMatch = section.match(/^【(.+?)】/);
    var characterName = nameMatch ? nameMatch[1] : '';
    var promptText = nameMatch ? section.slice(nameMatch[0].length).trim() : section;

    if (promptText) {
      prompts.push({
        prompt: promptText,
        characterName: characterName
      });
    }
  });

  // 如果分割后只有一段或者没有【】标记，尝试整体解析
  if (prompts.length === 0) {
    // 尝试逐行解析【角色名】
    var lineRegex = /【(.+?)】([\s\S]*?)(?=【|$)/g;
    var match;
    while ((match = lineRegex.exec(content)) !== null) {
      var text = match[2].trim();
      if (text) {
        prompts.push({
          prompt: text,
          characterName: match[1]
        });
      }
    }
  }

  return prompts;
}

/**
 * 从内容中提取角色名（回退方案）
 */
function extractPhotoCharacter(content, chat) {
  if (chat.characters && chat.characters.length > 0) {
    for (var i = 0; i < chat.characters.length; i++) {
      if (content.indexOf(chat.characters[i].name) !== -1) {
        return chat.characters[i].name;
      }
    }
    return chat.characters[0].name;
  }
  return '';
}

/**
 * 调用 ComfyUI 生成图片
 */
async function callComfyUI(prompt, width, height, signal) {
  var comfyui = appData.settings.comfyui;
  var serverUrl = comfyui.serverUrl || 'http://127.0.0.1:8188';

  try {
    // 1. 解析工作流 JSON 并替换节点
    var workflow = JSON.parse(comfyui.workflowJson);
    
    // 替换提示词节点
    if (comfyui.nodeIds.prompt) {
      var promptNode = findComfyNodeById(workflow, comfyui.nodeIds.prompt);
      if (promptNode) {
        setComfyNodeInput(promptNode, prompt);
      }
    }
    // 替换宽度节点
    if (comfyui.nodeIds.width) {
      var widthNode = findComfyNodeById(workflow, comfyui.nodeIds.width);
      if (widthNode) {
        setComfyNodeInput(widthNode, width);
      }
    }
    // 替换高度节点
    if (comfyui.nodeIds.height) {
      var heightNode = findComfyNodeById(workflow, comfyui.nodeIds.height);
      if (heightNode) {
        setComfyNodeInput(heightNode, height);
      }
    }

    // 2. 发送 prompt 到 ComfyUI
    var promptResp = await fetch(serverUrl.replace(/\/+$/, '') + '/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
      signal: signal
    });

    if (!promptResp.ok) {
      var errText = await promptResp.text();
      throw new Error('ComfyUI prompt 提交失败: ' + promptResp.status + ' ' + errText);
    }

    var promptResult = await promptResp.json();
    var promptId = promptResult.prompt_id;
    if (!promptId) throw new Error('ComfyUI 未返回 prompt_id');

    // 3. 轮询获取结果（最多 60 秒）
    var pollInterval = 1000; // 1 秒轮询一次
    var maxAttempts = 60;
    var historyUrl = serverUrl.replace(/\/+$/, '') + '/history/' + promptId;

    for (var attempt = 0; attempt < maxAttempts; attempt++) {
      // 等待 1 秒
      await new Promise(function(resolve) {
        setTimeout(resolve, pollInterval);
      });

      // 检查是否被中止
      if (signal && signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      var historyResp = await fetch(historyUrl, { signal: signal });
      if (!historyResp.ok) continue;

      var historyData = await historyResp.json();
      var promptHistory = historyData[promptId];
      if (!promptHistory || !promptHistory.outputs) continue;

      // 提取输出图片
      var outputs = promptHistory.outputs;
      var imageData = null;

      // 遍历所有输出节点，寻找图片
      for (var nodeId in outputs) {
        var nodeOutput = outputs[nodeId];
        if (nodeOutput.images && nodeOutput.images.length > 0) {
          var firstImage = nodeOutput.images[0];
          // 获取图片数据
          var imgResp = await fetch(serverUrl.replace(/\/+$/, '') + '/view?filename=' + encodeURIComponent(firstImage.filename) + '&type=' + (firstImage.type || 'output') + '&subfolder=' + (firstImage.subfolder || ''), {
            signal: signal
          });
          if (imgResp.ok) {
            var blob = await imgResp.blob();
            imageData = await blobToBase64(blob);
          }
          break;
        }
      }

      if (imageData) {
        return { dataUrl: imageData };
      }

      // 检查是否执行失败
      if (promptHistory.status && promptHistory.status.completed === false) {
        break;
      }
    }

    throw new Error('ComfyUI 生成超时（60秒）');
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    console.error('ComfyUI 调用失败', e);
    return null;
  }
}

/**
 * 在工作流中查找指定 ID 的节点
 */
function findComfyNodeById(workflow, nodeId) {
  // ComfyUI 工作流格式: { "节点ID": { "inputs": {...}, "class_type": "..." } }
  return workflow[nodeId] || null;
}

/**
 * 设置 ComfyUI 节点的输入值
 */
function setComfyNodeInput(node, value) {
  if (!node || !node.inputs) return;
  // 尝试找到第一个非连接的输入字段
  for (var key in node.inputs) {
    if (!Array.isArray(node.inputs[key])) {
      node.inputs[key] = value;
      return;
    }
  }
}

/**
 * Blob 转 base64 Data URL
 */
function blobToBase64(blob) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function() { resolve(reader.result); };
    reader.onerror = function() { reject(reader.error); };
    reader.readAsDataURL(blob);
  });
}

/**
 * 渲染单张图片消息（追加到聊天区域，不修改 messages）
 */
function renderPhotoMessage(photoObj) {
  var area = document.getElementById('chatArea');
  if (!area) return;

  var speakerMode = appData.settings.speakerMode !== false;
  var charName = photoObj.characterName || '';

  // 构建头像
  var avatarHtml = '🤖';
  if (speakerMode && charName) {
    var charInfo = findCharacter(charName);
    if (charInfo && charInfo.avatar) {
      avatarHtml = '<img src="' + escHtml(charInfo.avatar) + '" alt="' + escHtml(charName) + '">';
    } else {
      avatarHtml = '<span>' + escHtml(charName.charAt(0) || '?') + '</span>';
    }
  }

  var photoHtml = '';
  if (photoObj.dataUrl) {
    photoHtml = '<img src="' + photoObj.dataUrl + '" alt="拍照" class="photo-message-img" onclick="zoomPhoto(\'' + escHtml(photoObj.id) + '\')">';
  } else {
    photoHtml = '<div style="padding:12px;text-align:center;color:var(--text-secondary);font-size:13px;">📷 ' + escHtml(photoObj.prompt) + '</div>';
  }

  var html = '';
  if (speakerMode && charName) {
    html = '<div class="message ai photo-message" data-photo-id="' + escHtml(photoObj.id) + '">';
    html += '<div class="msg-avatar">' + avatarHtml + '</div>';
    html += '<div class="msg-body">';
    html += '<div class="speaker-segment">';
    html += '<div class="msg-avatar" style="width:30px;height:30px;font-size:12px;">' + avatarHtml + '</div>';
    html += '<div>';
    html += '<div class="speaker-name">' + escHtml(charName) + ' 📷 拍摄了一张照片</div>';
    html += '<div class="speaker-bubble photo-bubble">' + photoHtml + '</div>';
    html += '<div class="msg-actions">';
    html += '<button class="msg-action-btn del" onclick="deletePhotoMessage(\'' + escHtml(photoObj.id) + '\')">🗑️ 删除</button>';
    html += '</div>';
    html += '</div></div></div></div>';
  } else {
    html = '<div class="message ai photo-message" data-photo-id="' + escHtml(photoObj.id) + '">';
    html += '<div class="msg-avatar">🤖</div>';
    html += '<div class="msg-body">';
    html += '<div class="msg-bubble photo-bubble">' + photoHtml + '</div>';
    html += '<div class="msg-actions">';
    html += '<button class="msg-action-btn del" onclick="deletePhotoMessage(\'' + escHtml(photoObj.id) + '\')">🗑️ 删除</button>';
    html += '</div>';
    html += '</div></div>';
  }

  // 追加到末尾
  area.insertAdjacentHTML('beforeend', html);
  scrollToBottom();
}

/**
 * 构建相册图片的消息 HTML（用于 renderMessages 中批量渲染）
 */
function buildPhotoMessageHtml(photoObj) {
  var speakerMode = appData.settings.speakerMode !== false;
  var charName = photoObj.characterName || '';

  var avatarHtml = '🤖';
  if (speakerMode && charName) {
    var charInfo = findCharacter(charName);
    if (charInfo && charInfo.avatar) {
      avatarHtml = '<img src="' + escHtml(charInfo.avatar) + '" alt="' + escHtml(charName) + '">';
    } else {
      avatarHtml = '<span>' + escHtml(charName.charAt(0) || '?') + '</span>';
    }
  }

  var photoHtml = '';
  if (photoObj.dataUrl) {
    photoHtml = '<img src="' + photoObj.dataUrl + '" alt="拍照" class="photo-message-img" onclick="zoomPhoto(\'' + escHtml(photoObj.id) + '\')">';
  } else {
    photoHtml = '<div style="padding:12px;text-align:center;color:var(--text-secondary);font-size:13px;">📷 ' + escHtml(photoObj.prompt) + '</div>';
  }

  var html = '';
  if (speakerMode && charName) {
    html = '<div class="message ai photo-message" data-photo-id="' + escHtml(photoObj.id) + '">';
    html += '<div class="msg-avatar" style="display:none;"></div>';
    html += '<div class="msg-body">';
    html += '<div class="speaker-segment">';
    html += '<div class="msg-avatar" style="width:30px;height:30px;font-size:12px;">' + avatarHtml + '</div>';
    html += '<div>';
    html += '<div class="speaker-name">' + escHtml(charName) + ' 📷 拍摄了一张照片</div>';
    html += '<div class="speaker-bubble photo-bubble">' + photoHtml + '</div>';
    html += '<div class="msg-actions">';
    html += '<button class="msg-action-btn del" onclick="deletePhotoMessage(\'' + escHtml(photoObj.id) + '\')">🗑️ 删除</button>';
    html += '</div>';
    html += '</div></div></div></div>';
  } else {
    html = '<div class="message ai photo-message" data-photo-id="' + escHtml(photoObj.id) + '">';
    html += '<div class="msg-avatar">🤖</div>';
    html += '<div class="msg-body">';
    html += '<div class="msg-bubble photo-bubble">' + photoHtml + '</div>';
    html += '<div class="msg-actions">';
    html += '<button class="msg-action-btn del" onclick="deletePhotoMessage(\'' + escHtml(photoObj.id) + '\')">🗑️ 删除</button>';
    html += '</div>';
    html += '</div></div>';
  }

  return html;
}

/**
 * 显示拍摄进度条
 */
function showPhotoProgress(text) {
  var existing = document.getElementById('photoProgressBar');
  if (!existing) return;
  existing.style.display = 'flex';
  document.getElementById('photoProgressText').textContent = text || '📸 拍摄中...';
  document.getElementById('photoProgressFill').style.animation = 'progressIndeterminate 1.5s infinite';
}

/**
 * 更新拍摄进度文字
 */
function updatePhotoProgress(text) {
  var el = document.getElementById('photoProgressText');
  if (el) el.textContent = text || '📸 拍摄中...';
}

/**
 * 隐藏拍摄进度条
 */
function hidePhotoProgress() {
  var existing = document.getElementById('photoProgressBar');
  if (!existing) return;
  existing.style.display = 'none';
}

/**
 * 删除照片消息（同时从聊天区域和相册中删除）
 */
function deletePhotoMessage(photoId) {
  // 复用相册的删除逻辑
  deleteAlbumPhoto(photoId);
}

/**
 * 放大查看照片（模态框）
 */
function zoomPhoto(photoId) {
  if (!currentChatId) return;
  var chat = appData.chats[currentChatId];
  if (!chat || !chat.photos) return;

  var photo = null;
  for (var i = 0; i < chat.photos.length; i++) {
    if (chat.photos[i].id === photoId) {
      photo = chat.photos[i];
      break;
    }
  }
  if (!photo || !photo.dataUrl) {
    showToast('图片数据不可用', 'error');
    return;
  }

  var overlay = document.getElementById('modalOverlay');
  var content = document.getElementById('modalContent');
  content.style.maxWidth = '90vw';
  content.style.maxHeight = '90vh';
  content.style.padding = '0';
  content.style.background = 'transparent';
  content.style.border = 'none';
  content.style.boxShadow = 'none';

  content.innerHTML = '<div class="photo-zoom-container" onclick="closeModal()">' +
    '<img src="' + photo.dataUrl + '" style="max-width:90vw;max-height:85vh;object-fit:contain;border-radius:12px;cursor:pointer;display:block;margin:auto;" onclick="event.stopPropagation()">' +
    '<div style="text-align:center;margin-top:8px;color:#fff;font-size:13px;opacity:0.8;">点击空白区域关闭</div>' +
    '</div>';

  overlay.classList.add('show');
  overlay._onConfirm = null;
}

