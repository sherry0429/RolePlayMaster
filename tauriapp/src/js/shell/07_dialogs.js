/**
 * 06_dialogs.js —— 应用内确认框
 *
 * 背景：Tauri 的 WebView 不支持浏览器原生 `window.confirm()`（macOS 上 WKWebView
 * 会直接忽略，返回值恒为 undefined/false），因此网页版里所有 `if (!confirm(...)) return;`
 * 形式的二次确认在桌面端都会「点了没反应」。
 *
 * 处理方式：
 *   1. 提供 confirmDialog(message) → Promise<boolean>，使用应用内样式化的模态框；
 *   2. core 模块里 7 处 confirm 调用已改为 await confirmDialog(...)（见 MAP.md）；
 *   3. 兜底把 window.confirm 覆盖为一个「弹应用内对话框 + 立即返回 false」的实现——
 *      这样即使将来有遗漏的调用点，也只会「取消操作」，绝不会静默执行危险动作。
 */

/**
 * 应用内确认框
 * @param {string} message 提示文案
 * @param {{okText?:string, cancelText?:string, title?:string, danger?:boolean}} [options]
 * @returns {Promise<boolean>}
 */
function confirmDialog(message, options) {
  options = options || {};
  return new Promise(function (resolve) {
    var overlay = document.getElementById('modalOverlay');
    var content = document.getElementById('modalContent');
    if (!overlay || !content) {
      resolve(false);
      return;
    }

    var okText = options.okText || '确定';
    var cancelText = options.cancelText || '取消';
    var title = options.title || '请确认';
    var dangerClass = options.danger === false ? '' : ' confirm-ok-danger';

    content.style.maxWidth = '420px';
    content.innerHTML =
      '<h3>' + escHtml(title) + '</h3>' +
      '<div class="confirm-message">' + escHtml(message).replace(/\n/g, '<br>') + '</div>' +
      '<div class="modal-btns">' +
        '<button class="btn-sm btn-ghost" data-confirm-cancel>' + escHtml(cancelText) + '</button>' +
        '<button class="btn-sm btn-primary' + dangerClass + '" data-confirm-ok>' + escHtml(okText) + '</button>' +
      '</div>';

    overlay.classList.add('show');
    overlay._onConfirm = null;
    overlay._isDialog = true;

    var done = false;
    function finish(result) {
      if (done) return;
      done = true;
      overlay.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKey, true);
      overlay._isDialog = null;
      overlay.classList.remove('show');
      resolve(result);
    }

    content.querySelector('[data-confirm-ok]').addEventListener('click', function (e) {
      e.stopPropagation();
      finish(true);
    });
    content.querySelector('[data-confirm-cancel]').addEventListener('click', function (e) {
      e.stopPropagation();
      finish(false);
    });

    // 点击遮罩或按 Esc 视为取消
    function onOverlayClick(e) {
      if (e.target === overlay) finish(false);
    }
    overlay.addEventListener('click', onOverlayClick);

    function onKey(e) {
      if (e.key === 'Escape') finish(false);
    }
    document.addEventListener('keydown', onKey, true);
  });
}

/** 应用内提示框（只有一个「知道了」） */
function messageDialog(message, title) {
  var overlay = document.getElementById('modalOverlay');
  var content = document.getElementById('modalContent');
  if (!overlay || !content) {
    showToast(String(message));
    return;
  }
  content.style.maxWidth = '420px';
  content.innerHTML =
    '<h3>' + escHtml(title || '提示') + '</h3>' +
    '<div class="confirm-message">' + escHtml(message).replace(/\n/g, '<br>') + '</div>' +
    '<div class="modal-btns">' +
      '<button class="btn-sm btn-primary" data-msg-ok>知道了</button>' +
    '</div>';
  overlay.classList.add('show');
  overlay._onConfirm = null;
  content.querySelector('[data-msg-ok]').addEventListener('click', function (e) {
    e.stopPropagation();
    overlay.classList.remove('show');
  });
}

// ==================== 兜底：覆盖原生 confirm / alert ====================

/**
 * 原生 confirm 在 Tauri 里不可用，覆盖为：
 * 弹出应用内确认框（用户能看到提示），但同步返回 false 让调用方中止。
 * core 模块已全部改用 confirmDialog，这里只是防止遗漏调用点静默执行危险操作。
 */
window.confirm = function (message) {
  console.warn('[Shell] 检测到对原生 confirm 的调用，已替换为应用内确认框（返回值按“取消”处理）');
  confirmDialog(String(message === undefined ? '' : message));
  return false;
};

/** 原生 alert 同样不可用，改成 Toast */
window.alert = function (message) {
  showToast(String(message === undefined ? '' : message));
};
