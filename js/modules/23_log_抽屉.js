/**
     * 模块: Log 抽屉
     * 该文件由自动拆分工具生成
     * 后续建议继续手动细化
     */

    import { state } from '../core/state.js';
    import * as CONSTANTS from '../core/constants.js';

    function openLogDrawer() {
  document.getElementById('logDrawer').classList.add('open');
  document.getElementById('logBackdrop').classList.add('show');
  renderLogContent();
}

function closeLogDrawer() {
  document.getElementById('logDrawer').classList.remove('open');
  document.getElementById('logBackdrop').classList.remove('show');
}

document.getElementById('logBackdrop').addEventListener('click', closeLogDrawer);

/* 渲染日志内容：最近 3 条请求的 messages 以树形展示 */
function renderLogContent() {
  const body = document.getElementById('logDrawerBody');

  if (requestLog.length === 0) {
    body.innerHTML = '<div class="log-empty">暂无请求日志<br><span style="font-size:12px;">发送消息后会自动记录</span></div>';
    return;
  }

  let html = '';
  // 倒序展示（最新的在上面）
  for (let i = requestLog.length - 1; i >= 0; i--) {
    const entry = requestLog[i];
    const msgCount = entry.messages.length;
    html += `<div class="log-entry">`;
    html += `<div class="log-entry-header" onclick="toggleLogEntry(this)">
      <span>📩 ${escHtml(entry.chatName)}</span>
      <span><span class="log-time">${entry.time}</span> <span class="log-arrow">▶</span></span>
    </div>`;
    html += `<div class="log-entry-body"><div style="padding:12px 14px;">`;
    html += `<div style="margin-bottom:8px;font-size:12px;color:var(--text-secondary);">共 ${msgCount} 条 messages</div>`;
    // 渲染 messages 数组
    html += renderJsonTree({ key: 'messages', value: entry.messages, isArray: true });
    html += `</div></div>`;
    html += `</div>`;
  }

  body.innerHTML = html;
}

function toggleLogEntry(headerEl) {
  headerEl.classList.toggle('expanded');
  const body = headerEl.nextElementSibling;
  body.classList.toggle('show');
}

/* JSON 树形渲染，用于展示 messages 数组 */
function renderJsonTree({ key, value, isArray, isLast, depth }) {
  depth = depth || 0;
  let html = '';
  const indent = 'padding-left:' + (depth * 20) + 'px;';

  if (value === null) {
    html += `<div style="${indent}"><span class="json-key">${escHtml(key)}</span>: <span class="json-null">null</span>${isLast ? '' : ','}</div>`;
    return html;
  }

  if (typeof value !== 'object') {
    // 基本类型
    let valClass = 'json-string';
    let valDisplay = escHtml(JSON.stringify(value));
    if (typeof value === 'number') { valClass = 'json-number'; }
    else if (typeof value === 'boolean') { valClass = 'json-bool'; }
    html += `<div style="${indent}"><span class="json-key">${escHtml(key)}</span>: <span class="${valClass}">${valDisplay}</span>${isLast ? '' : ','}</div>`;
    return html;
  }

  // 数组或对象
  const entries = isArray
    ? value.map((v, i) => ({ k: String(i), v: v, isObj: typeof v === 'object' && v !== null }))
    : Object.entries(value).map(([k, v]) => ({ k: k, v: v, isObj: typeof v === 'object' && v !== null }));

  const count = entries.length;
  const openBracket = isArray ? '[' : '{';
  const closeBracket = isArray ? ']' : '}';
  const nodeId = 'jtn_' + Math.random().toString(36).slice(2, 10);

  // 特殊处理：messages 数组的每个元素展示为带 role 标签的卡片
  if (key === 'messages' && isArray) {
    html += `<div style="${indent}"><span class="json-key">messages</span> <span class="json-bracket">[</span> <span class="json-count">${count} items</span></div>`;
    html += `<div class="json-children show" style="padding-left:12px;">`;
    entries.forEach((entry, idx) => {
      const msg = entry.v;
      const role = msg.role || 'unknown';
      const roleClass = 'role-' + role;
      const content = msg.content || '';
      const preview = content.length > 500 ? content.slice(0, 500) + '\n... (truncated)' : content;
      html += `<div style="margin-bottom:10px;border:1px solid var(--border-color);border-radius:8px;overflow:hidden;">`;
      html += `<div style="display:flex;align-items:center;gap:6px;padding:8px 12px;background:var(--bg-secondary);">`;
      html += `<span class="msg-role-tag ${roleClass}">${escHtml(role)}</span>`;
      html += `<span style="font-size:12px;color:var(--text-tertiary);">[${idx}]</span>`;
      html += `</div>`;
      html += `<div class="msg-content-preview">${escHtml(preview)}</div>`;
      html += `</div>`;
    });
    html += `</div>`;
    html += `<div style="${indent}"><span class="json-bracket">]</span></div>`;
    return html;
  }

  // 通用对象/数组：可展开折叠
  html += `<div style="${indent}">`;
  html += `<span class="json-toggle" onclick="toggleJsonNode('${nodeId}', this)">`;
  html += `<span class="json-arrow">▶</span>`;
  if (!isArray) html += `<span class="json-key">${escHtml(key)}</span>: `;
  else if (key) html += `<span class="json-key">${escHtml(key)}</span> `;
  html += `<span class="json-bracket">${openBracket}</span>`;
  html += `<span class="json-count">${count}</span>`;
  html += `</span>`;
  html += `</div>`;

  html += `<div class="json-children" id="${nodeId}" style="padding-left:20px;">`;
  entries.forEach((entry, idx) => {
    const childIsArray = Array.isArray(entry.v);
    html += renderJsonTree({
      key: entry.k,
      value: entry.v,
      isArray: childIsArray,
      isLast: idx === count - 1,
      depth: depth + 1
    });
  });
  html += `</div>`;

  html += `<div style="${indent}"><span class="json-bracket">${closeBracket}</span>${isLast ? '' : ','}</div>`;
  return html;
}

function toggleJsonNode(nodeId, toggleEl) {
  const children = document.getElementById(nodeId);
  if (!children) return;
  children.classList.toggle('show');
  toggleEl.classList.toggle('open');
}