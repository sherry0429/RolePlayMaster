// 模块: PWA

    function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then(reg => {
        console.log('[SW] 注册成功', reg.scope);
        // 有新版本时提示用户刷新
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showToast('发现新版本，刷新页面即可更新 🔄', 'success');
            }
          });
        });
      }).catch(err => {
        console.warn('[SW] 注册失败', err);
      });
    });
  }
}

// PWA 安装提示
let _deferredPrompt = null;

function initPwaInstall() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    _deferredPrompt = e;
    // 显示安装横幅
    showPwaBanner();
  });

  window.addEventListener('appinstalled', () => {
    _deferredPrompt = null;
    hidePwaBanner();
    showToast('已成功添加到桌面 🎉', 'success');
  });

  // 快捷方式：action=new
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('action') === 'new') {
    setTimeout(() => newChat(), 300);
  }
}

function showPwaBanner() {
  // 如果已经是 standalone 模式（已安装），不显示
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) return;
  // 桌面端浏览器（Windows/Mac/Linux）不需要安装 PWA，浏览器本身已够好用
  const ua = navigator.userAgent || navigator.vendor || '';
  const isDesktop = /Windows|Macintosh|Linux/.test(ua) && !/Android|iPhone|iPad|iPod/.test(ua);
  if (isDesktop) return;
  let banner = document.getElementById('pwaBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'pwaBanner';
    banner.innerHTML = `
      <span>📱 添加到桌面，获得更好体验</span>
      <div style="display:flex;gap:8px">
        <button onclick="installPwa()" style="padding:4px 12px;backgrou
        nd:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px">安装</button>
        <button onclick="hidePwaBanner()" style="padding:4px 10px;background:transparent;color:var(--text-secondary);border:1px solid var(--border-color);border-radius:6px;cursor:pointer;font-size:13px">稍后</button>
      </div>
    `;
    document.body.appendChild(banner);
  }
  banner.style.display = 'flex';
}

function hidePwaBanner() {
  const banner = document.getElementById('pwaBanner');
  if (banner) banner.style.display = 'none';
}

async function installPwa() {
  if (!_deferredPrompt) return;
  _deferredPrompt.prompt();
  const { outcome } = await _deferredPrompt.userChoice;
  _deferredPrompt = null;
  hidePwaBanner();
  if (outcome === 'accepted') {
    showToast('正在安装，请稍候…', 'success');
  }
}



    window.registerServiceWorker = registerServiceWorker;
window.initPwaInstall = initPwaInstall;
window.showPwaBanner = showPwaBanner;
window.hidePwaBanner = hidePwaBanner;
window.installPwa = installPwa;