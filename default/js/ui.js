/* ============================================
 * CloudMusic ui.js — 渲染基础层
 * Toast / 模态框 / 右键菜单框架 / 标题栏 / Tab / 底栏图标
 * 当前曲目信息与封面 / 专辑卡片 / 曲目行渲染 / 即时播放
 * （页面级渲染模块拆分至 ui-*.js，此处仅保留跨模块共享部分）
 * ============================================ */

(function () {
  'use strict';
  const CM = window.CloudMusic,
    els = CM.els, state = CM.state, esc = CM.escHtml;

  /* ============================================
   * Toast
   * ============================================ */
  CM.showToast = function (title, sub, type) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    const icon = type === 'success' ? CM.icons.check : type === 'error' ? CM.icons.error : CM.icons.note;
    toast.innerHTML = `<div class="toast-icon ${type || ''}">${icon}</div>
      <div class="toast-info">
        <div class="toast-title">${esc(title)}</div>
        ${sub ? `<div class="toast-sub">${esc(sub)}</div>` : ''}
      </div>`;
    els.toastContainer.appendChild(toast);
    // 进场动画由 .toast 的 animation 自动播放；定时退出
    setTimeout(() => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 320);
    }, 2600);
  };

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
      ${icon || CM.icons.note}<span>${esc(text || '暂无内容')}</span>
    </div>`;
  };
  CM.trackPaths = function (tracks) {
    return tracks.map(CM.trackPath).filter(Boolean);
  };
  // 从 API 响应中提取曲目数组（兼容 tracks/items 两种字段名）
  CM.respTracks = function (r) {
    return (r && (r.tracks || r.items)) || [];
  };
  // 从 API 响应中提取计数值（兼容 count/total 两种字段名）
  CM.respCount = function (r) {
    return (r && (r.count != null ? r.count : r.total)) || 0;
  };

  // 通用：替换播放列表并原子播放（多处复用：playAlbum / renderLibraryDrill / renderLibraryTracks）
  CM.playAllTracks = function (tracks, title, onDone) {
    const fail = (desc) => { CM.showToast('播放失败', desc, 'error'); onDone(false); };

    const paths = CM.trackPaths(tracks);
    if (!paths.length) {
      CM.showToast('无法播放', '未找到有效文件路径', 'error');
      return onDone?.(false);
    }

    // 先停掉 JIT 无痕试听，避免与正常播放同时输出（两首一起播）
    CM.stopPreviewIfActive().then(() =>
      // 若当前活动歌单是锁定/自动歌单，replace 会被宿主拒绝（"playlist is lock"），先切到可写歌单
      CM.ensureWritableActivePlaylist().then(idx => {
        if (idx < 0) {
          CM.showToast('播放失败', '没有可写入的播放列表', 'error');
          return onDone?.(false);
        }

        CM.api('playlist.replaceAllAndPlay', { paths, playIndex: 0, autoPlay: true, stop: true }).then(res => {
          const ok = res?.success !== false;
          if (ok) {
            if (!onDone) CM.showToast('开始播放', `${title || '全部'} · ${paths.length} 首`, 'success');
          } else {
            CM.showToast('播放失败', res?.error || '未知错误', 'error');
          }
          onDone?.(ok);
        });
      })
    );
  };

  // 确保存在一个可写活动歌单：当前活动歌单被锁定/不可写时，复用或新建专用歌单并设为活动，返回其索引
  CM.ensureWritableActivePlaylist = function () {
    const TEMP = 'CloudMusic 播放';

    return CM.api('playlist.getActive').then(active => {
      if (active?.found && active && !active.isLocked && !active.isAutoplaylist(active)) return active.index;

      return CM.api('playlist.getAll').then(r => {
        const pls = Array.isArray(r) ? r : [];
        const reused = pls.find(p => p && !p.isLocked && !p.isAutoplaylist && p.name === TEMP);

        const getIdx = reused
          ? Promise.resolve(reused.index)
          : CM.api('playlist.create', { name: TEMP }).then(r2 => r2?.index ?? r2?.playlist ?? -1);

        return getIdx.then(idx =>
          idx < 0 ? -1 : CM.api('playlist.setActive', { playlist: idx }).then(() => idx)
        );
      });
    });
  };

  // 若正处于 JIT 无痕试听，则静默停止并复位状态；否则直接完成
  CM.stopPreviewIfActive = function () {
    if (!CM.state.previewActive) return Promise.resolve();
    return CM.api('jitQueue.stop').then(r => {
      if (r && r.success !== false) CM.state.previewActive = false;
    });
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
  let modalResolve = null;
  CM.showModal = function (opts) {
    return new Promise(resolve => {
      modalResolve?.(null);
      modalResolve = resolve;

      els.modalTitle.textContent = opts.title || '';
      els.modalDesc.textContent = opts.desc || '';
      els.modalDesc.style.display = opts.desc ? '' : 'none';

      const hasInput = opts.input !== undefined;
      els.modalInput.style.display = hasInput ? '' : 'none';
      els.modalInput.value = hasInput ? (opts.input || '') : '';
      els.modalOk.textContent = opts.okText || '确定';
      els.modalOk.className = `modal-btn ${opts.danger ? 'danger' : 'primary'}`;
      els.modal.showModal();

      if (hasInput) {
        setTimeout(() => {
          els.modalInput.focus();
          els.modalInput.select();
        }, 80);
      }
    });
  };
  CM.closeModal = function (result) {
    els.modal.close();
    modalResolve?.(result);
    modalResolve = null;
  };

  els.modalOk.addEventListener('click', () => {
    const hasInput = els.modalInput.style.display !== 'none';
    CM.closeModal(hasInput ? els.modalInput.value.trim() : true);
  });
  els.modalCancel.addEventListener('click', () => CM.closeModal(null));
  els.modal.addEventListener('mousedown', e => { if (e.target === els.modal) CM.closeModal(null); });
  els.modalInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') CM.closeModal(els.modalInput.value.trim());
    else if (e.key === 'Escape') CM.closeModal(null);
  });

  /* ============================================
   * 右键菜单
   * items: [{label, icon?, html?, danger?, checked?, disabled?, hidden?, action?, submenu?:[items]}
   * {divider:true, hidden?}
   * {label:..., isLabel:true, hidden?}]
   * ============================================ */
  function _showElement(el) {
    el.removeEventListener('animationend', el._hideListener);
    el.classList.remove('hidden', 'removing');
  }

  function _hideElement(el) {
    if (el.classList.contains('hidden') || el.classList.contains('removing')) return;
    el.classList.add('removing');

    const listener = e => {
      if (e.animationName === 'ctx-out') {
        el.classList.add('hidden');
        el.classList.remove('removing');
        el.removeEventListener('animationend', listener);
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
  };

  CM.createMenu = function (items, basePath = []) {
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
          <div class="ctx-submenu hidden">${CM.createMenu(item.submenu, path)}</div>
        </div>`;

      const content = item.html || `<span>${esc(item.label)}</span>`;
      return `<div class="ctx-item ${classes}" data-path="${JSON.stringify(path)}">${item.icon || ''}${content}</div>`;
    }).join('');
  };

  CM.showCtxMenu = function (x, y, items) {
    const menu = els.ctxMenu;
    menu.removeEventListener('animationend', menu._hideListener);

    state.menuItems = items;
    menu.innerHTML = CM.createMenu(items);
    // 定位
    _setPosition(menu, x, y, 8);
    _showElement(menu);
  };

  CM.hideCtxMenu = function () {
    const menu = els.ctxMenu;
    if (menu.classList.contains('hidden') || menu.classList.contains('removing')) return;

    menu.querySelectorAll('.ctx-submenu').forEach(sub => {
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
    const sub = item?.querySelector('.ctx-submenu');
    if (!sub) return;

    if (!sub.classList.contains('hidden')) {
      if (sub.classList.contains('removing')) _showElement(sub);
      return;
    }

    const { right, top } = item.getBoundingClientRect();
    _setPosition(sub, right + 5, top, -8);
    _showElement(sub);
  });

  els.ctxMenu.addEventListener('mouseout', e => {
    const item = e.target.closest('.ctx-menu-item');
    const sub = item?.querySelector('.ctx-submenu');
    if (!sub || item.contains(e.relatedTarget)) return;
    _hideElement(sub);
  });

  document.addEventListener('mousedown', e => { if (!els.ctxMenu.contains(e.target)) CM.hideCtxMenu(); });
  window.addEventListener('blur', () => CM.hideCtxMenu());

  /* ============================================
   * 标题栏（窗口控制按钮）
   * ============================================ */
  CM.initTitlebar = function () {
    CM.$('capMin').addEventListener('click', () => CM.api('window.minimize'));
    CM.$('capMax').addEventListener('click', () => CM.api('window.toggleMaximize'));
    CM.$('capClose').addEventListener('click', () => CM.api('window.close'));
    els.titlebarDrag.addEventListener('mousedown', e => { if (e.button === 0) CM.api('window.startDrag'); });
    els.titlebarDrag.addEventListener('dblclick', () => CM.api('window.toggleMaximize'));
    CM.updateMaxIcon();
    fb.on('window:stateChanged', e => CM.updateMaxIcon(e.maximized));
  };
  CM.updateMaxIcon = function (maximized = null) {
    if (maximized !== null) return CM.$('capMax').classList.toggle('is-max', maximized);
    CM.api('window.isMaximized').then(r =>
      CM.$('capMax').classList.toggle('is-max', r.maximized ?? r.isMaximized ?? false)
    );
  };

  /* ============================================
   * Tab 切换
   * ============================================ */
  const TAB_IDS = { discover: 'tabDiscover', playlist: 'tabPlaylist', library: 'tabLibrary', search: 'tabSearch' };
  // 缓存 Tab 相关 DOM（静态元素，无需每次 switchTab 都查询）
  let _tabNavItems, _tabMainTabs, _tabContents;
  CM.switchTab = function (tab) {
    if (!TAB_IDS[tab]) return;

    state.currentTab = tab;
    CM.setSettings('tab', tab);

    // 三组导航元素懒查询 + 统一同步 active 状态
    _tabNavItems ||= document.querySelectorAll('.nav-item[data-tab]');
    _tabMainTabs ||= document.querySelectorAll('.main-tab[data-tab]');
    _tabContents ||= document.querySelectorAll('.tab-content');

    _tabNavItems.forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
    _tabMainTabs.forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
    _tabContents.forEach(el => el.classList.toggle('active', el.id === TAB_IDS[tab]));

    // 按 tab 执行对应渲染（playlist 需有有效歌单索引）
    const renderers = {
      playlist: () => state.currentPlaylistIndex >= 0 && CM.renderPlaylistView(state.currentPlaylistIndex),
      library: () => CM.renderLibrary(),
      search: () => setTimeout(() => els.searchInput.focus(), 60)
    };
    renderers[tab]?.();
  };

  /* ============================================
   * 底栏图标状态
   * ============================================ */
  CM.updateOrderIcon = function () {
    const order = CM.ORDERS[CM.orderIndexOf(state.order)];
    els.btnOrder.classList.toggle('active', order.id !== 0);
    els.btnOrder.querySelectorAll('.icon').forEach(el =>
      el.classList.toggle('active', el.dataset.order === order.label)
    );
    els.btnOrder.title = `播放顺序： ${order.name}`;
  };

  CM.updateVolumeIcon = function () {
    const value = state.volume;
    const icons = [...els.volBtn.querySelectorAll('.icon')];
    const target = icons.find(el => value <= +el.dataset.vol);
    icons.forEach(el => el.classList.toggle('active', el === target));
    els.volSlider.value = value;
    els.volSlider.style.setProperty('--vol-pct', `${value}%`);
  };

  // 通用进度条更新（主进度条 + 沉浸式进度条共用）
  CM._updateSeekBar = function (bar, curLabel, totalLabel, cssVar, seekingFlag) {
    if (state[seekingFlag]) return;
    const pct = (state.duration > 0 ? state.position / state.duration : 0) * 100;
    bar.value = pct.toFixed(2);
    bar.style.setProperty(cssVar, `${pct.toFixed(2)}%`);
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

    els.lyricsBlurBg.style.backgroundImage = `url("${next}")`;
    CM.extractColorFromImage(next);
  };

  CM.updateTrackInfo = function (track) {
    CM.currentTrack = track || null;

    const name = track ? CM.trackName(track) : '未在播放';
    const artist = track ? CM.trackArtist(track) : '--';

    els.bottomTitle.textContent = els.bottomTitle.title = els.lyricsTrackTitle.textContent = name;
    els.bottomArtist.textContent = els.lyricsTrackArtist.textContent = artist;

    // duration 为 0/无效时回退到 length（如部分 .aac 流 duration=0 但 length 有效）
    const dur = track?.duration || track?.length;
    if (dur != null) state.duration = dur;

    document.title = track ? `${name} - ${artist}` : 'CloudMusic';
  };

  // 竞态防护：快速切歌时旧请求后返回会覆盖新数据，用递增 loadId 确保只有最新请求生效
  let _artworkLoadId = 0;
  CM.loadCurrentArtwork = function () {
    const loadId = ++_artworkLoadId;
    CM.api('artwork.getFb2kUrl', { type: 'front', maxSize: 600 }).then(r => {
      if (loadId !== _artworkLoadId) return;
      // 宿主响应无 success 字段：{available, dataUrl, type}
      CM.setArtwork(r?.dataUrl && r.available !== false ? r.dataUrl : null);
    });
  };

  /* ============================================
   * 批量封面（fb2k:// URL）
   * container 内查找 [data-path] 的 .art-slot 元素并填充
   * ============================================ */
  // 批量填充封面：分批请求避免大批量超时（每批 50 个）
  // 各批并行发起（原串行递归 N 批延迟 ×N），全部完成后统一结束
  CM.fillArtworkBatch = function (container, maxSize) {
    const slots = container.querySelectorAll('[data-art-path]');
    if (!slots.length) return Promise.resolve();
    const CHUNK = 50;
    // 先收集未填充的 slot：跳过已有封面的（"加载更多"重渲染时避免重复请求）
    // 注意：IMG.src 属性在未设置时返回页面基址 URL（truthy），需用 getAttribute 判断
    const pendSlots = [], pendPaths = [];

    for (const s of slots) {
      if (s.style.backgroundImage || (s.tagName === 'IMG' && s.getAttribute('src'))) continue;
      pendSlots.push(s);
      pendPaths.push(s.dataset.artPath);
    }
    if (!pendPaths.length) return Promise.resolve();
    const fillOne = (el, entry) => {
      if (!el || !entry) return;
      const url = entry.dataUrl || entry.url;
      if (entry.success === false || !url) return;

      if (el.tagName === 'IMG') {
        el.src = url;
        el.classList.remove('ph');
      } else {
        el.style.backgroundImage = `url("${url}")`;
      }
      el.innerHTML = '';
    };
    const reqs = [];

    for (let start = 0; start < pendPaths.length; start += CHUNK) {
      const chunkSlots = pendSlots.slice(start, start + CHUNK);
      const chunkPaths = pendPaths.slice(start, start + CHUNK);

      reqs.push(
        CM.api('artwork.getFb2kUrlByPathBatch', { paths: chunkPaths, type: 'front', maxSize: maxSize || 160 }).then(r =>
          r?.artworks.forEach((entry, i) => fillOne(chunkSlots[i], entry))
        )
      );
    }
    return Promise.all(reqs);
  };

  // 专辑卡片渲染（复用：发现页 + 媒体库全部专辑）
  // 不含封面数据；封面通过 _loadAlbumCovers 异步批量加载
  CM._renderAlbumCard = function (al) {
    const name = al.name || al.album || '未知专辑';
    const artist = al.artist || al.albumArtist || '未知艺术家';
    return `<div class="album-card fade-in" data-album="${esc(name)}" data-artist="${esc(artist)}">
      <div class="album-card-art">
        <div class="art-placeholder">${CM.icons.note}</div>
        <div class="album-card-play">${CM.icons.play}</div>
      </div>
      <div class="album-card-name">${esc(name)}</div>
      <div class="album-card-artist">${esc(artist)}</div>
    </div>`;
  };

  // 主内容区统一事件委托（专辑卡片 / dc-track / 搜索结果）
  // 一次性绑定在 els.mainContent 上，所有子元素动态渲染后自动生效
  // 挂 CM 供 ui-discover.js（搜索结果）等跨模块调用
  CM._ensureMainContentDelegation = function () {
    CM.runOnce('mainContentDelegation', () => {
      // 专辑卡片：播放按钮 + 点击进详情
      els.mainContent.addEventListener('click', e => {
        const card = e.target.closest('.album-card');
        if (!card) return;

        if (e.target.closest('.album-card-play')) {
          e.stopPropagation();
          CM.playAlbum(card.dataset.album, card.dataset.artist);
        } else {
          CM.openLibraryAlbum(card.dataset.album, card.dataset.artist);
        }
      });
      // dc-track / search-result-item：双击播放 + 右键菜单
      els.mainContent.addEventListener('dblclick', e => {
        const el = e.target.closest('.dc-track[data-path], .search-result-item[data-path]');
        if (!el) return;
        CM.playNow(el.dataset.path);
      });
      els.mainContent.addEventListener('contextmenu', e => {
        const el = e.target.closest('.dc-track[data-path], .search-result-item[data-path]');
        if (!el) return;

        const { path: absolutePath, title, artist, album } = el.dataset;
        CM.showTrackCtxMenu(e.clientX, e.clientY, { absolutePath, title, artist, album });
      });
    });
  };

  // 批量加载专辑封面：对每张专辑取首曲路径，再批量请求封面
  // 分批处理（每批24张），避免一次性发起过多 API 调用
  CM._loadAlbumCovers = function (container, albums, maxSize) {
    if (!albums?.length) return;

    const cards = container.querySelectorAll('.album-card');
    if (!cards.length) return;

    const CHUNK = 24, size = maxSize || 320;

    // 取单张专辑首曲路径（i 为 cards 全局索引）
    const fetchPath = (al, i) => {
      const name = al.name || al.album || '';
      const artist = al.artist || al.albumArtist || undefined;
      if (!name) return Promise.resolve(null);

      return CM.api('library.getAlbumTracks', { album: name, artist, limit: 1 }).then(r => {
        const tracks = r ? CM.respTracks(r) : [];
        if (tracks.length) return { index: i, path: CM.trackPath(tracks[0]) };

        // 专辑名或艺术家名含引号时宿主内部查询必然失配（无转义机制），回退 ? 通配查询
        if (!name.includes('"') && !(artist || '').includes('"')) return null;
        const wild = CM.wildValue(name);
        if (!wild) return null;

        return CM.api('library.search', { query: `album IS "${wild}"`, limit: 500 }).then(sr => {
          const st = CM.respTracks(sr).filter(t => t.album === name);
          return st.length ? { index: i, path: CM.trackPath(st[0]) } : null;
        });
      });
    };

    const applyArtworks = (valid, artworks) => {
      artworks?.forEach((entry, i) => {
        const target = entry && valid[i];
        if (!target) return;
        const card = cards[target.index];
        const artEl = card?.querySelector('.art-placeholder');
        const url = entry.dataUrl || entry.url;
        if (entry.success !== false && url && artEl) {
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

        CM.api('artwork.getFb2kUrlByPathBatch', {
          paths: valid.map(v => v.path),
          type: 'front',
          maxSize: size
        }).then(r => {
          applyArtworks(valid, r?.artworks);
          processChunk(start + CHUNK);
        });
      });
    };

    processChunk(0);
  };

  CM.playAlbum = function (album, artist) {
    CM.showToast('正在加载', `正在获取专辑「${album}」...`, null);
    CM.api('library.getAlbumTracks', { album, artist: artist || undefined }).then(r => {
      const tracks = CM.respTracks(r);
      if (!tracks.length) return CM.showToast('无法播放', '未找到专辑曲目', 'error');
      CM.playAllTracks(tracks, `专辑 ${album}`);
    });
  };

  // 打开专辑详情视图（媒体库下钻）
  CM.openLibraryAlbum = function (album, artist) {
    CM.openLibraryDetail('album', { album: album, artist: artist });
  };

  // 通用媒体库下钻导航（切换到媒体库标签页并设置视图）
  CM.openLibraryDetail = function (view, arg) {
    // 进入下钻详情前保存列表滚动位置，返回时恢复
    state.libScrollTop = els.libraryDetail.scrollTop;
    state.libraryView = view;
    state.libraryArg = arg;
    if (state.currentTab === 'library') CM.renderLibrary();
    else CM.switchTab('library'); // switchTab 内部会调用 renderLibrary()
  };

  /* 单曲即时播放：加入队列顶部并播放下一首（队列消费模型，不修改歌单）
   * 队列为空时直接 add+next；非空时 add 到末尾再 moveToTop，保证双击曲目立即播放 */
  CM.playNow = function (path) {
    if (!path) return;

    // 先停掉 JIT 无痕试听，避免与正常播放同时输出（两首一起播）
    CM.stopPreviewIfActive().then(() =>
      CM.api('queue.getCount').then(r => {
        const insertIdx = CM.respCount(r);

        CM.api('queue.addPaths', { paths: [path] }).then(res => {
          if (!res || res.success === false) return CM.api('playback.playPath', { path });

          // 队列非空：先将新曲目移到队首，再播放下一首
          if (insertIdx > 0) CM.api('queue.moveToTop', { index: insertIdx }).then(() => CM.api('playback.next'));
          else CM.api('playback.next'); // 队列为空：新曲目已在队首
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
        <div class="dc-track-art ph" data-art-path="${path}">${CM.icons.note}</div>
        <div class="dc-track-info">
          <div class="dc-track-title">${title}</div>
          <div class="dc-track-sub">${sub}</div>
        </div>
        <span class="dc-track-dur">${duration}</span>
      </div>`;
    }).join('');
    CM.fillArtworkBatch(container, 120);
    CM._ensureMainContentDelegation(); // 事件由 mainContent 统一委托
  };
})();
