
/**
 * 工具函数
 * 自动拆分模块
 * 保持全局兼容模式
 */

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/**
 * 行级 LCS Diff
 * 返回 [{type:'same'|'add'|'del', text, oldNo, newNo}]，oldNo/newNo 为 1 起始行号（缺省表示该行不存在于对应版本）
 */
function diffLines(oldText, newText) {
  var a = String(oldText || '').split('\n');
  var b = String(newText || '').split('\n');
  var n = a.length, m = b.length;
  var dp = [];
  for (var r = 0; r <= n; r++) dp.push(new Uint16Array(m + 1));
  for (var i = n - 1; i >= 0; i--) {
    for (var j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  var result = [];
  var x = 0, y = 0;
  while (x < n && y < m) {
    if (a[x] === b[y]) {
      result.push({ type: 'same', text: a[x], oldNo: x + 1, newNo: y + 1 });
      x++; y++;
    } else if (dp[x + 1][y] >= dp[x][y + 1]) {
      result.push({ type: 'del', text: a[x], oldNo: x + 1 });
      x++;
    } else {
      result.push({ type: 'add', text: b[y], newNo: y + 1 });
      y++;
    }
  }
  while (x < n) { result.push({ type: 'del', text: a[x], oldNo: x + 1 }); x++; }
  while (y < m) { result.push({ type: 'add', text: b[y], newNo: y + 1 }); y++; }
  return result;
}

/**
 * 粗略估算 token 数：CJK 字符按 1 字 ≈ 0.75 token，其余按 4 字符 ≈ 1 token
 */
function estimateTokens(text) {
  if (!text) return 0;
  var cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  var other = text.length - cjk;
  return Math.round(cjk * 0.75 + other / 4);
}

/**
 * 简易 Markdown 渲染
 * 支持：代码块、行内代码、粗体、斜体、列表
 */
function renderMarkdown(text) {
  if (!text) return '';
  var html = escHtml(text);

  // 代码块 ```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 粗体
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // 斜体
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // 换行
  html = html.replace(/\n/g, '<br>');

  return html;
}

