/**
 * 提示词统一管理
 * 所有快捷指令对应的 AI 提示词收归此文件管理
 * 修改提示词只需编辑此文件，无需翻找多个 JS 文件
 */

// ==================== 记忆压缩 ====================
// 点击「🧠 /记忆」按钮或输入 /记忆 时触发
// compressChat() 发送给 AI 的压缩指令，要求 AI 分析对话并更新 system_prompt
var PROMPT_MEMORY = '请对以上对话内容进行分析总结，输出system_prompt，包括任务定义，角色设定，背景故事，当前状态，回复样例。更新角色设定，背景故事，当前状态，绝对不要修改任务定义，回复样例。直接输出内容，不需要额外的说明。';

// ==================== 继续对话 ====================
// 点击「▶ /继续」按钮或输入 /继续 时触发
// 直接调用 requestAI() 以当前 context 继续生成，不需要额外的用户消息
// 如需自定义继续时 AI 感知到的消息，可在此修改
var PROMPT_CONTINUE = null; // null 表示不加额外消息，直接以已有上下文继续

// ==================== 拍照 ====================
// 点击「📷 拍照」按钮或输入 /拍照 时触发
// triggerTakePhoto() 中 buildPhotoRequestMessages() 发起的拍照指令
// AI 根据该指令生成用于图像生成的 prompt
var PROMPT_TAKE_PHOTO_PREAMBLE = '[系统拍照指令]';
var PROMPT_TAKE_PHOTO_BODY = '请根据以上对话中角色的外貌设定和当前聊天的剧情进展，推算每个涉及角色的当前外貌和状态。';
var PROMPT_TAKE_PHOTO_INSTRUCTION = '\n请为每个角色分别返回一段用于图像生成的 prompt（中文，一段描述性文字，不要用英文逗号分隔的词组格式）。';
var PROMPT_TAKE_PHOTO_SEPARATOR = '\n如果有多个角色，用以下分隔符分隔每个角色的 prompt：\n---\n';
var PROMPT_TAKE_PHOTO_EXAMPLE = '每个 prompt 的开头用【角色名】标记，例如：\n【林梦】一个穿着白色连衣裙的少女站在樱花树下，阳光透过花瓣洒在她柔顺的黑发上，她微微仰起头，眼神清澈而温柔，面带淡淡的微笑。\n---\n【苏晴】一个短发干练的职场女性，穿着深蓝色西装外套，站在落地窗前眺望城市夜景，手中端着一杯咖啡，神情专注而坚定。';
var PROMPT_TAKE_PHOTO_NOTE = '\n注意：请直接输出 prompt 内容，不要额外说明。prompt 要使用完整的中文句子描述，而不是标签式的词组。';

// ==================== 群聊初始化 ====================
// 建群后自动调用 AI 补充角色设定、背景故事和回复样例
// confirmCharSelect() → autoInitGroupChat() 中使用
// 注意：${charDescList} 会被替换为角色描述列表
var PROMPT_GROUP_INIT_TEMPLATE = '是一个多角色扮演模拟引擎。现在需要你根据以下角色信息，完成初始化设置：\n\n角色列表：\n${charDescList}\n\n请完成以下任务，直接输出结果，不需要额外说明：\n1. 为每个角色补充详细的设定，包含角色的外貌、身份背景、性格，外貌详细描写\n2. 随机生成一句话的初始场景作为背景故事\n3. 为每个角色生成一句回复样例，突出人物性格，用【角色名】开头\n4. 如果角色名是知名二次元角色，则直接套用二次元设定。\n\n外貌描写示例：\n<外貌>身高165cm，一头柔顺的黑色长发垂至腰际，斜刘海半遮右眼，琥珀般的眼眸清澈见底。皮肤白皙，常穿白色连衣裙配米色开衫。</外貌>\n\n身份描写示例：\n<身份>XX大学文学系大二学生，学生会文艺部部长，从小学习古筝，参加过多场市级演出。家境优越但不张扬。<身份>\n\n性格描写示例：\n<性格>温柔细腻但内心坚韧，待人接物有礼有节，偶尔会流露出俏皮的一面。责任感强，是朋友们信赖的倾诉对象。</性格>\n\n输出格式要求（严格按照以下格式）：\n# 角色设定\n【角色名称】\n  <外貌>XXXXXX</外貌>\n  <身份>XXXXXX</身份>\n  <性格>XXXXXX</性格>\n\n# 背景故事\n（一句话场景描述）\n\n# 回复样例\n（每个角色一句话，用【角色名】开头）';
function buildGroupInitPrompt(charDescList) {
  return PROMPT_GROUP_INIT_TEMPLATE.replace('${charDescList}', charDescList);
}

// ==================== 自动话题 ====================
// 自动找话题功能发送给 AI 的系统提示
// triggerAutoTopic() 中使用
// 注意：${charHint} 会被替换为实际可选角色名
var PROMPT_AUTO_TOPIC_TEMPLATE = '如果没有话题，则随机选择一个角色{charHint}发起一个话题，否则让多个角色之间根据之前的话题进行讨论，延续讨论的进展。请用【角色名】的格式来标记说话人。直接输出内容，不需要额外的说明。';
function buildAutoTopicPrompt(charHint) {
  return PROMPT_AUTO_TOPIC_TEMPLATE.replace('{charHint}', charHint || '');
}

// ==================== 显示在日志中的友好名称 ====================
var LOG_NAME_MEMORY = ' [压缩记忆]';
var LOG_NAME_PHOTO = ' [拍照]';
var LOG_NAME_AUTO_TOPIC = ' [自动话题]';
var LOG_NAME_GROUP_INIT = ' [群聊初始化]';
