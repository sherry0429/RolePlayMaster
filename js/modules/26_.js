// 模块: 工具函数

    function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/**
 * 简易 Markdown 渲染
 * 支持：代码块、行内代码、粗体、斜体、列表
 */
function renderMarkdown(text) {
  if (!text) return '';
  let html = escHtml(text);

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



    window.escHtml = escHtml;
window.renderMarkdown = renderMarkdown;