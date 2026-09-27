
/**
 * SPX（System Prompt XML）格式唯一出入口
 *
 * System Prompt 的唯一格式为 <roleplay_sp> XML（详见 docs/SP格式统一方案.md）：
 *   - 顶层节点：task / characters / backstory / state / samples / rules
 *   - 注：items（特殊物品）已按需求从格式中移除；旧数据中的 <items> 在下次写入时被忽略
 *   - 记忆压缩、群聊初始化让 AI 直接输出 SPX；本文件负责解析 / 序列化 / 合并 / 旧格式迁移
 *   - 其他文件禁止再写 SP 结构解析正则，一律调用本模块
 *
 * 消息层协议（不属于 SP 格式，不在本文件管辖）：
 *   - 说话人：AI 回复中的【角色名】分段（parseSpeakerSegments）
 *   - 拍照触发：function call take_photo（tool_registry.js）
 */

var SPX_ROOT = 'roleplay_sp';
var SPX_FORMAT = 1;

// 说话人格式规则（由 App 写入 <rules>，记忆压缩时禁改）
var SPX_SPEAKER_RULE = '回复时以角色名字用【】开头分段。如果是旁白则直接加在文本开始或结尾。除角色名外，消息内不再出现【】字符。';

// 群聊初始化的任务定义（generateGroupSystemPrompt 使用）
var SPX_GROUP_TASK = '你现在是一个多角色扮演模拟引擎，负责驱动一个叙事世界。你的任务是：\n' +
  '- 严格遵循指定角色的身份、性格、知识背景和说话风格。\n' +
  '- 用户：根据关系和性格有对应亲密称呼，默认为你。\n' +
  '- 推动符合当前世界观下的合理剧情发展。\n' +
  '- 在需要时自动完成各角色之间的对话、必要时包括行动和内在心理描写。';

/* ==================== 基础工具 ==================== */

/* XML 文本/属性转义 */
function escXml(s) {
  if (s === undefined || s === null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/* 还原实体（仅容错正则解析路径使用；DOMParser 路径已自动解码） */
function unescapeXmlEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&');
}

/* 判断一段文本是否已是 SPX 格式 */
function isSpFormat(xmlText) {
  return typeof xmlText === 'string' && /^\s*<\s*roleplay_sp\b/.test(xmlText);
}

/**
 * 预清洗 AI 输出：去除 ``` 包裹 / JSON 抽取 / 前导废话
 * （原 cleanAndRepairSp 的第 1~3 步收编于此，仅处理 AI 原始返回）
 */
function preCleanAiSpOutput(raw) {
  if (!raw) return '';
  var cleaned = String(raw).trim();

  // 去除 ```...``` 代码块包裹（支持 ```json、```xml 等）
  cleaned = cleaned.replace(/^```[a-zA-Z]*\s*\n?/i, '');
  cleaned = cleaned.replace(/\n?```\s*$/i, '');
  cleaned = cleaned.trim();

  // 检测并提取 JSON 格式的内容（AI 可能返回 {"system_prompt": "..."} 等）
  if (/^[\{\[]/.test(cleaned)) {
    try {
      var jsonObj = JSON.parse(cleaned);
      var extracted = jsonObj.system_prompt || jsonObj.systemPrompt
        || jsonObj.content || jsonObj.prompt || jsonObj.text || '';
      if (extracted && typeof extracted === 'string') {
        cleaned = extracted.trim();
      }
    } catch (e) {
      var spMatch = cleaned.match(/"system_prompt"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
      if (spMatch) {
        try {
          cleaned = JSON.parse('"' + spMatch[1] + '"').trim();
        } catch (e2) { /* 保留原文本 */ }
      }
    }
  }

  // 去除 SPX 之外的前导废话：截取从 <roleplay_sp 或第一个 # 标题或首个已知标签开始
  // 剥离零宽字符 / BOM（会绕过 isSpFormat 的 ^ 锚点检测）
  cleaned = cleaned.replace(/^[\uFEFF\u200B-\u200D\u2060]+/, '').trim();

  // 剥离 <?xml ... ?> 声明（部分模型会带上）
  cleaned = cleaned.replace(/^<\?xml[^>]*\?>\s*/i, '').trim();

  var rootIdx = cleaned.search(/<\s*roleplay_sp\b/);
  if (rootIdx > 0) {
    cleaned = cleaned.substring(rootIdx).trim();
  } else if (!isSpFormat(cleaned)) {
    var headingIdx = cleaned.search(/^#\s+/m);
    var tagIdx = cleaned.search(/<\s*(task|characters|backstory|state|samples|rules)\b/);
    var cut = -1;
    if (headingIdx >= 0 && tagIdx >= 0) cut = Math.min(headingIdx, tagIdx);
    else if (headingIdx >= 0) cut = headingIdx;
    else if (tagIdx >= 0) cut = tagIdx;
    if (cut > 0) cleaned = cleaned.substring(cut).trim();
  }

  // 根节点之后若还有收尾说明文字，一并剥离（如「希望对你有帮助！」）
  if (isSpFormat(cleaned)) {
    var closeIdx = cleaned.lastIndexOf('</' + SPX_ROOT + '>');
    if (closeIdx >= 0 && closeIdx + SPX_ROOT.length + 3 < cleaned.length) {
      var tail = cleaned.slice(closeIdx + SPX_ROOT.length + 3).trim();
      if (tail && !/^<\s*\/?\s*roleplay_sp/.test(tail)) {
        cleaned = cleaned.slice(0, closeIdx + SPX_ROOT.length + 3).trim();
      }
    }
  }

  return cleaned;
}

/* ==================== 解析 ==================== */

/**
 * 解析 SPX → 结构化模型（卡片数据源 / 各功能读取入口）
 * 返回：
 * {
 *   task, backstory, state: string,
 *   characters: [{ name, identity, appearance, personality, history, extra:[{tag,text}] }],
 *   samples: [{ char, text }],
 *   rules: [{ id, text }],
 *   unknown: [{ tag, attrs:{}, text }]   // 未识别的顶层标签，原样保留
 * }
 * 无法解析时返回 null
 */
function parseSp(xmlText) {
  if (!xmlText || typeof xmlText !== 'string') return null;
  var trimmed = xmlText.trim();
  if (!trimmed) return null;
  if (!isSpFormat(trimmed)) return null; // 旧格式 / 非法内容不在此解析

  var model = null;
  if (typeof DOMParser !== 'undefined') {
    try { model = _parseSpDom(trimmed); } catch (e) { model = null; }
  }
  if (!model) {
    try { model = _parseSpRegex(trimmed); } catch (e2) { model = null; }
  }
  return model;
}

/* 创建空模型 */
function _emptySpModel() {
  return {
    task: '',
    characters: [],
    backstory: '',
    state: '',
    samples: [],
    rules: [],
    unknown: []
  };
}

/* 解析属性字符串 name="a" b='c' → {} */
function _parseAttrs(attrsStr) {
  var attrs = {};
  if (!attrsStr) return attrs;
  var re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  var m;
  while ((m = re.exec(attrsStr)) !== null) {
    attrs[m[1]] = unescapeXmlEntities(m[3] !== undefined ? m[3] : m[4]);
  }
  return attrs;
}

/**
 * 容错顶层扫描器：按顺序扫描 innerHTML 中最外层的 <tag attrs>...</tag> 对
 * 自闭合标签 / 零散文本不匹配，自动跳过
 */
function _scanTopLevel(inner) {
  var results = [];
  if (!inner) return results;
  var re = /<([a-zA-Z_\u4e00-\u9fff][\w\u4e00-\u9fff:-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s">]+))*)\s*>([\s\S]*?)<\/\1>/g;
  var cursor = 0;
  var m;
  while ((m = re.exec(inner)) !== null) {
    if (m.index < cursor) continue; // 跳过嵌套重叠
    results.push({
      tag: m[1],
      attrs: _parseAttrs(m[2]),
      text: m[3],
      start: m.index,
      end: m.index + m[0].length
    });
    cursor = m.index + m[0].length;
  }
  return results;
}

/* 容错正则解析路径（不依赖 DOMParser，Node 亦可测试） */
function _parseSpRegex(trimmed) {
  var inner = trimmed;

  // 提取根节点内容；根节点缺失时容忍直接从顶层标签开始
  var rootMatch = trimmed.match(new RegExp('^<\\s*' + SPX_ROOT + '\\b[^>]*>([\\s\\S]*)<\\/\\s*' + SPX_ROOT + '\\s*>', 'i'));
  if (rootMatch) {
    inner = rootMatch[1];
  }

  var tops = _scanTopLevel(inner);
  if (tops.length === 0) return null;

  var model = _emptySpModel();
  // 根外的零散文本（前导废话的残余）并入 task，尽量不丢内容
  var covered = [];
  for (var i = 0; i < tops.length; i++) covered.push(tops[i]);
  var lastEnd = 0;
  var gaps = [];
  for (var g = 0; g < covered.length; g++) {
    if (covered[g].start > lastEnd) {
      gaps.push(inner.substring(lastEnd, covered[g].start));
    }
    lastEnd = covered[g].end;
  }
  if (lastEnd < inner.length) gaps.push(inner.substring(lastEnd));
  var gapJoined = gaps.join('\n').replace(/<\s*\/?\s*roleplay_sp[^>]*>/g, '').trim();
  if (gapJoined) {
    model.task = (model.task ? model.task + '\n\n' : '') + unescapeXmlEntities(gapJoined);
  }

  for (var k = 0; k < tops.length; k++) {
    var el = tops[k];
    switch (el.tag) {
      case 'task':
        model.task = (model.task ? model.task + '\n\n' : '') + unescapeXmlEntities(el.text.trim());
        break;
      case 'characters':
        _parseCharactersRegex(el.text, model);
        break;
      case 'backstory':
        model.backstory = unescapeXmlEntities(el.text.trim());
        break;
      case 'state':
        model.state = unescapeXmlEntities(el.text.trim());
        break;
      case 'items':
        // 特殊物品已从 SP 格式中移除：旧数据中的 <items> 直接忽略，不再写回
        break;
      case 'samples':
        var sampleTops = _scanTopLevel(el.text);
        for (var st = 0; st < sampleTops.length; st++) {
          if (sampleTops[st].tag === 'sample') {
            model.samples.push({
              char: sampleTops[st].attrs.char || '',
              text: unescapeXmlEntities(sampleTops[st].text.trim())
            });
          }
        }
        break;
      case 'rules':
        var ruleTops = _scanTopLevel(el.text);
        for (var rt = 0; rt < ruleTops.length; rt++) {
          if (ruleTops[rt].tag === 'rule') {
            model.rules.push({
              id: ruleTops[rt].attrs.id || '',
              text: unescapeXmlEntities(ruleTops[rt].text.trim())
            });
          }
        }
        break;
      default:
        model.unknown.push({ tag: el.tag, attrs: el.attrs, text: el.text.trim() });
    }
  }

  return model;
}

/* characters 容错解析（支持英文/中文标签双写） */
function _parseCharactersRegex(inner, model) {
  var charTops = _scanTopLevel(inner);
  var list = [];
  for (var i = 0; i < charTops.length; i++) {
    var el = charTops[i];
    if (el.tag !== 'character') continue;
    var fields = _scanTopLevel(el.text);
    var ch = {
      name: el.attrs.name || '',
      identity: '',
      appearance: '',
      personality: '',
      history: '',
      extra: []
    };
    for (var f = 0; f < fields.length; f++) {
      var fd = fields[f];
      var val = unescapeXmlEntities(fd.text.trim());
      switch (fd.tag) {
        case 'identity': case '身份': ch.identity = val; break;
        case 'appearance': case '外貌': ch.appearance = val; break;
        case 'personality': case '性格': ch.personality = val; break;
        case 'history': case '经历': ch.history = val; break;
        default: ch.extra.push({ tag: fd.tag, text: val });
      }
    }
    list.push(ch);
  }
  model.characters = list;
}

/* DOMParser 严格解析路径（浏览器） */
function _parseSpDom(trimmed) {
  var doc = new DOMParser().parseFromString(trimmed, 'text/xml');
  // 解析失败判定：不同内核下 parsererror 的位置不同，三种检查都做一遍
  if (doc.getElementsByTagName && doc.getElementsByTagName('parsererror').length > 0) return null;
  if (doc.querySelector && doc.querySelector('parsererror')) return null;
  var root = doc.documentElement;
  if (!root || root.nodeName === 'parsererror') return null;
  if (root.nodeName !== SPX_ROOT) return null;

  var model = _emptySpModel();
  var children = root.children;
  for (var i = 0; i < children.length; i++) {
    var el = children[i];
    switch (el.nodeName) {
      case 'task':
        model.task = el.textContent.trim();
        break;
      case 'characters': {
        var chars = el.children;
        for (var c = 0; c < chars.length; c++) {
          if (chars[c].nodeName !== 'character') continue;
          var ch = {
            name: chars[c].getAttribute('name') || '',
            identity: '',
            appearance: '',
            personality: '',
            history: '',
            extra: []
          };
          var fields = chars[c].children;
          for (var f = 0; f < fields.length; f++) {
            var val = fields[f].textContent.trim();
            switch (fields[f].nodeName) {
              case 'identity': case '身份': ch.identity = val; break;
              case 'appearance': case '外貌': ch.appearance = val; break;
              case 'personality': case '性格': ch.personality = val; break;
              case 'history': case '经历': ch.history = val; break;
              default: ch.extra.push({ tag: fields[f].nodeName, text: val });
            }
          }
          model.characters.push(ch);
        }
        break;
      }
      case 'backstory': model.backstory = el.textContent.trim(); break;
      case 'state': model.state = el.textContent.trim(); break;
      case 'items':
        // 特殊物品已从 SP 格式中移除（忽略旧数据）
        break;
      case 'samples': {
        var samples = el.children;
        for (var s = 0; s < samples.length; s++) {
          if (samples[s].nodeName === 'sample') {
            model.samples.push({ char: samples[s].getAttribute('char') || '', text: samples[s].textContent.trim() });
          }
        }
        break;
      }
      case 'rules': {
        var rules = el.children;
        for (var r = 0; r < rules.length; r++) {
          if (rules[r].nodeName === 'rule') {
            model.rules.push({ id: rules[r].getAttribute('id') || '', text: rules[r].textContent.trim() });
          }
        }
        break;
      }
      default:
        model.unknown.push({ tag: el.nodeName, attrs: {}, text: el.textContent.trim() });
    }
  }
  return model;
}

/* ==================== 序列化 ==================== */

/**
 * 结构化模型 → SPX 文本（固定节点顺序；未知标签追加在末尾）
 * 文本节点经 escXml 转义
 */
function serializeSp(model) {
  if (!model) return '';
  var out = '<' + SPX_ROOT + ' format="' + SPX_FORMAT + '">\n';

  out += '  <task>' + escXml(model.task || '') + '</task>\n';

  out += '  <characters>\n';
  var chars = model.characters || [];
  for (var i = 0; i < chars.length; i++) {
    var c = chars[i];
    out += '    <character name="' + escXml(c.name || '') + '">\n';
    out += '      <identity>' + escXml(c.identity || '') + '</identity>\n';
    out += '      <appearance>' + escXml(c.appearance || '') + '</appearance>\n';
    out += '      <personality>' + escXml(c.personality || '') + '</personality>\n';
    out += '      <history>' + escXml(c.history || '') + '</history>\n';
    var extras = c.extra || [];
    for (var e = 0; e < extras.length; e++) {
      out += '      <' + extras[e].tag + '>' + escXml(extras[e].text || '') + '</' + extras[e].tag + '>\n';
    }
    out += '    </character>\n';
  }
  out += '  </characters>\n';

  out += '  <backstory>' + escXml(model.backstory || '') + '</backstory>\n';
  out += '  <state>' + escXml(model.state || '') + '</state>\n';

  out += '  <samples>\n';
  var samples = model.samples || [];
  for (var s = 0; s < samples.length; s++) {
    out += '    <sample char="' + escXml(samples[s].char || '') + '">' + escXml(samples[s].text || '') + '</sample>\n';
  }
  out += '  </samples>\n';

  // rules：speaker-format 固定在前，其余按原顺序
  var rules = (model.rules || []).slice();
  rules.sort(function (a, b) {
    var pa = a.id === 'speaker-format' ? 0 : 1;
    var pb = b.id === 'speaker-format' ? 0 : 1;
    return pa - pb;
  });
  out += '  <rules>\n';
  for (var r = 0; r < rules.length; r++) {
    if (!rules[r].id) continue;
    out += '    <rule id="' + escXml(rules[r].id) + '">' + escXml(rules[r].text || '') + '</rule>\n';
  }
  out += '  </rules>\n';

  var unknown = model.unknown || [];
  for (var u = 0; u < unknown.length; u++) {
    var uk = unknown[u];
    var attrStr = '';
    var keys = Object.keys(uk.attrs || {});
    for (var a = 0; a < keys.length; a++) {
      attrStr += ' ' + keys[a] + '="' + escXml(uk.attrs[keys[a]]) + '"';
    }
    out += '  <' + uk.tag + attrStr + '>' + escXml(uk.text || '') + '</' + uk.tag + '>\n';
  }

  out += '</' + SPX_ROOT + '>';
  return out;
}

/* 检测文本是否为旧版 Markdown 结构（模型没按 SPX 模板输出时的兜底依据） */
function _looksLikeLegacySp(text) {
  return /^#\s*(任务定义|角色设定|背景故事|当前状态|回复样例|特殊物品)/m.test(text || '');
}

/* ==================== 合并（记忆压缩兜底） ==================== */

/**
 * 以新版为主、旧版补缺：task/rules 等关键节点新版为空时取旧版；
 * rules 永远以旧版为准（说话人格式禁改）。任一侧解析失败时尽力而为。
 * 返回 SPX 文本；新版完全不可解析时返回 null（由调用方放弃写入）
 */
function mergeSp(newXml, prevXml) {
  var cleanedNew = preCleanAiSpOutput(newXml || '');
  var m1 = parseSp(cleanedNew);
  if (!m1 && cleanedNew && !isSpFormat(cleanedNew)
    && /<\s*(characters|task|backstory|state|samples|rules)\b/.test(cleanedNew)) {
    // AI 只输出片段（如群聊初始化只填 characters/backstory/samples）：包一层根节点再解析
    m1 = parseSp('<' + SPX_ROOT + ' format="' + SPX_FORMAT + '">' + cleanedNew + '</' + SPX_ROOT + '>');
  }
  if (!m1 && _looksLikeLegacySp(cleanedNew)) {
    // 模型没按 SPX 模板走、输出了旧版 Markdown 结构：迁移为 SPX 后照常合并（不丢用户记忆）
    var migratedLegacy = migrateLegacySp(cleanedNew);
    if (migratedLegacy && isSpFormat(migratedLegacy)) m1 = parseSp(migratedLegacy);
  }
  if (!m1) return null;
  var m0 = prevXml ? parseSp(prevXml) : null;
  if (!m0) return serializeSp(m1);

  // task：新版为空取旧版
  if (!m1.task.trim()) m1.task = m0.task;

  // characters：新版为空整体取旧版；否则按名字合并，空字段从旧版补齐
  if (m1.characters.length === 0) {
    m1.characters = m0.characters;
  } else {
    for (var i = 0; i < m0.characters.length; i++) {
      var prevChar = m0.characters[i];
      var found = null;
      for (var j = 0; j < m1.characters.length; j++) {
        if (m1.characters[j].name === prevChar.name) { found = m1.characters[j]; break; }
      }
      if (!found) {
        m1.characters.push(prevChar);
      } else {
        if (!found.identity) found.identity = prevChar.identity;
        if (!found.appearance) found.appearance = prevChar.appearance;
        if (!found.personality) found.personality = prevChar.personality;
        if (!found.history) found.history = prevChar.history;
        if (found.extra.length === 0 && prevChar.extra.length > 0) found.extra = prevChar.extra;
      }
    }
  }

  if (!m1.backstory.trim()) m1.backstory = m0.backstory;
  if (!m1.state.trim()) m1.state = m0.state;
  if (m1.samples.length === 0) m1.samples = m0.samples;

  // rules：以旧版为准（禁改）；旧版无 rules 时才采用新版
  if (m0.rules.length > 0) m1.rules = m0.rules;

  // 未知标签：合并保留
  for (var u = 0; u < m0.unknown.length; u++) {
    var dupe = false;
    for (var v = 0; v < m1.unknown.length; v++) {
      if (m1.unknown[v].tag === m0.unknown[u].tag) { dupe = true; break; }
    }
    if (!dupe) m1.unknown.push(m0.unknown[u]);
  }

  return serializeSp(m1);
}

/* ==================== 旧格式迁移 ==================== */

/* 从旧 SP 文本中提取 # 标题区块（仅迁移期使用） */
function _extractLegacySection(spText, sectionName) {
  if (!spText) return '';
  var regex = new RegExp('^#\\s*' + sectionName + '\\s*\\n([\\s\\S]*?)(?=^#\\s|$(?!\\n))', 'm');
  var match = spText.match(regex);
  return match ? match[1].trim() : '';
}

/* 剥离旧任务定义中拼接的自动拍照触发指令（已迁出 SP，改由 function call 触发） */
function _stripLegacyPhotoTrigger(taskText) {
  var t = taskText;
  // 整块：- 每次回复根据当前聊天记录……<trigger …/>
  t = t.replace(/-\s*每次回复根据当前聊天记录[\s\S]*?<trigger[^>]*\/>\s*/g, '');
  // 残留的标记格式说明行 / trigger 标签行
  t = t.replace(/拍照标记格式[^\n]*\n?/g, '');
  t = t.replace(/^\s*<trigger\s+type="photo"[^\n]*\n?/gm, '');
  t = t.replace(/^\s*-\s*$/gm, ''); // 剥离后残留的空 bullet
  return t.trim();
}

/* 旧格式角色字段提取：<外貌>XML</外貌> 优先，退到 外貌： 冒号格式 */
function _extractLegacyCharField(charBody, fieldName) {
  var xml = charBody.match(new RegExp('<' + fieldName + '>([\\s\\S]*?)<\\/' + fieldName + '>'));
  if (xml) return xml[1].trim();
  // 冒号格式：到下一个字段行（XML 标签或 冒号字段）或段落结束为止
  var colon = charBody.match(new RegExp(
    fieldName + '[：:]\\s*([\\s\\S]*?)(?=\\n\\s*\\n|\\n\\s*<(?:身份|外貌|性格|经历)>|\\n\\s*(?:身份|外貌|性格|经历)[：:]|$)'
  ));
  if (colon) return colon[1].trim();
  return '';
}

/**
 * 旧混合格式（Markdown 标题 + XML 字段 + 【】锚点）→ SPX
 * - 无任何可识别结构时，全文并入 task（无损保留）
 * - 彻底无法处理时返回原文（调用方保留 legacyContent）
 */
function migrateLegacySp(legacyText) {
  if (!legacyText || typeof legacyText !== 'string' || !legacyText.trim()) return legacyText;
  if (isSpFormat(legacyText)) return legacyText;

  var text = legacyText.trim();
  var model = _emptySpModel();

  var task = _extractLegacySection(text, '任务定义');
  var charSec = _extractLegacySection(text, '角色设定');
  var backstory = _extractLegacySection(text, '背景故事');
  var state = _extractLegacySection(text, '当前状态');
  var samplesSec = _extractLegacySection(text, '回复样例');

  // 任务定义（剥离自动拍照指令）；没有 # 标题的旧 SP（用户手写自由格式）整体进 task
  model.task = _stripLegacyPhotoTrigger(task || text);

  // 角色设定：【角色名】切段 → 字段归一
  if (charSec) {
    var charRe = /【(.+?)】([\s\S]*?)(?=\n【|$)/g;
    var cm;
    while ((cm = charRe.exec(charSec)) !== null) {
      var name = cm[1].trim();
      var body = cm[2];
      if (!body.trim()) continue;
      model.characters.push({
        name: name,
        identity: _extractLegacyCharField(body, '身份'),
        appearance: _extractLegacyCharField(body, '外貌'),
        personality: _extractLegacyCharField(body, '性格'),
        history: _extractLegacyCharField(body, '经历'),
        extra: []
      });
    }
    // 整段没有【】但含 <外貌> 标签：单角色无锚点的旧格式
    if (model.characters.length === 0 && /<外貌>[\s\S]*?<\/外貌>/.test(charSec)) {
      model.characters.push({
        name: '',
        identity: _extractLegacyCharField(charSec, '身份'),
        appearance: _extractLegacyCharField(charSec, '外貌'),
        personality: _extractLegacyCharField(charSec, '性格'),
        history: _extractLegacyCharField(charSec, '经历'),
        extra: []
      });
    }
  }

  model.backstory = backstory;
  model.state = state || '无';

  // 回复样例：【角色名】切段
  if (samplesSec) {
    var sampleRe = /【(.+?)】([\s\S]*?)(?=【(.+?)】|$)/g;
    var sm;
    while ((sm = sampleRe.exec(samplesSec)) !== null) {
      var sText = sm[2].trim();
      if (sText) model.samples.push({ char: sm[1].trim(), text: sText });
    }
  }

  model.rules.push({ id: 'speaker-format', text: SPX_SPEAKER_RULE });

  return serializeSp(model);
}

/* 懒迁移单个版本：content 原文存 legacyContent，content 原地替换为 SPX */
function ensureSpVersionMigrated(ver) {
  if (!ver || typeof ver.content !== 'string' || !ver.content.trim()) return false;
  if (ver.format === SPX_FORMAT && isSpFormat(ver.content)) return false;
  if (isSpFormat(ver.content)) {
    ver.format = SPX_FORMAT;
    return true;
  }
  if (!ver.legacyContent) ver.legacyContent = ver.content;
  var xml = migrateLegacySp(ver.content);
  if (xml && isSpFormat(xml)) {
    ver.content = xml;
    ver.format = SPX_FORMAT;
    return true;
  }
  return false;
}

/* 迁移一个聊天的全部 SP 版本（selectChat / 导入数据时调用） */
function migrateChatSpVersions(chat) {
  if (!chat || !chat.spVersions) return false;
  var changed = false;
  for (var i = 0; i < chat.spVersions.length; i++) {
    if (ensureSpVersionMigrated(chat.spVersions[i])) changed = true;
  }
  return changed;
}

/* ==================== 功能读取入口 ==================== */

/**
 * 提取角色外貌（拍照用，替代旧三重正则）
 * @returns [{ characterName, appearance }]；onlyName 指定时只返回该角色
 * SPX 解析失败时回退旧格式提取（迁移失败的兜底）
 */
function getAppearances(xmlText, onlyName) {
  var list = [];
  var model = parseSp(xmlText);
  if (model) {
    for (var i = 0; i < model.characters.length; i++) {
      var c = model.characters[i];
      if (c.appearance) list.push({ characterName: c.name, appearance: c.appearance });
    }
  }
  // 兜底：旧格式【角色名】+ <外貌> 扫描（含冒号格式）
  if (list.length === 0 && xmlText) {
    var charRe = /【(.+?)】([\s\S]*?)(?=\n【|$)/g;
    var m;
    while ((m = charRe.exec(xmlText)) !== null) {
      var app = _extractLegacyCharField(m[2], '外貌');
      if (app) list.push({ characterName: m[1].trim(), appearance: app });
    }
    if (list.length === 0) {
      var xmlRe = /<外貌>([\s\S]*?)<\/外貌>/g;
      while ((m = xmlRe.exec(xmlText)) !== null) {
        list.push({ characterName: '', appearance: m[1].trim() });
      }
    }
  }
  if (onlyName) {
    list = list.filter(function (s) { return s.characterName === onlyName; });
  }
  return list;
}

/* 提取 SP 中的角色名列表（关联角色检测 / 自动话题兜底用） */
function getSpCharacterNames(xmlText) {
  var model = parseSp(xmlText);
  if (model && model.characters.length > 0) {
    var names = [];
    for (var i = 0; i < model.characters.length; i++) {
      if (model.characters[i].name && names.indexOf(model.characters[i].name) === -1) {
        names.push(model.characters[i].name);
      }
    }
    if (names.length > 0) return names;
  }
  // 兜底：旧格式【】扫描
  var out = [];
  var re = /【([^】]+)】/g;
  var m;
  while ((m = re.exec(xmlText || '')) !== null) {
    if (out.indexOf(m[1]) === -1) out.push(m[1]);
  }
  return out;
}

/* 提取指定角色的身份/性格（编辑关联角色表单用） */
function getSpIdentityFields(xmlText, charName) {
  var model = parseSp(xmlText);
  if (model) {
    for (var i = 0; i < model.characters.length; i++) {
      if (model.characters[i].name === charName) {
        return { identity: model.characters[i].identity, personality: model.characters[i].personality };
      }
    }
    return { identity: '', personality: '' };
  }
  // 兜底：旧格式
  var marker = '【' + charName + '】';
  var idx = (xmlText || '').indexOf(marker);
  if (idx === -1) return { identity: '', personality: '' };
  var after = xmlText.substring(idx + marker.length);
  var next = after.indexOf('【');
  var body = next !== -1 ? after.substring(0, next) : after;
  return {
    identity: _extractLegacyCharField(body, '身份'),
    personality: _extractLegacyCharField(body, '性格')
  };
}

/**
 * 群聊初始化：生成 SPX 骨架（AI 之后只填 characters/backstory/samples）
 * @param selectedChars [{ name, description }]
 */
function buildGroupSpTemplate(selectedChars) {
  var model = _emptySpModel();
  model.task = SPX_GROUP_TASK;
  model.characters = (selectedChars || []).map(function (c) {
    return {
      name: c.name || '',
      identity: c.description || '',
      appearance: '',
      personality: '',
      history: '',
      extra: []
    };
  });
  model.state = '无';
  model.rules.push({ id: 'speaker-format', text: SPX_SPEAKER_RULE });
  return serializeSp(model);
}
