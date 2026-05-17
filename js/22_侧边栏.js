
/**
 * 侧边栏
 * 自动拆分模块
 * 保持全局兼容模式
 */

function toggleSidebar() {
  var sidebar = document.getElementById('sidebar');
  var backdrop = document.getElementById('sidebarBackdrop');

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
  var sidebar = document.getElementById('sidebar');
  var backdrop = document.getElementById('sidebarBackdrop');

  if (window.innerWidth <= 768) {
    sidebar.classList.remove('open');
    backdrop.classList.remove('show');
  } else {
    sidebar.classList.add('collapsed');
    localStorage.setItem('sidebarCollapsed', 'true');
  }
}

document.getElementById('sidebarBackdrop').addEventListener('click', closeSidebar);

