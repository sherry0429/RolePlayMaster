
/**
 * 主题
 * 自动拆分模块
 * 保持全局兼容模式
 */

function toggleTheme() {
  appData.theme = appData.theme === 'dark' ? 'light' : 'dark';
  applyTheme(appData.theme);
  saveData();
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('themeBtn').textContent = theme === 'dark' ? '☀️' : '🌙';
  // 无背景图时更新背景层
  applyBgImage(appData.settings.bgImage);
}

