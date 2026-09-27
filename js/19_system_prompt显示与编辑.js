
/**
 * System Prompt 显示与编辑
 * 自动拆分模块
 * 保持全局兼容模式
 *
 * 编辑采用「区块卡片 + 源码模式」双 Tab（见 docs/SP格式统一方案.md 6.5）：
 *   - 区块卡片：parseSp() 模型 → 每个顶层节点一张卡片，分区修改
 *   - 源码模式：直接编辑 SPX 全文，保存前 parseSp() 校验
 * 序列化统一走 sp_format.js，本文件不写任何 SP 结构正则。
 */

function updateSpDisplay() {
  var sp = getCurrentSpVersion();
  var display = document.getElementById('spDisplay');
  var badge = document.getElementById('spVersionBadge');
  var versionText = document.getElementById('spVersionText');
  var prevBtn = document.getElementById('spPrevBtn');
  var nextBtn = document.getElementById('spNextBtn');

  if (!currentChatId || !appData.chats[currentChatId]) {
    badge.textContent = 'v0';
    versionText.textContent = '无版本';
    display.textContent = '暂无 System Prompt';
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  var chat = appData.chats[currentChatId];
  badge.textContent = 'v' + sp.version;
  versionText.textContent = `${chat.spViewIndex + 1} / ${chat.spVersions.length}`;
  prevBtn.disabled = chat.spViewIndex <= 0;
  nextBtn.disabled = chat.spViewIndex >= chat.spVersions.length - 1;

  // 淡入淡出动画
  display.classList.add('fading');
  setTimeout(() => {
    display.innerHTML = renderSpBlocksHtml(sp.content || '');
    display.classList.remove('fading');
  }, 200);
}

/* ==================== SP 区块展示（只读，彩色区块） ==================== */
/* 空区块在展示时跳过；SPX 解析失败回退纯文本（旧格式未迁移/自由文本） */

function renderSpBlocksHtml(spContent) {
  var model = parseSp(spContent);
  if (!model) {
    var text = (spContent || '').trim();
    return text ? '<div class="sp-blocks"><div class="sp-block sp-block--unknown">' +
      '<div class="sp-block-body">' + spTextHtml(text) + '</div></div></div>' : '（空）';
  }

  var html = '';

  // 任务定义
  if (model.task && model.task.trim()) {
    html += spBlockHtml('task', '任务定义', spTextHtml(model.task));
  }

  // 角色设定：每个角色一张子卡（只显示已填写的字段）
  if (model.characters.length > 0) {
    var charsHtml = model.characters.map(function (c) {
      var pairs = [['身份', c.identity], ['外貌', c.appearance], ['性格', c.personality], ['经历', c.history]];
      var filled = pairs.filter(function (f) { return f[1] && f[1].trim(); });
      var body = filled.length
        ? filled.map(function (f) {
          return '<div class="sp-field"><div class="sp-field-label">' + f[0] + '</div>' +
            '<div class="sp-field-text">' + escHtml(f[1]) + '</div></div>';
        }).join('')
        : '<div class="sp-block-empty">（未填写）</div>';
      return '<div class="sp-char-block"><div class="sp-char-block-head">' + escHtml(c.name || '未命名') + '</div>' + body + '</div>';
    }).join('');
    html += spBlockHtml('char', '角色设定', charsHtml, model.characters.length + ' 人');
  }

  if (model.backstory && model.backstory.trim()) {
    html += spBlockHtml('backstory', '背景故事', spTextHtml(model.backstory));
  }
  if (model.state && model.state.trim() && model.state.trim() !== '无') {
    html += spBlockHtml('state', '当前状态', spTextHtml(model.state));
  }

  if (model.samples.length > 0) {
    var samplesHtml = model.samples.map(function (sm) {
      return '<div class="sp-sample-line">' +
        (sm.char ? '<span class="sp-sample-char">' + escHtml(sm.char) + '</span>' : '') +
        '<span>' + escHtml(sm.text) + '</span></div>';
    }).join('');
    html += spBlockHtml('samples', '回复样例', samplesHtml);
  }

  var speakerRule = '';
  (model.rules || []).forEach(function (r) { if (r.id === 'speaker-format') speakerRule = r.text; });
  if (speakerRule && speakerRule.trim()) {
    html += spBlockHtml('rules', '行为规则', spTextHtml(speakerRule));
  }

  if ((model.unknown || []).length > 0) {
    var unknownHtml = model.unknown.map(function (u) { return spTextHtml(u.text); }).join('');
    html += spBlockHtml('unknown', '自定义区块', unknownHtml);
  }

  if (!html) return '（空）';
  return '<div class="sp-blocks">' + html + '</div>';
}

/* 单个区块外壳 */
function spBlockHtml(kind, title, bodyHtml, meta) {
  return '<section class="sp-block sp-block--' + kind + '">' +
    '<div class="sp-block-head"><span class="sp-block-dot"></span>' + escHtml(title) +
    (meta ? '<span class="sp-block-meta">' + escHtml(meta) + '</span>' : '') +
    '</div><div class="sp-block-body">' + bodyHtml + '</div></section>';
}

/* 纯文本 → 行 HTML（保留空行节奏） */
function spTextHtml(text) {
  if (!text || !text.trim()) return '<div class="sp-block-empty">（空）</div>';
  return String(text).split('\n').map(function (line) {
    return line.trim() ? '<div class="sp-line">' + escHtml(line) + '</div>' : '<div class="sp-line sp-blank"></div>';
  }).join('');
}

function spNavPrev() {
  if (!currentChatId) return;
  var chat = appData.chats[currentChatId];
  if (chat.spViewIndex > 0) {
    chat.spViewIndex--;
    saveData();
    updateSpDisplay();
  }
}

function spNavNext() {
  if (!currentChatId) return;
  var chat = appData.chats[currentChatId];
  if (chat.spViewIndex < chat.spVersions.length - 1) {
    chat.spViewIndex++;
    saveData();
    updateSpDisplay();
  }
}

/* ==================== 区块卡片编辑器 ==================== */

/* 进入编辑：SPX 解析为模型 → 渲染卡片（旧格式先就地迁移） */
function spStartEdit() {
  if (!currentChatId) return;
  var chat = appData.chats[currentChatId];
  var ver = chat.spVersions[chat.spViewIndex];
  if (!ver) return;

  if (ver.content && ver.content.trim() && !isSpFormat(ver.content)) {
    ensureSpVersionMigrated(ver);
    saveData();
  }

  var model = parseSp(ver.content || '') || _emptySpModel();
  if (model.rules.length === 0) {
    model.rules.push({ id: 'speaker-format', text: SPX_SPEAKER_RULE });
  }

  var overlay = document.getElementById('modalOverlay');
  var contentEl = document.getElementById('modalContent');
  contentEl.style.maxWidth = '680px';
  overlay._spModel = model;

  contentEl.innerHTML = spEditorBuildHtml(ver.version, model);
  overlay.classList.add('show');
  overlay._onConfirm = null;
  overlay._isTextarea = null;
}

/* 组装整个编辑器 HTML */
function spEditorBuildHtml(version, model) {
  var html = '<h3>编辑 System Prompt (v' + escHtml(version) + ')</h3>';
  html += '<div class="sp-editor-tabs">' +
    '<button type="button" class="sp-tab-btn active" id="spTabCardsBtn" onclick="spEditorTab(\'cards\')">区块编辑</button>' +
    '<button type="button" class="sp-tab-btn" id="spTabSourceBtn" onclick="spEditorTab(\'source\')">源码模式</button>' +
    '</div>';
  html += '<div class="sp-editor-body" id="spEditorBody">' + spEditorCardsHtml(model) + '</div>';
  html += '<div class="modal-btns">' +
    '<button class="btn-sm btn-primary" onclick="spEditorSave()">保存</button>' +
    '<button class="btn-sm btn-ghost" onclick="closeModal()">取消</button>' +
    '</div>';
  return html;
}

/* 区块卡片区 HTML */
function spEditorCardsHtml(model) {
  var html = '';

  // 任务定义
  html += '<div class="sp-card sp-card--task"><div class="sp-card-title">📋 任务定义</div>' +
    '<textarea class="sp-input" id="spTaskInput" rows="4">' + escHtml(model.task || '') + '</textarea></div>';

  // 角色设定
  html += '<div class="sp-card sp-card--char"><div class="sp-card-title">👥 角色设定</div>' +
    '<div id="spCharList">' + model.characters.map(function (c, i) { return spEditorCharCardHtml(c, i); }).join('') + '</div>' +
    '<button type="button" class="btn-sm btn-ghost" onclick="spEditorAddChar()">➕ 添加角色</button></div>';

  // 背景故事 / 当前状态
  html += '<div class="sp-card sp-card--backstory"><div class="sp-card-title">📖 背景故事</div>' +
    '<textarea class="sp-input" id="spBackstoryInput" rows="2">' + escHtml(model.backstory || '') + '</textarea></div>';
  html += '<div class="sp-card sp-card--state"><div class="sp-card-title">📍 当前状态</div>' +
    '<textarea class="sp-input" id="spStateInput" rows="2">' + escHtml(model.state || '') + '</textarea></div>';

  // 回复样例（每行一条：【角色名】台词）
  html += '<div class="sp-card sp-card--samples"><div class="sp-card-title">💬 回复样例 <span class="sp-card-hint">每行一条，以【角色名】开头</span></div>' +
    '<textarea class="sp-input" id="spSamplesInput" rows="3">' + escHtml((model.samples || []).map(function (s) {
      return (s.char ? '【' + s.char + '】' : '') + s.text;
    }).join('\n')) + '</textarea></div>';

  // 行为规则：speaker-format 可编辑；其余规则原样保留（不可见）
  var speakerRule = '';
  var otherRules = [];
  (model.rules || []).forEach(function (r) {
    if (r.id === 'speaker-format') speakerRule = r.text;
    else otherRules.push(r);
  });
  html += '<div class="sp-card sp-card--rules"><div class="sp-card-title">⚙️ 行为规则 <span class="sp-card-hint">说话人格式（AI 回复协议，压缩时禁改）</span></div>' +
    '<textarea class="sp-input" id="spRuleSpeakerInput" rows="2">' + escHtml(speakerRule) + '</textarea></div>';

  if ((model.unknown || []).length > 0 || otherRules.length > 0) {
    var hiddenCount = model.unknown.length + otherRules.length;
    html += '<div class="sp-card sp-card--unknown sp-card-muted">另有 ' + hiddenCount + ' 个自定义区块/规则将在保存时原样保留</div>';
  }

  return html;
}

/* 单个角色子卡片 HTML（data-src-idx 用于保存时回填 extra 字段） */
function spEditorCharCardHtml(ch, idx) {
  var isNew = idx < 0;
  return '<div class="sp-char-card"' + (isNew ? '' : ' data-src-idx="' + idx + '"') + '>' +
    '<div class="sp-char-head">' +
    '<input type="text" class="sp-input sp-char-name" placeholder="角色名" value="' + escHtml(ch.name || '') + '">' +
    '<button type="button" class="sp-char-del" onclick="this.closest(\'.sp-char-card\').remove()" title="删除角色">✕</button>' +
    '</div>' +
    '<textarea class="sp-input sp-char-identity" rows="2" placeholder="身份">' + escHtml(ch.identity || '') + '</textarea>' +
    '<textarea class="sp-input sp-char-appearance" rows="3" placeholder="外貌">' + escHtml(ch.appearance || '') + '</textarea>' +
    '<textarea class="sp-input sp-char-personality" rows="2" placeholder="性格">' + escHtml(ch.personality || '') + '</textarea>' +
    '<textarea class="sp-input sp-char-history" rows="2" placeholder="经历">' + escHtml(ch.history || '') + '</textarea>' +
    '</div>';
}

function spEditorAddChar() {
  var list = document.getElementById('spCharList');
  var div = document.createElement('div');
  div.innerHTML = spEditorCharCardHtml({ name: '', identity: '', appearance: '', personality: '', history: '', extra: [] }, -1);
  list.appendChild(div.firstElementChild);
}

/* 从卡片输入收集模型（保留原模型的 extra 字段 / 非说话人规则 / 未知区块） */
function spEditorCollectModel() {
  var overlay = document.getElementById('modalOverlay');
  var origin = overlay._spModel || _emptySpModel();
  var model = _emptySpModel();

  model.task = document.getElementById('spTaskInput').value.trim();

  var srcChars = origin.characters || [];
  document.querySelectorAll('#spCharList .sp-char-card').forEach(function (card) {
    var srcIdx = card.getAttribute('data-src-idx');
    var extra = (srcIdx !== null && srcChars[srcIdx]) ? srcChars[srcIdx].extra || [] : [];
    model.characters.push({
      name: card.querySelector('.sp-char-name').value.trim(),
      identity: card.querySelector('.sp-char-identity').value.trim(),
      appearance: card.querySelector('.sp-char-appearance').value.trim(),
      personality: card.querySelector('.sp-char-personality').value.trim(),
      history: card.querySelector('.sp-char-history').value.trim(),
      extra: extra
    });
  });

  model.backstory = document.getElementById('spBackstoryInput').value.trim();
  model.state = document.getElementById('spStateInput').value.trim();

  (document.getElementById('spSamplesInput').value.split('\n')).forEach(function (line) {
    var t = line.trim();
    if (!t) return;
    var m = t.match(/^【(.+?)】\s*([\s\S]*)$/);
    if (m) model.samples.push({ char: m[1].trim(), text: m[2].trim() });
    else model.samples.push({ char: '', text: t });
  });

  var speakerRule = document.getElementById('spRuleSpeakerInput').value.trim();
  if (speakerRule) model.rules.push({ id: 'speaker-format', text: speakerRule });
  (origin.rules || []).forEach(function (r) {
    if (r.id !== 'speaker-format') model.rules.push(r);
  });

  model.unknown = origin.unknown || [];
  return model;
}

/* Tab 切换：卡片 ⇄ 源码 */
function spEditorTab(which) {
  var body = document.getElementById('spEditorBody');
  var cardsBtn = document.getElementById('spTabCardsBtn');
  var sourceBtn = document.getElementById('spTabSourceBtn');
  var overlay = document.getElementById('modalOverlay');
  var inSource = body.querySelector('#spSourceTextarea') !== null;

  if (which === 'source' && !inSource) {
    // 卡片 → 源码：收集当前输入并序列化
    var collected = spEditorCollectModel();
    overlay._spModel = collected;
    var xml = serializeSp(collected);
    body.innerHTML = '<textarea class="sp-input sp-source" id="spSourceTextarea" rows="18" spellcheck="false">' + escHtml(xml) + '</textarea>' +
      '<div class="sp-source-error" id="spSourceError"></div>';
    cardsBtn.classList.remove('active');
    sourceBtn.classList.add('active');
  } else if (which === 'cards' && inSource) {
    // 源码 → 卡片：先校验
    var src = document.getElementById('spSourceTextarea').value.trim();
    var m = parseSp(src);
    if (!m) {
      document.getElementById('spSourceError').textContent = 'XML 解析失败：请检查标签是否闭合、属性是否带引号';
      return;
    }
    if (m.rules.length === 0) m.rules.push({ id: 'speaker-format', text: SPX_SPEAKER_RULE });
    overlay._spModel = m;
    body.innerHTML = spEditorCardsHtml(m);
    cardsBtn.classList.add('active');
    sourceBtn.classList.remove('active');
  }
}

/* 保存：当前 Tab 的内容 → 校验 → 写回当前版本 */
function spEditorSave() {
  var overlay = document.getElementById('modalOverlay');
  var body = document.getElementById('spEditorBody');
  var inSource = body.querySelector('#spSourceTextarea') !== null;

  var xml;
  if (inSource) {
    var src = document.getElementById('spSourceTextarea').value.trim();
    if (!parseSp(src)) {
      document.getElementById('spSourceError').textContent = 'XML 解析失败：请检查标签是否闭合、属性是否带引号';
      return;
    }
    xml = src;
  } else {
    xml = serializeSp(spEditorCollectModel());
  }

  if (!currentChatId) return;
  var chat = appData.chats[currentChatId];
  var ver = chat.spVersions[chat.spViewIndex];
  ver.content = xml;
  ver.format = SPX_FORMAT;
  saveData();
  updateSpDisplay();
  closeModal();
  showToast('System Prompt 已更新', 'success');
}
