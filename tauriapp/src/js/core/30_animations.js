
/**
 * 角色动画资产管线（仅桌面版）
 *
 * 职责（全部在「上传时一次性完成」，播放时不做任何实时计算）：
 *   1) 用户上传一段约 2 秒的 AI 生成视频（每个动画对应一种情绪）；
 *   2) 用隐藏 <video> 逐帧 seek + canvas 抽帧；
 *      - 可选色键（chroma key）抠像：上传时对每一帧做像素级处理，
 *        生成带 alpha 通道的帧 —— 播放阶段直接 drawImage，零计算；
 *      - 背景色支持自动检测（首帧四角取样平均）或手动指定；
 *   3) 拼接成 sprite sheet（PNG dataURL，每帧最大边 ANIM_CELL 像素）；
 *   4) 生成元数据 { frameCount, fps, cols, rows, cellW, cellH,
 *      loopMode, loopStart, chroma }，随 appData 持久化（体积小）；
 *      sheet 本体写入 IndexedDB 的 anim_assets store（体积大），
 *      key = anim:{charId}:{emotion}，播放时按需懒加载 + 内存缓存。
 *
 * 情绪约定：
 *   - 'idle'（待机）是保留名：每个启用动画的角色必须上传，
 *     循环播放，营造 Live2D 式的呼吸感；情绪动画播完自动回退待机；
 *   - 其他情绪名（高兴/悲伤/看书…）由用户自定义，loopMode = 'once'。
 */

var ANIM_CELL = 256;        // 单帧最大边（化身显示最大 320px，256 足够且省体积）
var ANIM_MAX_FRAMES = 96;   // 抽帧上限（2s × 30fps = 60，留余量）
var ANIM_SHEET_COLS = 8;    // sprite sheet 每行帧数
var ANIM_IDLE_EMOTION = 'idle';

// ==================== 角色动画元数据存取 ====================

/** 按 id 查角色 */
function getCharacterById(charId) {
  if (!appData.characters || !charId) return null;
  for (var i = 0; i < appData.characters.length; i++) {
    if (appData.characters[i].id === charId) return appData.characters[i];
  }
  return null;
}

/** 某角色的全部动画元数据 { emotion: meta }；无则返回 {} */
function charAnimations(charId) {
  var c = getCharacterById(charId);
  return (c && c.animations) ? c.animations : {};
}

/** 某角色某个情绪的元数据；无则返回 null */
function charAnimEntry(charId, emotion) {
  var metas = charAnimations(charId);
  return metas[emotion] || null;
}

/** 写入/更新某角色某个情绪的元数据（不含 sheet 本体）并持久化 */
async function saveCharAnimMeta(charId, emotion, meta) {
  var c = getCharacterById(charId);
  if (!c) throw new Error('角色不存在：' + charId);
  if (!c.animations) c.animations = {};
  c.animations[emotion] = meta;
  await saveData();
}

/** 删除某角色某个情绪的元数据 + sheet 资产，并持久化 */
async function deleteCharAnim(charId, emotion) {
  var c = getCharacterById(charId);
  if (c && c.animations) {
    delete c.animations[emotion];
    if (Object.keys(c.animations).length === 0) delete c.animations;
  }
  try { await animDeleteAsset(charId, emotion); } catch (e) { /* ignore */ }
  if (window.AnimPlayer) AnimPlayer.invalidate(charId, emotion);
  await saveData();
}

/** 角色删除时清理其全部动画资产（供 deleteCharacter 调用） */
async function deleteAllCharAnims(charId) {
  var metas = charAnimations(charId);
  var emotions = Object.keys(metas);
  var c = getCharacterById(charId);
  if (c) delete c.animations;
  for (var i = 0; i < emotions.length; i++) {
    try { await animDeleteAsset(charId, emotions[i]); } catch (e) { /* ignore */ }
  }
  if (window.AnimPlayer) AnimPlayer.invalidateChar(charId);
  if (emotions.length) await saveData();
}

// ==================== sprite sheet 资产（IndexedDB 懒加载） ====================

function animAssetKey(charId, emotion) {
  return 'anim:' + charId + ':' + emotion;
}

/** sheet 本体写入 IndexedDB（dataURL 字符串） */
async function animSaveAsset(charId, emotion, dataUrl) {
  var db = await openDB();
  return new Promise((resolve, reject) => {
    var tx = db.transaction([DB_ANIM_STORE], 'readwrite');
    tx.objectStore(DB_ANIM_STORE).put({ key: animAssetKey(charId, emotion), sheet: dataUrl });
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

/** sheet 本体读取（播放时懒加载），没有则返回 null */
async function animLoadAsset(charId, emotion) {
  try {
    var db = await openDB();
    return await new Promise((resolve, reject) => {
      var tx = db.transaction([DB_ANIM_STORE], 'readonly');
      var req = tx.objectStore(DB_ANIM_STORE).get(animAssetKey(charId, emotion));
      req.onsuccess = (e) => resolve(e.target.result ? e.target.result.sheet : null);
      req.onerror = (e) => reject(e.target.error);
    });
  } catch (e) {
    console.error('[Anim] 资产读取失败', charId, emotion, e);
    return null;
  }
}

async function animDeleteAsset(charId, emotion) {
  var db = await openDB();
  return new Promise((resolve, reject) => {
    var tx = db.transaction([DB_ANIM_STORE], 'readwrite');
    tx.objectStore(DB_ANIM_STORE).delete(animAssetKey(charId, emotion));
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

// ==================== 视频抽帧 / 色键 / 拼图 ====================

/** 等待 <video> seek 到指定时间点 */
function _animSeek(video, t) {
  return new Promise(function (resolve, reject) {
    var done = false;
    var onSeeked = function () {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    // 兜底：个别编码 seeked 不触发，超时按当前帧算
    setTimeout(onSeeked, 1200);
    try {
      video.currentTime = Math.min(Math.max(t, 0), Math.max(0, video.duration - 0.001));
    } catch (e) {
      video.removeEventListener('seeked', onSeeked);
      reject(e);
    }
  });
}

/**
 * 检测背景色：首帧四角各取 10×10 块平均。
 * 返回 {r,g,b, uniform} —— uniform 表示四角颜色是否足够接近（差异过大说明不是纯色背景）。
 */
function _animDetectBackgroundColor(ctx, x, y, w, h) {
  var patch = 10;
  var corners = [
    [x + 1, y + 1], [x + w - patch - 1, y + 1],
    [x + 1, y + h - patch - 1], [x + w - patch - 1, y + h - patch - 1]
  ];
  var sum = { r: 0, g: 0, b: 0 }, n = 0;
  var avgs = [];
  for (var ci = 0; ci < corners.length; ci++) {
    var d = ctx.getImageData(corners[ci][0], corners[ci][1], patch, patch).data;
    var acc = { r: 0, g: 0, b: 0 };
    for (var i = 0; i < d.length; i += 4) { acc.r += d[i]; acc.g += d[i + 1]; acc.b += d[i + 2]; }
    var cnt = d.length / 4;
    avgs.push({ r: acc.r / cnt, g: acc.g / cnt, b: acc.b / cnt });
    sum.r += acc.r; sum.g += acc.g; sum.b += acc.b; n += cnt;
  }
  var overall = { r: sum.r / n, g: sum.g / n, b: sum.b / n };
  var maxDiff = 0;
  for (var ai = 0; ai < avgs.length; ai++) {
    var diff = Math.sqrt(
      Math.pow(avgs[ai].r - overall.r, 2) +
      Math.pow(avgs[ai].g - overall.g, 2) +
      Math.pow(avgs[ai].b - overall.b, 2));
    if (diff > maxDiff) maxDiff = diff;
  }
  return {
    r: Math.round(overall.r), g: Math.round(overall.g), b: Math.round(overall.b),
    uniform: maxDiff < 24   // 四角基本一致才认为是纯色背景
  };
}

/**
 * 对指定帧区域做色键抠像（写入 alpha）。
 * 距离 < hard 内完全透明，hard ~ feather 之间线性过渡（避免锯齿白边）。
 */
function _animApplyChromaKey(ctx, x, y, w, h, color, tolerance) {
  var img = ctx.getImageData(x, y, w, h);
  var d = img.data;
  var hard = Math.max(4, tolerance);          // RGB 欧氏距离，完全透明阈值
  var feather = Math.max(10, hard * 0.45);    // 过渡带宽度
  var cr = color.r, cg = color.g, cb = color.b;
  for (var i = 0; i < d.length; i += 4) {
    var dr = d[i] - cr, dg = d[i + 1] - cg, db = d[i + 2] - cb;
    var dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist <= hard) {
      d[i + 3] = 0;
    } else if (dist < hard + feather) {
      d[i + 3] = Math.round(d[i + 3] * (dist - hard) / feather);
    }
  }
  ctx.putImageData(img, x, y);
}

/**
 * 上传处理主流程（一次性完成：抽帧 → 色键 → 拼图 → 元数据）
 *
 * @param {File|Blob} file 视频文件
 * @param {object} opts { emotion, fps, chroma: 'auto'|'off'|'custom',
 *                        chromaColor: {r,g,b}|null, tolerance: 5~80 }
 * @param {function} onProgress (done, total, phase)
 * @returns {{ meta: object, sheetDataUrl: string }}
 */
async function processAnimationUpload(file, opts, onProgress) {
  var emotion = String(opts.emotion || '').trim();
  if (!emotion) throw new Error('缺少情绪名称');

  onProgress = onProgress || function () {};
  onProgress(0, 1, 'loading');

  var url = URL.createObjectURL(file);
  var video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;

  try {
    await new Promise(function (resolve, reject) {
      video.onloadedmetadata = function () { resolve(); };
      video.onerror = function () { reject(new Error('视频无法解码，请使用 MP4(H.264) 或 WebM 格式')); };
    });

    var vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) throw new Error('无法读取视频尺寸');

    var fps = parseInt(opts.fps, 10) || 30;
    fps = Math.max(8, Math.min(60, fps));
    var count = Math.max(1, Math.min(ANIM_MAX_FRAMES, Math.floor(video.duration * fps)));

    // 单帧尺寸：保持宽高比，最大边 = ANIM_CELL
    var scale = Math.min(ANIM_CELL / vw, ANIM_CELL / vh, 2);
    var cw = Math.max(2, Math.round(vw * scale));
    var ch = Math.max(2, Math.round(vh * scale));
    var cols = Math.min(ANIM_SHEET_COLS, count);
    var rows = Math.ceil(count / cols);

    var sheet = document.createElement('canvas');
    sheet.width = cols * cw;
    sheet.height = rows * ch;
    var ctx = sheet.getContext('2d', { willReadFrequently: true });

    // 色键设置：'auto' 抽完第一帧后自动检测背景色；'custom' 用指定色；'off' 不抠像
    var chromaMode = opts.chroma || 'auto';
    var chromaColor = null;
    var chromaUniform = true;
    if (chromaMode !== 'off') {
      await _animSeek(video, 0);
      ctx.drawImage(video, 0, 0, cw, ch);
      var detected = _animDetectBackgroundColor(ctx, 0, 0, cw, ch);
      chromaUniform = detected.uniform;
      chromaColor = (chromaMode === 'custom' && opts.chromaColor) ? opts.chromaColor
        : { r: detected.r, g: detected.g, b: detected.b };
    }

    var tolerance = Math.max(5, Math.min(80, parseInt(opts.tolerance, 10) || 28));

    for (var i = 0; i < count; i++) {
      await _animSeek(video, i / fps);
      var cx = (i % cols) * cw;
      var cy = Math.floor(i / cols) * ch;
      ctx.drawImage(video, cx, cy, cw, ch);
      if (chromaColor) _animApplyChromaKey(ctx, cx, cy, cw, ch, chromaColor, tolerance);
      onProgress(i + 1, count, 'extract');
    }

    onProgress(count, count, 'encode');
    var sheetDataUrl = sheet.toDataURL('image/png');

    var meta = {
      emotion: emotion,
      frameCount: count,
      fps: fps,
      cols: cols,
      rows: rows,
      cellW: cw,
      cellH: ch,
      loopMode: (emotion === ANIM_IDLE_EMOTION) ? 'loop' : 'once',  // 待机循环；情绪动画播一次
      loopStart: 0,                                                  // 循环起点帧（预留）
      chroma: { mode: chromaMode, color: chromaColor, tolerance: tolerance },
      srcName: file.name || '',
      createdAt: Date.now()
    };

    return { meta: meta, sheetDataUrl: sheetDataUrl };
  } finally {
    try { video.pause(); } catch (e) { /* ignore */ }
    video.removeAttribute('src');
    try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
  }
}
