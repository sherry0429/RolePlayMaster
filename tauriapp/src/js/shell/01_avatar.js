/**
 * 01_avatar.js —— 化身（Avatar）
 *
 * 职责：
 * - 依据当前聊天的关联角色渲染圆形化身（单角色 = 一个圆；多角色 = 大圆内聚合多个小圆）
 * - 从角色图片中提取「出现最多的颜色」作为气泡描边主色（多角色固定为黑色）
 * - 图片边缘通过 radial-gradient 遮罩实现「越靠边越透明」的淡出效果
 */

// ==================== 主色提取 ====================

var _dominantCache = {};   // src -> {r,g,b} | null

/** RGB -> HSL（h:0-360, s:0-1, l:0-1） */
function _rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  var h = 0, s = 0, l = (max + min) / 2;
  var d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: h, s: s, l: l };
}

/** HSL -> RGB */
function _hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  var r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

/** 提升饱和度/亮度，让描边色更鲜明可辨 */
function _boostColor(rgb) {
  var hsl = _rgbToHsl(rgb.r, rgb.g, rgb.b);
  hsl.s = Math.min(1, Math.max(hsl.s, 0.52));
  hsl.l = Math.min(0.68, Math.max(hsl.l, 0.42));
  return _hslToRgb(hsl.h, hsl.s, hsl.l);
}

/**
 * 计算图片中出现最多的颜色（32x32 采样 + 4bit 量化 + 中心加权）
 * 结果带缓存，避免切换聊天时重复解码
 */
function computeDominantColor(src, callback) {
  if (!src) { callback(null); return; }
  if (Object.prototype.hasOwnProperty.call(_dominantCache, src)) {
    callback(_dominantCache[src]);
    return;
  }

  var img = new Image();
  img.onload = function () {
    try {
      var S = 32;
      var canvas = document.createElement('canvas');
      canvas.width = S;
      canvas.height = S;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, S, S);
      var data = ctx.getImageData(0, 0, S, S).data;

      var buckets = {};
      var cx = (S - 1) / 2, cy = (S - 1) / 2;
      var maxDist = Math.sqrt(cx * cx + cy * cy);

      for (var y = 0; y < S; y++) {
        for (var x = 0; x < S; x++) {
          var i = (y * S + x) * 4;
          if (data[i + 3] < 128) continue;           // 透明像素不计
          var r = data[i], g = data[i + 1], b = data[i + 2];
          var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          var lum = 0.299 * r + 0.587 * g + 0.114 * b;
          var sat = mx === 0 ? 0 : (mx - mn) / mx;

          var w = 1;
          // 中心权重更高（人像主体通常在中心）
          var dist = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / maxDist;
          w *= 1.25 - dist * 0.5;
          // 压暗极端明暗与低饱和区域，避免主色总是黑/白/灰
          if (lum < 24 || lum > 236) w *= 0.15;
          if (sat < 0.1) w *= 0.3;

          var key = (r >> 4) + '_' + (g >> 4) + '_' + (b >> 4);
          var bk = buckets[key] || (buckets[key] = { r: 0, g: 0, b: 0, w: 0 });
          bk.r += r * w;
          bk.g += g * w;
          bk.b += b * w;
          bk.w += w;
        }
      }

      var best = null;
      for (var k in buckets) {
        if (!best || buckets[k].w > best.w) best = buckets[k];
      }
      if (!best || best.w <= 0) {
        _dominantCache[src] = null;
        callback(null);
        return;
      }
      var color = _boostColor({
        r: Math.round(best.r / best.w),
        g: Math.round(best.g / best.w),
        b: Math.round(best.b / best.w)
      });
      _dominantCache[src] = color;
      callback(color);
    } catch (e) {
      // 图片跨域/读取失败 → 退回默认主色
      _dominantCache[src] = null;
      callback(null);
    }
  };
  img.onerror = function () {
    _dominantCache[src] = null;
    callback(null);
  };
  img.src = src;
}

// ==================== 主色应用 ====================

/** 写入 --accent-rgb（供气泡描边、箭头、发送按钮共用） */
function applyAccentColor(color) {
  var rgb = color || { r: 99, g: 102, b: 241 };
  document.documentElement.style.setProperty(
    '--accent-rgb',
    rgb.r + ', ' + rgb.g + ', ' + rgb.b
  );
}

/** 多角色 / 无角色时统一使用黑色描边 */
function applyBlackAccent() {
  document.documentElement.style.setProperty('--accent-rgb', '0, 0, 0');
}

// ==================== 角色来源 ====================

/**
 * 取当前聊天要展示的角色列表
 * 优先级：聊天关联角色 > System Prompt 中【】匹配到图库的角色
 */
function getChatAvatars() {
  if (!currentChatId || !appData.chats[currentChatId]) return [];
  var chat = appData.chats[currentChatId];

  if (chat.characters && chat.characters.length > 0) {
    return chat.characters.slice();
  }

  var sp = getCurrentSpVersion();
  var names = extractSpeakerNames(sp.content || '');
  var out = [];
  names.forEach(function (n) {
    var c = findCharacter(n);
    if (c) out.push({ name: c.name, avatar: c.avatar || '' });
  });
  return out;
}

// ==================== 多角色布局 ====================

/**
 * 依据角色数量计算小圆位置（单位化坐标，0~1）
 * 统一采用「环形分布」：整体仍落在与单角色一致的大圆范围内，
 * 并通过外圈遮罩让整组头像一起淡出。
 */
function layoutMulti(n) {
  if (n <= 1) return [{ cx: 0.5, cy: 0.5, d: 1.0 }];

  // 数量 → { 环形半径, 圆直径, 起始角度(度) }
  // 参数经过测算：相邻圆不重叠，且整体外接范围不超过 0.98（避免被容器遮罩切掉）
  var presets = {
    2: { r: 0.25, d: 0.48, start: 0 },     // 左右并排
    3: { r: 0.25, d: 0.42, start: -90 },   // 一个在上、两个在下
    4: { r: 0.27, d: 0.40, start: -135 },  // 田字格
    5: { r: 0.26, d: 0.30, start: -90 },
    6: { r: 0.26, d: 0.26, start: -90 }
  };
  var preset = presets[n] || presets[6];

  // 超过 6 个：只排前 6 个，其余通过角标提示
  var shown = Math.min(n, 6);
  var out = [];
  for (var i = 0; i < shown; i++) {
    var angle = (preset.start + i * (360 / shown)) * Math.PI / 180;
    out.push({
      cx: 0.5 + preset.r * Math.cos(angle),
      cy: 0.5 + preset.r * Math.sin(angle),
      d: preset.d
    });
  }
  return out;
}

// ==================== 渲染 ====================

var _avatarSignature = '';   // 角色集合指纹，未变化时跳过重绘（避免图片闪烁）

/** 角色集合指纹（名字 + 头像特征） */
function avatarSignature(chars) {
  return chars.length + '#' + chars.map(function (c) {
    var av = c.avatar || '';
    return (c.name || '') + ':' + (av ? av.length + '|' + av.slice(-24) : '');
  }).join('~');
}

function _renderAvatarBase() {
  var singleEl = document.getElementById('avatarSingle');
  var multiEl = document.getElementById('avatarMulti');
  var badgeEl = document.getElementById('avatarBadge');
  if (!singleEl || !multiEl) return;

  var chars = getChatAvatars().filter(function (c) { return c && (c.avatar || c.name); });

  var sig = avatarSignature(chars);
  if (sig === _avatarSignature && singleEl.childElementCount + multiEl.childElementCount > 0) {
    return;   // 视觉无变化，跳过
  }
  _avatarSignature = sig;

  // 无角色：显示占位化身（继承当前聊名的首字）
  if (chars.length === 0) {
    var chat = currentChatId ? appData.chats[currentChatId] : null;
    var label = chat ? (chat.name || 'AI').charAt(0) : '🤖';
    singleEl.removeAttribute('data-char-name');
    multiEl.style.display = 'none';
    multiEl.innerHTML = '';
    singleEl.style.display = '';
    singleEl.innerHTML = '<div class="avatar-placeholder-face">' + escHtml(label) + '</div>';
    if (badgeEl) badgeEl.classList.remove('show');
    applyAccentColor(null);
    return;
  }

  // 单角色
  if (chars.length === 1) {
    var c0 = chars[0];
    singleEl.style.display = '';
    multiEl.style.display = 'none';
    multiEl.innerHTML = '';
    singleEl.setAttribute('data-char-name', c0.name || '');   // 动画播放器按名字解析角色
    if (c0.avatar) {
      singleEl.innerHTML = '<img id="avatarMainImg" src="' + escHtml(c0.avatar) + '" alt="' + escHtml(c0.name || '') + '">';
      computeDominantColor(c0.avatar, function (color) {
        // 期间若已切换到别的角色，丢弃这次结果
        if (sig !== _avatarSignature) return;
        applyAccentColor(color);
      });
    } else {
      singleEl.innerHTML = '<div class="avatar-placeholder-face">' + escHtml((c0.name || '?').charAt(0)) + '</div>';
      applyAccentColor(null);
    }
    if (badgeEl) badgeEl.classList.remove('show');
    return;
  }

  // 多角色：大圆内聚合
  singleEl.style.display = 'none';
  singleEl.innerHTML = '';
  singleEl.removeAttribute('data-char-name');
  multiEl.style.display = '';

  var layout = layoutMulti(chars.length);
  var html = '';
  for (var i = 0; i < layout.length && i < chars.length; i++) {
    var c = chars[i];
    var l = layout[i];
    var sizePct = (l.d * 100).toFixed(2) + '%';
    var leftPct = ((l.cx - l.d / 2) * 100).toFixed(2) + '%';
    var topPct = ((l.cy - l.d / 2) * 100).toFixed(2) + '%';
    var inner = c.avatar
      ? '<img src="' + escHtml(c.avatar) + '" alt="' + escHtml(c.name || '') + '">'
      : '<div class="avatar-cell-fallback">' + escHtml((c.name || '?').charAt(0)) + '</div>';
    html += '<div class="avatar-cell" style="width:' + sizePct + ';height:' + sizePct +
            ';left:' + leftPct + ';top:' + topPct + ';" title="' + escHtml(c.name || '') + '">' +
            inner + '</div>';
  }
  multiEl.innerHTML = html;

  if (badgeEl) {
    if (chars.length > 6) {
      badgeEl.textContent = '共 ' + chars.length + ' 人';
      badgeEl.classList.add('show');
    } else {
      badgeEl.classList.remove('show');
    }
  }

  // 多角色：描边固定为黑色
  applyBlackAccent();
}

/**
 * 化身渲染入口：先按静态图渲染 DOM，再让动画播放器按角色实例接管 ——
 * 配了动画的角色会把 <img> 藏起来、在其位置挂 canvas 逐帧绘制；
 * 没有动画的角色保持原样。
 */
function renderAvatar() {
  _renderAvatarBase();
  if (window.AnimPlayer) {
    try { AnimPlayer.syncFromDom(); } catch (e) { /* 动画系统异常不影响化身显示 */ }
  }
}

/** 流式输出期间给化身加一点“说话中”的呼吸动画 */
function setAvatarSpeaking(on) {
  var el = document.getElementById('avatar');
  if (!el) return;
  el.classList.toggle('speaking', !!on);
}
