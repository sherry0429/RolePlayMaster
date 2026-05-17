/**
     * 模块: 角色图库
     * 该文件由自动拆分工具生成
     * 后续建议继续手动细化
     */

    import { state } from '../core/state.js';
    import * as CONSTANTS from '../core/constants.js';

    const GALLERY_PAGE_SIZE = 20;
let galleryCurrentPage = 0;
let galleryHasMore = true;

function openGalleryDrawer() {
  document.getElementById('galleryDrawer').classList.add('open');
  document.getElementById('galleryBackdrop').classList.add('show');
  galleryCurrentPage = 0;
  galleryHasMore = true;
  renderGalleryContent();
}

function closeGalleryDrawer() {
  document.getElementById('galleryDrawer').classList.remove('open');
  document.getElementById('galleryBackdrop').classList.remove('show');
  // 关闭时退出选择模式
  if (charSelectMode) {
    charSelectMode = false;
    charSelectedIndices.clear();
    const btn = document.getElementById('charSelectModeBtn');
    const bar = document.getElementById('charSelectBar');
    btn.classList.remove('active');
    btn.textContent = '👥 群聊';
    bar.classList.remove('show');
  }
}

document.getElementById('galleryBackdrop').addEventListener('click', closeGalleryDrawer);

function renderGalleryContent(append) {
  const body = document.getElementById('galleryDrawerBody');
  const chars = appData.characters || [];
  const start = append ? galleryCurrentPage * GALLERY_PAGE_SIZE : 0;
  const end = (galleryCurrentPage + 1) * GALLERY_PAGE_SIZE;
  const pageChars = chars.slice(start, end);
  galleryHasMore = end < chars.length;

  if (!append) {
    if (chars.length === 0) {
      body.innerHTML = '<div class="gallery-empty">暂无角色，点击「新增」添加</div>';
      return;
    }
    body.innerHTML = '<div class="gallery-waterfall" id="galleryWaterfall"></div>';
  }

  // 移除旧的 loading
  const oldLoading = document.getElementById('galleryLoading');
  if (oldLoading) oldLoading.remove();

  const waterfall = document.getElementById('galleryWaterfall');
  if (!waterfall) return;

  const isSelectMode = charSelectMode;

  pageChars.forEach((char, idx) => {
    const globalIdx = start + idx;
    const avatarHtml = char.avatar
      ? `<img src="${escHtml(char.avatar)}" alt="${escHtml(char.name)}">`
      : `<span class="avatar-placeholder">${escHtml(char.name.charAt(0) || '?')}</span>`;
    const isSelected = charSelectedIndices.has(globalIdx);
    const selectClass = isSelectMode ? ` selectable${isSelected ? ' selected' : ''}` : '';
    const clickAction = isSelectMode ? `toggleCharSelect(${globalIdx})` : `editCharacter(${globalIdx})`;
    const deleteBtn = isSelectMode ? '' : `<button class="gallery-card-delete" onclick="event.stopPropagation();deleteCharacter(${globalIdx})" title="删除">✕</button>`;
    waterfall.insertAdjacentHTML('beforeend', `
      <div class="gallery-card${selectClass}" onclick="${clickAction}">
        <div class="gallery-card-avatar-wrap">
          ${avatarHtml}
          ${deleteBtn}
        </div>
        <div class="gallery-card-info">
          <div class="gallery-card-name">${escHtml(char.name)}</div>
          <div class="gallery-card-desc">${escHtml(char.description || '')}</div>
        </div>
      </div>`);
  });

  if (galleryHasMore) {
    waterfall.insertAdjacentHTML('afterend', '<div class="gallery-loading" id="galleryLoading">↓ 下拉加载更多</div>');
  }

  // 监听滚动加载更多
  setupGalleryScroll();
}

function setupGalleryScroll() {
  const body = document.getElementById('galleryDrawerBody');
  body.onscroll = () => {
    if (!galleryHasMore) return;
    const loading = document.getElementById('galleryLoading');
    if (!loading) return;
    const rect = loading.getBoundingClientRect();
    if (rect.top < body.getBoundingClientRect().bottom + 100) {
      galleryCurrentPage++;
      renderGalleryContent(true);
    }
  };
}

function addCharacter() {
  showCharacterForm(-1, null);
}

function editCharacter(idx) {
  const char = appData.characters[idx];
  if (!char) return;
  showCharacterForm(idx, char);
}

function deleteCharacter(idx) {
  const char = appData.characters[idx];
  if (!char) return;
  if (!confirm(`确定删除角色「${char.name}」吗？`)) return;
  appData.characters.splice(idx, 1);
  saveData();
  galleryCurrentPage = 0;
  renderGalleryContent();
  // 重新渲染聊天消息以更新头像
  if (currentChatId) renderMessages();
  showToast('角色已删除');
}