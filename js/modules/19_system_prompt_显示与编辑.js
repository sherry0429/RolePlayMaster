/**
     * 模块: System Prompt 显示与编辑
     * 该文件由自动拆分工具生成
     * 后续建议继续手动细化
     */

    import { state } from '../core/state.js';
    import * as CONSTANTS from '../core/constants.js';

    function updateSpDisplay() {
  const sp = getCurrentSpVersion();
  const display = document.getElementById('spDisplay');
  const badge = document.getElementById('spVersionBadge');
  const versionText = document.getElementById('spVersionText');
  const prevBtn = document.getElementById('spPrevBtn');
  const nextBtn = document.getElementById('spNextBtn');

  if (!currentChatId || !appData.chats[currentChatId]) {
    badge.textContent = 'v0';
    versionText.textContent = '无版本';
    display.textContent = '暂无 System Prompt';
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  const chat = appData.chats[currentChatId];
  badge.textContent = 'v' + sp.version;
  versionText.textContent = `${chat.spViewIndex + 1} / ${chat.spVersions.length}`;
  prevBtn.disabled = chat.spViewIndex <= 0;
  nextBtn.disabled = chat.spViewIndex >= chat.spVersions.length - 1;

  // 淡入淡出动画
  display.classList.add('fading');
  setTimeout(() => {
    display.textContent = sp.content || '（空）';
    display.classList.remove('fading');
  }, 200);
}

function spNavPrev() {
  if (!currentChatId) return;
  const chat = appData.chats[currentChatId];
  if (chat.spViewIndex > 0) {
    chat.spViewIndex--;
    saveData();
    updateSpDisplay();
  }
}

function spNavNext() {
  if (!currentChatId) return;
  const chat = appData.chats[currentChatId];
  if (chat.spViewIndex < chat.spVersions.length - 1) {
    chat.spViewIndex++;
    saveData();
    updateSpDisplay();
  }
}

/* System Prompt 编辑 - 使用弹框 */
function spStartEdit() {
  if (!currentChatId) return;
  const sp = getCurrentSpVersion();
  showTextareaModal('编辑 System Prompt (v' + sp.version + ')', sp.content || '', (val) => {
    if (!currentChatId) return;
    const chat = appData.chats[currentChatId];
    const newContent = val.trim();

    // 直接修改当前版本的 content，不创建新版本
    chat.spVersions[chat.spViewIndex].content = newContent;
    saveData();
    updateSpDisplay();
    showToast('System Prompt 已更新', 'success');
  });
}