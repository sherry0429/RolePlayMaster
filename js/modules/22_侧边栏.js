/**
     * 模块: 侧边栏
     * 该文件由自动拆分工具生成
     * 后续建议继续手动细化
     */

    import { state } from '../core/state.js';
    import * as CONSTANTS from '../core/constants.js';

    function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');

  if (window.innerWidth <= 768) {
    // 移动端：切换 open 类
    sidebar.classList.toggle('open');
    backdrop.classList.toggle('show');
  } else {
    // 桌面端：切换 collapsed 类，并保存状态
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
  }
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');

  if (window.innerWidth <= 768) {
    sidebar.classList.remove('open');
    backdrop.classList.remove('show');
  } else {
    sidebar.classList.add('collapsed');
    localStorage.setItem('sidebarCollapsed', 'true');
  }
}

document.getElementById('sidebarBackdrop').addEventListener('click', closeSidebar);