
/**
 * 工具注册表（function calling）
 * 当前注册：take_photo（AI 自动拍照）
 * 桌面版另有 show_emotion 情绪动画工具（core/15_stream.js），同一机制即插即用。
 *
 * 触发方式说明见 docs/SP格式统一方案.md 第十章：
 *   - 仅 DeepSeek（原生支持 function calling），不做多供应商探测
 *   - 设置开关 autoPhotoTool 默认关闭；关闭时聊天请求不含 tools，行为与旧版一致
 *   - 工具调用不写入聊天历史（fire-and-forget），回调复用现有拍照管线
 *     （takePhotoForCharacter → LLM 生成图像 prompt → ComfyUI）
 */

var TAKE_PHOTO_TOOL = {
  type: 'function',
  function: {
    name: 'take_photo',
    description: '当剧情出现值得拍照记录的画面（角色外貌/服装/发型/场景/姿势/表情明显变化、剧情重要节点或名场面、用户要求拍照或合影）时调用。先正常输出对话内容，再调用本工具。每个角色每次最多调用一次。',
    parameters: {
      type: 'object',
      properties: {
        character: {
          type: 'string',
          description: '要拍照的角色名，必须与角色设定中的名字完全一致'
        }
      },
      required: ['character']
    }
  }
};

/* 每次回复允许的最大自动拍照数（超出忽略） */
var AUTO_PHOTO_MAX_PER_REPLY = 2;

/* 是否向聊天请求注入拍照工具 */
function shouldInjectPhotoTool() {
  return !!(appData && appData.settings && appData.settings.autoPhotoTool
    && appData.settings.comfyui && appData.settings.comfyui.enabled);
}

/* 判断一条消息是否为工具协议消息（渲染/编辑/压缩遍历时的防御性过滤） */
function isToolProtocolMessage(msg) {
  if (!msg) return false;
  if (msg.role === 'tool') return true;
  if (msg.role === 'assistant' && msg.tool_calls && (!msg.content || !String(msg.content).trim())) return true;
  return false;
}

/**
 * 从聚合完成的 take_photo 调用中提取角色名（去重，超出上限截断）
 * @param calls [{ name, args }]  流式聚合后的工具调用（与桌面版 show_emotion 同构）
 */
function extractPhotoToolCharacters(calls) {
  var names = [];
  if (!calls) return names;
  for (var i = 0; i < calls.length; i++) {
    var call = calls[i];
    if (!call || call.name !== 'take_photo') continue;
    try {
      var args = JSON.parse(call.args || '{}');
      if (args.character && names.indexOf(args.character) === -1) names.push(args.character);
    } catch (e) { /* 参数不完整，忽略 */ }
  }
  return names.slice(0, AUTO_PHOTO_MAX_PER_REPLY);
}

/**
 * 处理模型输出的 take_photo 调用：逐个触发现有拍照管线
 * 模型只调工具没输出正文时，移除空占位消息（与桌面版 handleEmotionToolCalls 行为一致）
 * @param calls [{ name, args }]  流式聚合后的工具调用
 */
function handlePhotoToolCalls(chat, calls, aiMsgIdx) {
  var photoCalls = [];
  for (var i = 0; i < (calls || []).length; i++) {
    if (calls[i] && calls[i].name === 'take_photo') photoCalls.push(calls[i]);
  }
  if (photoCalls.length === 0) return;

  var chars = extractPhotoToolCharacters(photoCalls);
  for (var p = 0; p < chars.length; p++) {
    (function (c, seq) {
      addProgramLog(LOG_TYPE_PHOTO, {
        summary: 'AI 自动触发拍照（' + c + '）',
        chatName: chat ? chat.name : '',
        detail: '由 take_photo 工具调用触发'
      });
      showToast('📸 ' + c + ' 开始拍照...', 'success');
      // 每个拍照按顺序错开延迟，避免并发冲突
      setTimeout(function () {
        triggerTakePhoto(c);
      }, 100 + seq * 500);
    })(chars[p], p);
  }

  // 只调了工具、没有正文 → 移除空占位消息
  if (chat && chat.messages[aiMsgIdx] && !chat.messages[aiMsgIdx].content.trim()) {
    chat.messages.splice(aiMsgIdx, 1);
  }
}
