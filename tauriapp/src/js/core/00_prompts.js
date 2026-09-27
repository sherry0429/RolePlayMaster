/**
 * 提示词统一管理
 * 所有快捷指令对应的 AI 提示词收归此文件管理
 * 修改提示词只需编辑此文件，无需翻找多个 JS 文件
 */

// ==================== 记忆压缩 ====================
// 点击「🧠 /记忆」按钮或输入 /记忆 时触发
// compressChat() 发送给 AI 的压缩指令，要求 AI 分析对话并更新 system_prompt
var PROMPT_MEMORY = `请对以上对话内容进行分析总结，输出system_prompt。
- 回复内容中必然包括任务定义，角色设定，背景故事，回复样例，四大部分。
- 对任务定义原封不动的保留。
- 更新角色设定，角色设定不包括用户本身，角色设定包括其他聊天角色的身份，外貌，性格，个人经历。外貌，个人经历要尽可能详细。每部分描述不要涉及不相关的内容
- 更新背景故事，背景故事要简洁精炼，只记录涉及世界观和重大事件的内容，不超过100字。
- 更新回复样例，记录每个角色根据当前性格生活化的一句聊天内容，要简短，体现人物性格。一人一句。
以下为模版：
# 任务定义
....
# 角色设定
[角色1]
<身份>...</身份>
<外貌>...</外貌>
<性格>...</性格>
<经历>...</经历>

[角色2]
...

# 背景故事
...

# 回复样例
[角色1]....
[角色2]....

直接输出内容，不需要额外的说明。';`

// ==================== 记忆压缩（SPX 新格式） ====================
// useSpxFormat 开启时（默认）发送此模板，要求 AI 在当前 <roleplay_sp> 基础上输出 SPX
// 解析与合并逻辑见 sp_format.js（mergeSp：rules 禁改、缺失节点从旧版回填）
var PROMPT_MEMORY_SPX = `请对以上对话内容进行分析总结，在当前 <roleplay_sp> 的基础上输出更新后的完整 <roleplay_sp>（XML 格式）。
- <task> 节点原封不动保留。
- <rules> 节点整体原样保留，禁止修改。
- <characters> 更新每个角色的身份(identity)、外貌(appearance)、性格(personality)、经历(history)。外貌与经历要尽可能详细。每部分描述不要涉及不相关的内容。不包括用户本身。
- <backstory> 背景故事要简洁精炼，只记录涉及世界观和重大事件的内容，不超过100字。
- <state> 根据最新剧情更新当前状态。
- <samples> 回复样例：记录每个角色根据当前性格生活化的一句聊天内容，要简短，体现人物性格。一人一条，char 属性填角色名。

严格输出要求（必须遵守）：
1. 只输出 XML 本体，第一个字符必须是 <（即 <roleplay_sp），最后一个字符必须是 >；
2. 禁止使用 Markdown 标题（不要出现 # 任务定义 这种旧格式），禁止用反引号代码块包裹；
3. 不要在 XML 前后添加任何说明、寒暄或总结文字；
4. 所有节点标签必须正确闭合，正文中如需使用 < 或 & 请写成 &lt; &amp;。
当前 <roleplay_sp> 已作为 system 消息提供。`;

// ==================== 继续对话 ====================
// 点击「▶ /继续」按钮或输入 /继续 时触发
// 直接调用 requestAI() 以当前 context 继续生成，不需要额外的用户消息
// 如需自定义继续时 AI 感知到的消息，可在此修改
var PROMPT_CONTINUE = '继续当前话题'; // null 表示不加额外消息，直接以已有上下文继续

// ==================== 拍照 ====================
// 点击「📷 拍照」按钮或输入 /拍照 时触发
// triggerTakePhoto() 中 buildPhotoRequestMessages() 发起的拍照指令
// AI 根据该指令生成用于图像生成的 prompt
var PROMPT_TAKE_PHOTO_PREAMBLE = '[系统拍照指令]';
var PROMPT_TAKE_PHOTO_BODY = '请根据以上对话中角色的外貌设定和当前聊天的剧情进展，推算每个涉及角色的当前外貌和状态。';
var PROMPT_TAKE_PHOTO_INSTRUCTION = '\n请为涉及角色返回用于图像生成的 prompt（中文，一段描述性文字，不要用英文逗号分隔的词组格式）。';
var PROMPT_TAKE_PHOTO_SEPARATOR = '\n如果有多个角色，用以下分隔符分隔每个角色的 prompt：\n---\n';
var PROMPT_TAKE_PHOTO_EXAMPLE = '每个 prompt 必须以【角色名】作为开头标记，例如：【林梦】、【苏晴】；若为双人或多人合照，则使用【角色A&角色B】、【角色A&角色B&角色C】这样的格式。角色描述必须高度细化、视觉化、可直接用于 AI 绘图生成，内容需完整涵盖以下维度：角色年龄感、身高、体型、身材比例、肤色、胸型、腰臀曲线、腿部线条、发型、发长、发色、刘海样式、发饰、瞳孔颜色、眼神、睫毛、眉形、嘴唇细节、表情、妆容、服装材质、服装颜色、服装剪裁、饰品、动作、姿势、手部细节、场景互动、镜头感、光影、环境氛围等，整体描述必须自然流畅且具有电影级画面感。角色的外貌描写要突出辨识度与人物性格，例如清冷、温柔、病娇、成熟、元气、知性、傲娇等气质。姿势需要具体，例如“微微侧身”“双手轻握裙摆”“抬头望向远方”“跪坐在沙发边缘”等；表情需细化到眼神与嘴角变化，例如“眼尾微弯”“嘴 唇轻抿”“带着若有若无的笑意”。服装不仅描述类型，还需描述材质与细节，例如“半透明雪纺白裙”“贴身高领毛衣勾勒出丰满胸部曲线”“黑色吊带袜包裹修长双腿”。环境描写需包含时间、天气、光线、色彩氛围，例如“夕阳穿过樱花树洒下暖金色光影”“霓虹灯映照在雨后的街道”。若为多人场景，必须详细描述角色之间的互动与动作关系，例如牵手、整理头发、依靠肩膀、对视、拥抱等，并明确每位角色的 外貌与动作差异，避免混淆。整体输出必须保持一整段形式，不要分点，不要解释，不要加入额外说明，直接输出高质量、细节丰富、可直接用于生成图像的完整 prompt。\n\n例如：\n\n【林梦】一名18岁左右的少女，身高165cm，身材纤细却带着柔和曲线，白皙细腻的肌肤在阳光下泛着淡淡暖色，胸部丰满圆润，腰肢纤细，修长双腿被白色过膝袜包裹。她有一头及腰的柔顺黑色长发，发尾微卷，轻薄空气刘海垂落额前，侧边别着樱花发卡，浅琥珀色眼睛清澈透亮，睫毛纤长，眼尾微微下垂，带着温柔而羞涩的神情，粉嫩嘴唇轻轻抿起一丝笑意。她穿着一件轻薄白色雪纺连衣裙，裙摆随着微风轻轻扬起，胸口带有细腻蕾丝花边，肩部微微裸露，搭配细银项链与珍珠手链。她站在盛开的樱花树下，微微仰头望向飘落的花瓣，一只手轻轻压住被风吹起的裙摆，另一只手自然垂落身侧，夕阳透过粉白花瓣洒下柔和暖金色光影，整个画面充满青春感与电影氛围。\n\n【林梦&苏晴】林梦，一名18岁左右的黑发少女，穿着白色雪纺长裙，纤细柔软的身 体微微靠坐在长椅边缘，浅琥珀色眼睛带着羞涩笑意，双手轻轻扶着裙摆；旁边的苏晴，一位26岁的短发女性，身高172cm，身材高挑成 熟，穿着深蓝色修身西装外套与黑色包臀裙，黑色短发利落干练，金色耳坠在夜色下微微反光，锐利的深灰色眼睛中带着温柔，她正站在林梦身后，微微低头替她整理被风吹乱的长发，一只手轻轻绕起发丝，另一只手扶着她的肩膀。城市夜景与霓虹灯在落地窗外形成朦胧光斑，暖黄色灯光映照在两人的脸侧，空气中带着安静而暧昧的氛围。';
var PROMPT_TAKE_PHOTO_NOTE = '\n注意：请直接输出 prompt 内容，不要额外说明。prompt 要使用完整的中文句子描述，而不是标签式的词组。';

// ==================== 群聊初始化 ====================
// 建群后自动调用 AI 补充角色设定、背景故事和回复样例
// confirmCharSelect() → autoInitGroupChat() 中使用
// 注意：${charDescList} 会被替换为角色描述列表
var PROMPT_GROUP_INIT_TEMPLATE = `是一个多角色扮演模拟引擎。现在需要你根据以下角色信息，完成初始化设置。

角色列表：
\${charDescList}

请完成以下任务：
1. 为每个角色补充详细的设定，包含角色的外貌、身份背景、性格。其中外貌进行详细描写
2. 随机生成一句话的初始场景作为背景故事，要有剧情冲突
3. 为每个角色生成一句回复样例，突出人物性格
4. 如果角色名是知名二次元角色，则直接套用二次元设定。

严格按照以下 XML 格式输出（只输出这三个节点，不要输出 <roleplay_sp> 根节点，不要输出 task / rules，不要额外说明）：
<characters>
  <character name="角色名">
    <identity>身份背景描写</identity>
    <appearance>外貌详细描写，例如：身高165cm，一头柔顺的黑色长发垂至腰际，斜刘海半遮右眼，琥珀般的眼眸清澈见底。皮肤白皙，常穿白色连衣裙配米色开衫。</appearance>
    <personality>性格描写，例如：温柔细腻但内心坚韧，待人接物有礼有节，偶尔会流露出俏皮的一面。</personality>
    <history>个人经历描写</history>
  </character>
</characters>
<backstory>一句话场景描述，要有剧情冲突</backstory>
<samples>
  <sample char="角色名">一句生活化的台词</sample>
</samples>`;
function buildGroupInitPrompt(charDescList) {
  return PROMPT_GROUP_INIT_TEMPLATE.replace('${charDescList}', charDescList);
}

// ==================== 自动话题 ====================
// 自动找话题功能发送给 AI 的系统提示
// triggerAutoTopic() 中使用
// 注意：${charHint} 会被替换为实际可选角色名
var PROMPT_AUTO_TOPIC_TEMPLATE = '如果当前没有进行中事件，则随机选择一个角色{charHint}触发事件，否则让多个角色之间根据之前的事件进行延续发展，事件没结束则不触发新事件。请用【角色名】的格式来标记说话人。直接输出内容，不需要额外的说明。';
function buildAutoTopicPrompt(charHint) {
  return PROMPT_AUTO_TOPIC_TEMPLATE.replace('{charHint}', charHint || '');
}

// ==================== 显示在日志中的友好名称 ====================
var LOG_NAME_MEMORY = ' [压缩记忆]';
var LOG_NAME_PHOTO = ' [拍照]';
var LOG_NAME_AUTO_TOPIC = ' [自动话题]';
var LOG_NAME_GROUP_INIT = ' [群聊初始化]';

// ==================== 自定义提示词（设置 → 数据 → 功能提示词调整） ====================
// 用户可在设置中覆盖以下三个功能的运行时控制提示词：
//   memory   → 记忆功能（/记忆、🧠 按钮）
//   continue → 继续功能（/继续、▶ 按钮）
//   photo    → 拍照功能（📷 拍照按钮）
// 覆盖值为空字符串时使用本文件的默认值。

/* 读取某个功能的自定义提示词（未自定义时返回空字符串） */
function getPromptOverride(type) {
  try {
    if (typeof appData !== 'undefined' && appData && appData.settings && appData.settings.promptOverrides) {
      return appData.settings.promptOverrides[type] || '';
    }
  } catch (e) { /* ignore */ }
  return '';
}

/* 记忆功能实际发送的压缩指令 */
function getMemoryPrompt() {
  return getPromptOverride('memory') || PROMPT_MEMORY;
}

/* 继续功能实际发送的控制提示词（空字符串/null 表示不附带额外消息） */
function getContinuePrompt() {
  var override = getPromptOverride('continue');
  if (override !== '') return override;
  return (typeof PROMPT_CONTINUE === 'string') ? PROMPT_CONTINUE : '';
}

/* 拍照正文：单角色时用指定角色的推算指令，否则用默认多角色正文 */
function getPhotoBodyDefault(specificCharacter) {
  if (specificCharacter) {
    return '请根据以上对话中角色的外貌设定和聊天记录，推算角色' + specificCharacter + '的当前外貌和状态。';
  }
  return PROMPT_TAKE_PHOTO_BODY;
}

/* 拍照模板默认值（设置编辑器中展示）。
   占位符：${photoBody} 角色推算正文 / ${roleList} 涉及角色列表 / ${appearanceGuide} 外貌设定参考 */
function getPhotoPromptTemplate() {
  return PROMPT_TAKE_PHOTO_PREAMBLE + '\n${photoBody}\n${roleList}\n${appearanceGuide}\n'
    + PROMPT_TAKE_PHOTO_INSTRUCTION + PROMPT_TAKE_PHOTO_SEPARATOR + PROMPT_TAKE_PHOTO_EXAMPLE + PROMPT_TAKE_PHOTO_NOTE;
}

/* 组装拍照功能实际发送的完整指令 */
function buildPhotoPrompt(specificCharacter, roleList, appearanceGuide) {
  var tpl = getPromptOverride('photo') || getPhotoPromptTemplate();
  return tpl
    .replace(/\$\{photoBody\}/g, getPhotoBodyDefault(specificCharacter))
    .replace(/\$\{roleList\}/g, roleList || '')
    .replace(/\$\{appearanceGuide\}/g, appearanceGuide || '');
}

/* 各功能默认提示词（设置编辑器中使用）
   memory：跟随「新版 XML System Prompt」开关返回对应格式的默认模板，
   避免编辑器在 SPX 模式下仍展示旧版 Markdown 模板造成误导 */
function getDefaultPromptText(type) {
  if (type === 'memory') {
    var useSpx = !appData.settings || appData.settings.useSpxFormat !== false;
    return useSpx ? PROMPT_MEMORY_SPX : PROMPT_MEMORY;
  }
  if (type === 'continue') return getContinuePrompt();
  if (type === 'photo') return getPhotoPromptTemplate();
  return '';
}