// 模块: 主题

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



    window.toggleTheme = toggleTheme;
window.applyTheme = applyTheme;