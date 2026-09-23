/**
 * 03_menu.js —— 化身右键菜单
 *
 * 菜单项（按需求，不含「重放」）：
 *   创建聊天（群聊） / 切换聊天
 *   修改 System Prompt / 触发记忆功能 / 触发拍照功能
 *   打开设置面板
 */

function openContextMenu(x, y) {
  var menu = document.getElementById('contextMenu');
  var stage = document.getElementById('stage');
  if (!menu || !stage) return;

  // 没选中聊天时，与聊天相关的操作置灰
  var hasChat = !!(currentChatId && appData.chats[currentChatId]);
  ['sp', 'memory', 'photo'].forEach(function (act) {
    var item = menu.querySelector('.ctx-item[data-act="' + act + '"]');
    if (item) item.classList.toggle('disabled', !hasChat);
  });

  menu.classList.add('open');

  // 先显示再测量，才能拿到真实尺寸
  var rect = menu.getBoundingClientRect();
  var bounds = stage.getBoundingClientRect();
  var left = Math.max(2, Math.min(x, bounds.width - rect.width - 2));
  var top = Math.max(2, Math.min(y, bounds.height - rect.height - 2));
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}

function closeContextMenu() {
  var menu = document.getElementById('contextMenu');
  if (menu) menu.classList.remove('open');
}

function handleMenuAction(act) {
  closeContextMenu();
  switch (act) {
    case 'newGroup':
      startGroupChatFlow();
      break;
    case 'switch':
      openSettingsPanel();
      // 滚动到聊天列表
      setTimeout(function () {
        var list = document.getElementById('panel-settings');
        if (list) {
          var target = list.querySelector('#chatList');
          if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }, 120);
      break;
    case 'sp':
      openSpPanel();
      break;
    case 'memory':
      triggerMemory();
      break;
    case 'photo':
      triggerTakePhoto();
      break;
    case 'settings':
      openSettingsPanel();
      break;
    default:
      break;
  }
}

/**
 * 绑定所有带 data-drag 的拖动区域（面板标题栏、抽屉标题栏、消息浮层顶栏）。
 * 落在交互控件上的按下不触发拖动，避免影响按钮点击。
 */
function initDragHandles() {
  document.querySelectorAll('[data-drag]').forEach(function (el) {
    el.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (e.target.closest('button, input, textarea, select, a, .ptab')) return;
      e.preventDefault();
      closeContextMenu();
      shellStartDrag();
    });
  });
}

function initContextMenu() {
  var menu = document.getElementById('contextMenu');
  var stage = document.getElementById('stage');

  if (menu) {
    menu.querySelectorAll('.ctx-item').forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.stopPropagation();
        if (item.classList.contains('disabled')) return;
        handleMenuAction(item.dataset.act);
      });
    });
  }

  if (stage) {
    // 化身右键
    var avatar = document.getElementById('avatar');
    if (avatar) {
      avatar.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openContextMenu(e.clientX, e.clientY);
      });
    }

    // 点击其他地方关闭菜单
    document.addEventListener('mousedown', function (e) {
      if (!menu || !menu.classList.contains('open')) return;
      if (menu.contains(e.target)) return;
      if (e.target.closest && e.target.closest('#bubble')) return;
      closeContextMenu();
    });

    // 屏蔽整个外壳的系统右键菜单
    document.addEventListener('contextmenu', function (e) {
      var t = e.target;
      // 输入框/日志等需要文本操作的区域保留原生菜单
      if (t && t.closest && t.closest('input, textarea, .log-drawer-body, .sp-content, .album-drawer-body, .gallery-drawer-body')) return;
      e.preventDefault();
    });

    // Esc 逐层关闭
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (menu && menu.classList.contains('open')) { closeContextMenu(); return; }
      if (_bubblePanelOpen) { closeBubblePanel(); return; }
      if (document.body.classList.contains('panel-mode')) { closeAllPanels(); }
    });
  }

  // 窗口拖拽：按住化身旁边的空白处
  var dragSurface = document.getElementById('avatar');
  if (dragSurface) {
    dragSurface.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      closeContextMenu();
      shellStartDrag();
    });
  }

  // 面板 / 抽屉 / 消息浮层的标题栏也可以拖窗口
  initDragHandles();
}
