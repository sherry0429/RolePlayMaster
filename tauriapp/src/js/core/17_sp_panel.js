
/**
 * System Prompt 显示与编辑（v2）
 * - 原文 / 对比（与上一版本行级 diff）双视图
 * - 版本胶囊导航（点击直达）
 * - # 标题轻量渲染 + 字符/行/token 统计
 * - 专属编辑弹窗：编辑 / 改动预览 双 tab，⌘↩ 保存
 * 保持全局兼容模式
 */

var spViewMode = 'raw';            // 'raw' | 'diff'
var spExpandedRuns = {};           // diff 中被手动展开的折叠段 key -> true

function _spGetChat() {
  return (currentChatId && appData.chats[currentChatId]) ? appData.chats[currentChatId] : null;
}

/* ---------- 版本胶囊导航 ---------- */

function renderSpChips(chat) {
  var wrap = document.getElementById('spChips');
  if (!wrap) return;
  if (!chat.spVersions || chat.spVersions.length === 0) {
    wrap.innerHTML = '';
    return;
  }
  var html = '';
  chat.spVersions.forEach(function (v, idx) {
    var cur = idx === chat.spViewIndex;
    html += '<button class="sp-chip' + (cur ? ' active' : '') + '" onclick="spJumpTo(' + idx + ')" title="切换到 v' + v.version + '">v' + v.version + (cur ? ' ●' : '') + '</button>';
  });
  wrap.innerHTML = html;
}

function spJumpTo(idx) {
  var chat = _spGetChat();
  if (!chat || idx < 0 || idx >= chat.spVersions.length) return;
  chat.spViewIndex = idx;
  saveData();
  updateSpDisplay();
}

/* 兼容旧入口（如有残留调用） */
function spNavPrev() { spJumpTo(_spGetChat() ? _spGetChat().spViewIndex - 1 : -1); }
function spNavNext() { var c = _spGetChat(); spJumpTo(c ? c.spViewIndex + 1 : -1); }

/* ---------- 视图切换 ---------- */

function spSetView(mode) {
  spViewMode = (mode === 'diff') ? 'diff' : 'raw';
  updateSpDisplay();
}

/* ---------- 内容渲染 ---------- */

/* 原文模式：SPX 渲染为彩色区块；非 SPX（旧格式/自由文本）回退逐行渲染 */
function renderSpRaw(content) {
  var model = parseSp(content || '');
  if (model) return spBlocksHtml(model);

  var lines = String(content || '').split('\n');
  var html = '';
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^#{1,3}\s/.test(line)) {
      html += '<div class="sp-h">' + escHtml(line.replace(/^#{1,3}\s*/, '')) + '</div>';
    } else if (line.trim() === '') {
      html += '<div class="sp-line sp-blank"></div>';
    } else {
      html += '<div class="sp-line">' + escHtml(line) + '</div>';
    }
  }
  return html;
}

/* ==================== SP 区块展示（只读，彩色区块） ==================== */
/* 仅渲染已填写的区块；空区块跳过。布局与网页版 19_system_prompt 显示区一致 */

function spBlocksHtml(model) {
  var html = '';

  if (model.task && model.task.trim()) {
    html += spBlockHtml('task', '任务定义', spTextHtml(model.task));
  }

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

  if (!html) return '<div class="sp-blocks"><div class="sp-block sp-block--unknown"><div class="sp-block-body"><div class="sp-block-empty">（空）</div></div></div></div>';
  return '<div class="sp-blocks">' + html + '</div>';
}

function spBlockHtml(kind, title, bodyHtml, meta) {
  return '<section class="sp-block sp-block--' + kind + '">' +
    '<div class="sp-block-head"><span class="sp-block-dot"></span>' + escHtml(title) +
    (meta ? '<span class="sp-block-meta">' + escHtml(meta) + '</span>' : '') +
    '</div><div class="sp-block-body">' + bodyHtml + '</div></section>';
}

function spTextHtml(text) {
  if (!text || !text.trim()) return '<div class="sp-block-empty">（空）</div>';
  return String(text).split('\n').map(function (line) {
    return line.trim() ? '<div class="sp-line">' + escHtml(line) + '</div>' : '<div class="sp-line sp-blank"></div>';
  }).join('');
}

/* diff 行渲染（面板与编辑器预览共用）；超长未改动段自动折叠 */
function renderDiffRowsHtml(rows) {
  var html = '';
  var runStart = -1;
  var runKey = 0;
  function flushRun(endIdx) {
    var len = endIdx - runStart;
    if (len <= 8) {
      for (var k = runStart; k < endIdx; k++) html += diffRowHtml(rows[k]);
    } else {
      var key = 'run' + (runKey++);
      var showHead = 2, showTail = 2;
      for (var k2 = runStart; k2 < runStart + showHead; k2++) html += diffRowHtml(rows[k2]);
      if (spExpandedRuns[key]) {
        for (var k3 = runStart + showHead; k3 < endIdx; k3++) html += diffRowHtml(rows[k3]);
      } else {
        html += '<div class="sp-diff-collapse" onclick="spExpandRun(\'' + key + '\')">··· ' + (len - showHead - showTail) + ' 行未改动，点击展开 ···</div>';
      }
      for (var k4 = endIdx - showTail; k4 < endIdx; k4++) html += diffRowHtml(rows[k4]);
    }
    runStart = -1;
  }
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].type === 'same') {
      if (runStart < 0) runStart = i;
    } else {
      if (runStart >= 0) flushRun(i);
      html += diffRowHtml(rows[i]);
    }
  }
  if (runStart >= 0) flushRun(rows.length);
  return html;
}

function diffRowHtml(r) {
  if (r.type === 'add') {
    return '<div class="sp-diff-line add"><span class="mark">+</span>' + escHtml(r.text) + '</div>';
  }
  if (r.type === 'del') {
    return '<div class="sp-diff-line del"><span class="mark">−</span>' + escHtml(r.text) + '</div>';
  }
  return '<div class="sp-diff-line"><span class="mark">&nbsp;</span>' + escHtml(r.text) + '</div>';
}

function spExpandRun(key) {
  spExpandedRuns[key] = true;
  updateSpDisplay();
}

/* diff 模式：当前查看版本 vs 上一版本 */
function renderSpDiff(chat) {
  var display = document.getElementById('spDisplay');
  var vi = chat.spViewIndex;
  if (vi <= 0) {
    display.innerHTML = '<div class="sp-diff-empty">这是第一个版本，没有可对比的上一版本。</div>';
    return { added: 0, removed: 0 };
  }
  var prev = chat.spVersions[vi - 1];
  var rows = diffLines(prev.content || '', chat.spVersions[vi].content || '');
  var added = 0, removed = 0;
  rows.forEach(function (r) {
    if (r.type === 'add') added++;
    else if (r.type === 'del') removed++;
  });
  var html = '<div class="sp-diff-head">对比 v' + prev.version + ' → v' + chat.spVersions[vi].version + '</div>';
  html += '<div class="sp-diff">' + renderDiffRowsHtml(rows) + '</div>';
  display.innerHTML = html;
  return { added: added, removed: removed };
}

/* ---------- 主刷新 ---------- */

function updateSpDisplay() {
  var display = document.getElementById('spDisplay');
  var badge = document.getElementById('spVersionBadge');
  var statsEl = document.getElementById('spDiffStats');
  var metaEl = document.getElementById('spMeta');
  var rawBtn = document.getElementById('spViewRaw');
  var diffBtn = document.getElementById('spViewDiff');
  if (!display) return;

  var chat = _spGetChat();
  if (!chat) {
    badge.textContent = 'v0';
    display.innerHTML = '暂无 System Prompt';
    if (statsEl) statsEl.innerHTML = '';
    if (metaEl) metaEl.innerHTML = '';
    if (rawBtn) rawBtn.classList.add('active');
    if (diffBtn) diffBtn.classList.remove('active');
    var chips0 = document.getElementById('spChips');
    if (chips0) chips0.innerHTML = '';
    return;
  }

  var sp = getCurrentSpVersion();
  badge.textContent = 'v' + sp.version;
  renderSpChips(chat);

  if (rawBtn) rawBtn.classList.toggle('active', spViewMode === 'raw');
  if (diffBtn) diffBtn.classList.toggle('active', spViewMode === 'diff');

  // 淡入淡出动画
  display.classList.add('fading');
  setTimeout(function () {
    var stats;
    if (spViewMode === 'diff') {
      stats = renderSpDiff(chat);
    } else {
      display.innerHTML = renderSpRaw(sp.content || '');
      stats = null;
    }
    // 工具栏 +X/−Y 统计（仅对比视图显示）
    if (statsEl) {
      if (stats && (stats.added || stats.removed)) {
        statsEl.innerHTML =
          '<span class="sp-stat-add">+' + stats.added + ' 行</span>' +
          '<span class="sp-stat-del">−' + stats.removed + ' 行</span>';
      } else {
        statsEl.innerHTML = '';
      }
    }
    // 底部统计条
    if (metaEl) {
      var content = sp.content || '';
      var lineCount = content === '' ? 0 : content.split('\n').length;
      metaEl.innerHTML =
        '<span>' + content.length.toLocaleString() + ' 字符</span>' +
        '<span>' + lineCount + ' 行</span>' +
        '<span>≈ ' + estimateTokens(content).toLocaleString() + ' tokens</span>';
    }
    display.classList.remove('fading');
  }, 200);
}

/* ---------- 专属编辑弹窗 ---------- */
/* 三 Tab：区块（SPX 卡片）/ 源码 / 改动预览。区块与源码双向同步，保存前 parseSp 校验。 */

function spStartEdit() {
  var chat = _spGetChat();
  if (!chat) return;
  var ver = chat.spVersions[chat.spViewIndex];
  if (!ver) return;

  // 旧格式（Markdown+XML 混合）先就地迁移为 SPX，原文存 legacyContent
  if (ver.content && ver.content.trim() && !isSpFormat(ver.content)) {
    ensureSpVersionMigrated(ver);
    saveData();
  }

  var oldContent = ver.content || '';
  var oldVersion = ver.version;
  var model = parseSp(oldContent) || _emptySpModel();
  if (model.rules.length === 0) {
    model.rules.push({ id: 'speaker-format', text: SPX_SPEAKER_RULE });
  }

  showSpEditorModal('编辑 System Prompt · v' + oldVersion, oldContent, function (val) {
    if (!currentChatId) return;
    var chat = appData.chats[currentChatId];
    var newContent = val.trim();

    // 直接修改当前版本的 content，不创建新版本（与原逻辑一致）
    chat.spVersions[chat.spViewIndex].content = newContent;
    chat.spVersions[chat.spViewIndex].format = SPX_FORMAT;
    saveData();
    spExpandedRuns = {};
    updateSpDisplay();
    // 日志：记录 SP 修改前后内容（debug 用）
    addProgramLog(LOG_TYPE_SYSTEM, {
      summary: '修改 System Prompt (v' + oldVersion + ')' + (oldContent === newContent ? '（内容未变化）' : ''),
      chatName: chat.name,
      detail: { version: oldVersion, before: oldContent, after: newContent }
    });
    showToast('System Prompt 已更新', 'success');
  }, model);
}

function showSpEditorModal(title, value, onConfirm, model) {
  var overlay = document.getElementById('modalOverlay');
  var content = document.getElementById('modalContent');
  content.style.maxWidth = '860px';

  var html = '<h3>' + escHtml(title) + '</h3>';
  html += '<div class="sp-ed-tabs">';
  html += '<button type="button" class="sp-ed-tab active" id="spEdTabCards" onclick="spEdSwitch(\'cards\')">区块</button>';
  html += '<button type="button" class="sp-ed-tab" id="spEdTabEdit" onclick="spEdSwitch(\'edit\')">源码</button>';
  html += '<button type="button" class="sp-ed-tab" id="spEdTabDiff" onclick="spEdSwitch(\'diff\')">改动预览</button>';
  html += '</div>';
  html += '<div id="spEdCardsWrap" class="sp-editor-body">' + spEditorCardsHtml(model) + '</div>';
  html += '<div id="spEdEditWrap" style="display:none;"><textarea id="modalTextarea" class="sp-ed-textarea" spellcheck="false">' + escHtml(value) + '</textarea></div>';
  html += '<div id="spEdDiffWrap" style="display:none;"><div id="spEdDiffBody" class="sp-diff sp-diff-editor"></div></div>';
  html += '<div class="sp-ed-status">';
  html += '<span id="spEdAdded" class="sp-stat-add">+0</span>';
  html += '<span id="spEdRemoved" class="sp-stat-del">−0</span>';
  html += '<span id="spEdChars">0 字符</span>';
  html += '<span style="flex:1"></span>';
  html += '<span class="sp-ed-kbd">⌘↩ 保存</span>';
  html += '<button type="button" class="btn-sm btn-primary" onclick="confirmSpEditor()">保存</button>';
  html += '<button type="button" class="btn-sm btn-ghost" onclick="closeModal()">取消</button>';
  html += '</div>';

  content.innerHTML = html;
  overlay.classList.add('show');
  overlay._onConfirm = onConfirm;
  overlay._isTextarea = true;
  overlay._spOriginal = value;
  overlay._spModel = model;

  var ta = document.getElementById('modalTextarea');
  if (ta) {
    // 输入时刷新状态栏
    ta.addEventListener('input', spEdUpdateStatus);
    // ⌘/Ctrl + Enter 保存
    ta.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        confirmSpEditor();
      }
    });
    setTimeout(function () {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }, 50);
  }
  spEdUpdateStatus();
}

function spEdUpdateStatus() {
  var overlay = document.getElementById('modalOverlay');
  var ta = document.getElementById('modalTextarea');
  if (!ta || !overlay) return;
  var cur = ta.value;
  var charsEl = document.getElementById('spEdChars');
  if (charsEl) charsEl.textContent = cur.length.toLocaleString() + ' 字符';

  var rows = diffLines(overlay._spOriginal || '', cur);
  var added = 0, removed = 0;
  rows.forEach(function (r) {
    if (r.type === 'add') added++;
    else if (r.type === 'del') removed++;
  });
  var addEl = document.getElementById('spEdAdded');
  var delEl = document.getElementById('spEdRemoved');
  if (addEl) addEl.textContent = '+' + added;
  if (delEl) delEl.textContent = '−' + removed;
}

function spEdSwitch(mode) {
  var overlay = document.getElementById('modalOverlay');
  var cardsWrap = document.getElementById('spEdCardsWrap');
  var editWrap = document.getElementById('spEdEditWrap');
  var diffWrap = document.getElementById('spEdDiffWrap');
  var tabCards = document.getElementById('spEdTabCards');
  var tabEdit = document.getElementById('spEdTabEdit');
  var tabDiff = document.getElementById('spEdTabDiff');
  if (!cardsWrap || !editWrap || !diffWrap) return;
  var onCards = cardsWrap.style.display !== 'none';

  // 离开区块页签前：把卡片内容序列化进源码框（供改动预览 / 保存使用）
  if (onCards && mode !== 'cards') {
    var collected = spEditorCollectModel();
    overlay._spModel = collected;
    var taSync = document.getElementById('modalTextarea');
    if (taSync) taSync.value = serializeSp(collected);
    spEdUpdateStatus();
  }

  if (mode === 'cards') {
    // 从源码切回区块：先校验源码框内容
    var ta = document.getElementById('modalTextarea');
    var m = parseSp(((ta ? ta.value : '') || '').trim());
    if (!m) {
      showToast('XML 解析失败：请检查标签是否闭合、属性是否带引号', 'error');
      return;
    }
    if (m.rules.length === 0) m.rules.push({ id: 'speaker-format', text: SPX_SPEAKER_RULE });
    overlay._spModel = m;
    cardsWrap.innerHTML = spEditorCardsHtml(m);
    cardsWrap.style.display = 'block';
    editWrap.style.display = 'none';
    diffWrap.style.display = 'none';
    tabCards.classList.add('active');
    tabEdit.classList.remove('active');
    tabDiff.classList.remove('active');
    return;
  }

  if (mode === 'diff') {
    var ta2 = document.getElementById('modalTextarea');
    var rows = diffLines(overlay._spOriginal || '', ta2 ? ta2.value : '');
    var body = document.getElementById('spEdDiffBody');
    var changed = rows.some(function (r) { return r.type !== 'same'; });
    body.innerHTML = changed
      ? renderDiffRowsHtml(rows)
      : '<div class="sp-diff-empty">还没有改动，与保存前内容一致。</div>';
    cardsWrap.style.display = 'none';
    editWrap.style.display = 'none';
    diffWrap.style.display = 'block';
    tabCards.classList.remove('active');
    tabEdit.classList.remove('active');
    tabDiff.classList.add('active');
  } else {
    cardsWrap.style.display = 'none';
    editWrap.style.display = 'block';
    diffWrap.style.display = 'none';
    tabCards.classList.remove('active');
    tabDiff.classList.remove('active');
    tabEdit.classList.add('active');
    var ta3 = document.getElementById('modalTextarea');
    if (ta3) ta3.focus();
  }
}

function confirmSpEditor() {
  var overlay = document.getElementById('modalOverlay');
  var cardsWrap = document.getElementById('spEdCardsWrap');
  var val;
  if (cardsWrap && cardsWrap.style.display !== 'none') {
    // 区块页签：收集卡片 → 序列化
    val = serializeSp(spEditorCollectModel());
  } else {
    var ta = document.getElementById('modalTextarea');
    val = ta ? ta.value : '';
  }
  if (overlay && overlay._onConfirm) {
    var cb = overlay._onConfirm;
    overlay._onConfirm = null;
    cb(val);
  }
  closeModal();
}

/* ==================== 区块卡片编辑器（与网页版 19_sp 同构） ==================== */

/* 区块卡片区 HTML */
function spEditorCardsHtml(model) {
  var html = '';

  // 任务定义
  html += '<div class="sp-card sp-card--task"><div class="sp-card-title">任务定义</div>' +
    '<textarea class="sp-input" id="spTaskInput" rows="4">' + escHtml(model.task || '') + '</textarea></div>';

  // 角色设定
  html += '<div class="sp-card sp-card--char"><div class="sp-card-title">角色设定</div>' +
    '<div id="spCharList">' + model.characters.map(function (c, i) { return spEditorCharCardHtml(c, i); }).join('') + '</div>' +
    '<button type="button" class="btn-sm btn-ghost" onclick="spEditorAddChar()">+ 添加角色</button></div>';

  // 背景故事 / 当前状态
  html += '<div class="sp-card sp-card--backstory"><div class="sp-card-title">背景故事</div>' +
    '<textarea class="sp-input" id="spBackstoryInput" rows="2">' + escHtml(model.backstory || '') + '</textarea></div>';
  html += '<div class="sp-card sp-card--state"><div class="sp-card-title">当前状态</div>' +
    '<textarea class="sp-input" id="spStateInput" rows="2">' + escHtml(model.state || '') + '</textarea></div>';

  // 回复样例（每行一条：【角色名】台词）
  html += '<div class="sp-card sp-card--samples"><div class="sp-card-title">回复样例 <span class="sp-card-hint">每行一条，以【角色名】开头</span></div>' +
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
  html += '<div class="sp-card sp-card--rules"><div class="sp-card-title">行为规则 <span class="sp-card-hint">说话人格式（AI 回复协议，压缩时禁改）</span></div>' +
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
  if (!list) return;
  var div = document.createElement('div');
  div.innerHTML = spEditorCharCardHtml({ name: '', identity: '', appearance: '', personality: '', history: '', extra: [] }, -1);
  list.appendChild(div.firstElementChild);
}

/* 从卡片输入收集模型（保留原模型的 extra 字段 / 非说话人规则 / 未知区块） */
function spEditorCollectModel() {
  var overlay = document.getElementById('modalOverlay');
  var origin = (overlay && overlay._spModel) || _emptySpModel();
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
