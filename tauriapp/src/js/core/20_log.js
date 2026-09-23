/**
 * 程序日志抽屉
 * 自动拆分模块
 * 保持全局兼容模式
 */

// ==================== 日志类型常量 ====================
var LOG_TYPE_REQUEST = 'request';       // 普通 AI 请求
var LOG_TYPE_MEMORY = 'memory';         // 记忆压缩
var LOG_TYPE_AUTO_TOPIC = 'auto_topic'; // 自动话题
var LOG_TYPE_PHOTO = 'photo';           // 拍照
var LOG_TYPE_PHOTO_DONE = 'photo_done'; // 拍照完成（触发新对话）
var LOG_TYPE_INFO = 'info';             // 信息类操作
var LOG_TYPE_ERROR = 'error';           // 错误
var LOG_TYPE_SYSTEM = 'system';         // 系统操作（保存/导入/导出等）

var LOG_TYPE_ICON = {};
LOG_TYPE_ICON[LOG_TYPE_REQUEST] = '💬';
LOG_TYPE_ICON[LOG_TYPE_MEMORY] = '🧠';
LOG_TYPE_ICON[LOG_TYPE_AUTO_TOPIC] = '🤖';
LOG_TYPE_ICON[LOG_TYPE_PHOTO] = '📷';
LOG_TYPE_ICON[LOG_TYPE_PHOTO_DONE] = '📸';
LOG_TYPE_ICON[LOG_TYPE_INFO] = 'ℹ️';
LOG_TYPE_ICON[LOG_TYPE_ERROR] = '❌';
LOG_TYPE_ICON[LOG_TYPE_SYSTEM] = '⚙️';

var LOG_COUNT_MAX = 200; // 日志最大存储条数

// ==================== 添加日志 ====================
/**
 * 添加一条程序日志
 * @param {string} type - 日志类型（LOG_TYPE_* 常量）
 * @param {object} data - 日志数据，包含相关信息
 * @param {string} [data.summary] - 简要描述
 * @param {string} [data.chatName] - 聊天名称
 * @param {*} [data.detail] - 详细数据（如 messages 数组）
 */
function addProgramLog(type, data) {
  data = data || {};
  programLog.push({
    time: new Date().toLocaleString(),
    timestamp: Date.now(),
    type: type,
    summary: data.summary || '',
    chatName: data.chatName || '',
    detail: data.detail !== undefined ? JSON.parse(JSON.stringify(data.detail)) : null
  });
  // 超出上限时移除最旧的
  if (programLog.length > LOG_COUNT_MAX) {
    programLog = programLog.slice(-LOG_COUNT_MAX);
  }
}

// ==================== 打开/关闭日志抽屉 ====================
function openLogDrawer() {
  document.getElementById('logDrawer').classList.add('open');
  document.getElementById('logBackdrop').classList.add('show');
  renderLogContent();
}

function closeLogDrawer() {
  document.getElementById('logDrawer').classList.remove('open');
  document.getElementById('logBackdrop').classList.remove('show');
}

// 包装调用：点击时再查全局（桌面壳会给 closeLogDrawer 包「退出面板模式」逻辑）
document.getElementById('logBackdrop').addEventListener('click', function () {
  closeLogDrawer();
});

// ==================== 渲染日志内容 ====================
function renderLogContent() {
  var body = document.getElementById('logDrawerBody');

  if (programLog.length === 0) {
    body.innerHTML = '<div class="log-empty">暂无程序日志<br><span style="font-size:12px;">操作后会自动记录</span></div>';
    return;
  }

  var html = '';
  // 倒序展示（最新的在上面）
  for (var i = programLog.length - 1; i >= 0; i--) {
    var entry = programLog[i];
    var icon = LOG_TYPE_ICON[entry.type] || '📝';
    var typeLabel = getTypeLabel(entry.type);
    html += '<div class="log-entry">';
    html += '<div class="log-entry-header" onclick="toggleLogEntry(this)">';
    html += '<span>' + icon + ' <strong>' + escHtml(typeLabel) + '</strong>';
    if (entry.summary) {
      html += ' <span style="font-weight:normal;font-size:13px;color:var(--text-secondary);">' + escHtml(entry.summary) + '</span>';
    }
    if (entry.chatName) {
      html += ' <span class="log-chat-name">' + escHtml(entry.chatName) + '</span>';
    }
    html += '</span>';
    html += '<span><span class="log-time">' + entry.time + '</span> <span class="log-arrow">▶</span></span>';
    html += '</div>';
    html += '<div class="log-entry-body"><div style="padding:12px 14px;">';
    // 如果有 detail，渲染 detail 内容
    if (entry.detail !== null) {
      html += renderLogDetail(entry);
    }
    html += '</div></div>';
    html += '</div>';
  }

  body.innerHTML = html;
}

/**
 * 获取日志类型的友好名称
 */
function getTypeLabel(type) {
  var labels = {};
  labels[LOG_TYPE_REQUEST] = 'AI请求';
  labels[LOG_TYPE_MEMORY] = '记忆压缩';
  labels[LOG_TYPE_AUTO_TOPIC] = '自动话题';
  labels[LOG_TYPE_PHOTO] = '拍照';
  labels[LOG_TYPE_PHOTO_DONE] = '拍照完成';
  labels[LOG_TYPE_INFO] = '信息';
  labels[LOG_TYPE_ERROR] = '错误';
  labels[LOG_TYPE_SYSTEM] = '系统';
  return labels[type] || type;
}

/**
 * 根据日志类型渲染详情
 */
function renderLogDetail(entry) {
  var detail = entry.detail;
  if (!detail) return '';

  // 如果是 messages 数组（AI 请求的日志），用 JSON 树渲染
  if (Array.isArray(detail)) {
    var msgCount = detail.length;
    var html = '<div style="margin-bottom:8px;font-size:12px;color:var(--text-secondary);">共 ' + msgCount + ' 条 messages</div>';
    html += renderJsonTree({ key: 'messages', value: detail, isArray: true });
    return html;
  }

  // 如果是普通对象，渲染为 JSON
  if (typeof detail === 'object') {
    return renderJsonTree({ key: 'data', value: detail, isArray: false });
  }

  // 字符串直接显示
  return '<div style="font-size:13px;white-space:pre-wrap;">' + escHtml(String(detail)) + '</div>';
}

// ==================== 展开/折叠 ====================
function toggleLogEntry(headerEl) {
  headerEl.classList.toggle('expanded');
  var body = headerEl.nextElementSibling;
  if (body) body.classList.toggle('show');
}

// ==================== JSON 树形渲染 ====================
function renderJsonTree({ key, value, isArray, isLast, depth }) {
  depth = depth || 0;
  var html = '';
  var indent = 'padding-left:' + (depth * 20) + 'px;';

  if (value === null) {
    html += '<div style="' + indent + '"><span class="json-key">' + escHtml(key) + '</span>: <span class="json-null">null</span>' + (isLast ? '' : ',') + '</div>';
    return html;
  }

  if (typeof value !== 'object') {
    var valClass = 'json-string';
    var valDisplay = escHtml(JSON.stringify(value));
    if (typeof value === 'number') { valClass = 'json-number'; }
    else if (typeof value === 'boolean') { valClass = 'json-bool'; }
    html += '<div style="' + indent + '"><span class="json-key">' + escHtml(key) + '</span>: <span class="' + valClass + '">' + valDisplay + '</span>' + (isLast ? '' : ',') + '</div>';
    return html;
  }

  // 数组或对象
  var entries = isArray
    ? value.map(function(v, i) { return { k: String(i), v: v, isObj: typeof v === 'object' && v !== null }; })
    : Object.entries(value).map(function(e) { return { k: e[0], v: e[1], isObj: typeof e[1] === 'object' && e[1] !== null }; });

  var count = entries.length;
  var openBracket = isArray ? '[' : '{';
  var closeBracket = isArray ? ']' : '}';
  var nodeId = 'jtn_' + Math.random().toString(36).slice(2, 10);

  // 特殊处理：messages 数组的每个元素展示为带 role 标签的卡片
  // 要求：倒序展示（后发的在前），每个日志最多渲染3条，其余点击"更多"展开
  if (key === 'messages' && isArray) {
    var INITIAL_SHOW = 3;
    html += '<div style="' + indent + '"><span class="json-key">messages</span> <span class="json-bracket">[</span> <span class="json-count">' + count + ' items</span></div>';
    var nodeId = 'jtn_' + Math.random().toString(36).slice(2, 10);
    html += '<div class="json-children show" style="padding-left:12px;">';
    // 反转 entries（最新的在前面）
    var reversed = entries.slice().reverse();
    reversed.forEach(function(entry, idx) {
      var msg = entry.v;
      var role = msg.role || 'unknown';
      var roleClass = 'role-' + role;
      var content = msg.content || '';
      var preview = content.length > 500 ? content.slice(0, 500) + '\n... (truncated)' : content;
      // 前3条正常显示，其余默认隐藏，但都先渲染在容器内
      var hiddenStyle = (idx >= INITIAL_SHOW) ? ' style="display:none;"' : '';
      html += '<div class="msg-log-item" data-msg-idx="' + idx + '"' + hiddenStyle + '>';
      html += '<div style="margin-bottom:10px;border:1px solid var(--border-color);border-radius:8px;overflow:hidden;">';
      html += '<div style="display:flex;align-items:center;gap:6px;padding:8px 12px;background:var(--bg-secondary);">';
      html += '<span class="msg-role-tag ' + roleClass + '">' + escHtml(role) + '</span>';
      // 显示倒序后的索引（从最新开始计数）
      html += '<span style="font-size:12px;color:var(--text-tertiary);">[' + (count - 1 - idx) + ']</span>';
      html += '</div>';
      html += '<div class="msg-content-preview">' + escHtml(preview) + '</div>';
      html += '</div>';
      html += '</div>';
    });
    // 如果超过3条，添加"更多"按钮
    if (count > INITIAL_SHOW) {
      var hiddenCount = count - INITIAL_SHOW;
      html += '<div id="' + nodeId + '_more" style="text-align:center;padding:4px 0;">';
      html += '<button class="log-more-btn" onclick="expandLogMessages(\'' + nodeId + '\')">更多 ' + hiddenCount + ' 条 ▼</button>';
      html += '</div>';
    }
    html += '</div>';
    html += '<div style="' + indent + '"><span class="json-bracket">]</span></div>';
    return html;
  }

  // 通用对象/数组：可展开折叠
  html += '<div style="' + indent + '">';
  html += '<span class="json-toggle" onclick="toggleJsonNode(\'' + nodeId + '\', this)">';
  html += '<span class="json-arrow">▶</span>';
  if (!isArray) html += '<span class="json-key">' + escHtml(key) + '</span>: ';
  else if (key) html += '<span class="json-key">' + escHtml(key) + '</span> ';
  html += '<span class="json-bracket">' + openBracket + '</span>';
  html += '<span class="json-count">' + count + '</span>';
  html += '</span>';
  html += '</div>';

  html += '<div class="json-children" id="' + nodeId + '" style="padding-left:20px;">';
  entries.forEach(function(entry, idx) {
    var childIsArray = Array.isArray(entry.v);
    html += renderJsonTree({
      key: entry.k,
      value: entry.v,
      isArray: childIsArray,
      isLast: idx === count - 1,
      depth: depth + 1
    });
  });
  html += '</div>';

  html += '<div style="' + indent + '"><span class="json-bracket">' + closeBracket + '</span>' + (isLast ? '' : ',') + '</div>';
  return html;
}

function toggleJsonNode(nodeId, toggleEl) {
  var children = document.getElementById(nodeId);
  if (!children) return;
  children.classList.toggle('show');
  toggleEl.classList.toggle('open');
}

/**
 * 展开日志中隐藏的 messages（超出3条的部分）
 */
function expandLogMessages(nodeId) {
  var container = document.getElementById(nodeId + '_more');
  if (!container) return;
  // 查找该容器前面的所有 msg-log-item
  var parent = container.parentNode;
  var items = parent.querySelectorAll('.msg-log-item[style*="display:none"]');
  items.forEach(function(item) {
    item.style.display = '';
  });
  container.innerHTML = '<span style="font-size:12px;color:var(--text-tertiary);">已全部展开</span>';
}
