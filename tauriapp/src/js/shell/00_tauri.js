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

function updateTopButton() {
  var btn = document.getElementById('winTopBtn');
  if (!btn) return;
  var on = ShellPrefs.get('alwaysOnTop', true);
  btn.classList.toggle('off', !on);
  btn.title = on ? '窗口已置顶（点击取消）' : '窗口未置顶（点击开启）';
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
 * 根据当前化身尺寸与聊天浮层是否展开，动态调整窗口大小。
 * 收起态窗口紧贴化身，避免大片透明区域挡住桌面上的其它应用。
 */
function shellSyncAvatarWindowSize() {
  if (document.body.classList.contains('panel-mode')) return;
  var size = parseInt(ShellPrefs.get('avatarSize', 220), 10) || 220;
  var open = document.body.classList.contains('chat-open');
  var availH = (window.screen && window.screen.availHeight) || 900;
  var availW = (window.screen && window.screen.availWidth) || 1280;

  var w = Math.round(Math.min(Math.max(360, size + 170), Math.max(360, availW * 0.4)));
  var h = open
    ? Math.round(Math.min(size + 390, availH * 0.88))
    : Math.round(Math.min(size + 118, availH * 0.6));

  shellCall('resize_avatar_window', { width: w, height: h });
}

/** 最小化窗口（应用保留 Dock 图标，点 Dock 图标即可恢复） */
function shellMinimize() {
  if (!ShellNative.available) {
    showToast('浏览器预览模式：最小化不可用', 'info');
    return;
  }
  shellCall('minimize_window');
}

/** 隐藏到系统托盘（可从菜单栏托盘图标恢复） */
function shellHideWindow() {
  shellCall('hide_window');
}

/** 退出应用（浏览器预览时仅提示） */
function shellQuit() {
  if (!ShellNative.available) {
    showToast('浏览器预览模式：请直接关闭标签页', 'info');
    return;
  }
  shellCall('quit_app');
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
    var defaults = { alwaysOnTop: true, avatarSize: 220, opacity: 85 };
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

// ==================== 窗口工具按钮装配 ====================

function initWindowTools() {
  var topBtn = document.getElementById('winTopBtn');
  var minBtn = document.getElementById('winHideBtn');
  var quitBtn = document.getElementById('winQuitBtn');

  if (topBtn) {
    updateTopButton();
    topBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      shellSetAlwaysOnTop(!ShellPrefs.get('alwaysOnTop', true));
      showToast(ShellPrefs.get('alwaysOnTop', true) ? '窗口已置顶 📌' : '已取消置顶');
    });
  }

  if (minBtn) {
    minBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      shellMinimize();
    });
  }

  // 退出用「两段式确认」，避免依赖 Tauri 不支持的 window.confirm
  if (quitBtn) {
    var armed = false;
    var timer = null;
    var disarm = function () {
      armed = false;
      quitBtn.classList.remove('armed');
      quitBtn.textContent = '✕';
      quitBtn.title = '退出应用';
      if (timer) { clearTimeout(timer); timer = null; }
    };
    quitBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!armed) {
        armed = true;
        quitBtn.classList.add('armed');
        quitBtn.textContent = '✓';
        quitBtn.title = '再点一次退出应用';
        showToast('再点一次即退出应用');
        timer = setTimeout(disarm, 3000);
        return;
      }
      disarm();
      shellQuit();
    });
    // 点到别处就取消待确认状态
    document.addEventListener('mousedown', function (e) {
      if (armed && e.target !== quitBtn) disarm();
    });
  }
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
