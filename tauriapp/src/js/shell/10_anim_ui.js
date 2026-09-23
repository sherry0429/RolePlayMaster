/**
 * 10_anim_ui.js —— 角色动画管理界面（桌面版）
 *
 * 入口：角色图库卡片悬停出现的 🎬 按钮 → 动画管理模态框：
 *   - 「待机（idle）」固定在首位 —— 启用动画的角色必填，循环播放呼吸感动画；
 *   - 其余情绪（高兴/悲伤/看书…）由用户自由添加，每个情绪独立一张 sprite sheet；
 *   - 上传时一次性完成：抽帧 → 色键抠像（自动检测背景色/指定色/不抠）→
 *     拼 sheet → 生成元数据，产物持久化（sheet 进 IndexedDB，元数据进 appData）；
 *   - 支持播放预览（小 canvas 循环）与删除。
 */

var _animMgrCtx = null;      // { charIdx, charId }
var _animUploadFile = null;  // 待处理的视频文件
var _animUploadResult = null;// { meta, sheetDataUrl }
var _animPreviewTimer = 0;   // 预览循环定时器

var ANIM_EMOTION_PRESETS = ['高兴', '悲伤', '惊讶', '生气', '害羞', '看书', '睡觉', '挥手'];

function stopAnimPreview() {
  if (_animPreviewTimer) {
    clearInterval(_animPreviewTimer);
    _animPreviewTimer = 0;
  }
}

// 关闭模态框时顺手停掉预览循环（包装 closeModal，全局查找保证链式包装生效）
var _animBaseCloseModal = closeModal;
closeModal = function () {
  stopAnimPreview();
  return _animBaseCloseModal.apply(null, arguments);
};

/** 在小 canvas 上循环播放某条已生成的/已保存的动画（仅预览用，走主播放器同款帧定位逻辑） */
function startAnimPreview(canvas, meta, img) {
  stopAnimPreview();
  canvas.width = meta.cellW;
  canvas.height = meta.cellH;
  var ctx = canvas.getContext('2d');
  var t0 = performance.now();
  var draw = function () {
    var fi = Math.floor((performance.now() - t0) / 1000 * meta.fps);
    if (meta.loopMode === 'once' && fi >= meta.frameCount) fi = meta.frameCount - 1;
    else fi = fi % meta.frameCount;
    var col = fi % meta.cols, row = Math.floor(fi / meta.cols);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, col * meta.cellW, row * meta.cellH, meta.cellW, meta.cellH, 0, 0, meta.cellW, meta.cellH);
  };
  draw();
  _animPreviewTimer = setInterval(draw, 1000 / Math.max(1, meta.fps));
}

// ==================== 管理主界面 ====================

function openAnimationManager(charIdx) {
  var char = appData.characters[charIdx];
  if (!char) return;
  _animMgrCtx = { charIdx: charIdx, charId: char.id };
  _animUploadFile = null;
  _animUploadResult = null;
  animMgrRender();
}

function animMgrMetaSummary(meta) {
  if (!meta) return '';
  var parts = [meta.frameCount + ' 帧', meta.fps + ' fps', meta.cellW + '×' + meta.cellH];
  if (meta.chroma && meta.chroma.mode && meta.chroma.mode !== 'off') parts.push('已抠像');
  else parts.push('原背景');
  return parts.join(' · ');
}

function animMgrRender() {
  var ctxInfo = _animMgrCtx;
  var char = appData.characters[ctxInfo.charIdx];
  if (!char) { closeModal(); return; }
  stopAnimPreview();

  var metas = charAnimations(ctxInfo.charId);
  var emotions = Object.keys(metas).sort(function (a, b) {
    if (a === ANIM_IDLE_EMOTION) return -1;
    if (b === ANIM_IDLE_EMOTION) return 1;
    return (metas[a].createdAt || 0) - (metas[b].createdAt || 0);
  });

  var overlay = document.getElementById('modalOverlay');
  var content = document.getElementById('modalContent');
  content.style.maxWidth = '620px';

  // 头部：标题 + 右上角关闭
  var html = '<div class="anim-modal-head">' +
    '<h3>🎬 动画管理 — ' + escHtml(char.name) + '</h3>' +
    '<button class="anim-modal-close" onclick="closeModal()" title="关闭">✕</button>' +
    '</div>';
  html += '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px;line-height:1.6;">' +
    '上传约 2 秒的 AI 生成视频（MP4/WebM），上传时自动抽帧并拼成 sprite sheet。' +
    '<b>待机动画为必填素材</b>（循环播放的呼吸感动画）；情绪动画播完自动回退待机。</div>';

  html += '<div style="max-height:44vh;overflow-y:auto;margin-bottom:12px;">';
  if (emotions.length === 0) {
    html += '<div style="text-align:center;color:var(--text-tertiary);padding:18px 0;font-size:13px;">还没有动画，先上传「待机」</div>';
  }
  emotions.forEach(function (emo) {
    var meta = metas[emo];
    var label = emo === ANIM_IDLE_EMOTION ? '待机（必填）' : escHtml(emo);
    html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border-light);border-radius:10px;margin-bottom:8px;background:var(--bg-secondary);">' +
      '<div class="anim-mgr-thumb" data-emotion="' + escHtml(emo) + '"><span class="anim-mgr-thumb-fallback">🎬</span></div>' +
      '<div style="flex:1;min-width:0;">' +
      '<div style="font-size:13px;font-weight:600;">' + label + '</div>' +
      '<div style="font-size:11px;color:var(--text-secondary);">' + animMgrMetaSummary(meta) + '</div>' +
      '</div>' +
      '<button class="btn-sm btn-ghost" onclick="animMgrPreview(\'' + escHtml(emo) + '\')">▶ 预览</button>' +
      '<button class="btn-sm btn-ghost" onclick="animMgrShowUpload(\'' + escHtml(emo) + '\')">重新上传</button>' +
      '<button class="btn-sm btn-danger" onclick="animMgrDelete(\'' + escHtml(emo) + '\')">删除</button>' +
      '</div>';
  });
  html += '</div>';

  // 新增情绪：不在列表页输入名称，统一进上传窗口填写（那里也有预置选项）
  html += '<div style="display:flex;gap:8px;align-items:center;">' +
    '<button class="btn-sm btn-primary" onclick="animMgrShowUpload(null)">➕ 上传动画</button>' +
    '<span style="flex:1;"></span>' +
    '<button class="btn-sm btn-ghost" onclick="closeModal()">关闭</button>' +
    '</div>';

  content.innerHTML = html;
  overlay.classList.add('show');

  // 缩略图：加载 sheet 后，用 <img> + CSS 裁切显示「内容最多的一帧」。
  // 不走 canvas 绘制（WKWebView 上 canvas 缩略图可能空白），
  // 也不固定用第 0 帧（AI 视频开头常是淡入空白帧，抠像后整帧透明）。
  content.querySelectorAll('.anim-mgr-thumb').forEach(function (box) {
    var emo = box.getAttribute('data-emotion');
    animLoadSheet(ctxInfo.charId, emo).then(function (img) {
      var meta = charAnimEntry(ctxInfo.charId, emo);
      if (!img || !meta || !box.isConnected) return;   // 加载失败保留 🎬 占位
      var fi = animPickThumbFrame(img, meta);
      var col = fi % meta.cols;
      var row = Math.floor(fi / meta.cols);
      // 把整张 sheet 缩放到「单帧恰好适配 56px 圆」，再平移露出目标帧
      var scale = 56 / Math.max(meta.cellW, meta.cellH);
      var w = meta.cellW * scale, h = meta.cellH * scale;
      var offX = Math.round((56 - w) / 2), offY = Math.round((56 - h) / 2);
      box.innerHTML = '<img class="anim-thumb-img" alt="" src="' + img.src + '" style="' +
        'position:absolute;width:' + Math.round(img.naturalWidth * scale) + 'px;' +
        'height:' + Math.round(img.naturalHeight * scale) + 'px;' +
        'left:' + Math.round(offX - col * w) + 'px;' +
        'top:' + Math.round(offY - row * h) + 'px;">';
    });
  });
}

/**
 * 挑一帧「内容最多」的帧作缩略图：在 首 / 中 / 倒数第二 帧里
 * 选不透明像素占比最高的（AI 视频第一帧常是空白淡入帧）。
 */
function animPickThumbFrame(img, meta) {
  var cands = [0, Math.floor(meta.frameCount / 2), Math.max(0, meta.frameCount - 2)];
  var probe = document.createElement('canvas');
  probe.width = 48;
  probe.height = 48;
  var pctx = probe.getContext('2d', { willReadFrequently: true });
  var best = cands[0], bestA = -1;
  for (var i = 0; i < cands.length; i++) {
    var fi = cands[i];
    var col = fi % meta.cols, row = Math.floor(fi / meta.cols);
    pctx.clearRect(0, 0, 48, 48);
    pctx.drawImage(img, col * meta.cellW, row * meta.cellH, meta.cellW, meta.cellH, 0, 0, 48, 48);
    var d = pctx.getImageData(0, 0, 48, 48).data;
    var a = 0;
    for (var k = 3; k < d.length; k += 16) a += d[k];
    if (a > bestA) { bestA = a; best = fi; }
  }
  return best;
}

function animMgrPreview(emotion) {
  var ctxInfo = _animMgrCtx;
  if (!ctxInfo) return;
  var meta = charAnimEntry(ctxInfo.charId, emotion);
  if (!meta) { showToast('动画不存在', 'error'); return; }
  animLoadSheet(ctxInfo.charId, emotion).then(function (img) {
    if (!img) { showToast('动画资产缺失，请重新上传', 'error'); return; }
    var overlay = document.getElementById('modalOverlay');
    var content = document.getElementById('modalContent');
    content.style.maxWidth = '420px';
    var html = '<h3>▶ 预览 — ' + (emotion === ANIM_IDLE_EMOTION ? '待机' : escHtml(emotion)) + '</h3>';
    html += '<div style="display:flex;justify-content:center;margin:10px 0 14px;">' +
      '<canvas id="animPreviewCanvas" style="width:240px;height:240px;border-radius:50%;background:var(--bg-tertiary);"></canvas></div>';
    html += '<div style="text-align:center;font-size:11px;color:var(--text-secondary);margin-bottom:10px;">' +
      escHtml(animMgrMetaSummary(meta)) + (meta.loopMode === 'loop' ? ' · 循环播放' : ' · 播一次后回待机') + '</div>';
    html += '<div class="modal-btns"><button class="btn-sm btn-ghost" onclick="animMgrRender()">返回</button></div>';
    content.innerHTML = html;
    overlay.classList.add('show');
    startAnimPreview(document.getElementById('animPreviewCanvas'), meta, img);
  });
}

async function animMgrDelete(emotion) {
  var ctxInfo = _animMgrCtx;
  if (!ctxInfo) return;
  var tip = emotion === ANIM_IDLE_EMOTION
    ? '确定删除「待机」动画吗？删除后该角色将回退为静态头像。'
    : '确定删除「' + emotion + '」动画吗？';
  if (!(await confirmDialog(tip))) return;
  await deleteCharAnim(ctxInfo.charId, emotion);
  try { AnimPlayer.syncFromDom(); } catch (e) { /* ignore */ }
  try { if (_settingsCharsVisible()) renderSettingsChars(); } catch (e) { /* ignore */ }
  showToast('已删除「' + (emotion === ANIM_IDLE_EMOTION ? '待机' : emotion) + '」动画', 'success');
  animMgrRender();
}

// ==================== 上传 / 处理 ====================

function animMgrShowUpload(emotion) {
  var ctxInfo = _animMgrCtx;
  if (!ctxInfo) return;
  stopAnimPreview();
  _animUploadFile = null;
  _animUploadResult = null;

  var isNew = !emotion;
  var overlay = document.getElementById('modalOverlay');
  var content = document.getElementById('modalContent');
  content.style.maxWidth = '560px';

  // 头部：标题 + 右上角关闭（返回列表用底部「返回」或此处 ✕ 均可）
  var title = isNew ? '➕ 上传动画' : '重新上传 — ' + (emotion === ANIM_IDLE_EMOTION ? '待机' : escHtml(emotion));
  var html = '<div class="anim-modal-head">' +
    '<h3>' + title + '</h3>' +
    '<button class="anim-modal-close" onclick="animMgrRender()" title="返回列表">✕</button>' +
    '</div>';

  // 注意：不要用 .character-form / 裸 input —— legacy.css 会把 input 拉成 width:100%，
  // 单选框撑满后标签文字会被挤成一字一行。统一走 .anim-up-form + .anim-bg-line。
  html += '<div class="anim-up-form">';

  // 情绪名
  if (isNew) {
    html += '<div class="form-group" style="text-align:left;">' +
      '<label>情绪名称<em>待机请直接在管理列表上传，这里填高兴 / 看书等</em></label>' +
      '<input type="text" id="animUpEmotion" list="animEmotionPresets" placeholder="如：高兴">' +
      '<datalist id="animEmotionPresets">' +
      ANIM_EMOTION_PRESETS.map(function (p) { return '<option value="' + escHtml(p) + '">'; }).join('') +
      '</datalist></div>';
  } else {
    html += '<input type="hidden" id="animUpEmotion" value="' + escHtml(emotion) + '">';
  }

  // 视频文件
  html += '<div class="form-group" style="text-align:left;">' +
    '<label>视频文件<em>约 2 秒 · MP4(H.264) / WebM</em></label>' +
    '<div style="display:flex;gap:8px;align-items:center;">' +
    '<button class="btn-sm btn-primary" onclick="document.getElementById(\'animUpFile\').click()">选择视频</button>' +
    '<span id="animUpFileName" style="font-size:12px;color:var(--text-secondary);">未选择</span></div>' +
    '<input type="file" id="animUpFile" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" style="display:none" onchange="animMgrHandleFile(this)">' +
    '</div>';

  // 高级设置开关：默认收起（30fps + 自动抠像），点开才显示帧率与背景处理
  html += '<div class="form-group" style="text-align:left;margin-top:2px;">' +
    '<button type="button" class="anim-adv-toggle" id="animAdvToggle" onclick="animMgrToggleAdv()">▸ 高级设置<em>默认 30fps · 自动抠像，一般不用改</em></button>' +
    '</div>';

  html += '<div id="animAdvConfig" style="display:none;">';

  // 帧率
  html += '<div class="form-group" style="text-align:left;">' +
    '<label>抽帧帧率<em>越高越流畅、sheet 越大</em></label>' +
    '<select id="animUpFps">' +
    [12, 15, 24, 30].map(function (f) { return '<option value="' + f + '"' + (f === 30 ? ' selected' : '') + '>' + f + ' fps</option>'; }).join('') +
    '</select></div>';

  // 背景处理
  html += '<div class="form-group" style="text-align:left;">' +
    '<label>背景处理<em>透明背景 = 色键抠像，上传时逐帧处理，播放零计算</em></label>' +
    '<div style="display:flex;flex-direction:column;gap:8px;">' +
    '<label class="anim-bg-line"><input type="radio" name="animBg" value="auto" checked> 自动抠像（检测背景色）</label>' +
    '<label class="anim-bg-line"><input type="radio" name="animBg" value="custom"> 指定色键颜色 <input type="color" id="animUpKeyColor" value="#00ff00">' +
    '<span class="anim-tip" data-tip="视频背景是纯色（绿幕/蓝幕等）时，用取色器选取与背景一致的颜色，抠像会比自动检测更干净。若背景不是纯色，请改用「保留原始背景」。">?</span></label>' +
    '<label class="anim-bg-line"><input type="radio" name="animBg" value="off"> 保留原始背景（不抠像）</label>' +
    '</div>' +
    '<div id="animTolRow" style="margin-top:8px;">' +
    '<label style="font-size:12px;color:var(--text-secondary);display:flex;align-items:center;gap:4px;">抠像容差：<span id="animTolVal">28</span>/80' +
    '<span class="anim-tip" data-tip="控制多大颜色差异内的像素会被当作背景抹成透明：调大能去除背景残留，但可能误伤角色身上相近的颜色；调小则抠得保守、边缘易留底色。建议 20~40 之间微调。">?</span></label>' +
    '<input type="range" id="animUpTol" min="5" max="80" step="1" value="28" style="width:100%;" oninput="document.getElementById(\'animTolVal\').textContent=this.value;">' +
    '</div></div>';

  html += '</div>';   // /animAdvConfig

  // 进度 / 结果
  html += '<div id="animUpProgress" style="display:none;margin:6px 0;">' +
    '<div style="height:8px;border-radius:4px;background:var(--border-light);overflow:hidden;">' +
    '<div id="animUpProgressBar" style="height:100%;width:0;background:var(--accent);transition:width .15s;"></div></div>' +
    '<div id="animUpProgressText" style="font-size:11px;color:var(--text-secondary);margin-top:4px;">准备中…</div></div>' +
    '<div id="animUpPreviewWrap" style="display:none;text-align:center;margin:8px 0;">' +
    '<canvas id="animUpPreview" style="width:180px;height:180px;border-radius:50%;background:var(--bg-tertiary);"></canvas>' +
    '<div id="animUpResultText" style="font-size:11px;color:var(--text-secondary);margin-top:4px;"></div></div>';

  html += '</div>';

  html += '<div class="modal-btns">' +
    '<button class="btn-sm btn-ghost" onclick="animMgrRender()">返回</button>' +
    '<button class="btn-sm btn-primary" id="animUpProcessBtn" onclick="animMgrStartProcess()">开始处理</button>' +
    '<button class="btn-sm btn-primary" id="animUpSaveBtn" onclick="animMgrSaveProcessed()" style="display:none;">保存到角色</button>' +
    '</div>';

  content.innerHTML = html;
  overlay.classList.add('show');

  // 背景模式切换 → 容差行显隐
  content.querySelectorAll('input[name="animBg"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      document.getElementById('animTolRow').style.display = radio.value === 'off' ? 'none' : '';
    });
  });
}

/** 展开 / 收起高级设置（帧率 + 背景处理），收起时全部走默认值 */
function animMgrToggleAdv() {
  var cfg = document.getElementById('animAdvConfig');
  var btn = document.getElementById('animAdvToggle');
  if (!cfg) return;
  var show = cfg.style.display === 'none';
  cfg.style.display = show ? '' : 'none';
  if (btn) btn.innerHTML = (show ? '▾ 高级设置' : '▸ 高级设置') +
    '<em>默认 30fps · 自动抠像，一般不用改</em>';
}

function animMgrHandleFile(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  _animUploadFile = file;
  var nameEl = document.getElementById('animUpFileName');
  if (nameEl) nameEl.textContent = file.name + '（' + (file.size / 1024 / 1024).toFixed(2) + ' MB）';
  input.value = '';
}

async function animMgrStartProcess() {
  var ctxInfo = _animMgrCtx;
  if (!ctxInfo) return;
  var emotion = document.getElementById('animUpEmotion').value.trim();
  if (!emotion) { showToast('请填写情绪名称', 'error'); return; }
  if (!_animUploadFile) { showToast('请先选择视频文件', 'error'); return; }

  var bgMode = 'auto';
  content_query: {
    var checked = document.querySelector('input[name="animBg"]:checked');
    if (checked) bgMode = checked.value;
  }
  var chromaColor = null;
  if (bgMode === 'custom') {
    var hex = document.getElementById('animUpKeyColor').value || '#00ff00';
    chromaColor = {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16)
    };
  }
  var opts = {
    emotion: emotion,
    fps: parseInt(document.getElementById('animUpFps').value, 10) || 30,
    chroma: bgMode,
    chromaColor: chromaColor,
    tolerance: parseInt(document.getElementById('animUpTol').value, 10) || 28
  };

  var progWrap = document.getElementById('animUpProgress');
  var progBar = document.getElementById('animUpProgressBar');
  var progText = document.getElementById('animUpProgressText');
  var previewWrap = document.getElementById('animUpPreviewWrap');
  var processBtn = document.getElementById('animUpProcessBtn');
  var saveBtn = document.getElementById('animUpSaveBtn');
  progWrap.style.display = '';
  previewWrap.style.display = 'none';
  saveBtn.style.display = 'none';
  processBtn.disabled = true;
  processBtn.textContent = '处理中…';
  stopAnimPreview();

  try {
    var result = await processAnimationUpload(_animUploadFile, opts, function (done, total, phase) {
      var pct = Math.round(done / Math.max(1, total) * 100);
      progBar.style.width = pct + '%';
      progText.textContent = phase === 'extract'
        ? '抽帧 + 抠像：' + done + ' / ' + total + ' 帧'
        : '生成 sprite sheet…';
    });

    _animUploadResult = result;
    progText.textContent = '处理完成 ✓';
    if (!result.meta.chroma || result.meta.chroma.mode === 'off') {
      // 用户选择抠像但背景可能不是纯色时提示
    }
    if (bgMode !== 'off') {
      progText.textContent += '（若残留背景，可调大容差或改用指定颜色重试）';
    }
    previewWrap.style.display = '';
    document.getElementById('animUpResultText').textContent =
      result.meta.frameCount + ' 帧 · ' + result.meta.fps + ' fps · sheet ' + result.meta.cols + '×' + result.meta.rows + ' 格 · 循环点 ' + result.meta.loopStart;
    startAnimPreview(document.getElementById('animUpPreview'), result.meta, await loadImgFromDataUrl(result.sheetDataUrl));
    saveBtn.style.display = '';
  } catch (e) {
    console.error('[Anim] 处理失败', e);
    progText.textContent = '处理失败：' + e.message;
    showToast('处理失败：' + e.message, 'error');
  } finally {
    processBtn.disabled = false;
    processBtn.textContent = '开始处理';
  }
}

function loadImgFromDataUrl(dataUrl) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () { reject(new Error('sheet 解码失败')); };
    img.src = dataUrl;
  });
}

async function animMgrSaveProcessed() {
  var ctxInfo = _animMgrCtx;
  if (!ctxInfo || !_animUploadResult) return;
  var emotion = _animUploadResult.meta.emotion;
  try {
    await animSaveAsset(ctxInfo.charId, emotion, _animUploadResult.sheetDataUrl);
    await saveCharAnimMeta(ctxInfo.charId, emotion, _animUploadResult.meta);
    AnimPlayer.invalidate(ctxInfo.charId, emotion);
    try { AnimPlayer.syncFromDom(); } catch (e) { /* ignore */ }
    try { if (_settingsCharsVisible()) renderSettingsChars(); } catch (e) { /* ignore */ }
    showToast('「' + (emotion === ANIM_IDLE_EMOTION ? '待机' : emotion) + '」动画已保存', 'success');
    animMgrRender();
  } catch (e) {
    console.error('[Anim] 保存失败', e);
    showToast('保存失败：' + e.message, 'error');
  }
}

// ==================== 设置面板 → 角色 Tab ====================

/**
 * 设置面板「角色」Tab 的角色列表。
 * 每行：头像 + 名称（含动画数徽标）+ 描述 + 编辑 / 动画 / 删除。
 */
function renderSettingsChars() {
  var container = document.getElementById('settingsCharList');
  if (!container) return;
  var chars = appData.characters || [];

  if (chars.length === 0) {
    container.innerHTML = '<div class="char-mgr-empty">还没有角色，点击「新建角色」添加</div>';
    return;
  }

  var html = '';
  chars.forEach(function (c, idx) {
    var animCount = Object.keys(charAnimations(c.id)).length;
    var avatar = c.avatar
      ? '<img src="' + escHtml(c.avatar) + '" alt="' + escHtml(c.name) + '">'
      : '<span>' + escHtml((c.name || '?').charAt(0)) + '</span>';
    html += '<div class="char-mgr-card">' +
      '<div class="char-mgr-avatar">' + avatar + '</div>' +
      '<div class="char-mgr-info">' +
      '<div class="char-mgr-name">' + escHtml(c.name) +
      (animCount ? '<span class="char-mgr-anim-badge">🎬 ' + animCount + ' 个动画</span>' : '<span class="char-mgr-anim-badge dim">无动画</span>') +
      '</div>' +
      '<div class="char-mgr-desc">' + escHtml((c.description || '').slice(0, 80) || '暂无描述') + '</div>' +
      '</div>' +
      '<div class="char-mgr-actions">' +
      '<button class="btn-sm btn-ghost" onclick="editCharacter(' + idx + ')">编辑</button>' +
      '<button class="btn-sm btn-ghost" onclick="openAnimationManager(' + idx + ')">动画</button>' +
      '<button class="btn-sm btn-danger" onclick="deleteCharacter(' + idx + ')">删除</button>' +
      '</div></div>';
  });
  container.innerHTML = html;
}

/** 角色 Tab 是否正显示着（决定要不要顺手刷新列表） */
function _settingsCharsVisible() {
  var pane = document.querySelector('.pane[data-pane="chars"]');
  return !!(pane && pane.classList.contains('active') && document.getElementById('settingsCharList'));
}

// ---- 保存/删除角色后刷新列表（包装全局函数，运行时查找保证链式生效） ----

var _animBaseSaveCharacterForm = saveCharacterForm;
saveCharacterForm = function () {
  var r = _animBaseSaveCharacterForm.apply(null, arguments);
  try { if (_settingsCharsVisible()) renderSettingsChars(); } catch (e) { /* ignore */ }
  return r;
};

var _animBaseDeleteCharacter = deleteCharacter;
deleteCharacter = function () {
  return _animBaseDeleteCharacter.apply(null, arguments).then(function (r) {
    try { if (_settingsCharsVisible()) renderSettingsChars(); } catch (e) { /* ignore */ }
    return r;
  });
};
