// 模块: 侧边栏

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



    window.toggleSidebar = toggleSidebar;
window.closeSidebar = closeSidebar;