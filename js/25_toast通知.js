
/**
 * Toast 通知
 * 自动拆分模块
 * 保持全局兼容模式
 */

function showToast(msg, type) {
  var container = document.getElementById('toastContainer');
  var toast = document.createElement('div');
  toast.className = 'toast' + (type ? ' ' + type : '');
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

