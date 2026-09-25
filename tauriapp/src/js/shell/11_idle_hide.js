/**
 * 11_idle_hide.js —— 空闲收起化身
 *
 * 场景：聊一会儿去忙别的，右下角的化身留在桌面碍事。
 * 行为：一段时间无操作 → 化身朝「离窗口最近的屏幕边缘」滚走（滚动 + 缩小 + 淡出），
 *       窗口随之收缩，只保留输入栏；用户再次点击/输入 → 化身从原方向滚回来并弹两下。
 *
 * 只在桌面外壳里生效；设置面板打开、AI 正在回复、拍照中都不会收起。
 */

var _idleLastActivity = Date.now();
var _idleTimer = null;
var _avatarAway = false;      // 已收起（滚走动画已开始）
var _avatarAwayDone = false;  // 滚走动画已结束（此时窗口才收缩、化身 display:none）

var IDLE_ROLL_MS = 900;       // 滚走动画时长，与 CSS 保持一致

function idleHideEnabled() {
  return ShellPrefs.get('idleHideAvatar', true) !== false;
}

function idleHideMinutes() {
  var m = parseInt(ShellPrefs.get('idleHideMinutes', 3), 10);
  return (m >= 1 && m <= 60) ? m : 3;
}

/** 化身当前是否已收起（窗口尺寸计算用） */
function avatarIsAway() {
  return _avatarAwayDone && document.body.classList.contains('avatar-away-done');
}

// ==================== 空闲计时 ====================

/** 用户有明确操作：刷新计时，并把已收起的化身唤回来 */
function noteShellActivity() {
  _idleLastActivity = Date.now();
  scheduleIdleCheck();
  if (_avatarAway) rollAvatarBack();
}

/** 仅刷新计时（鼠标划过这类「不算操作」的动作用它） */
function touchIdleTimer() {
  _idleLastActivity = Date.now();
  scheduleIdleCheck();
}

function scheduleIdleCheck() {
  clearTimeout(_idleTimer);
  if (!idleHideEnabled()) return;
  _idleTimer = setTimeout(checkIdleAndHide, idleHideMinutes() * 60 * 1000);
}

/** 到点检查：确认确实空闲、且没有正在进行中的对话/面板，才收起 */
function checkIdleAndHide() {
  if (!idleHideEnabled() || _avatarAway) return;
  if (Date.now() - _idleLastActivity < idleHideMinutes() * 60 * 1000 - 500) {
    scheduleIdleCheck();
    return;
  }
  if (typeof isStreaming !== 'undefined' && isStreaming) { scheduleIdleCheck(); return; }
  if (typeof isCompressing !== 'undefined' && isCompressing) { scheduleIdleCheck(); return; }
  if (typeof isPhotoShooting !== 'undefined' && isPhotoShooting) { scheduleIdleCheck(); return; }
  if (document.body.classList.contains('panel-mode')) { scheduleIdleCheck(); return; }
  if (document.body.classList.contains('chat-open')) { scheduleIdleCheck(); return; }
  rollAvatarAway();
}

// ==================== 滚走 / 滚回 ====================

/**
 * 计算滚动方向与位移：朝离窗口最近的屏幕边缘（左 / 右 / 下，取最近的一个）。
 * 位移要足够让整个圆滑出窗口边界，视觉上就是「滚出屏幕边缘」。
 */
function computeRollVector() {
  var size = parseInt(ShellPrefs.get('avatarSize', 220), 10) || 220;
  var availW = (window.screen && window.screen.availWidth) || 1280;
  var availH = (window.screen && window.screen.availHeight) || 900;

  var winW = window.outerWidth || document.documentElement.clientWidth || 360;
  var winH = window.outerHeight || document.documentElement.clientHeight || 400;
  var sx = (typeof window.screenX === 'number' && !isNaN(window.screenX)) ? window.screenX : NaN;
  var sy = (typeof window.screenY === 'number' && !isNaN(window.screenY)) ? window.screenY : NaN;

  // 化身在窗口内的中心点（圆形，位于窗口底部居中）
  var cx = winW / 2;
  var cy = winH - size / 2 - 14;

  var r = size / 2;
  var pad = 24;   // 多滚一点，确保完全出界

  var dir = 'right';
  if (!isNaN(sx) && !isNaN(sy)) {
    // 窗口在屏幕上的位置 → 比较到三条候选边的距离
    var dLeft = sx + cx;
    var dRight = availW - (sx + cx);
    var dBottom = availH - (sy + cy);
    var min = dRight;
    dir = 'right';
    if (dLeft < min) { min = dLeft; dir = 'left'; }
    if (dBottom < min) { min = dBottom; dir = 'bottom'; }
  }

  var x = 0, y = 0, rot = 0;
  if (dir === 'left') {
    x = -(cx + r + pad);
    rot = -900;      // 逆时针滚
  } else if (dir === 'right') {
    x = (winW - cx) + r + pad;
    rot = 900;       // 顺时针滚
  } else {
    y = (winH - cy) + r + pad;
    rot = 720;
  }
  return { dir: dir, x: Math.round(x), y: Math.round(y), rot: rot };
}

/** 化身滚走：朝最近边缘滚出 + 缩小淡出，动画结束后收起窗口高度 */
function rollAvatarAway() {
  var av = document.getElementById('avatar');
  if (!av || _avatarAway) return;
  if (document.body.classList.contains('panel-mode')) return;

  _avatarAway = true;
  var v = computeRollVector();
  av.style.setProperty('--roll-x', v.x + 'px');
  av.style.setProperty('--roll-y', v.y + 'px');
  av.style.setProperty('--roll-rot', v.rot + 'deg');
  av.classList.remove('avatar-return');
  av.classList.add('avatar-away');

  clearTimeout(_idleRollTimer);
  _idleRollTimer = setTimeout(function () {
    if (!_avatarAway) return;
    _avatarAwayDone = true;
    document.body.classList.add('avatar-away-done');   // 化身不再占位 → 窗口收缩
    shellSyncAvatarWindowSize();
  }, IDLE_ROLL_MS);
}

/** 化身滚回来：从原方向滚入并弹两下 */
function rollAvatarBack() {
  if (!_avatarAway) return;
  var av = document.getElementById('avatar');
  if (!av) return;

  _avatarAway = false;
  _avatarAwayDone = false;
  clearTimeout(_idleRollTimer);
  document.body.classList.remove('avatar-away-done');
  av.classList.remove('avatar-away');

  // 先把窗口撑回带化身的高度，化身才有地方滚进来
  shellSyncAvatarWindowSize();

  av.classList.add('avatar-return');
  clearTimeout(_idleReturnTimer);
  _idleReturnTimer = setTimeout(function () { av.classList.remove('avatar-return'); }, 1200);

  _idleLastActivity = Date.now();
  scheduleIdleCheck();
}

var _idleRollTimer = null;
var _idleReturnTimer = null;

/** 设置变化后重新排程（关掉开关时立刻把化身唤回） */
function applyIdleHidePrefs() {
  clearTimeout(_idleTimer);
  if (!idleHideEnabled()) {
    if (_avatarAway) rollAvatarBack();
    return;
  }
  scheduleIdleCheck();
}

// ==================== 事件装配 ====================

function initIdleHide() {
  // 明确的操作：刷新计时 + 唤回化身
  ['mousedown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, function () { noteShellActivity(); }, { passive: true, capture: true });
  });
  // 指针移动只刷新计时（鼠标偶然划过不该把化身弹回来）
  document.addEventListener('mousemove', function () { touchIdleTimer(); }, { passive: true });

  // 输入框获得焦点 / 开始输入：把化身唤回来
  var input = document.getElementById('userInput');
  if (input) {
    input.addEventListener('focus', function () { noteShellActivity(); });
    input.addEventListener('input', function () { noteShellActivity(); });
  }

  applyIdleHidePrefs();
}
