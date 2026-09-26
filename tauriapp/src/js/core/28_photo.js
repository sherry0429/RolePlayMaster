
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
 * 也由 AI 自动拍照触发标签调用（传角色名跳过 AI 分析）
 * 拍照是异步后台任务，不阻塞聊天
 * @param {string} [characterName] - 可选，指定角色名则直接为该角色拍照
 */
async function triggerTakePhoto(characterName) {
  // 如果指定了角色名（AI 自动触发），直接执行
  if (characterName) {
    return await takePhotoForCharacter(characterName);
  }

  // 日志：手动触发拍照功能（进入角色选择）
  addProgramLog(LOG_TYPE_PHOTO, {
    summary: '手动触发拍照功能（选择角色）',
    chatName: currentChatId ? (appData.chats[currentChatId] || {}).name || '' : ''
  });

  // 未指定角色名，显示角色选择对话框
  showPhotoCharSelect();
}

/**
 * 为指定角色直接拍照（跳过 AI 角色分析阶段，直接让 AI 生成该角色的图像 prompt）
 * 由 triggerTakePhoto(characterName) 中的角色名分支调用
 */
async function takePhotoForCharacter(characterName) {
  isPhotoShooting = true;
  photoAbortController = new AbortController();
  showPhotoProgress('🤳 ' + characterName + ' 正在拍摄...');

  try {
    var chat = appData.chats[currentChatId];
    var sp = getCurrentSpVersion();

    // 1. 构建 AI 请求消息（指定角色，只关注该角色）
    var messages = buildPhotoRequestMessages(chat, sp, characterName);

    // 记录日志
    addProgramLog(LOG_TYPE_PHOTO, {
      summary: 'AI 自动拍照（' + characterName + '）',
      chatName: chat.name + LOG_NAME_PHOTO,
      detail: messages
    });

    // 2. 发送 AI 请求，获取该角色的图像 prompt
    var apiKey = appData.settings.apiKey;
    var apiHost = appData.settings.apiHost || DEFAULT_API_HOST;
    var url = apiHost.replace(/\/+$/, '') + '/chat/completions';

    updatePhotoProgress('🧠 AI 正在生成 ' + characterName + ' 的外貌描述...');

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

    // 记录日志
    addProgramLog(LOG_TYPE_PHOTO, {
      summary: 'AI 返回 ' + characterName + ' 的图像描述',
      chatName: chat.name + LOG_NAME_PHOTO,
      detail: aiContent
    });

    // 3. 解析 AI 返回的 prompt
    var prompts = parsePhotoPrompts(aiContent);
    if (prompts.length === 0) {
      prompts = [{ prompt: aiContent, characterName: characterName }];
    }

    // 4. 生成图片（供应商由「设置 → 图像」决定，具体实现见 31_image_providers.js）
    var provider = activeImageProvider();
    var useProvider = !!(provider && provider.isReady());
    if (!chat.photos) chat.photos = [];

    for (var i = 0; i < prompts.length; i++) {
      var item = prompts[i];
      updatePhotoProgress('📸 ' + (item.characterName || characterName) + ' 正在拍摄 (' + (i + 1) + '/' + prompts.length + ')');

      var photoData = null;
      if (useProvider) {
        // 各供应商的默认尺寸不同，按当前供应商取
        var pcfg = (provider.id === 'siliconflow')
          ? (appData.settings.siliconflow || {})
          : (appData.settings.comfyui || {});
        var useW = pcfg.defaultWidth || (provider.id === 'siliconflow' ? 1024 : 512);
        var useH = pcfg.defaultHeight || (provider.id === 'siliconflow' ? 1024 : 768);
        photoData = await callImageProvider(
          item.prompt,
          { width: useW, height: useH, characterName: item.characterName || characterName },
          photoAbortController.signal
        );
      }

      var photoObj;
      if (photoData && photoData.dataUrl) {
        // 缩略图失败不致命：直接拿原图当缩略图（原图较小/解码异常时的情况）
        var thumbUrl = photoData.dataUrl;
        try {
          thumbUrl = await generateThumbnail(photoData.dataUrl, 200, 200);
        } catch (thumbErr) {
          console.warn('缩略图生成失败，退回原图', thumbErr);
        }
        photoObj = {
          id: 'photo_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2, 8),
          dataUrl: photoData.dataUrl,
          thumbUrl: thumbUrl,
          prompt: item.prompt,
          characterName: item.characterName || characterName,
          createdAt: Date.now(),
          afterMessageIndex: chat.messages.length - 1
        };
        chat.photos.push(photoObj);
        await saveData();
        renderPhotoMessage(photoObj);
      } else {
        addProgramLog(LOG_TYPE_ERROR, {
          summary: '拍照失败（' + (item.characterName || characterName) + '）— 供应商 ' +
            (provider ? provider.label : '未注册') + (useProvider ? '' : '（未配置）'),
          chatName: chat.name,
          detail: {
            prompt: item.prompt,
            providerReady: useProvider,
            lastError: (typeof _lastImageGenError !== 'undefined' ? _lastImageGenError : null)
          }
        });
        // 生成失败：不再创建空照片对象，而是把 image prompt 落成一条正式聊天消息
        // —— 它会以气泡形式出现在历史气泡堆、在消息浮层完整展示、且可悬停编辑/删除
        var failChar = item.characterName || characterName;
        var providerName = provider ? provider.label : '图像供应商';
        // 具体失败原因：来自供应商层的详细记录（HTTP 状态 / 响应体 / 异常），
        // 完整细节见 设置 → 日志
        var detail = (typeof _lastImageGenError !== 'undefined' && _lastImageGenError) ? _lastImageGenError : null;
        var failReason;
        if (!useProvider) {
          failReason = providerName + ' 未配置（请到「设置 → 图像」检查开关与 API Key）';
        } else if (detail) {
          var stepHasStatus = detail.step && String(detail.step).indexOf('HTTP ' + detail.httpStatus) >= 0;
          failReason = providerName + ' · ' + detail.step +
            (detail.httpStatus !== null && !stepHasStatus ? '（HTTP ' + detail.httpStatus + '）' : '') +
            (detail.error ? '：' + detail.error : '') +
            (detail.elapsedMs !== null ? '（' + (detail.elapsedMs / 1000).toFixed(1) + 's）' : '');
        } else {
          failReason = providerName + ' 未响应或出错';
        }
        var respHint = (detail && detail.responseBody)
          ? '\n对方返回：' + String(detail.responseBody).slice(0, 500)
          : '';
        chat.messages.push({
          role: 'assistant',
          content: '【' + failChar + '】📷 拍照失败（' + failReason + '）' + respHint +
            '\n\n本次图像 prompt 已保留：\n' + item.prompt +
            '\n\n（完整请求与响应见「设置 → 日志」）'
        });
        await saveData();
        renderMessages();
        showToast('图片生成失败：' + failReason + '（详情见 设置 → 日志）', 'error');
      }
    }

    // 5. 拍照完成
    renderMessages();
    addProgramLog(LOG_TYPE_PHOTO_DONE, {
      summary: '拍照完成',
      chatName: chat.name,
      detail: characterName + ' 已拍摄 ' + prompts.length + ' 张照片'
    });
    showToast('📸 ' + characterName + ' 已拍摄 ' + prompts.length + ' 张照片', 'success');
    // 系统通知（设置 → 图像 开关控制）
    sendPhotoNotification(
      '拍照完成',
      characterName + ' 已拍摄 ' + prompts.length + ' 张照片'
    );

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
 * @param {object} chat - 聊天对象
 * @param {object} sp - 当前 system prompt 版本
 * @param {string} [specificCharacter] - 可选，指定角色名则只关注该角色
 */
function buildPhotoRequestMessages(chat, sp, specificCharacter) {
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
  // 如果指定了角色，只保留该角色
  if (specificCharacter) {
    charNames = charNames.filter(function(n) { return n === specificCharacter; });
  }

  // 获取角色外貌设定（从 SP 中提取，支持多角色）
  var appearanceSections = [];
  if (sp && sp.content) {
    // 方式1：按【角色名】分段提取外貌
    // 群聊初始化后 system_prompt 格式为：
    // 【角色名】
    //   <外貌>XXXXX</外貌>
    //   <身份>XXXXX</身份>
    //   <性格>XXXXX</性格>
    var charSectionRegex = /【(.+?)】([\s\S]*?)(?=\n【|$)/g;
    var sectionMatch;
    while ((sectionMatch = charSectionRegex.exec(sp.content)) !== null) {
      var charName = sectionMatch[1].trim();
      var charBody = sectionMatch[2];
      // 优先尝试 XML 标签格式 <外貌>...</外貌>
      var appMatch = charBody.match(/<外貌>([\s\S]*?)<\/外貌>/);
      // 未匹配到 XML 标签，再尝试冒号格式 外貌：
      if (!appMatch) {
        appMatch = charBody.match(/外貌[：:]([\s\S]*?)(?:\n\n|\n#{1,}|$)/);
      }
      if (appMatch) {
        appearanceSections.push({
          characterName: charName,
          appearance: appMatch[1].trim()
        });
      }
    }
    // 方式2：如果按角色分段没找到，尝试全局匹配外貌（XML 标签格式优先）
    if (appearanceSections.length === 0) {
      // 尝试匹配 <外貌>...</外貌> XML 标签
      var xmlRegex = /<外貌>([\s\S]*?)<\/外貌>/g;
      var xmlMatch;
      while ((xmlMatch = xmlRegex.exec(sp.content)) !== null) {
        appearanceSections.push({
          characterName: '',
          appearance: xmlMatch[1].trim()
        });
      }
      // 仍未匹配到，尝试冒号格式
      if (appearanceSections.length === 0) {
        var globalRegex = /外貌[：:]([\s\S]*?)(?:\n\n|\n#{1,}|$)/g;
        var globalMatch;
        while ((globalMatch = globalRegex.exec(sp.content)) !== null) {
          appearanceSections.push({
            characterName: '',
            appearance: globalMatch[1].trim()
          });
        }
      }
    }
  }

  // 如果指定了角色，只保留该角色的外貌设定
  if (specificCharacter) {
    appearanceSections = appearanceSections.filter(function(s) {
      return s.characterName === specificCharacter;
    });
  }

  var roleList = charNames.length > 0 ? '涉及角色：' + charNames.join('、') + '。' : '';
  var appearanceGuide = '';
  if (appearanceSections.length > 0) {
    appearanceGuide = '角色外貌设定参考：\n';
    for (var ai = 0; ai < appearanceSections.length; ai++) {
      var sec = appearanceSections[ai];
      if (sec.characterName) {
        appearanceGuide += '【' + sec.characterName + '】\n外貌：' + sec.appearance + '\n';
      } else {
        appearanceGuide += '外貌：' + sec.appearance + '\n';
      }
      if (ai < appearanceSections.length - 1) {
        appearanceGuide += '---\n';
      }
    }
  }

  // 构建拍照指令（支持设置中的自定义模板，占位符见 getPhotoPromptTemplate）
  var userContent = buildPhotoPrompt(specificCharacter, roleList, appearanceGuide);

  messages.push({ role: 'user', content: userContent });

  return messages;
}

/**
 * 解析 AI 返回的多个 prompt
 * 格式：每段以【角色名】开头，多段可用 --- 分隔
 * 
 * 解析策略（双保险）：
 * 1. 先统计【角色名】的数量
 * 2. 尝试按 --- 分割，如果段数等于角色数，用 --- 分割方案
 * 3. 如果段数不匹配（AI没返回---），直接用【】正则提取
 */
function parsePhotoPrompts(content) {
  var prompts = [];

  // Step 1: 统计【角色名】的个数
  var charNameList = [];
  var nameRegex = /【(.+?)】/g;
  var m;
  while ((m = nameRegex.exec(content)) !== null) {
    charNameList.push(m[1]);
  }
  var charCount = charNameList.length;

  // 没有【】标记，返回空（由调用方兜底）
  if (charCount === 0) return prompts;

  // Step 2: 尝试按 --- 分割
  var rawSections = content.split(/---+/);
  var sections = [];
  for (var i = 0; i < rawSections.length; i++) {
    var s = rawSections[i].trim();
    if (s) sections.push(s);
  }

  // Step 3: 段数等于角色数 → 使用 --- 分割方案
  if (sections.length === charCount) {
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      var nameMatch = section.match(/^【(.+?)】/);
      var characterName = nameMatch ? nameMatch[1] : '';
      var promptText = nameMatch ? section.slice(nameMatch[0].length).trim() : section;
      if (promptText) {
        prompts.push({
          prompt: promptText,
          characterName: characterName
        });
      }
    }
    return prompts;
  }

  // Step 4: 段数不匹配（AI没返回---），直接用【】正则逐段提取
  var sectionRegex = /【(.+?)】([\s\S]*?)(?=【|$)/g;
  while ((m = sectionRegex.exec(content)) !== null) {
    var text = m[2].trim();
    if (text) {
      prompts.push({
        prompt: text,
        characterName: m[1]
      });
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
        setComfyNodeInput(widthNode, width, 'width');
      }
    }
    // 替换高度节点
    if (comfyui.nodeIds.height) {
      var heightNode = findComfyNodeById(workflow, comfyui.nodeIds.height);
      if (heightNode) {
        setComfyNodeInput(heightNode, height, 'height');
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

    // 3. 轮询获取结果（超时秒数可在 设置 → 图像 中配置，默认 300 秒）
    var timeoutSec = (parseInt(comfyui.timeout, 10) >= 10) ? parseInt(comfyui.timeout, 10) : 300;
    var pollInterval = 1000; // 1 秒轮询一次
    var maxAttempts = Math.max(1, timeoutSec);
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

    throw new Error('ComfyUI 生成超时（' + timeoutSec + ' 秒）');
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
function setComfyNodeInput(node, value, inputName) {
  if (!node || !node.inputs) return;

  // 新模式：指定 inputName
  if (inputName) {
    if (node.inputs.hasOwnProperty(inputName)) {
      node.inputs[inputName] = value;
    }
    return;
  }

  // 旧模式：自动修改第一个普通输入
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
/**
 * 读取 blob 头部若干字节（兼容性优先，用 FileReader 而非 Blob.arrayBuffer）
 */
function _readBlobHead(blob, n) {
  return new Promise(function (resolve) {
    try {
      var fr = new FileReader();
      fr.onload = function () { resolve(new Uint8Array(fr.result || [])); };
      fr.onerror = function () { resolve(new Uint8Array(0)); };
      fr.readAsArrayBuffer(blob.slice(0, n));
    } catch (e) {
      resolve(new Uint8Array(0));
    }
  });
}

/** 按文件头嗅探图片 MIME；识别不出返回空串 */
function sniffImageMime(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return '';
}

/**
 * blob → dataURL。
 * 注意：很多图床（如硅基流动的 S3）返回的 Content-Type 是 application/octet-stream，
 * 若直接读成 data URL，MIME 就是 octet-stream —— WKWebView 无法解码这种 data URL，
 * <img> 的 onload 永远不触发，拍照流程会卡死。这里按文件头嗅探真实格式后再转。
 */
async function blobToBase64(blob, fallbackMime) {
  var type = blob.type || '';
  if (!/^image\//i.test(type)) {
    var head = await _readBlobHead(blob, 16);
    var sniffed = sniffImageMime(head) || fallbackMime || 'image/png';
    blob = new Blob([blob], { type: sniffed });
  }
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function() { resolve(reader.result); };
    reader.onerror = function() { reject(reader.error); };
    reader.readAsDataURL(blob);
  });
}

/**
 * 渲染单张图片消息（根据 afterMessageIndex 插入到聊天区域中正确位置）
 * 用于拍照过程中逐张渲染，不等待全部照片生成完成
 */
function renderPhotoMessage(photoObj) {
  var area = document.getElementById('chatArea');
  if (!area) return;

  var html = buildPhotoMessageHtml(photoObj);

  // 根据 afterMessageIndex 找到插入位置：在该索引的消息之后插入
  var targetIdx = photoObj.afterMessageIndex;
  if (targetIdx !== undefined) {
    var targetEl = area.querySelector('.message[data-idx="' + targetIdx + '"]');
    if (targetEl && targetEl.nextSibling) {
      targetEl.insertAdjacentHTML('afterend', html);
    } else {
      // 没找到目标元素，回退到末尾追加
      area.insertAdjacentHTML('beforeend', html);
    }
  } else {
    area.insertAdjacentHTML('beforeend', html);
  }

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
 * 取消拍摄（手动中止拍照流程）
 */
function cancelPhoto() {
  if (photoAbortController) {
    photoAbortController.abort();
  }
  showToast('已取消拍摄');
}

/**
 * 生成缩略图（canvas压缩）
 * @param {string} dataUrl - 原图 data URL
 * @param {number} maxWidth - 缩略图最大宽度（默认200）
 * @param {number} maxHeight - 缩略图最大高度（默认200）
 * @returns {Promise<string>} 缩略图 data URL
 */
function generateThumbnail(dataUrl, maxWidth, maxHeight) {
  maxWidth = maxWidth || 200;
  maxHeight = maxHeight || 200;
  return new Promise(function(resolve, reject) {
    var img = new Image();
    // 兜底：解码失败/超时要报错，绝不能挂着不返回（否则拍照流程卡在「未响应」）
    var failTimer = setTimeout(function () {
      reject(new Error('缩略图生成超时（图片解码失败）'));
    }, 15000);
    img.onerror = function () {
      clearTimeout(failTimer);
      reject(new Error('图片解码失败（数据格式不受支持）'));
    };
    img.onload = function() {
      clearTimeout(failTimer);
      var canvas = document.createElement('canvas');
      var width = img.width;
      var height = img.height;
      // 等比例缩放，最大 200x200（足够清晰且文件小）
      if (width > height) {
        if (width > maxWidth) {
          height = Math.round(height * maxWidth / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round(width * maxHeight / height);
          height = maxHeight;
        }
      }
      canvas.width = width;
      canvas.height = height;
      var ctx = canvas.getContext('2d');
      // 使用较高品质，避免缩略图模糊
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = function() {
      // 缩略图生成失败时回退到原图
      resolve(dataUrl);
    };
    img.src = dataUrl;
  });
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

/**
 * 显示拍照角色选择对话框
 * 渲染当前聊天中的所有角色供用户选择（可多选）
 */
function showPhotoCharSelect() {
  // 状态检查
  if (isPhotoShooting) {
    showToast('正在拍照中，请等待完成', 'error');
    return;
  }
  if (isStreaming || isCompressing || isReplaying) {
    showToast('请等待当前操作完成', 'error');
    return;
  }
  if (!currentChatId) {
    showToast('请先开始一个对话', 'error');
    return;
  }
  var chat = appData.chats[currentChatId];
  if (!chat) {
    showToast('请先开始一个对话', 'error');
    return;
  }

  // 获取当前聊天关联的角色
  var characters = chat.characters || [];
  if (characters.length === 0) {
    showToast('当前聊天未关联任何角色', 'error');
    return;
  }

  // 渲染角色复选框列表
  var listEl = document.getElementById('photoCharSelectList');
  if (!listEl) return;

  var html = '';
  for (var i = 0; i < characters.length; i++) {
    var char = characters[i];
    var charInfo = findCharacter(char.name);
    var avatarHtml = '🤖';
    if (charInfo && charInfo.avatar) {
      avatarHtml = '<img src="' + escHtml(charInfo.avatar) + '" alt="' + escHtml(char.name) + '">';
    } else if (char.avatar) {
      avatarHtml = '<img src="' + escHtml(char.avatar) + '" alt="' + escHtml(char.name) + '">';
    }
    
    html += '<div class="photo-char-item" onclick="togglePhotoCharSelect(' + i + ')">' +
      '<input type="checkbox" id="photoChar_' + i + '" onchange="event.stopPropagation()">' +
      '<div class="photo-char-avatar">' + avatarHtml + '</div>' +
      '<div class="photo-char-name">' + escHtml(char.name) + '</div>' +
      '</div>';
  }
  listEl.innerHTML = html;

  // 显示对话框
  var overlay = document.getElementById('photoCharSelectOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
  }
}

/**
 * 切换角色选择状态
 * @param {number} index - 角色索引
 */
function togglePhotoCharSelect(index) {
  var checkbox = document.getElementById('photoChar_' + index);
  if (checkbox) {
    checkbox.checked = !checkbox.checked;
  }
}

/**
 * 确认拍照角色选择
 * 获取所有选中的角色，逐个执行拍照
 */
async function confirmPhotoCharSelect() {
  if (!currentChatId) return;
  var chat = appData.chats[currentChatId];
  if (!chat || !chat.characters) return;

  // 收集选中的角色名
  var selectedNames = [];
  for (var i = 0; i < chat.characters.length; i++) {
    var checkbox = document.getElementById('photoChar_' + i);
    if (checkbox && checkbox.checked) {
      selectedNames.push(chat.characters[i].name);
    }
  }

  if (selectedNames.length === 0) {
    showToast('请至少选择一个角色', 'error');
    return;
  }

  // 关闭对话框
  closePhotoCharSelect();

  // 逐个为选中的角色拍照
  for (var j = 0; j < selectedNames.length; j++) {
    await takePhotoForCharacter(selectedNames[j]);
  }
}

/**
 * 关闭拍照角色选择对话框
 */
function closePhotoCharSelect() {
  var overlay = document.getElementById('photoCharSelectOverlay');
  if (overlay) {
    overlay.style.display = 'none';
  }
  // 清空复选框状态
  if (!currentChatId) return;
  var chat = appData.chats[currentChatId];
  if (!chat || !chat.characters) return;
  
  for (var i = 0; i < chat.characters.length; i++) {
    var checkbox = document.getElementById('photoChar_' + i);
    if (checkbox) {
      checkbox.checked = false;
    }
  }
}


/**
 * 删除一条「拍摄失败」的遗留照片记录（消息浮层失败照片行的删除按钮）
 * @param {string} photoId
 */
async function deleteFailedPhoto(photoId) {
  if (!currentChatId) return;
  var chat = appData.chats[currentChatId];
  if (!chat || !chat.photos) return;
  var idx = -1;
  for (var i = 0; i < chat.photos.length; i++) {
    if (chat.photos[i].id === photoId) { idx = i; break; }
  }
  if (idx < 0) return;
  if (!(await confirmDialog('删除这条拍摄失败的记录吗？'))) return;
  chat.photos.splice(idx, 1);
  await saveData();
  renderMessages();
  showToast('已删除失败记录');
}

/**
 * 删除一条照片记录（消息浮层照片行的删除按钮）。
 * 删除后：相册少一张图，气泡堆里对应的「[照片]」气泡同步消失。
 * @param {string} photoId
 */
async function deletePhotoById(photoId) {
  if (!currentChatId) return;
  var chat = appData.chats[currentChatId];
  if (!chat || !chat.photos) return;
  var idx = -1;
  for (var i = 0; i < chat.photos.length; i++) {
    if (chat.photos[i].id === photoId) { idx = i; break; }
  }
  if (idx < 0) return;
  if (!(await confirmDialog('删除这张照片吗？'))) return;
  chat.photos.splice(idx, 1);
  await saveData();
  // 浮层与气泡堆一起刷新（气泡堆由 chat.photos 推导，删除即消失）
  renderMessages();
  showToast('照片已删除');
}

// ==================== 拍照完成系统通知 ====================

/**
 * 发送「拍照完成」系统通知。
 * 优先走 Tauri 原生通知插件（window.__TAURI__.notification，macOS / Windows 均支持）；
 * 在纯浏览器环境（网页版 / 本地预览）回退到 Web Notification API。
 * 开关：设置 → 图像 → 拍照完成系统通知（appData.settings.photoNotification）
 */
async function sendPhotoNotification(title, body) {
  try {
    if (!appData.settings || !appData.settings.photoNotification) return;

    // ---- Tauri 原生通知 ----
    var np = (typeof window !== 'undefined') && window.__TAURI__ && window.__TAURI__.notification;
    if (np) {
      var granted = false;
      try {
        // 兼容两种 API 形态：isPermissionGranted()（布尔）与 permissionState()（字符串）
        if (typeof np.isPermissionGranted === 'function') {
          granted = await np.isPermissionGranted() === true;
        } else if (typeof np.permissionState === 'function') {
          granted = (await np.permissionState()) === 'granted';
        } else {
          granted = true; // 查不到权限状态时仍尝试发送，由后端兜底
        }
        if (!granted && typeof np.requestPermission === 'function') {
          var perm = await np.requestPermission();
          granted = (perm === 'granted' || perm === true);
        }
      } catch (permErr) {
        console.warn('[通知] 权限查询失败', permErr);
        granted = true; // 权限 API 异常时仍尝试发送，由后端兜底
      }
      if (!granted) {
        console.warn('[通知] 系统通知权限被拒绝，无法推送');
        return;
      }
      await np.sendNotification({ title: title, body: body });
      return;
    }

    // ---- Web Notification 回退（浏览器环境） ----
    if (typeof Notification !== 'undefined') {
      if (Notification.permission === 'granted') {
        new Notification(title, { body: body });
      } else if (Notification.permission === 'default') {
        var p = await Notification.requestPermission();
        if (p === 'granted') new Notification(title, { body: body });
      }
      return;
    }

    console.warn('[通知] 当前环境不支持系统通知');
  } catch (e) {
    // 通知失败不影响拍照主流程
    console.warn('[通知] 发送失败', e);
  }
}
