/**
 * 04_panels.js —— 面板层（设置 / System Prompt）与「面板模式」窗口
 *
 * 布局约定：面板层是化身舞台上方的弹性区域，
 *   - 打开面板时窗口放大并居中，化身仍留在下方（不被隐藏，可继续拖动/右键）
 *   - 窗口尺寸会「贴合面板内容」计算，既能一屏装下，也不会留出大片空白挡住桌面
 */

var _activePanelId = null;

// ==================== 面板开关 ====================

function openPanel(id) {
  var layer = document.getElementById('panelLayer');
  if (!layer) return;

  // 先切面板模式，再收起消息浮层（否则浮层的收起会把窗口缩回化身尺寸）
  shellEnterPanelMode(calcPanelSize());
  closeBubblePanel();
  closeContextMenu();

  layer.querySelectorAll('.panel').forEach(function (p) {
    p.classList.toggle('active', p.id === id);
  });
  _activePanelId = id;

  if (id === 'panel-sp') setTimeout(updateSpDisplaySafe, 60);
  if (id === 'panel-settings') applyShellOptionsToControls();

  // 等窗口完成放大后，再按内容把尺寸收紧
  setTimeout(fitPanelWindow, 180);
}

function closePanel(id) {
  var layer = document.getElementById('panelLayer');
  if (!layer) return;
  layer.querySelectorAll('.panel').forEach(function (p) {
    if (!id || p.id === id) p.classList.remove('active');
  });
  var still = layer.querySelector('.panel.active');
  _activePanelId = still ? still.id : null;
  if (!_activePanelId) maybeExitPanelMode();
}

function closeAllPanels() {
  var layer = document.getElementById('panelLayer');
  if (layer) {
    layer.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
  }
  _activePanelId = null;
  try { closeLogDrawer(); } catch (e) { /* ignore */ }
  try { closeAlbumDrawer(); } catch (e) { /* ignore */ }
  try { closeGalleryDrawer(); } catch (e) { /* ignore */ }
  try { closeModal(); } catch (e) { /* ignore */ }
  try { closePhotoCharSelect(); } catch (e) { /* ignore */ }
  maybeExitPanelMode();
}

/** 所有面板与抽屉都关闭后，把窗口还原为化身气泡窗口 */
function maybeExitPanelMode() {
  if (!document.body.classList.contains('panel-mode')) return;

  var layer = document.getElementById('panelLayer');
  if (layer && layer.querySelector('.panel.active')) return;

  var drawerOpen = ['logDrawer', 'albumDrawer', 'galleryDrawer'].some(function (id) {
    var el = document.getElementById(id);
    return el && el.classList.contains('open');
  });
  if (drawerOpen) return;

  if (document.querySelector('.modal-overlay.show')) return;

  var photoSelect = document.getElementById('photoCharSelectOverlay');
  if (photoSelect && photoSelect.style.display !== 'none') return;

  shellExitPanelMode();
  // 还原成贴合化身的紧凑窗口
  setTimeout(shellSyncAvatarWindowSize, 60);
}

// ==================== 各面板入口 ====================

function openSettingsPanel() {
  openPanel('panel-settings');
  try { renderChatList(); } catch (e) { /* ignore */ }
}

function openSpPanel() {
  if (!currentChatId || !appData.chats[currentChatId]) {
    showToast('请先创建或选择一个聊天', 'error');
    return;
  }
  openPanel('panel-sp');
}

/**
 * 创建群聊：直接复用网页版的「角色图库 + 选择模式 + 确认建群」链路
 * toggleCharSelectMode → 勾选角色 → confirmCharSelect
 */
function startGroupChatFlow() {
  closeAllPanels();
  openGalleryDrawer();
  if (typeof charSelectMode !== 'undefined' && !charSelectMode) {
    toggleCharSelectMode();
  }
  showToast('勾选要加入群聊的角色，再点「确认建群」');
}

// ==================== 设置面板分页 ====================

function switchSettingsTab(name) {
  var panel = document.getElementById('panel-settings');
  if (!panel) return;
  panel.querySelectorAll('.ptab').forEach(function (b) {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  panel.querySelectorAll('.pane').forEach(function (p) {
    p.classList.toggle('active', p.dataset.pane === name);
  });
  ShellPrefs.set('settingsTab', name);
  // 角色 / 日志 Tab：每次进入都重绘（内容可能在别处被修改）
  if (name === 'chars') { try { renderSettingsChars(); } catch (e) { /* ignore */ } }
  if (name === 'logs') { try { renderSettingsLogs(); } catch (e) { /* ignore */ } }
  // 不同分页内容高度不同，重新贴合一次
  setTimeout(fitPanelWindow, 60);
}

function restoreSettingsTab() {
  var name = ShellPrefs.get('settingsTab', 'desktop');
  var panel = document.getElementById('panel-settings');
  if (!panel) return;
  var exists = panel.querySelector('.ptab[data-tab="' + name + '"]');
  if (!exists) name = 'desktop';
  panel.querySelectorAll('.ptab').forEach(function (b) {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  panel.querySelectorAll('.pane').forEach(function (p) {
    p.classList.toggle('active', p.dataset.pane === name);
  });
  if (name === 'chars') { try { renderSettingsChars(); } catch (e) { /* ignore */ } }
  if (name === 'logs') { try { renderSettingsLogs(); } catch (e) { /* ignore */ } }
}

// ==================== 窗口尺寸贴合内容 ====================

/** 测量当前面板的自然高度，算出「刚好装下 + 留出化身区域」的窗口尺寸 */
function fitPanelWindow() {
  if (!document.body.classList.contains('panel-mode')) return;

  var availW = (window.screen && window.screen.availWidth) || 1280;
  var availH = (window.screen && window.screen.availHeight) || 800;

  var panel = document.querySelector('.panel.active');
  if (!panel) {
    // 只有抽屉打开 → 用默认大画布
    var def = calcPanelSize();
    shellEnterPanelMode({ w: def.w, h: def.h });
    return;
  }

  // 临时放开高度限制，量出内容真实高度
  var prevMaxH = panel.style.maxHeight;
  panel.style.maxHeight = 'none';
  var head = panel.querySelector('.panel-head');
  var tabs = panel.querySelector('.panel-tabs');
  var body = panel.querySelector('.panel-body');
  var contentH = (head ? head.offsetHeight : 0)
    + (tabs ? tabs.offsetHeight : 0)
    + (body ? body.scrollHeight : 0);
  panel.style.maxHeight = prevMaxH;

  var wantW = parseInt(panel.dataset.panelW || '980', 10);
  var avatarSize = parseInt(ShellPrefs.get('avatarSize', 220), 10) || 220;
  var avatarZone = avatarSize + 50;   // 化身 + 贴在其上方的气泡

  var w = Math.round(Math.min(wantW + 36, availW - 60));
  var h = Math.round(Math.min(contentH + avatarZone + 34, availH - 80));

  shellEnterPanelMode({ w: w, h: h });
}

// ==================== 桌面外壳选项 ====================

function applyShellOptionsToControls() {
  var size = ShellPrefs.get('avatarSize', 220);
  var opacity = ShellPrefs.get('opacity', 85);
  var onTop = ShellPrefs.get('alwaysOnTop', true);

  var sizeInput = document.getElementById('optAvatarSize');
  var sizeVal = document.getElementById('optAvatarSizeVal');
  var opInput = document.getElementById('optOpacity');
  var opVal = document.getElementById('optOpacityVal');
  var topInput = document.getElementById('optAlwaysOnTop');

  if (sizeInput) sizeInput.value = size;
  if (sizeVal) sizeVal.textContent = size;
  if (opInput) opInput.value = opacity;
  if (opVal) opVal.textContent = opacity;
  if (topInput) topInput.checked = !!onTop;

  // ---- 消息展示 ----
  var fontSize = ShellPrefs.get('fontSize', 14);
  var histLimit = ShellPrefs.get('historyLimit', 5);
  var always = ShellPrefs.get('alwaysShowBubbles', true);
  var bTimeout = ShellPrefs.get('bubbleTimeout', 10);

  var fontInput = document.getElementById('optFontSize');
  var fontVal = document.getElementById('optFontSizeVal');
  var histInput = document.getElementById('optHistoryLimit');
  var histVal = document.getElementById('optHistoryLimitVal');
  var alwaysInput = document.getElementById('optAlwaysShowBubbles');
  var timeoutInput = document.getElementById('optBubbleTimeout');
  var timeoutVal = document.getElementById('optBubbleTimeoutVal');
  var timeoutCfg = document.getElementById('bubbleTimeoutConfig');

  if (fontInput) fontInput.value = fontSize;
  if (fontVal) fontVal.textContent = fontSize;
  if (histInput) histInput.value = histLimit;
  if (histVal) histVal.textContent = histLimit;
  if (alwaysInput) alwaysInput.checked = !!always;
  if (timeoutInput) timeoutInput.value = bTimeout;
  if (timeoutVal) timeoutVal.textContent = bTimeout;
  if (timeoutCfg) timeoutCfg.style.display = always ? 'none' : '';
}

function applyShellOptionStyles() {
  var size = ShellPrefs.get('avatarSize', 220);
  var opacity = ShellPrefs.get('opacity', 85);
  document.documentElement.style.setProperty('--avatar-size', size + 'px');
  document.documentElement.style.setProperty('--shell-opacity', String(opacity / 100));
  // 消息字体大小（气泡堆 / 消息浮层 / 输入栏）
  document.documentElement.style.setProperty('--shell-font', ShellPrefs.get('fontSize', 14) + 'px');
}

function resetShellLayout() {
  ShellPrefs.set('avatarSize', 220);
  ShellPrefs.set('opacity', 85);
  ShellPrefs.set('alwaysOnTop', true);
  ShellPrefs.set('fontSize', 14);
  ShellPrefs.set('historyLimit', 5);
  ShellPrefs.set('alwaysShowBubbles', true);
  ShellPrefs.set('bubbleTimeout', 10);
  applyShellOptionStyles();
  applyBubbleDisplayPrefs();
  _bubbleExpiry = {};
  _bubbleLastCount = -1;
  _stackSig = '';
  renderBubble();
  applyShellOptionsToControls();
  shellSetAlwaysOnTop(true);
  shellDockWindow();
  if (document.body.classList.contains('panel-mode')) setTimeout(fitPanelWindow, 60);
  showToast('已恢复默认外观与位置', 'success');
}

// ==================== 事件装配 ====================

function initPanels() {
  var layer = document.getElementById('panelLayer');
  if (layer) {
    // 点击面板外部空白区域关闭面板（抽屉有自己的遮罩，不在这里处理）
    layer.addEventListener('mousedown', function (e) {
      if (e.target !== layer) return;
      if (!layer.querySelector('.panel.active')) return;
      closeAllPanels();
    });
    layer.querySelectorAll('[data-close-all]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        closeAllPanels();
      });
    });
  }

  // ---- 设置分页 ----
  var tabs = document.getElementById('settingsTabs');
  if (tabs) {
    tabs.addEventListener('click', function (e) {
      var btn = e.target.closest('.ptab');
      if (!btn) return;
      switchSettingsTab(btn.dataset.tab);
    });
  }
  restoreSettingsTab();

  // ---- 桌面外壳选项 ----
  var topInput = document.getElementById('optAlwaysOnTop');
  if (topInput) {
    topInput.addEventListener('change', function () {
      shellSetAlwaysOnTop(topInput.checked);
      addProgramLog(LOG_TYPE_SYSTEM, { summary: '修改设置：窗口置顶 → ' + (topInput.checked ? '开' : '关') });
      showToast(topInput.checked ? '窗口已置顶 📌' : '已取消置顶');
    });
  }

  var sizeInput = document.getElementById('optAvatarSize');
  if (sizeInput) {
    sizeInput.addEventListener('input', function () {
      var v = parseInt(sizeInput.value, 10) || 220;
      ShellPrefs.set('avatarSize', v);
      var val = document.getElementById('optAvatarSizeVal');
      if (val) val.textContent = v;
      applyShellOptionStyles();
      if (document.body.classList.contains('panel-mode')) fitPanelWindow();
      else shellSyncAvatarWindowSize();
    });
    // 滑杆拖动过程会产生大量 input 事件，日志只在松手（change）时记一条
    sizeInput.addEventListener('change', function () {
      addProgramLog(LOG_TYPE_SYSTEM, { summary: '修改设置：化身尺寸 → ' + sizeInput.value + 'px' });
    });
  }

  var opInput = document.getElementById('optOpacity');
  if (opInput) {
    opInput.addEventListener('input', function () {
      var v = parseInt(opInput.value, 10) || 85;
      ShellPrefs.set('opacity', v);
      var val = document.getElementById('optOpacityVal');
      if (val) val.textContent = v;
      applyShellOptionStyles();
    });
    opInput.addEventListener('change', function () {
      addProgramLog(LOG_TYPE_SYSTEM, { summary: '修改设置：气泡不透明度 → ' + opInput.value + '%' });
    });
  }

  // ---- 消息展示 ----
  var fontInput = document.getElementById('optFontSize');
  if (fontInput) {
    fontInput.addEventListener('input', function () {
      var v = parseInt(fontInput.value, 10) || 14;
      ShellPrefs.set('fontSize', v);
      var val = document.getElementById('optFontSizeVal');
      if (val) val.textContent = v;
      applyShellOptionStyles();
    });
    fontInput.addEventListener('change', function () {
      addProgramLog(LOG_TYPE_SYSTEM, { summary: '修改设置：消息字体大小 → ' + fontInput.value + 'px' });
    });
  }

  var histInput = document.getElementById('optHistoryLimit');
  if (histInput) {
    histInput.addEventListener('input', function () {
      var v = parseInt(histInput.value, 10) || 5;
      ShellPrefs.set('historyLimit', v);
      var val = document.getElementById('optHistoryLimitVal');
      if (val) val.textContent = v;
      applyBubbleDisplayPrefs();
      renderBubble();          // 刷新气泡堆
      renderBubbleMessages();  // 浮层展开时同步刷新（内部会滚到底部）
    });
    histInput.addEventListener('change', function () {
      addProgramLog(LOG_TYPE_SYSTEM, { summary: '修改设置：历史消息条数 → ' + histInput.value });
    });
  }

  var alwaysInput = document.getElementById('optAlwaysShowBubbles');
  if (alwaysInput) {
    alwaysInput.addEventListener('change', function () {
      ShellPrefs.set('alwaysShowBubbles', alwaysInput.checked);
      var cfg = document.getElementById('bubbleTimeoutConfig');
      if (cfg) cfg.style.display = alwaysInput.checked ? 'none' : '';
      _bubbleExpiry = {};
      _stackSig = '';
      renderBubble();
      addProgramLog(LOG_TYPE_SYSTEM, { summary: '修改设置：始终展示历史气泡 → ' + (alwaysInput.checked ? '开' : '关') });
    });
  }

  var timeoutInput = document.getElementById('optBubbleTimeout');
  if (timeoutInput) {
    timeoutInput.addEventListener('input', function () {
      var v = parseInt(timeoutInput.value, 10) || 10;
      v = Math.max(1, Math.min(180, v));
      ShellPrefs.set('bubbleTimeout', v);
      var val = document.getElementById('optBubbleTimeoutVal');
      if (val) val.textContent = v;
      _bubbleExpiry = {};      // 新时限从现在起对所有可见气泡生效
      _stackSig = '';
      renderBubble();
    });
    timeoutInput.addEventListener('change', function () {
      addProgramLog(LOG_TYPE_SYSTEM, { summary: '修改设置：历史气泡展示时长 → ' + timeoutInput.value + ' 秒' });
    });
  }

  applyShellOptionsToControls();
}
