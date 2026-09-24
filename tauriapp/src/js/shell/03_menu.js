/**
 * 03_menu.js —— 化身右键菜单
 *
 * 菜单项（按需求，不含「重放」）：
 *   创建聊天（群聊） / 切换聊天
 *   修改 System Prompt / 触发记忆功能 / 触发拍照功能
 *   打开设置面板
 *   窗口置顶 / 最小化 / 退出应用   ← 原先浮在化身右上角的三个按钮收进来了
 */

/**
 * 二级菜单：聊天列表。
 * 直接从 chatOrder 渲染，不用先进设置面板就能切换。
 */
function buildChatSubmenu() {
  var sub = document.getElementById('ctxChatSub');
  if (!sub) return;

  var ids = appData.chatOrder || [];
  if (ids.length === 0) {
    sub.innerHTML = '<div class="ctx-sub-empty">还没有聊天</div>';
    return;
  }

  sub.innerHTML = ids.map(function (id) {
    var chat = appData.chats[id];
    if (!chat) return '';
    var chars = chat.characters || [];
    var multi = chars.length > 1;
    var cls = 'ctx-sub-avatar' + (multi ? ' multi' : '');
    var face = (chars.length > 0 && chars[0].avatar)
      ? '<img class="' + cls + '" src="' + escHtml(chars[0].avatar) + '" alt="">'
      : '<span class="' + cls + '"></span>';
    var active = id === currentChatId;
    return '<div class="ctx-sub-item' + (active ? ' active' : '') + '" data-chat="' + escHtml(id) + '">' +
      face +
      '<span class="ctx-sub-name">' + escHtml(chat.name || '未命名') + '</span>' +
      (active ? '<span class="ctx-sub-tick">当前</span>' : '') +
      '</div>';
  }).join('');

  sub.querySelectorAll('.ctx-sub-item').forEach(function (item) {
    item.addEventListener('click', function (e) {
      e.stopPropagation();
      var id = item.dataset.chat;
      closeContextMenu();
      if (!id || id === currentChatId) return;
      selectChat(id);
      showToast('已切换到「' + ((appData.chats[id] || {}).name || '') + '」');
    });
  });
}

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

  // 置顶项的文案与勾选态跟随当前状态
  updateTopButton();

  buildChatSubmenu();

  menu.classList.add('open');
  menu.scrollTop = 0;         // 每次打开都从顶部开始（菜单超高时可滚动）

  // 先显示再测量，才能拿到真实尺寸
  var rect = menu.getBoundingClientRect();
  var bounds = stage.getBoundingClientRect();
  var left = Math.max(2, Math.min(x, bounds.width - rect.width - 2));
  var top = Math.max(2, Math.min(y, bounds.height - rect.height - 2));
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';

  positionChatSubmenu();
}

/**
 * 二级菜单（切换聊天）定位。
 * 以「切换聊天」菜单项的实时视口位置（getBoundingClientRect）为基准 ——
 * 自动兼容菜单滚动，不再用 offsetTop + 固定高度估算，
 * 任何情况下二级菜单都与菜单项无缝衔接：
 * 鼠标从菜单项移向二级菜单的路径上始终有悬停目标，不会再闪没。
 */
function positionChatSubmenu() {
  var menu = document.getElementById('contextMenu');
  var stage = document.getElementById('stage');
  if (!menu || !stage) return;
  var item = menu.querySelector('.ctx-item.has-sub');
  var sub = menu.querySelector('.ctx-sub');
  if (!item || !sub) return;

  var bounds = stage.getBoundingClientRect();
  var menuRect = menu.getBoundingClientRect();
  var itemRect = item.getBoundingClientRect();

  // 临时强制显示，量出真实尺寸（聊天数不同，高度不同）
  sub.style.display = 'block';
  sub.style.visibility = 'hidden';
  var subW = sub.offsetWidth || 184;
  var subH = sub.offsetHeight || 246;
  sub.style.visibility = '';
  sub.style.display = '';

  // 水平：贴菜单项右缘（无缝）；放不下翻到左侧（同样贴紧）；再夹进窗口
  var absLeft = itemRect.right;
  if (absLeft + subW > bounds.right - 2) absLeft = itemRect.left - subW;
  absLeft = Math.max(bounds.left + 2, Math.min(absLeft, bounds.right - 2 - subW));

  // 垂直：默认与菜单项顶对齐；底部放不下时整体上移 ——
  // 上移后与菜单项仍有重叠（sub 是菜单项的子节点，重叠区悬停链不会断），绝无空隙
  var absTop = itemRect.top;
  if (absTop + subH > bounds.bottom - 2) absTop = bounds.bottom - 2 - subH;
  absTop = Math.max(bounds.top + 2, absTop);

  // .ctx-sub 的定位基准是整个菜单的 padding 盒，换算时加上边框宽度
  sub.style.left = Math.round(absLeft - menuRect.left - menu.clientLeft) + 'px';
  sub.style.top = Math.round(absTop - menuRect.top - menu.clientTop) + 'px';
  sub.style.right = 'auto';
}

function closeContextMenu() {
  var menu = document.getElementById('contextMenu');
  if (!menu) return;
  menu.classList.remove('open', 'sub-open');
  var forced = menu.querySelector('.ctx-item.sub-forced');
  if (forced) forced.classList.remove('sub-forced');
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
    case 'pin':
      shellSetAlwaysOnTop(!ShellPrefs.get('alwaysOnTop', true));
      showToast(ShellPrefs.get('alwaysOnTop', true) ? '窗口已置顶 📌' : '已取消置顶');
      break;
    case 'minimize':
      shellMinimize();
      break;
    case 'quit':
      shellQuitWithConfirm();
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
      // 「[照片]」气泡可点击打开大图，不参与窗口拖拽
      if (e.target.closest && e.target.closest('.bs-photo')) return;
      // 可滚动且内容溢出的拖拽区（如历史气泡堆）：让位给滚动条，
      // 否则按住拖窗口会吞掉滚动条拖动。滚轮滚动不受影响。
      var oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return;
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
        // 「切换聊天」：点击 = 展开/收起二级菜单（不再落到设置面板）。
        // 兼容窗口失焦后首次点击 hover 不生效的场景 —— 点一下就出菜单。
        if (item.classList.contains('has-sub')) {
          var forced = item.classList.toggle('sub-forced');
          menu.classList.toggle('sub-open', forced);
          positionChatSubmenu();
          return;
        }
        handleMenuAction(item.dataset.act);
      });
    });

    // 二级菜单展开期间（悬停或点击强制），放开菜单的滚动裁剪（.sub-open），
    // 否则二级子菜单会被菜单的 overflow-y 裁掉
    var hasSub = menu.querySelector('.ctx-item.has-sub');
    if (hasSub) {
      hasSub.addEventListener('mouseenter', function () {
        menu.classList.add('sub-open');
        positionChatSubmenu();   // 菜单若滚动过，悬停时按实时位置重定位
      });
    }

    // 离开菜单：收回滚动放行与点击强制展开的二级菜单
    menu.addEventListener('mouseleave', function () {
      menu.classList.remove('sub-open');
      var forced = menu.querySelector('.ctx-item.sub-forced');
      if (forced) forced.classList.remove('sub-forced');
    });

    // 菜单滚动时，二级菜单位置跟着菜单项走
    menu.addEventListener('scroll', function () {
      if (menu.classList.contains('open')) positionChatSubmenu();
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
