
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

/* 原文模式：# 开头行渲染为小节标题，其余保持纯文本 */
function renderSpRaw(content) {
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

function spStartEdit() {
  if (!currentChatId) return;
  var sp = getCurrentSpVersion();
  var oldContent = sp.content || '';
  var oldVersion = sp.version;
  showSpEditorModal('编辑 System Prompt · v' + oldVersion, oldContent, function (val) {
    if (!currentChatId) return;
    var chat = appData.chats[currentChatId];
    var newContent = val.trim();

    // 直接修改当前版本的 content，不创建新版本（与原逻辑一致）
    chat.spVersions[chat.spViewIndex].content = newContent;
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
  });
}

function showSpEditorModal(title, value, onConfirm) {
  var overlay = document.getElementById('modalOverlay');
  var content = document.getElementById('modalContent');
  content.style.maxWidth = '860px';

  var html = '<h3>' + escHtml(title) + '</h3>';
  html += '<div class="sp-ed-tabs">';
  html += '<button type="button" class="sp-ed-tab active" id="spEdTabEdit" onclick="spEdSwitch(\'edit\')">编辑</button>';
  html += '<button type="button" class="sp-ed-tab" id="spEdTabDiff" onclick="spEdSwitch(\'diff\')">改动预览</button>';
  html += '</div>';
  html += '<div id="spEdEditWrap"><textarea id="modalTextarea" class="sp-ed-textarea" spellcheck="false">' + escHtml(value) + '</textarea></div>';
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
  var editWrap = document.getElementById('spEdEditWrap');
  var diffWrap = document.getElementById('spEdDiffWrap');
  var tabEdit = document.getElementById('spEdTabEdit');
  var tabDiff = document.getElementById('spEdTabDiff');
  if (!editWrap || !diffWrap) return;

  if (mode === 'diff') {
    var overlay = document.getElementById('modalOverlay');
    var ta = document.getElementById('modalTextarea');
    var rows = diffLines(overlay._spOriginal || '', ta ? ta.value : '');
    var body = document.getElementById('spEdDiffBody');
    var changed = rows.some(function (r) { return r.type !== 'same'; });
    body.innerHTML = changed
      ? renderDiffRowsHtml(rows)
      : '<div class="sp-diff-empty">还没有改动，与保存前内容一致。</div>';
    editWrap.style.display = 'none';
    diffWrap.style.display = 'block';
    tabEdit.classList.remove('active');
    tabDiff.classList.add('active');
  } else {
    editWrap.style.display = 'block';
    diffWrap.style.display = 'none';
    tabDiff.classList.remove('active');
    tabEdit.classList.add('active');
    var ta2 = document.getElementById('modalTextarea');
    if (ta2) ta2.focus();
  }
}

function confirmSpEditor() {
  var ta = document.getElementById('modalTextarea');
  var overlay = document.getElementById('modalOverlay');
  if (ta && overlay && overlay._onConfirm) {
    var cb = overlay._onConfirm;
    overlay._onConfirm = null;
    cb(ta.value);
  }
  closeModal();
}
