/**
 * 00_tauri.js —— Tauri 原生能力桥
 *
 * 设计原则：
 * 1) 只依赖 invoke 这一个入口（同时兼容 window.__TAURI__.core.invoke 与 __TAURI_INTERNALS__），
 *    避免绑定具体版本的 JS API 形态；
 * 2) 不在 Tauri 环境下自动降级为浏览器实现，这样同一套前端既能打包成桌面 App，
 *    也能直接在浏览器里打开预览调试（窗口相关操作变成空实现）。
 */

var ShellNative = (function () {
  function resolveInvoke() {
    try {
      if (window.__TAURI__ && window.__TAURI__.core &&
          typeof window.__TAURI__.core.invoke === 'function') {
        return window.__TAURI__.core.invoke.bind(window.__TAURI__.core);
      }
      if (window.__TAURI_INTERNALS__ &&
          typeof window.__TAURI_INTERNALS__.invoke === 'function') {
        return window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  var _invoke = resolveInvoke();

  return {
    available: !!_invoke,

    invoke: function (cmd, args) {
      if (!_invoke) return Promise.reject(new Error('非 Tauri 环境'));
      try {
        return Promise.resolve(_invoke(cmd, args || {}));
      } catch (e) {
        return Promise.reject(e);
      }
    }
  };
})();

/** 安全调用：桌面环境缺失时静默失败，不影响浏览器预览 */
function shellCall(cmd, args) {
  if (!ShellNative.available) return Promise.resolve(null);
  return ShellNative.invoke(cmd, args).catch(function (e) {
    console.warn('[Shell] 调用 ' + cmd + ' 失败：', e);
    return null;
  });
}

// ==================== 窗口操作 ====================

/** 按住化身/气泡拖动窗口 */
function shellStartDrag() {
  if (!ShellNative.available) return;
  shellCall('start_drag_window');
}

/** 窗口置顶开关 */
function shellSetAlwaysOnTop(on) {
  ShellPrefs.set('alwaysOnTop', !!on);
  shellCall('set_always_on_top', { onTop: !!on });
  updateTopButton();
}

/**
 * 刷新右键菜单里「窗口置顶」一项的文案与勾选态。
 * 窗口按钮已从界面上移除，置顶状态改为在菜单里体现。
 */
function updateTopButton() {
  var label = document.getElementById('ctxPinLabel');
  if (!label) return;
  var on = ShellPrefs.get('alwaysOnTop', true);
  label.textContent = on ? '取消窗口置顶' : '窗口置顶';
  var item = label.closest('.ctx-item');
  if (item) {
    item.classList.toggle('checked', on);
    item.title = on ? '当前已置顶，点击取消' : '当前未置顶，点击置顶';
  }
}

/** 计算面板模式尺寸（留出足够空间给设置/相册/日志） */
function calcPanelSize() {
  var availW = (window.screen && window.screen.availWidth) || 1280;
  var availH = (window.screen && window.screen.availHeight) || 800;
  var w = Math.round(Math.max(600, Math.min(1040, availW * 0.82)));
  var h = Math.round(Math.max(480, Math.min(780, availH * 0.88)));
  return { w: w, h: h };
}

/**
 * 进入面板模式：窗口放大并居中。
 * 传入 size 时按该尺寸（用于「贴合面板内容」的紧凑窗口）；
 * 否则使用默认的较大画布。
 */
function shellEnterPanelMode(size) {
  var first = !document.body.classList.contains('panel-mode');
  document.body.classList.add('panel-mode');
  if (!ShellNative.available) return;
  if (size && size.w && size.h) {
    shellCall('enter_panel_mode', { width: size.w, height: size.h });
    return;
  }
  if (!first) return;              // 已在面板模式下且未指定尺寸 → 保持现状
  var def = calcPanelSize();
  shellCall('enter_panel_mode', { width: def.w, height: def.h });
}

/** 退出面板模式：窗口还原并停靠右下角 */
function shellExitPanelMode() {
  if (!document.body.classList.contains('panel-mode')) return;
  document.body.classList.remove('panel-mode');
  shellCall('exit_panel_mode');
}

/** 重新停靠到屏幕右下角 */
function shellDockWindow() {
  shellCall('dock_window');
}

/**
 * 根据当前内容精确收紧窗口。
 *
 * 注意：不能直接量 .avatar-block 的实时高度 —— 化身的宽高带 CSS 过渡，
 * 展开/收起消息浮层时立即测量会读到「过渡进行中」的旧尺寸，窗口就会差出一个化身的高度。
 * 所以这里按已知量解析计算：气泡堆高度 + 输入栏高度 + 化身的「目标」高度。
 *
 * 高度上限直接取屏幕工作区高度：气泡堆最多 6 个气泡 × 6 行，全放得下就绝不切，
 * 只有极端情况（6 条都写满 6 行，且屏幕偏矮）才会从最旧的那条开始淡出。
 */
function shellSyncAvatarWindowSize() {
  if (document.body.classList.contains('panel-mode')) return;

  var availW = (window.screen && window.screen.availWidth) || 1280;
  var availH = (window.screen && window.screen.availHeight) || 900;
  var size = parseInt(ShellPrefs.get('avatarSize', 220), 10) || 220;
  var open = document.body.classList.contains('chat-open');

  var gap = 6;
  var stackEl = document.getElementById('bubbleStack');
  var barEl = document.getElementById('bubble');
  // 无内容或浮层展开时气泡堆是 display:none，此时它不占位、也不产生间距
  var stackVisible = !!(stackEl && getComputedStyle(stackEl).display !== 'none');
  var stackH = stackVisible ? stackEl.getBoundingClientRect().height : 0;
  var barH = barEl ? barEl.getBoundingClientRect().height : 40;
  // 空闲收起后化身不占位（窗口收缩成「气泡堆 + 输入栏」，位置不变）
  var avatarAway = document.body.classList.contains('avatar-away-done');
  var avatarH = avatarAway ? 0 : (open ? size * 0.5 : size);   // 化身的「目标」高度，而不是过渡中的高度

  var blockH = (stackH > 0 ? stackH + gap : 0) + barH + (avatarAway ? 0 : gap + avatarH);
  // 没有任何气泡时气泡堆不占位，输入栏按钮的悬停提示会向上浮出约 30px，
  // 这里预留同样高度，否则初始化的窗口太矮会把提示截断
  if (stackH === 0 && !open) blockH += 30;

  // 气泡堆的高度上限 = 屏幕工作区里，扣掉「输入栏 + 化身 + 内边距」之后剩下的全部空间。
  // 这样气泡堆最多能长到把窗口撑满屏幕，长文本就不会被顶部遮罩切掉。
  var chromeH = barH + (avatarAway ? 0 : gap + avatarH) + 14 + gap;   // 14 = stage 上下内边距
  var stackMax = Math.max(120, Math.round(availH - chromeH));
  document.documentElement.style.setProperty('--stack-max-h', stackMax + 'px');
  // 上限变了，「是否被截断」也要跟着重判（内容未变时 renderBubbleStack 不会重排）
  if (stackEl && stackEl.childElementCount) {
    stackEl.classList.toggle('clipped', stackEl.scrollHeight > stackEl.clientHeight + 1);
  }

  var w = Math.round(Math.min(Math.max(360, size + 170), Math.max(360, availW * 0.4)));

  var h = Math.round(blockH + 14 + (open ? 612 : 0));
  h = Math.min(Math.max(h, 200), Math.round(availH));   // 上限 = 屏幕工作区高度

  shellCall('resize_avatar_window', { width: w, height: h });
}

/** 隐藏到系统托盘（可从菜单栏托盘图标恢复） */
function shellHideWindow() {
  shellCall('hide_window');
}

// ==================== 文件读写 ====================

/**
 * 保存文本文件（导出数据 / 导出角色）
 * @returns {Promise<boolean>} 是否成功保存
 */
function shellSaveText(content, defaultName, filterName, filterExt) {
  if (ShellNative.available) {
    return ShellNative.invoke('save_text_file', {
      content: content,
      defaultName: defaultName,
      filterName: filterName || '文本文件',
      filterExt: filterExt || ['txt', 'json']
    }).then(function (path) {
      return !!path;
    }).catch(function (e) {
      showToast('保存失败：' + (e && e.message ? e.message : e), 'error');
      return false;
    });
  }
  // 浏览器降级：走 <a download>
  try {
    var blob = new Blob([content], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = defaultName;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    return Promise.resolve(true);
  } catch (e) {
    showToast('保存失败：' + e.message, 'error');
    return Promise.resolve(false);
  }
}

/**
 * 选择并读取文本文件
 * @returns {Promise<string|null>} 文件内容，取消则为 null
 */
function shellOpenText(filterName, filterExt) {
  if (ShellNative.available) {
    return ShellNative.invoke('open_text_file', {
      filterName: filterName || '文本文件',
      filterExt: filterExt || ['txt', 'json']
    }).catch(function (e) {
      showToast('读取失败：' + (e && e.message ? e.message : e), 'error');
      return null;
    });
  }
  // 浏览器降级：临时 file input
  return new Promise(function (resolve) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.json';
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) { resolve(null); return; }
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result)); };
      fr.onerror = function () { resolve(null); };
      fr.readAsText(file);
    };
    input.click();
  });
}

/**
 * 保存二进制文件（相册照片下载）
 * @param {string} dataUrl 形如 data:image/png;base64,xxxx
 */
function shellSaveBinary(dataUrl, defaultName) {
  if (!dataUrl) { showToast('图片数据不可用', 'error'); return Promise.resolve(false); }
  var comma = dataUrl.indexOf(',');
  var base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;

  if (ShellNative.available) {
    return ShellNative.invoke('save_binary_file', {
      base64Data: base64,
      defaultName: defaultName
    }).then(function (path) {
      if (path) showToast('照片已保存', 'success');
      return !!path;
    }).catch(function (e) {
      showToast('保存失败：' + (e && e.message ? e.message : e), 'error');
      return false;
    });
  }
  try {
    var a = document.createElement('a');
    a.href = dataUrl;
    a.download = defaultName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('照片已保存', 'success');
    return Promise.resolve(true);
  } catch (e) {
    showToast('保存失败：' + e.message, 'error');
    return Promise.resolve(false);
  }
}

// ==================== 外壳偏好（窗口级设置） ====================

var ShellPrefs = (function () {
  var KEY = 'rpm_shell_prefs';
  var cache = null;

  function load() {
    if (cache) return cache;
    var defaults = {
      alwaysOnTop: true,
      avatarSize: 220,
      opacity: 85,
      fontSize: 14,             // 消息字体大小（px）
      historyLimit: 5,          // 消息浮层最多展示的历史消息数
      alwaysShowBubbles: true,  // 是否始终展示历史消息气泡
      bubbleTimeout: 10         // 不始终展示时，每个气泡的存活秒数（1~180）
    };
    try {
      var raw = localStorage.getItem(KEY);
      cache = raw ? Object.assign(defaults, JSON.parse(raw)) : defaults;
    } catch (e) {
      cache = defaults;
    }
    return cache;
  }

  return {
    get: function (k, dflt) {
      var v = load()[k];
      return v === undefined ? dflt : v;
    },
    set: function (k, v) {
      var p = load();
      p[k] = v;
      try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
    },
    all: load
  };
})();

// ==================== 窗口操作入口（已并入右键菜单） ====================
//
// 之前化身右上角浮动「置顶 / 最小化 / 退出」三个按钮，太破坏沉浸感，
// 现在全部收进右键菜单（见 shell/03_menu.js 的 pin / minimize / quit）。
// 这里只保留最小化与退出的实现，供菜单项调用。

/** 最小化窗口（应用保留 Dock 图标，点 Dock 图标即可恢复） */
function shellMinimize() {
  if (!ShellNative.available) {
    showToast('浏览器预览模式：最小化不可用', 'info');
    return;
  }
  shellCall('minimize_window');
}

/** 退出应用：先弹应用内确认框，避免误触 */
async function shellQuitWithConfirm() {
  if (!ShellNative.available) {
    showToast('浏览器预览模式：请直接关闭标签页', 'info');
    return;
  }
  var ok = await confirmDialog('确定退出「RolePlayMaster 化身」吗？', { title: '退出应用', okText: '退出' });
  if (ok) shellCall('quit_app');
}

/** 启动时把置顶状态同步给窗口 */
function applyShellWindowPrefs() {
  var onTop = ShellPrefs.get('alwaysOnTop', true);
  shellCall('set_always_on_top', { onTop: onTop });
  updateTopButton();

  var size = ShellPrefs.get('avatarSize', 220);
  document.documentElement.style.setProperty('--avatar-size', size + 'px');
  var op = ShellPrefs.get('opacity', 85);
  document.documentElement.style.setProperty('--shell-opacity', String(op / 100));
}
