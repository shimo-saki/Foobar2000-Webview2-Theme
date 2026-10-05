/* ============================================
 * CloudMusic ui.js — 渲染基础层
 * Toast / 模态框 / 右键菜单框架 / 标题栏 / Tab / 底栏图标
 * 当前曲目信息与封面 / 专辑卡片 / 曲目行渲染 / 即时播放
 * ============================================ */

import { $, $$, CM } from 'core';
import { fb } from 'foo-webview-sdk';
const { els, icons, state, esc } = CM;

/* ============================================
 * Toast
 * ============================================ */
CM.showToast = function (title, sub, type) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  const icon = type === 'success' ? icons.check : type === 'error' ? icons.error : icons.note;
  toast.innerHTML = `<div class="toast-icon ${type || ''}">${icon}</div>
      <div class="toast-info">
        <div class="toast-title">${esc(title)}</div>
        ${sub ? `<div class="toast-sub">${esc(sub)}</div>` : ''}
      </div>`;
  els.toastContainer.appendChild(toast);
  // 进场动画由 .toast 的 animation 自动播放；定时退出
  setTimeout(() => toast.classList.add('removing'), 3000);
};
els.toastContainer.addEventListener('animationend', e => { if (e.animationName === 'toast-out') e.target.remove(); });
els.toastContainer.addEventListener('click', e => e.target.closest('.toast')?.classList.add('removing'));

/* ============================================
 * 通用 HTML 片段
 * ============================================ */
CM.loadingHTML = function (text, extraStyle) {
  return `<div class="loading-spinner"${extraStyle ? ` style="${extraStyle}"` : ''}>
      <div class="spinner"></div><span>${text || '加载中...'}</span>
    </div>`;
};

CM.emptyHTML = function (text, icon, extraStyle) {
  return `<div class="empty-illustration"${extraStyle ? ` style="${extraStyle}"` : ''}>
      ${icon || icons.note}<span>${esc(text || '暂无内容')}</span>
    </div>`;
};

CM.trackPaths = function (tracks) {
  return tracks.map(CM.trackPath).filter(Boolean);
};

// 从 API 响应中提取曲目数组（兼容 tracks/items 两种字段名）
CM.respTracks = function (r) {
  return r.tracks ?? r.items ?? [];
};

// 从 API 响应中提取计数值（兼容 count/total 两种字段名）
CM.respCount = function (r) {
  return r.count ?? r.total ?? 0;
};

// 通用：替换播放列表并原子播放（多处复用：playAlbum / renderLibraryDrill / renderLibraryTracks）
CM.playAllTracks = function (tracks, title, onDone) {
  const paths = CM.trackPaths(tracks);
  if (!paths.length) {
    CM.showToast('无法播放', '未找到有效文件路径', 'error');
    return onDone?.(false);
  }

  // 先停掉 JIT 无痕试听，避免与正常播放同时输出（两首一起播）
  CM.stopPreviewIfActive().then(() =>
    // 若当前活动歌单是锁定/自动歌单，replace 会被宿主拒绝（"playlist is lock"），先切到可写歌单
    ensureWritableActivePlaylist().then(idx => {
      if (idx < 0) {
        CM.showToast('播放失败', '没有可写入的播放列表', 'error');
        return onDone?.(false);
      }

      fb.playlist.replaceAllAndPlay({ paths, playIndex: 0, autoPlay: true, stop: true }).then(({ success }) => {
        if (success) {
          if (!onDone) CM.showToast('开始播放', `${title || '全部'} · ${paths.length} 首`, 'success');
        } else {
          CM.showToast('播放失败', res?.error || '未知错误', 'error');
        }
        onDone?.(success);
      });
    })
  );
};

// 确保存在一个可写活动歌单：当前活动歌单被锁定/不可写时，复用或新建专用歌单并设为活动，返回其索引
async function ensureWritableActivePlaylist() {
  const TEMP = 'CloudMusic 播放';

  const active = await fb.playlist.getActive();
  if (active?.found && active && !active.isLocked && !active.isAutoplaylist(active)) return active.index;
  const r = await fb.playlist.getAll();
  const pls = Array.isArray(r) ? r : [];
  const reused = pls.find(p => p && !p.isLocked && !p.isAutoplaylist && p.name === TEMP);
  const getIdx = reused
    ? Promise.resolve(reused.index)
    : fb.playlist.create(TEMP).then(r2 => r2?.index ?? r2?.playlist ?? -1);
  const idx = await getIdx;
  return idx < 0 ? -1 : fb.playlist.setActive(idx).then(() => idx);
}

// 若正处于 JIT 无痕试听，则静默停止并复位状态；否则直接完成
CM.stopPreviewIfActive = async function () {
  if (!state.previewActive) return Promise.resolve();
  const r = await fb.jitQueue.stop();
  if (r.success) state.previewActive = false;
};

// 通用：提取曲目路径并弹出"添加到歌单"菜单
CM.addToPlaylistMenu = function (tracks, x, y) {
  const paths = CM.trackPaths(tracks);
  if (!paths.length) return CM.showToast('无可添加曲目', null, 'error');
  CM.showAddToPlaylistMenu(x, y, paths);
};

/* ============================================
 * 模态框（Promise 化）
 * resolve: 输入模式返回字符串 / 确认模式返回 true；取消返回 null
 * ============================================ */
CM.showModal = function ({ title = '', desc = '', input, okText = '确定', danger } = {}) {
  if (els.modal.open) els.modal.close();
  els.modal.returnValue = '';

  const hasInput = input !== undefined;

  els.modalTitle.textContent = title;
  els.modalDesc.textContent = desc;
  els.modalDesc.hidden = !desc;

  els.modalInput.hidden = !hasInput;
  els.modalInput.value = input ?? '';
  els.modalOk.textContent = okText;
  els.modalOk.className = `modal-btn ${danger ? 'danger' : 'primary'}`;

  if (hasInput) {
    els.modalInput.focus();
    els.modalInput.select();
  } else els.modalOk.focus();

  return new Promise(resolve => {
    els.modal.addEventListener('close', () => resolve(els.modal.returnValue || null), { once: true });
    els.modal.showModal();
  });
};

function closeModal(result = '') {
  if (els.modal.open) els.modal.close(result);
}

els.modal.addEventListener('mousedown', e => { if (e.target === els.modal) closeModal(); });
els.modalOk.addEventListener('click', () => closeModal(els.modalInput.hidden ? true : els.modalInput.value.trim()));
els.modalCancel.addEventListener('click', () => closeModal());
els.modalInput.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  closeModal(els.modalInput.value.trim());
});

/* ============================================
 * 右键菜单
 * items: [{label, icon?, html?, danger?, checked?, disabled?, hidden?, action?, submenu?:[items]}
 * {divider:true, hidden?}
 * {label:..., isLabel:true, hidden?}]
 * ============================================ */
function _showElement(el) {
  el.removeEventListener('animationend', el._hideListener);
  if (el.hasAttribute('popover')) el.showPopover();
  else el.classList.remove('hidden', 'removing');
}

function _hideElement(el) {
  if (el.classList.contains('hidden') || el.classList.contains('removing')) return;
  el.classList.add('removing');

  const listener = e => {
    if (e.animationName === 'ctx-out') {
      el.classList.add('hidden');
      el.classList.remove('removing');
      el.removeEventListener('animationend', listener);
      if (el.hasAttribute('popover')) el.hidePopover();
    }
  };
  el.addEventListener('animationend', listener);
  el._hideListener = listener;
}

function _setPosition(el, refX, refY, gap = 8) {
  const MARGIN = 8;
  const { innerWidth: W, innerHeight: H } = window;

  const maxH = Math.max(180, Math.min(H - gap, 480));
  el.style.maxHeight = `${maxH}px`;
  el.classList.remove('hidden', 'removing');

  const w = el.offsetWidth, h = el.offsetHeight;
  const offsetW = el.matches('.ctx-submenu') ? el.parentNode.offsetWidth : 0;
  const left = Math.max(MARGIN, (refX + w > W - MARGIN) ? refX - offsetW - w : refX + gap);
  const top = Math.max(MARGIN, Math.min(refY, H - h - MARGIN));

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function createMenu(items, basePath = []) {
  return items.map((item, idx) => {
    if (item.hidden) return ''; // 隐藏项
    if (item.divider) return '<div class="ctx-divider"></div>'; // 分割线
    if (item.isLabel) return `<div class="ctx-label">${esc(item.label)}</div>`; // 标签

    const path = [...basePath, idx];
    const classes = ['danger', 'checked', 'disabled']
      .filter(k => item[k])
      .join(' ');

    if (item.submenu?.length) return `
        <div class="ctx-menu-item ${classes}" data-path="${JSON.stringify(path)}">
          ${item.icon || ''}
          <span>${esc(item.label)}</span>
          <span class="icon" style="margin-left:auto"></span>
          <div class="ctx-submenu hidden">${createMenu(item.submenu, path)}</div>
        </div>`;

    const content = item.html || `<span>${esc(item.label)}</span>`;
    return `<div class="ctx-item ${classes}" data-path="${JSON.stringify(path)}">${item.icon || ''}${content}</div>`;
  }).join('');
}

CM.showCtxMenu = function (x, y, items) {
  const menu = els.ctxMenu;
  menu.removeEventListener('animationend', menu._hideListener);

  state.menuItems = items;
  menu.innerHTML = createMenu(items);
  // 定位
  _showElement(menu);
  _setPosition(menu, x, y, 8);
};

CM.hideCtxMenu = function () {
  const menu = els.ctxMenu;
  if (menu.classList.contains('hidden') || menu.classList.contains('removing')) return;

  menu.$$('.ctx-submenu').forEach(sub => {
    if (!sub.classList.contains('hidden')) {
      sub.removeEventListener('animationend', sub._hideListener);
      sub.classList.add('hidden');
      sub.classList.remove('removing');
    }
  });
  _hideElement(menu);
};

function getMenuItemByPath(path) {
  const node = path.slice(0, -1).reduce((acc, key) => acc?.[key]?.submenu, state.menuItems);
  return node?.[path[path.length - 1]];
}

// 事件处理
els.ctxMenu.addEventListener('click', e => {
  const el = e.target.closest('.ctx-item');
  if (!el || !state.menuItems || el.classList.contains('disabled')) return;
  e.stopPropagation();
  CM.hideCtxMenu();

  const path = JSON.parse(el.dataset.path);
  const target = getMenuItemByPath(path);
  target?.action();
});

els.ctxMenu.addEventListener('mouseover', e => {
  const item = e.target.closest('.ctx-menu-item');
  const sub = item?.$('.ctx-submenu');
  if (!sub) return;

  if (!sub.classList.contains('hidden')) {
    if (sub.classList.contains('removing')) _showElement(sub);
    return;
  }

  const { right, top } = item.getBoundingClientRect();
  _showElement(sub);
  _setPosition(sub, right + 5, top, -8);
});

els.ctxMenu.addEventListener('mouseout', e => {
  const item = e.target.closest('.ctx-menu-item');
  const sub = item?.$('.ctx-submenu');
  if (!sub || item.contains(e.relatedTarget)) return;
  _hideElement(sub);
});

document.addEventListener('mousedown', e => { if (!els.ctxMenu.contains(e.target)) CM.hideCtxMenu(); });
window.addEventListener('blur', () => CM.hideCtxMenu());

/* ============================================
 * 标题栏（窗口控制按钮）
 * ============================================ */
$('#capRestart').addEventListener('click', fb.misc.restart);
$('#capMin').addEventListener('click', fb.ui.minimize);
$('#capMax').addEventListener('click', fb.ui.toggleMaximize);
$('#capClose').addEventListener('click', fb.ui.close);
els.titlebarDrag.addEventListener('mousedown', e => { if (e.button === 0) fb.ui.startDrag(); });
els.titlebarDrag.addEventListener('dblclick', fb.ui.toggleMaximize);
fb.on('window:stateChanged', ({ maximized }) => updateMaxIcon(maximized));

function updateMaxIcon(maximized = null) {
  if (maximized !== null) return $('#capMax').classList.toggle('is-max', maximized);
  fb.ui.isMaximized().then(({ isMaximized }) =>
    $('#capMax').classList.toggle('is-max', isMaximized)
  );
}
updateMaxIcon();

/* ============================================
 * Tab 切换
 * ============================================ */
const TAB_IDS = { discover: 'tabDiscover', playlist: 'tabPlaylist', library: 'tabLibrary', search: 'tabSearch' };
// 缓存 Tab 相关 DOM（静态元素，无需每次 switchTab 都查询）
const _tabNavItems = $$('.nav-item[data-tab]'), _tabContents = $$('.tab-content');
// 按 tab 执行对应渲染（playlist 需有有效歌单索引）
const renderers = {
  playlist: () => state.currentPlaylistIndex >= 0 && CM.renderPlaylistView(state.currentPlaylistIndex),
  library: CM.renderLibrary,
  search: () => setTimeout(() => els.searchInput.focus(), 60)
};

CM.switchTab = function (tab) {
  if (!TAB_IDS[tab]) return;

  state.currentTab = tab;
  state.libraryView = 'stats';
  CM.setSettings('tab', tab);

  _tabNavItems.forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  _tabContents.forEach(el => el.classList.toggle('active', el.id === TAB_IDS[tab]));

  renderers[tab]?.();
};

/* ============================================
 * 底栏图标状态
 * ============================================ */
CM.updateOrderIcon = function () {
  const order = CM.ORDERS[CM.orderIndexOf(state.order)];
  els.btnOrder.classList.toggle('active', order.id !== 0);
  els.btnOrder.$$('.icon').forEach(el =>
    el.classList.toggle('active', el.dataset.order === order.label)
  );
  els.btnOrder.setAttribute('tooltip', `播放顺序： ${order.name}`);
};

CM.updateVolumeIcon = function () {
  const value = state.volume;
  const icons = [...els.volBtn.$$('.icon')];
  const target = icons.find(el => value <= +el.dataset.vol);
  icons.forEach(el => el.classList.toggle('active', el === target));
  els.volSlider.value = value;
  els.volSlider.style.setProperty('--vol-pct', `${value}%`);
  $(".vol-wrap").setAttribute('tooltip', value === 0 ? '已静音' : `音量 ${value}%`);
};

// 通用进度条更新（主进度条 + 沉浸式进度条共用）
CM._updateSeekBar = function (bar, curLabel, totalLabel, cssVar, seekingFlag) {
  if (state[seekingFlag]) return;
  const pct = ((state.duration > 0 ? state.position / state.duration : 0) * 100).toFixed(2);
  bar.value = pct;
  bar.style.setProperty(cssVar, `${pct}%`);
  curLabel.textContent = CM.formatTimeCached(state.position);
  totalLabel.textContent = CM.formatTimeCached(state.duration);
};

CM.updateSeekUI = function () {
  CM._updateSeekBar(els.seekBar, els.seekCurrent, els.seekTotal, '--seek-pct', 'seeking');
};

CM.updateStopIcon = function () {
  els.btnStop.classList.toggle('active', state.stopAfterCurrent);
};

/* ============================================
 * 当前曲目信息 + 封面 + 取色
 * ============================================ */
const DEFAULT_TRACK_COVER = CM.DEFAULT_TRACK_COVER = 'static/img/no_cover.svg';

CM.setArtwork = function (url) {
  const next = url?.trim() ?? DEFAULT_TRACK_COVER;

  [els.bottomArt, els.lyricsArt, els.plCover, els.npArtwork].forEach(el => {
    el.src = next;
    el.onerror = () => el.src = DEFAULT_TRACK_COVER;
  });

  CM.background?.setAlbum(next);
  els.lyricsBlurBg.style.backgroundImage = `url("${next}")`;
  CM.extractColorFromImage(next);
};

CM.updateTrackInfo = function (track) {
  CM.currentTrack = track || null;

  const name = track ? CM.trackName(track) : '未在播放';
  const artist = track ? CM.trackArtist(track) : '--';

  els.bottomTitle.textContent = els.lyricsTrackTitle.textContent = name;
  els.bottomArtist.textContent = els.lyricsTrackArtist.textContent = artist;

  // duration 为 0/无效时回退到 length（如部分 .aac 流 duration=0 但 length 有效）
  const dur = track?.duration || track?.length;
  if (!dur) state.duration = dur;

  document.title = track ? `${name} - ${artist}` : 'CloudMusic';
};

// 竞态防护：快速切歌时旧请求后返回会覆盖新数据，用递增 loadId 确保只有最新请求生效
let _artworkLoadId = 0;
CM.loadCurrentArtwork = function () {
  const loadId = ++_artworkLoadId;
  fb.artwork.getFb2kUrl('front', { maxSize: 600 }).then(r => {
    if (loadId !== _artworkLoadId) return;
    // 宿主响应无 success 字段：{available, dataUrl, type}
    CM.setArtwork(r.available ? r.dataUrl : null);
  });
};

/* ============================================
   * 批量封面（fb2k:// URL）
   * container 内查找 [data-path] 的 .art-slot 元素并填充
   * ============================================ */
// 批量填充封面：分批请求避免大批量超时（每批 50 个）
// 各批并行发起（原串行递归 N 批延迟 ×N），全部完成后统一结束
CM.fillArtworkBatch = function (container, maxSize) {
  const slots = container.$$('[data-art-path]');
  if (!slots.length) return;
  // 先收集未填充的 slot：跳过已有封面的（"加载更多"重渲染时避免重复请求）
  // 注意：IMG.src 属性在未设置时返回页面基址 URL（truthy），需用 getAttribute 判断
  const pendSlots = [];
  slots.forEach(slot => {
    if (slot.style.backgroundImage || (slot.tagName === 'IMG' && slot.getAttribute('src'))) return;
    pendSlots.push({ el: slot, path: slot.dataset.artPath });
  });
  if (!pendSlots.length) return;

  const fillImg = (el, { available, dataUrl }) => {
    if (!el || !available || !dataUrl) return;

    if (el.tagName === 'IMG') {
      el.src = dataUrl;
      el.classList.remove('ph');
    } else {
      el.style.backgroundImage = `url(${JSON.stringify(dataUrl)})`;
    }
    el.innerHTML = '';
  };
  const CHUNK = 50;
  for (let i = 0; i < pendSlots.length; i += CHUNK) {
    const chunkSlots = pendSlots.slice(i, i + CHUNK);
    fb.artwork
      .getFb2kUrlByPathBatch(chunkSlots.map(s => s.path), { maxSize: maxSize || 160 })
      .then(r => r.artworks.forEach((entry, i) => fillImg(chunkSlots[i].el, entry)));
  }
};

// 专辑卡片渲染（复用：发现页 + 媒体库全部专辑）
// 不含封面数据；封面通过 _loadAlbumCovers 异步批量加载
CM._renderAlbumCard = function (al) {
  const name = al.name || al.album || '未知专辑';
  const artist = al.artist || al.albumArtist || '未知艺术家';
  return `<div class="album-card fade-in" data-album="${esc(name)}" data-artist="${esc(artist)}">
      <div class="album-card-art">
        <div class="art-placeholder">${icons.note}</div>
        <div class="album-card-play">${icons.play}</div>
      </div>
      <div class="album-card-name">${esc(name)}</div>
      <div class="album-card-artist">${esc(artist)}</div>
    </div>`;
};

// 主内容区统一事件委托（专辑卡片 / dc-track / 搜索结果）
// 一次性绑定在 els.mainContent 上，所有子元素动态渲染后自动生效
// 挂 CM 供 ui-discover.js（搜索结果）等跨模块调用
// 专辑卡片：播放按钮 + 点击进详情
els.mainContent.addEventListener('click', e => {
  const card = e.target.closest('.album-card');
  if (!card) return;
  e.stopPropagation();

  if (e.target.closest('.album-card-play')) playAlbum(card.dataset.album, card.dataset.artist);
  else openLibraryAlbum(card.dataset.album, card.dataset.artist);
});
// dc-track / search-result-item：双击播放 + 右键菜单
els.mainContent.addEventListener('dblclick', e => {
  const el = e.target.closest('.dc-track[data-path], .search-result-item[data-path]');
  if (!el) return;
  CM.playNow(el.dataset.path);
  els.mainContent.$$('.dc-track[data-path], .search-result-item[data-path]').forEach(el => el.classList.remove('playing'));
  el.classList.add('playing');
});
els.mainContent.addEventListener('contextmenu', e => {
  const el = e.target.closest('.dc-track[data-path], .search-result-item[data-path]');
  if (!el) return;

  const { path: absolutePath, title, artist, album } = el.dataset;
  CM.showTrackCtxMenu(e.clientX, e.clientY, { absolutePath, title, artist, album });
});

// 批量加载专辑封面：对每张专辑取首曲路径，再批量请求封面
// 分批处理（每批24张），避免一次性发起过多 API 调用
CM._loadAlbumCovers = function (container, albums, maxSize) {
  if (!albums?.length) return;

  const cards = container.$$('.album-card');
  if (!cards.length) return;

  const CHUNK = 24, size = maxSize || 320;

  // 取单张专辑首曲路径（i 为 cards 全局索引）
  const fetchPath = async (al, i) => {
    const name = al.name || al.album || '';
    const artist = al.artist || al.albumArtist || undefined;
    if (!name) return Promise.resolve(null);

    const r = await fb.library.getAlbumTracks(name, artist);
    const tracks = r ? CM.respTracks(r) : [];
    if (tracks.length) return { index: i, path: CM.trackPath(tracks[0]) };
    // 专辑名或艺术家名含引号时宿主内部查询必然失配（无转义机制），回退 ? 通配查询
    if (!name.includes('"') && !(artist || '').includes('"')) return null;
    const wild = CM.wildValue(name);
    if (!wild) return null;
    const sr = await fb.library.search(`album IS "${wild}"`, 500);
    const st = CM.respTracks(sr).filter(t_1 => t_1.album === name);
    return st.length ? { index: i, path: CM.trackPath(st[0]) } : null;
  };

  const applyArtworks = (valid, artworks) => {
    artworks?.forEach((entry, i) => {
      const target = entry && valid[i];
      if (!target) return;
      const card = cards[target.index];
      const artEl = card?.$('.art-placeholder');
      const url = entry.dataUrl || entry.url;
      if (entry.available && url && artEl) {
        artEl.style.backgroundImage = `url("${url}")`;
        artEl.innerHTML = '';
      }
    });
  };

  const processChunk = start => {
    const slice = albums.slice(start, start + CHUNK);
    if (!slice.length) return;

    const jobs = slice.map((al, i) => fetchPath(al, start + i));
    Promise.all(jobs).then(results => {
      // 仅保留有 path 的结果，保证 valid 与 paths 一一对应（修复封面错位）
      const valid = results.filter(v => v?.path);
      if (!valid.length) return processChunk(start + CHUNK);

      fb.artwork.getFb2kUrlByPathBatch(valid.map(v => v.path), { maxSize: size }).then(r => {
        applyArtworks(valid, r?.artworks);
        processChunk(start + CHUNK);
      });
    });
  };

  processChunk(0);
};

function playAlbum(album, artist) {
  CM.showToast('正在加载', `正在获取专辑「${album}」...`, null);
  fb.library.getAlbumTracks(album, artist).then(r => {
    const tracks = CM.respTracks(r);
    if (!tracks.length) return CM.showToast('无法播放', '未找到专辑曲目', 'error');
    CM.playAllTracks(tracks, `专辑 ${album}`);
  });
}

// 打开专辑详情视图（媒体库下钻）
function openLibraryAlbum(album, artist) {
  CM.openLibraryDetail('album', { album, artist });
}

// 通用媒体库下钻导航（切换到媒体库标签页并设置视图）
CM.openLibraryDetail = function (view, arg) {
  // 进入下钻详情前保存列表滚动位置，返回时恢复
  state.libScrollTop = els.libraryDetail.scrollTop;
  if (state.currentTab !== 'library') CM.switchTab('library');
  state.libraryView = view;
  CM.renderLibrary(arg);
};

/* 单曲即时播放：加入队列顶部并播放下一首（队列消费模型，不修改歌单）
 * 队列为空时直接 add+next；非空时 add 到末尾再 moveToTop，保证双击曲目立即播放 */
CM.playNow = function (path) {
  if (!path) return;

  // 先停掉 JIT 无痕试听，避免与正常播放同时输出（两首一起播）
  CM.stopPreviewIfActive().then(() =>
    fb.queue.getCount().then(r => {
      const insertIdx = CM.respCount(r);

      fb.queue.addPaths([path]).then(res => {
        if (!res.success) return fb.player.playPath(path);

        // 队列非空：先将新曲目移到队首，再播放下一首
        if (insertIdx > 0) fb.queue.moveToTop(insertIdx).then(fb.player.next);
        else fb.player.next(); // 队列为空：新曲目已在队首
      });
    })
  );
};

CM.renderTrackRows = function (container, tracks, emptyText, startIdx) {
  if (!tracks.length) {
    container.innerHTML = CM.emptyHTML(emptyText);
    return;
  }
  startIdx ||= 0;
  const curPath = CM.trackPath(CM.currentTrack);

  container.innerHTML = tracks.map((track, i) => {
    const idx = startIdx + i;
    const title = esc(CM.trackName(track));
    const artist = esc(CM.trackArtist(track));
    const album = esc(track.album);
    const path = esc(CM.trackPath(track));
    const sub = artist + (track.album ? ` · ${album}` : '');
    const duration = CM.formatTime(track.duration);

    return `<div class="dc-track fade-in${path === curPath ? ' playing' : ''}" data-path="${path}" data-i="${idx}" data-title="${title}" data-artist="${artist}" data-album="${album}">
        <span class="dc-track-idx">${idx + 1}</span>
        <div class="dc-track-art ph" data-art-path="${path}">${icons.note}</div>
        <div class="dc-track-info">
          <div class="dc-track-title">${title}</div>
          <div class="dc-track-sub">${sub}</div>
        </div>
        <span class="dc-track-dur">${duration}</span>
      </div>`;
  }).join('');
  CM.fillArtworkBatch(container, 120);
};
