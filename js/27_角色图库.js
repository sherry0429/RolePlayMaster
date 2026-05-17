
/**
 * 角色图库
 * 自动拆分模块
 * 保持全局兼容模式
 */

var GALLERY_PAGE_SIZE = 20;
var galleryCurrentPage = 0;
var galleryHasMore = true;

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
    var btn = document.getElementById('charSelectModeBtn');
    var bar = document.getElementById('charSelectBar');
    btn.classList.remove('active');
    btn.textContent = '👥 群聊';
    bar.classList.remove('show');
  }
}

document.getElementById('galleryBackdrop').addEventListener('click', closeGalleryDrawer);

function renderGalleryContent(append) {
  var body = document.getElementById('galleryDrawerBody');
  var chars = appData.characters || [];
  var start = append ? galleryCurrentPage * GALLERY_PAGE_SIZE : 0;
  var end = (galleryCurrentPage + 1) * GALLERY_PAGE_SIZE;
  var pageChars = chars.slice(start, end);
  galleryHasMore = end < chars.length;

  if (!append) {
    if (chars.length === 0) {
      body.innerHTML = '<div class="gallery-empty">暂无角色，点击「新增」添加</div>';
      return;
    }
    body.innerHTML = '<div class="gallery-waterfall" id="galleryWaterfall"></div>';
  }

  // 移除旧的 loading
  var oldLoading = document.getElementById('galleryLoading');
  if (oldLoading) oldLoading.remove();

  var waterfall = document.getElementById('galleryWaterfall');
  if (!waterfall) return;

  var isSelectMode = charSelectMode;

  pageChars.forEach((char, idx) => {
    var globalIdx = start + idx;
    var avatarHtml = char.avatar
      ? `<img src="${escHtml(char.avatar)}" alt="${escHtml(char.name)}">`
      : `<span class="avatar-placeholder">${escHtml(char.name.charAt(0) || '?')}</span>`;
    var isSelected = charSelectedIndices.has(globalIdx);
    var selectClass = isSelectMode ? ` selectable${isSelected ? ' selected' : ''}` : '';
    var clickAction = isSelectMode ? `toggleCharSelect(${globalIdx})` : `editCharacter(${globalIdx})`;
    var deleteBtn = isSelectMode ? '' : `<button class="gallery-card-delete" onclick="event.stopPropagation();deleteCharacter(${globalIdx})" title="删除">✕</button>`;
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
  var body = document.getElementById('galleryDrawerBody');
  body.onscroll = () => {
    if (!galleryHasMore) return;
    var loading = document.getElementById('galleryLoading');
    if (!loading) return;
    var rect = loading.getBoundingClientRect();
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
  var char = appData.characters[idx];
  if (!char) return;
  showCharacterForm(idx, char);
}

function deleteCharacter(idx) {
  var char = appData.characters[idx];
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

