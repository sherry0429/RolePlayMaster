
/**
 * 模态框
 * 自动拆分模块
 * 保持全局兼容模式
 */

function showModal(title, value, onConfirm, readOnly) {
  var overlay = document.getElementById('modalOverlay');
  var content = document.getElementById('modalContent');

  var html = `<h3>${escHtml(title)}</h3>`;
  if (readOnly) {
    html += `<textarea style="width:100%;min-height:80px;padding:8px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);color:var(--text-primary);font-size:12px;resize:vertical;font-family:monospace;" readonly>${escHtml(value)}</textarea>`;
  } else {
    html += `<input type="text" id="modalInput" value="${escHtml(value)}">`;
  }
  html += `<div class="modal-btns">`;
  if (!readOnly && onConfirm) {
    html += `<button class="btn-sm btn-primary" onclick="confirmModal()">确定</button>`;
  }
  html += `<button class="btn-sm btn-ghost" onclick="closeModal()">关闭</button>`;
  html += `</div>`;

  content.innerHTML = html;
  overlay.classList.add('show');

  // 保存回调
  if (onConfirm) {
    overlay._onConfirm = onConfirm;
  } else {
    overlay._onConfirm = null;
  }
}

/* 带大文本域的弹框，用于编辑长文本如 System Prompt */
function showTextareaModal(title, value, onConfirm) {
  var overlay = document.getElementById('modalOverlay');
  var content = document.getElementById('modalContent');

  var html = `<h3>${escHtml(title)}</h3>`;
  html += `<textarea id="modalTextarea" style="width:100%;min-height:260px;max-height:60vh;padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);color:var(--text-primary);font-size:14px;line-height:1.5;resize:vertical;font-family:inherit;outline:none;">${escHtml(value)}</textarea>`;
  html += `<div class="modal-btns">`;
  html += `<button class="btn-sm btn-primary" onclick="confirmTextareaModal()">保存</button>`;
  html += `<button class="btn-sm btn-ghost" onclick="closeModal()">取消</button>`;
  html += `</div>`;

  content.innerHTML = html;
  content.style.maxWidth = '560px';
  overlay.classList.add('show');

  // 聚焦文本域
  setTimeout(() => {
    var ta = document.getElementById('modalTextarea');
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, 50);

  // 保存回调
  overlay._onConfirm = onConfirm;
  overlay._isTextarea = true;
}

function confirmTextareaModal() {
  var ta = document.getElementById('modalTextarea');
  var overlay = document.getElementById('modalOverlay');
  if (ta && overlay._onConfirm) {
    overlay._onConfirm(ta.value);
  }
  closeModal();
}

function confirmModal() {
  var input = document.getElementById('modalInput');
  if (input && document.getElementById('modalOverlay')._onConfirm) {
    document.getElementById('modalOverlay')._onConfirm(input.value);
  }
  closeModal();
}

function closeModal() {
  var overlay = document.getElementById('modalOverlay');
  var content = document.getElementById('modalContent');
  overlay.classList.remove('show');
  overlay._onConfirm = null;
  overlay._isTextarea = null;
  content.style.maxWidth = ''; // 重置弹框宽度
  content.style.maxHeight = '';
  content.style.padding = '';
  content.style.background = '';
  content.style.border = '';
  content.style.boxShadow = '';
}

// 点击遮罩关闭
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modalOverlay')) {
    closeModal();
  }
});

