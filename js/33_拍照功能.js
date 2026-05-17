
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
  // 状态检查：只阻止并发拍照，不阻塞聊天
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
  if (!chat || chat.messages.length === 0) {
    showToast('请先发送一些消息再拍照', 'error');
    return;
  }

  var apiKey = appData.settings.apiKey;
  if (!apiKey) {
    showToast('请先设置 API Key', 'error');
    return;
  }

  // 如果有指定角色名，直接为该角色拍照（跳过 AI 角色分析）
  if (characterName) {
    return await takePhotoForCharacter(characterName);
  }

  isPhotoShooting = true;
  photoAbortController = new AbortController();

  // 显示拍摄进度条
  showPhotoProgress('🤳 正在构思画面...');

  try {
    // 1. 构建 AI 请求消息
    var sp = getCurrentSpVersion();
    var messages = buildPhotoRequestMessages(chat, sp);

    // 记录日志
    addProgramLog(LOG_TYPE_PHOTO, {
      summary: 'AI 分析角色外貌（拍照）',
      chatName: chat.name + LOG_NAME_PHOTO,
      detail: messages
    });

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

    // 记录 AI 返回的图像 prompt 日志（不进入 history_messages，但出现在请求日志中）
    addProgramLog(LOG_TYPE_PHOTO, {
      summary: 'AI 返回的图像描述（共解析出 ' + (parsePhotoPrompts(aiContent).length || 1) + ' 张）',
      chatName: chat.name + LOG_NAME_PHOTO,
      detail: aiContent
    });

    // 3. 解析 AI 返回的 prompts（按分隔符分割）
    var prompts = parsePhotoPrompts(aiContent);
    if (prompts.length === 0) {
      // 如果解析失败，把整个内容当作一个 prompt
      prompts = [{ prompt: aiContent, characterName: extractPhotoCharacter(aiContent, chat) }];
    }

    // 4. 对每个 prompt 生成图片
    var comfyuiEnabled = appData.settings.comfyui && appData.settings.comfyui.enabled;

    // 确保 photos 数组存在
    if (!chat.photos) chat.photos = [];

    // 收集本轮新生成的照片 ID，用于后续更新 afterMessageIndex
    var newPhotoIds = [];

    for (var i = 0; i < prompts.length; i++) {
      var item = prompts[i];
      updatePhotoProgress('📸 ' + (item.characterName || '角色') + ' 正在拍摄 (' + (i + 1) + '/' + prompts.length + ')');

      var photoData = null;
      if (comfyuiEnabled && appData.settings.comfyui.workflowJson) {
        // 记录 ComfyUI 请求日志（不进入 history_messages，但出现在请求日志中）
        addProgramLog(LOG_TYPE_PHOTO, {
          summary: 'ComfyUI 生成图片 (' + (item.characterName || '角色') + ')',
          chatName: chat.name + LOG_NAME_PHOTO,
          detail: '角色：' + (item.characterName || '未知') +
            '\nWidth: ' + (appData.settings.comfyui.defaultWidth || 512) +
            '\nHeight: ' + (appData.settings.comfyui.defaultHeight || 768) +
            '\n\nPrompt:\n' + item.prompt
        });
        photoData = await callComfyUI(
          item.prompt,
          appData.settings.comfyui.defaultWidth || 512,
          appData.settings.comfyui.defaultHeight || 768,
          photoAbortController.signal
        );
      }

      var photoObj;
      if (photoData && photoData.dataUrl) {
        var thumbUrl = await generateThumbnail(photoData.dataUrl, 200, 200);
        photoObj = {
          id: 'photo_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2, 8),
          dataUrl: photoData.dataUrl,
          thumbUrl: thumbUrl,
          prompt: item.prompt,
          characterName: item.characterName || '',
          createdAt: Date.now(),
          // 使用当前最新消息索引，使照片像新消息一样出现在对话末尾
          afterMessageIndex: chat.messages.length - 1
        };
        chat.photos.push(photoObj);
        await saveData();
      } else {
        photoObj = {
          id: 'photo_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2, 8),
          dataUrl: '',
          prompt: item.prompt,
          characterName: item.characterName || '',
          createdAt: Date.now(),
          afterMessageIndex: chat.messages.length - 1
        };
        chat.photos.push(photoObj);
        await saveData();
        showToast('图片生成失败（ComfyUI 未响应或未配置）', 'error');
      }
      newPhotoIds.push(photoObj.id);

      // 每生成一张照片立即渲染，不等待全部完成
      // 使用 insertAdjacentHTML 插入到 afterMessageIndex 对应的消息之后
      renderPhotoMessage(photoObj);
    }

    // 5. 拍照完成，仅重新渲染确保位置准确，不触发 AI 回复
    // 渲染引擎会根据 chat.photos 中的 afterMessageIndex 重新排列
    renderMessages();

    // 记录拍照完成日志
    addProgramLog(LOG_TYPE_PHOTO_DONE, {
      summary: '拍照完成',
      chatName: chat.name,
      detail: '已拍摄 ' + prompts.length + ' 张照片'
    });

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

    // 4. 生成图片
    var comfyuiEnabled = appData.settings.comfyui && appData.settings.comfyui.enabled;
    if (!chat.photos) chat.photos = [];

    for (var i = 0; i < prompts.length; i++) {
      var item = prompts[i];
      updatePhotoProgress('📸 ' + (item.characterName || characterName) + ' 正在拍摄 (' + (i + 1) + '/' + prompts.length + ')');

      var photoData = null;
      if (comfyuiEnabled && appData.settings.comfyui.workflowJson) {
        addProgramLog(LOG_TYPE_PHOTO, {
          summary: 'ComfyUI 生成图片 (' + (item.characterName || characterName) + ')',
          chatName: chat.name + LOG_NAME_PHOTO,
          detail: '角色：' + (item.characterName || characterName) +
            '\nWidth: ' + (appData.settings.comfyui.defaultWidth || 512) +
            '\nHeight: ' + (appData.settings.comfyui.defaultHeight || 768) +
            '\n\nPrompt:\n' + item.prompt
        });
        photoData = await callComfyUI(
          item.prompt,
          appData.settings.comfyui.defaultWidth || 512,
          appData.settings.comfyui.defaultHeight || 768,
          photoAbortController.signal
        );
      }

      var photoObj;
      if (photoData && photoData.dataUrl) {
        var thumbUrl = await generateThumbnail(photoData.dataUrl, 200, 200);
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
      } else {
        photoObj = {
          id: 'photo_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2, 8),
          dataUrl: '',
          prompt: item.prompt,
          characterName: item.characterName || characterName,
          createdAt: Date.now(),
          afterMessageIndex: chat.messages.length - 1
        };
        chat.photos.push(photoObj);
        await saveData();
        showToast('图片生成失败（ComfyUI 未响应或未配置）', 'error');
      }
      renderPhotoMessage(photoObj);
    }

    // 5. 拍照完成
    renderMessages();
    addProgramLog(LOG_TYPE_PHOTO_DONE, {
      summary: '拍照完成',
      chatName: chat.name,
      detail: characterName + ' 已拍摄 ' + prompts.length + ' 张照片'
    });
    showToast('📸 ' + characterName + ' 已拍摄 ' + prompts.length + ' 张照片', 'success');

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

  // 如果指定了角色，只保留该角色的外貌设定
  if (specificCharacter) {
    appearanceSections = appearanceSections.filter(function(s) {
      return s.characterName === specificCharacter;
    });
  }

  // 构建拍照指令
  var userContent = PROMPT_TAKE_PHOTO_PREAMBLE + '\n';
  if (specificCharacter) {
    userContent += '请根据以上对话中角色的外貌设定，推算角色「' + specificCharacter + '」的当前外貌和状态。\n';
  } else {
    userContent += PROMPT_TAKE_PHOTO_BODY + '\n';
  }
  userContent += roleList + '\n';
  userContent += appearanceGuide + '\n';
  userContent += PROMPT_TAKE_PHOTO_INSTRUCTION;
  userContent += PROMPT_TAKE_PHOTO_SEPARATOR;
  userContent += PROMPT_TAKE_PHOTO_EXAMPLE;
  userContent += PROMPT_TAKE_PHOTO_NOTE;

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
    img.onload = function() {
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

