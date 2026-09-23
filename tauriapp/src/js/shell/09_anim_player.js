/**
 * 09_anim_player.js —— 角色动画播放器（sprite sheet + canvas 逐帧绘制）
 *
 * 设计要点：
 * - 状态管理按**角色 ID 命名空间**（_animStates[charId]），当前即使界面上
 *   只有一个角色实例，结构上也支持任意多个实例并行播放（群聊每个格子独立）；
 * - 动画队列：触发情绪动画 = 入队，**上一个播完才播下一个**；
 *   队列空了自动回退待机（idle）循环；
 * - 情绪没有对应动画 → 不入队（等效回退待机），并返回 false 供调用方记日志；
 * - 播放时零计算：抽帧/色键/拼图都在上传阶段完成，这里只做
 *   「按已流逝时间定位帧号 + drawImage 一次拷贝」；sheet 按需从 IndexedDB
 *   懒加载并缓存内存（_animSheetCache）；
 * - 单个 requestAnimationFrame 节拍器驱动所有实例，无实例时自动停表省电。
 */

// ==================== 状态（按角色 ID 命名空间） ====================

var _animStates = {};        // charId -> { queue: [emotion...], current: {emotion,meta,img,start}|null, idleImg }
var _animDisplays = [];      // 舞台上正在显示的实例 [{charId, canvas, ctx, container}]
var _animSheetCache = {};    // cacheKey -> { img } | { promise }（charId::emotion -> Image）
var _animRafId = 0;

function _animEnsureState(charId) {
  if (!_animStates[charId]) {
    _animStates[charId] = { queue: [], current: null, idleImg: null, loading: false };
  }
  return _animStates[charId];
}

/** 聊天里的角色名 → 角色图库 id（无图库条目时退回名字命名空间） */
function resolveCharacterId(name) {
  var c = findCharacter(name);
  return c ? c.id : 'name:' + (name || '');
}

/** 化身元素名 → 角色图库 id */
function resolveCharAvatarId(c) {
  if (c.charId) return c.charId;
  return resolveCharacterId(c.name);
}

// ==================== sheet 懒加载 ====================

/**
 * 加载某角色某情绪的 sprite sheet（IndexedDB → Image 解码 → 内存缓存）。
 * 返回 Promise<Image|null>；并发调用共享同一次加载。
 */
function animLoadSheet(charId, emotion) {
  var key = charId + '::' + emotion;
  var cached = _animSheetCache[key];
  if (cached) {
    if (cached.img) return Promise.resolve(cached.img);
    if (cached.promise) return cached.promise;
  }
  var promise = animLoadAsset(charId, emotion).then(function (dataUrl) {
    if (!dataUrl) {
      delete _animSheetCache[key];
      return null;
    }
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        _animSheetCache[key] = { img: img };
        resolve(img);
      };
      img.onerror = function () {
        delete _animSheetCache[key];
        resolve(null);
      };
      img.src = dataUrl;
    });
  }).catch(function () {
    delete _animSheetCache[key];
    return null;
  });
  _animSheetCache[key] = { promise: promise };
  return promise;
}

// ==================== 队列 / 触发 ====================

/**
 * 触发情绪动画：加入该角色的动画队列（顺序播放）。
 * @returns {boolean} 该角色是否有此情绪的动画（false = 回退待机，不入队）
 */
function animTrigger(charId, emotion) {
  var meta = charAnimEntry(charId, emotion);
  if (!meta) return false;                      // 找不到对应动画 → 回退待机
  var st = _animEnsureState(charId);
  if (st.queue.length >= 8) return true;        // 队列上限，静默丢弃
  // 连续重复触发只保留一次
  if (st.queue[st.queue.length - 1] === emotion) return true;
  st.queue.push(emotion);
  // loading 防止重入：上一个 playNext 还在等 sheet 加载时，不再重复取队首
  if (!st.current && !st.loading) _animPlayNext(charId);
  _animEnsureTicker();
  return true;
}

/** 播下一个（队列空 = 不做任何事，绘制层自动回到待机循环） */
function _animPlayNext(charId) {
  var st = _animEnsureState(charId);
  var emotion = st.queue.shift();
  if (!emotion) { st.current = null; st.loading = false; return; }
  st.loading = true;

  animLoadSheet(charId, emotion).then(function (img) {
    var st2 = _animStates[charId];
    if (!st2) return;                           // 实例已被清掉（切聊天/删角色）
    st2.loading = false;
    var meta = charAnimEntry(charId, emotion);
    if (!img || !meta) {
      _animPlayNext(charId);                    // 资产缺失 → 跳过（等效回退待机）
      return;
    }
    st2.current = { emotion: emotion, meta: meta, img: img, start: performance.now() };
    _animEnsureTicker();
  });
}

// ==================== 绘制 ====================

/** 把 sprite sheet 的第 fi 帧画到 canvas（唯一的热路径，一次 drawImage） */
function _animDrawFrame(canvas, img, meta, fi) {
  if (canvas.width !== meta.cellW) canvas.width = meta.cellW;
  if (canvas.height !== meta.cellH) canvas.height = meta.cellH;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  var col = fi % meta.cols;
  var row = Math.floor(fi / meta.cols);
  ctx.drawImage(img,
    col * meta.cellW, row * meta.cellH, meta.cellW, meta.cellH,
    0, 0, meta.cellW, meta.cellH);
}

/**
 * 绘制一个实例的当前帧。
 * @returns {boolean} 该实例是否仍需要节拍器继续跑
 */
function _animDrawInstance(d, now) {
  var st = _animStates[d.charId];
  var metas = charAnimations(d.charId);
  var imgEl = d.container.querySelector('img');
  var phEl = d.container.querySelector('.avatar-placeholder-face');   // 占位头像（无图角色）
  var canvas = d.canvas;

  function _hideStatic(hide) {
    var v = hide ? 'hidden' : '';
    if (imgEl) imgEl.style.visibility = v;
    if (phEl) phEl.style.visibility = v;
  }

  // 当前在播情绪动画
  if (st && st.current) {
    var clip = st.current;
    var fi = Math.floor((now - clip.start) / 1000 * clip.meta.fps);
    if (fi >= clip.meta.frameCount) {
      st.current = null;                        // 播完 → 队列下一个 / 待机
      _animPlayNext(d.charId);
    } else {
      _animDrawFrame(canvas, clip.img, clip.meta, fi);
      canvas.style.display = '';
      _hideStatic(true);
      return true;
    }
  }

  // 待机循环
  var idleMeta = metas[ANIM_IDLE_EMOTION];
  if (idleMeta) {
    var idleImg = (st && st.idleImg) ? st.idleImg : null;
    if (!idleImg) {
      animLoadSheet(d.charId, ANIM_IDLE_EMOTION).then(function (img) {
        var st2 = _animStates[d.charId];
        if (st2 && img) {
          st2.idleImg = img;
          _animEnsureTicker();
        }
      });
      return true;                              // 等待加载，保持节拍
    }
    var span = Math.max(1, idleMeta.frameCount - (idleMeta.loopStart || 0));
    var ifi = (idleMeta.loopStart || 0) + (Math.floor(now / 1000 * idleMeta.fps) % span);
    _animDrawFrame(canvas, idleImg, idleMeta, ifi);
    canvas.style.display = '';
    _hideStatic(true);
    return true;
  }

  // 没有待机（也没在播情绪）：还原静态图片/占位
  canvas.style.display = 'none';
  _hideStatic(false);
  return false;
}

// ==================== 节拍器 ====================

function _animTick(now) {
  _animRafId = 0;
  var alive = false;
  for (var i = 0; i < _animDisplays.length; i++) {
    if (_animDrawInstance(_animDisplays[i], now)) alive = true;
  }
  if (alive) _animRafId = requestAnimationFrame(_animTick);
}

function _animEnsureTicker() {
  if (!_animRafId && _animDisplays.length) {
    _animRafId = requestAnimationFrame(_animTick);
  }
}

// ==================== 与化身 DOM 同步 ====================

/** 从当前化身 DOM 收集角色实例（单角色大圆 / 群聊小圆格） */
function collectAnimInstances() {
  var out = [];
  var single = document.getElementById('avatarSingle');
  var multi = document.getElementById('avatarMulti');
  if (single && single.style.display !== 'none') {
    var img = single.querySelector('img');
    // 名字优先读渲染时写入的 data-char-name（占位头像没有 img 时也能解析）
    var name = single.getAttribute('data-char-name') || (img ? img.getAttribute('alt') : '') || '';
    if (name) {
      out.push({ name: name, container: single });
    }
  } else if (multi && multi.style.display !== 'none') {
    multi.querySelectorAll('.avatar-cell').forEach(function (cell) {
      out.push({ name: cell.getAttribute('title') || '', container: cell });
    });
  }
  out.forEach(function (inst) { inst.charId = resolveCharAvatarId(inst); });
  return out;
}

// ==================== 对外接口 ====================

var AnimPlayer = {
  /**
   * 化身渲染后调用：按 DOM 里的角色实例重建显示层。
   * 有动画的角色挂 canvas 并隐藏静态图；没有的还原静态图。
   */
  syncFromDom: function () {
    var instances = collectAnimInstances();
    var seen = {};
    var nextDisplays = [];

    instances.forEach(function (inst) {
      seen[inst.charId] = true;
      var metas = charAnimations(inst.charId);
      var hasAnims = Object.keys(metas).length > 0;
      var imgEl = inst.container.querySelector('img');
      var phEl = inst.container.querySelector('.avatar-placeholder-face');

      var canvas = inst.container.querySelector('canvas.avatar-anim-canvas');
      if (!hasAnims) {
        if (canvas) canvas.remove();
        if (imgEl) imgEl.style.visibility = '';
        if (phEl) phEl.style.visibility = '';
        var st = _animStates[inst.charId];
        if (st) { st.current = null; st.queue = []; }   // 停止排队（不可见时播了也白播）
        return;
      }
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.className = 'avatar-anim-canvas';
        inst.container.appendChild(canvas);
      }
      nextDisplays.push({ charId: inst.charId, container: inst.container, canvas: canvas, ctx: canvas.getContext('2d') });
    });

    _animDisplays = nextDisplays;

    // 舞台上已不存在的角色状态直接清理（换聊天 / 删角色）
    for (var id in _animStates) {
      if (!seen[id]) delete _animStates[id];
    }
    _animEnsureTicker();
  },

  /** 触发情绪动画（角色 id）；找不到动画返回 false（调用方记日志） */
  trigger: function (charId, emotion) {
    return animTrigger(charId, emotion);
  },

  /** 按角色名触发（AI function calling 入口） */
  triggerByName: function (name, emotion) {
    var lib = findCharacter(name);
    if (!lib) return false;
    return animTrigger(lib.id, emotion);
  },

  /** 某角色是否有某个情绪的动画 */
  hasEmotion: function (charId, emotion) {
    return !!charAnimEntry(charId, emotion);
  },

  /** 某角色的全部情绪（含待机） */
  emotionsOf: function (charId) {
    return Object.keys(charAnimations(charId));
  },

  /** 舞台上当前显示的角色实例（供 function calling 枚举可用情绪） */
  displayedCharIds: function () {
    var ids = [];
    for (var i = 0; i < _animDisplays.length; i++) {
      if (ids.indexOf(_animDisplays[i].charId) < 0) ids.push(_animDisplays[i].charId);
    }
    return ids;
  },

  /** 动画更新/删除后失效 sheet 缓存 */
  invalidate: function (charId, emotion) {
    delete _animSheetCache[charId + '::' + emotion];
    var st = _animStates[charId];
    if (st && emotion === ANIM_IDLE_EMOTION) st.idleImg = null;
  },

  /** 整个角色的缓存失效 */
  invalidateChar: function (charId) {
    for (var key in _animSheetCache) {
      if (key.indexOf(charId + '::') === 0) delete _animSheetCache[key];
    }
    delete _animStates[charId];
  },

  /** 清空一切（重置数据时用） */
  clearAll: function () {
    _animStates = {};
    _animSheetCache = {};
    _animDisplays = [];
  }
};

window.AnimPlayer = AnimPlayer;
