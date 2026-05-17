/**
     * 模块: 主题
     * 该文件由自动拆分工具生成
     * 后续建议继续手动细化
     */

    import { state } from '../core/state.js';
    import * as CONSTANTS from '../core/constants.js';

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