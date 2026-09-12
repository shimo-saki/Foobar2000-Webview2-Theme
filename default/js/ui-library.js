/* ============================================
 * CloudMusic ui-library.js — 媒体库
 * 库树导航 / 概览统计 / 艺术家·流派·专辑网格
 * 文件夹浏览（面包屑/子目录） / 下钻详情 / 客户端分页
 * ============================================ */

(function() {
  'use strict';
  var CM = window.CloudMusic;
  var els = CM.els, state = CM.state, esc = CM.escHtml;
  var wildValue = CM.wildValue;

  /* ============================================
   * 媒体库
   * ============================================ */
  var LIB_NODES = [
    { id: 'stats', name: '概览', icon: CM.icons.info },
    { id: 'tracks', name: '歌曲', icon: CM.icons.note },
    { id: 'artists', name: '艺术家', icon: CM.icons.artist },
    { id: 'albums', name: '专辑', icon: CM.icons.album },
    { id: 'genres', name: '流派', icon: CM.icons.tag },
    { id: 'folders', name: '文件夹', icon: CM.icons.folder }
  ];

  // 媒体库树节点缓存 + 事件委托（避免每次 renderLibrary 都 querySelectorAll + 逐节点绑事件）
  var _libTreeNodes = null;
  CM.renderLibrary = function() {
    if (!_libTreeNodes) {
      els.libraryTree.innerHTML = LIB_NODES.map(n =>
        `<div class="tree-node${state.libraryView === n.id ? ' active' : ''}" data-view="${n.id}">${n.icon}<span>${n.name}</span></div>`
      ).join('');
      _libTreeNodes = els.libraryTree.querySelectorAll('.tree-node');
    }
    // 事件委托：一次性绑定在 libraryTree 上
    CM.runOnce('libTreeDelegation', function() {
      els.libraryTree.addEventListener('click', function(e) {
        var el = e.target.closest('.tree-node');
        if (!el) return;
        state.libraryView = el.dataset.view;
        state.libraryArg = null;
        CM.renderLibrary();
      });
    });
    // 后续切换只更新 active 状态，无需 querySelectorAll
    _libTreeNodes.forEach(el =>
      el.classList.toggle('active', el.dataset.view === (state.libraryView === 'folder' ? 'folders' : state.libraryView))
    );
    var view = state.libraryView;
    if (view === 'stats') CM.renderLibraryStats();
    else if (view === 'tracks') CM.renderLibraryTracks();
    else if (view === 'artists') CM.renderLibraryArtists();
    else if (view === 'albums') CM.renderLibraryAlbums();
    else if (view === 'genres') CM.renderLibraryGenres();
    else if (view === 'artist') CM.renderLibraryArtistDetail(state.libraryArg);
    else if (view === 'album') CM.renderLibraryAlbumDetail(state.libraryArg);
    else if (view === 'genre') CM.renderLibraryGenreDetail(state.libraryArg);
    else if (view === 'folders') CM.renderLibraryFolders();
    else if (view === 'folder') CM.renderLibraryFolder(state.libraryArg);
  };

  // 延迟加载指示器：API 快速返回（<150ms）时不闪烁，保留旧内容
  // 返回一个 cancel 函数，在 API 回调中调用以取消转圈
  CM.libLoadingDelayed = function() {
    return CM.delayedLoading(() => els.libraryDetail.innerHTML = CM.loadingHTML());
  };
  // 内容淡入：同步 reflow 模式，避免 innerHTML 后内容先以 opacity:1 渲染再变透明导致的闪烁
  // 原理：add(lib-transparent) 瞬间隐藏 → reflow 记录状态 → remove 触发 transition
  CM.libFadeIn = function() {
    var el = els.libraryDetail;
    el.classList.add('lib-transparent');
    void el.offsetHeight; // 强制 reflow，确保浏览器记录 opacity:0
    el.classList.remove('lib-transparent'); // 恢复，触发 0.2s transition
  };
  CM.libError = retry => {
    els.libraryDetail.innerHTML = `<div class="section-error">${CM.icons.error}<span>加载失败，媒体库可能未就绪</span><button class="retry-btn">重试</button></div>`;

    const btn = els.libraryDetail.querySelector('.retry-btn');
    if (btn && retry) btn.addEventListener('click', retry);
  };
  // 从下钻详情返回列表时恢复滚动位置（专辑/艺术家/流派网格通用）
  CM._restoreLibScroll = function() {
    if (state.libScrollRestore) {
      state.libScrollRestore = false;
      els.libraryDetail.scrollTop = state.libScrollTop || 0;
    }
  };

  CM.renderLibraryStats = () => {
    const cancelLoading = CM.libLoadingDelayed();

    CM.api('library.getStats').then(r => {
      cancelLoading();
      if (!r || r.success === false) return CM.libError(CM.renderLibraryStats);

      const totalSec = r.totalDuration || 0;
      const durText = totalSec >= 3600
        ? `${(totalSec / 3600).toFixed(1)} 小时`
        : `${Math.round(totalSec / 60)} 分钟`;

      const statCards = [
        [r.totalTracks || 0, '曲目'],
        [r.totalAlbums || 0, '专辑'],
        [r.totalArtists || 0, '艺术家'],
        [durText, '总时长'],
        [CM.formatSize(r.totalSize), '总大小']
      ].map(([value, label]) =>
        `<div class="stat-card"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`
      ).join('');

      els.libraryDetail.innerHTML = `
        <div class="library-stats">${statCards}</div>
        <div style="display:flex;align-items:center;gap:12px;margin:18px 0 14px">
          <div class="library-section-title" style="margin:0">最近添加</div>
          <button class="pl-btn" id="libAddAllBtn" style="margin-left:auto">${CM.icons.plus}<span>添加全部到歌单</span></button>
        </div>
        <div class="dc-tracklist" id="libRecentRows"></div>`;

      CM.libFadeIn();

      // 添加全部按钮
      const addAllBtn = CM.$('libAddAllBtn');
      if (addAllBtn) {
        let resetAddAllBtn = () => { };
        addAllBtn.addEventListener('click', e => {
          resetAddAllBtn = CM.setBtnLoading(addAllBtn, '加载曲目中...');

          CM.api('library.getCount').then(cr => {
            if (!cr) return fail('加载失败');
            const total = CM.respCount(cr);
            if (!total) return fail('媒体库为空');

            const pageSize = 2000;
            let collected = [];
            let pos = 0;

            const fetchPage = () => {
              CM.api('library.getAll', { start: pos, count: Math.min(pageSize, total - pos) }).then(pr => {
                if (!pr) {
                  resetAddAllBtn();
                  CM.showToast('加载失败', null, 'error');
                  return;
                }

                const batch = CM.respTracks(pr);
                collected = collected.concat(batch);
                pos += batch.length;

                if (pos < total && batch.length > 0) return fetchPage();

                resetAddAllBtn();
                const paths = CM.trackPaths(collected);
                if (!paths.length) return CM.showToast('未找到曲目路径', null, 'error');
                CM.showAddToPlaylistMenu(e.clientX, e.clientY, paths);
              });
            };
            fetchPage();
          });
        });
      }

      // 最近添加列表
      CM.api('library.getRecentlyAdded', { limit: 10 }).then(rr => {
        const box = CM.$('libRecentRows');
        if (box) CM.renderTrackRows(box, CM.respTracks(rr), '暂无曲目');
      });
    });
  };

  // 通用卡片网格渲染（艺术家 / 流派共用；传入 pageKey 则启用客户端分页）
  CM._renderLibraryGrid = function(apiMethod, apiParams, title, emptyText, cardRenderer, pageKey) {
    const cancelLoading = CM.libLoadingDelayed();
    CM.api(apiMethod, apiParams).then(r => {
      cancelLoading();
      if (!r || r.success === false) {
        CM.libError(() => CM._renderLibraryGrid(apiMethod, apiParams, title, emptyText, cardRenderer, pageKey));
        return;
      }

      const items = r.items || r.artists || r.genres || [];
      if (!items.length) {
        els.libraryDetail.innerHTML = CM.emptyHTML(emptyText);
        return;
      }

      // 统一的卡片切片渲染，分页/不分页都走这里
      const cardsHTML = (start, end) => items.slice(start, end).map(item => {
        const name = typeof item === 'string' ? item : (item.name || item.artist || item.genre || '');
        if (!name) return '';
        const count = typeof item === 'object' ? (item.trackCount || item.count || '') : '';
        return cardRenderer(name, count);
      }).join('');

      if (pageKey) {
        els.libraryDetail.innerHTML = CM._pagerBarHtml('libGrid', title, items.length) + '<div class="artist-grid" id="libGridRows"></div>';
        CM._bindPager('libGrid', items.length, pageKey, (start, size) => {
          const box = CM.$('libGridRows');
          if (box) box.innerHTML = cardsHTML(start, start + size);
        });
      } else {
        els.libraryDetail.innerHTML =
          `<div class="library-section-title" style="margin-top:0">${title}（${items.length}）</div>
          <div class="artist-grid">${cardsHTML(0, items.length)}</div>`;
      }

      CM.libFadeIn();
      CM._restoreLibScroll();
    });
  };

  // 媒体库详情区事件委托（艺术家/流派卡片点击，一次性绑定避免每次渲染都逐卡 attach）
  function ensureLibDetailDelegation() {
    CM.runOnce('libDetailDelegation', function() {
      els.libraryDetail.addEventListener('click', function(e) {
        var card = e.target.closest('.artist-card');
        if (!card) return;
        if (card.dataset.artist) CM.openLibraryDetail('artist', card.dataset.artist);
        else if (card.dataset.genre) CM.openLibraryDetail('genre', card.dataset.genre);
      });
    });
  }

  CM.renderLibraryArtists = () => {
    ensureLibDetailDelegation();
    CM._renderLibraryGrid(
      'library.getArtists', { limit: 1000000 }, '全部艺术家', '媒体库为空',
      (name, count) => `
        <div class="artist-card" data-artist="${esc(name)}">
          <div class="artist-avatar">${esc(name.charAt(0).toUpperCase())}</div>
          <div class="artist-name">${esc(name)}</div>
          ${count ? `<div class="artist-meta">${count} 首曲目</div>` : ''}
        </div>`,
      'artists'
    );
  };

  // 全部歌曲视图：自动分页加载全部曲目
  CM.renderLibraryTracks = function() {
    state.libraryBack = 'stats';
    const cancelLoading = CM.libLoadingDelayed();

    CM.api('library.getCount').then(cr => {
      const total = CM.respCount(cr);
      if (!total) {
        cancelLoading();
        els.libraryDetail.innerHTML = CM.emptyHTML('媒体库为空');
        return;
      }

      const PAGE = 500;
      const all = [];
      let offset = 0;

      // 串行拉取下一页：全部加载完 resolve，任一出错 reject
      const loadNext = () =>
        CM.api('library.getAll', { start: offset, count: Math.min(PAGE, total - offset) })
          .then(r => {
            if (!r || r.success === false) return Promise.reject(r);
            const batch = CM.respTracks(r);
            all.push(...batch);
            offset += batch.length;
            // batch 为空视为结束，防御 API 异常导致的死循环
            if (batch.length && offset < total) return loadNext();
          });

      loadNext()
        .then(() => {
          CM.renderLibraryDrill(
            '全部歌曲', `${total} 首曲目`, all,
            { pageSizes: LIB_PAGE_SIZES, pageKey: 'songTracks' }
          );
          CM.libFadeIn();
          CM._addRefreshLibButton();
        })
        .catch(() => { if (!all.length) CM.libError(CM.renderLibraryTracks) })
        .finally(cancelLoading);
    });
  };

  // 在“添加到播放列表”按钮旁插入“刷新媒体库”按钮
  CM._addRefreshLibButton = function () {
    const btnBar = CM.$('libAddToPlBtn');
    const parent = btnBar && btnBar.parentElement;
    if (!parent) return;

    const btn = document.createElement('button');
    btn.className = 'pl-btn';
    btn.innerHTML = CM.icons.refresh + '<span>刷新媒体库</span>';
    parent.insertBefore(btn, parent.firstChild);

    btn.addEventListener('click', () => {
      const resetBtn = CM.setBtnLoading(btn, '扫描中...');
      CM.api('library.refresh').then(res => {
        if (res && res.success !== false) {
          CM.showToast('媒体库已刷新', '正在重新加载歌曲列表', 'success');
          CM.renderLibraryTracks();
        } else {
          CM.showToast('刷新失败', null, 'error');
          resetBtn();
        }
      });
    });
  };
  /* 媒体库客户端分页（专辑/艺术家/流派共用）：全量拉取后按页渲染，页尺寸可切、页码记忆 */
  const LIB_PAGE_SIZES = [50, 100, 300, 500];
  CM._libPageSize = function() {
    const n = parseInt(state.libPageSize, 10);
    return LIB_PAGE_SIZES.includes(n) ? n : 50;
  };
  // 媒体库浮动分页栏（sticky 吸顶）：标题+数量徽标 + 每页尺寸 + 上一页/页码/下一页
  CM._pagerBarHtml = function(prefix, title, total) {
    var pageSize = CM._libPageSize();
    const sizeOpts = LIB_PAGE_SIZES
      .map(n => `<option value="${n}"${n === pageSize ? ' selected' : ''}>${n}</option>`)
      .join('');
    const head = title
      ? `<div class="lib-page-title">${esc(title)}</div><span class="lib-page-count">${total}</span>`
      : '';
    return `<div class="lib-pager">${head}
      <div class="lib-pager-controls">
        <span class="lib-pager-label">每页</span>
        <select class="lib-page-size" id="${prefix}PageSize">${sizeOpts}</select>
        <div class="lib-page-nav">
          <button class="lib-page-btn" id="${prefix}Prev" type="button">${CM.icons.pre}<span>上一页</span></button>
          <span class="lib-page-info" id="${prefix}PageInfo"></span>
          <button class="lib-page-btn" id="${prefix}Next" type="button"><span>下一页</span>${CM.icons.next}</button>
        </div>
      </div>
    </div>`;
  };
  CM._bindPager = function (prefix, total, pageKey, onPage) {
    if (!state.libPages) state.libPages = {};

    let pageSize = CM._libPageSize();
    let page = state.libPages[pageKey] || 1;
    let totalPages = 1;

    const renderPage = (scrollTop) => {
      totalPages = Math.max(1, Math.ceil((total || 0) / pageSize));
      page = Math.min(Math.max(page, 1), totalPages);
      state.libPages[pageKey] = page;
      state.libPageSize = pageSize;

      onPage((page - 1) * pageSize, pageSize, page, totalPages);

      const info = CM.$(prefix + 'PageInfo');
      if (info) info.textContent = `${page} / ${totalPages}`;

      const prev = CM.$(prefix + 'Prev');
      const next = CM.$(prefix + 'Next');
      if (prev) prev.disabled = page <= 1;
      if (next) next.disabled = page >= totalPages;

      if (scrollTop) els.libraryDetail.scrollTop = 0;
    };

    const sizeEl = CM.$(prefix + 'PageSize');
    if (sizeEl) {
      sizeEl.addEventListener('change', () => {
        pageSize = parseInt(sizeEl.value, 10) || LIB_PAGE_SIZES[0];
        page = 1;
        renderPage(true);
      });
    }

    const prevBtn = CM.$(prefix + 'Prev');
    const nextBtn = CM.$(prefix + 'Next');
    if (prevBtn) prevBtn.addEventListener('click', () => {
      if (page > 1) { page--; renderPage(true); }
    });
    if (nextBtn) nextBtn.addEventListener('click', () => {
      if (page < totalPages) { page++; renderPage(true); }
    });

    renderPage(false);
  };

  CM.renderLibraryAlbums = function() {
    const cancelLoading = CM.libLoadingDelayed();
    // 全量拉取专辑（解除 limit:200 上限），客户端分页渲染
    CM.api('library.getAlbums', { limit: 1000000 }).then(r => {
      cancelLoading();
      if (!r || r.success === false) { CM.libError(CM.renderLibraryAlbums); return; }

      const albums = r.albums || [];
      if (!albums.length) { els.libraryDetail.innerHTML = CM.emptyHTML('媒体库为空'); return; }

      els.libraryDetail.innerHTML = CM._pagerBarHtml('libAlbum', '全部专辑', albums.length) + '<div class="album-grid" id="libAlbumRows"></div>';

      CM._bindPager('libAlbum', albums.length, 'albums', (start, size) => {
        const box = CM.$('libAlbumRows');
        if (!box) return;

        const slice = albums.slice(start, start + size);
        box.innerHTML = slice.map(CM._renderAlbumCard).join('');

        // 异步批量加载封面：并行获取每张专辑首曲路径，再批量请求封面
        CM._loadAlbumCovers(box, slice, 320);
        CM._bindAlbumCards(box);
      });

      CM.libFadeIn();
      CM._restoreLibScroll();
    });
  };

  CM.renderLibraryGenres = function() {
    ensureLibDetailDelegation();
    CM._renderLibraryGrid(
      'library.getGenres', { limit: 1000000 }, '全部流派', '暂无流派信息',
      (name, count) => `
        <div class="artist-card" data-genre="${esc(name)}">
          <div class="artist-avatar">♪</div>
          <div class="artist-name">${esc(name)}</div>
          ${count ? `<div class="artist-meta">${count} 首曲目</div>` : ''}
        </div>`,
      'genres'
    );
  };

  // 文件夹卡片渲染（根目录 + 子目录共用）
  // root 结构: { id, displayName, absolutePath, trackCount }
  // dir 结构:  { pathId, displayName/name, trackCount }（rootId 由调用方 parentRootId 传入）
  CM._renderFolderCard = function(folder, parentRootId) {
    const name = folder.displayName || folder.name || folder.title || folder.path || '未命名文件夹';
    const isRoot = folder.pathId === undefined && folder.id !== undefined;
    const rootId = (isRoot ? folder.id : parentRootId) || folder.rootId || '';
    const pathId = isRoot ? '' : folder.pathId || folder.path_id || '';
    const sub = folder.absolutePath || folder.path || folder.relativePath || '';

    return `<div class="artist-card folder-card" data-root-id="${esc(rootId)}" data-path-id="${esc(pathId)}" data-folder-name="${esc(name)}">
      <div class="artist-avatar">${CM.icons.folder}</div>
      <div class="artist-name">${esc(name)}</div>
      ${sub ? `<div class="artist-meta">${esc(sub)}</div>` : ''}
    </div>`;
  };

  CM._pushFolderTrail = function(rootId, pathId, name) {
    rootId = rootId || '';
    pathId = pathId || '';

    let trail = (state.libFolderTrail || []).slice();
    const i = trail.findIndex(t => t.rootId === rootId && (t.pathId || '') === pathId);

    if (i >= 0) {
      if (name) trail[i].name = name;
      trail = trail.slice(0, i + 1);
    } else {
      if (trail[0] && trail[0].rootId !== rootId) trail = [];

      const last = trail.at(-1);
      const lastPath = last && (last.pathId || '');
      const isChild = !last || (last.rootId === rootId &&
        (lastPath ? pathId.indexOf(lastPath + '/') === 0 : !!pathId));

      if (isChild) {
        trail.push({ rootId, pathId, name: name || pathId.split('/').pop() || '文件夹' });
      } else {
        trail = [{ rootId, pathId: '', name: (trail[0] && trail[0].name) || (!pathId && name) || '根目录' }];

        if (pathId) {
          const parts = pathId.split('/').filter(Boolean);
          trail = parts.reduce((t, part, n) => {
            const lastPath = t.at(-1).pathId;
            t.push({ rootId, pathId: lastPath ? `${lastPath}/${part}` : part, name: n === parts.length - 1 ? (name || part) : part });
            return t;
          }, trail);
        }
      }
    }

    state.libFolderTrail = trail;
  };

  CM._folderCrumbHtml = function() {
    const trail = state.libFolderTrail || [];
    return [
      `<span class="lib-crumb" data-crumb="0" style="cursor:pointer">文件夹</span>`,
      ...trail.map((item, i) => {
        const name = esc(item.name || '');
        const sep = `<span style="opacity:0.4;margin:0 6px">/</span>`;
        return (i === trail.length - 1)
          ? `${sep}<span style="color:var(--text-1)">${name}</span>`
          : `${sep}<span class="lib-crumb" data-crumb="${i + 1}" style="cursor:pointer">${name}</span>`;
      }),
    ].join('');
  };

  CM._goFolderCrumb = function(index) {
    if (index <= 0) {
      state.libraryView = 'folders';
      state.libraryArg = null;
      state.libFolderTrail = [];
      state.libScrollRestore = true;
      CM.renderLibrary();
      return;
    }
    var trail = state.libFolderTrail || [];
    var target = trail[index - 1];
    if (!target) return;
    state.libFolderTrail = trail.slice(0, index);
    CM.openLibraryDetail('folder', { rootId: target.rootId, pathId: target.pathId || '' });
  };

  CM._folderGoBack = function () {
    CM._goFolderCrumb((state.libFolderTrail || []).length - 1);
  };

  CM._openLibraryFolder = function(rootId, pathId, name) {
    CM._pushFolderTrail(rootId, pathId, name);
    CM.openLibraryDetail('folder', { rootId: rootId || '', pathId: pathId || '' });
  };

  function ensureFolderDelegation() {
    CM.runOnce('folderDelegation', function() {
      els.libraryDetail.addEventListener('click', e => {
        const crumb = e.target.closest('.lib-crumb');
        if (crumb) return CM._goFolderCrumb(parseInt(crumb.dataset.crumb, 10) || 0);

        const card = e.target.closest('.folder-card');
        if (card) CM._openLibraryFolder(card.dataset.rootId, card.dataset.pathId, card.dataset.folderName);
      });
    });
  }

  // 文件夹视图：列出媒体库根目录
  CM.renderLibraryFolders = function () {
    ensureFolderDelegation();
    state.libraryBack = 'stats';

    const cancelLoading = CM.libLoadingDelayed();
    CM.api('library.getRoots').then(r => {
      cancelLoading();
      if (!r || r.success === false) return CM.libError(CM.renderLibraryFolders);

      const roots = r.roots || r.items || r.directories || [];
      if (!roots.length) {
        els.libraryDetail.innerHTML = CM.emptyHTML('媒体库未配置文件夹');
        return;
      }

      els.libraryDetail.innerHTML =
        `<div class="library-section-title" style="margin-top:0">媒体库文件夹（${roots.length}）</div>` +
        `<div class="artist-grid">${roots.map(CM._renderFolderCard).join('')}</div>`;

      CM.libFadeIn();
      CM._restoreLibScroll();
    });
  };

  // 文件夹详情：面包屑导航 + 子文件夹网格 + 分页曲目 + 播放全部/添加到歌单
  CM.renderLibraryFolder = function (arg) {
    ensureFolderDelegation();
    arg = arg || {};

    const rootId = arg.rootId || '';
    const pathId = arg.pathId || '';

    if (!state.libFolderTrail || !state.libFolderTrail.length) {
      CM._pushFolderTrail(rootId, pathId, pathId ? pathId.split('/').pop() : '');
    }

    state.libraryBack = 'folders';
    const cancelLoading = CM.libLoadingDelayed();

    CM.api('library.browseTree', {
      rootId, pathId, includeFiles: true, recursiveFiles: false
    }).then(r => {
      cancelLoading();
      if (!r || r.success === false) return CM.libError(() => CM.renderLibraryFolder(arg));

      const dirs = r.directories || r.dirs || [];
      const files = r.files || r.tracks || [];

      const trail = state.libFolderTrail || [];
      const title = (trail.length && trail.at(-1).name) || (pathId ? pathId.split('/').pop() : '文件夹');
      const crumb = CM._folderCrumbHtml();

      // 空文件夹和无曲目时共用同一个头部
      const header = sub => `
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
        <button class="retry-btn" id="libBackBtn">← 返回</button>
        <div>
          <div class="library-section-title" style="margin:0">${crumb}</div>
          ${sub ? `<div style="font-size:11.5px;color:var(--text-3);margin-top:2px">${sub}</div>` : ''}
        </div>
      </div>`;

      if (!dirs.length && !files.length) {
        els.libraryDetail.innerHTML = header() + CM.emptyHTML('此文件夹为空');
        CM.$('libBackBtn').addEventListener('click', CM._folderGoBack);
        return;
      }

      const folderKey = `${rootId}::${pathId}`;
      if (state.libFolderKey !== folderKey) {
        state.libFolderKey = folderKey;
        state.libPages = state.libPages || {};
        state.libPages.folder = 1;
      }

      const extraHtml = dirs.length
        ? `<div class="library-section-title">子文件夹（${dirs.length}）</div>
         <div class="artist-grid">${dirs.map(d => CM._renderFolderCard(d, rootId)).join('')}</div>`
        : '';

      const stats = `${dirs.length} 个子文件夹 · ${files.length} 首曲目`;
      if (files.length) {
        CM.renderLibraryDrill(
          title, stats, files,
          { extraHtml, pageSizes: LIB_PAGE_SIZES, pageKey: 'folder', onBack: CM._folderGoBack, titleHtml: crumb }
        );
      } else {
        els.libraryDetail.innerHTML = header(stats) + extraHtml;
        CM.$('libBackBtn').addEventListener('click', CM._folderGoBack);
      }

      CM.libFadeIn();
    });
  };

  // 下钻详情通用：标题 + 播放全部 + 添加到歌单 + 曲目行
  // opts.extraHtml: 标题与曲目之间的附加内容（如子文件夹网格）
  // opts.pageSizes: 启用曲目分页；播放全部/添加到歌单始终使用完整 tracks
  // opts.pageKey: 分页页码缓存键；opts.onBack: 自定义返回；opts.titleHtml: 自定义标题（如面包屑）
  CM.renderLibraryDrill = function(title, subtitle, tracks, opts) {
    opts = opts || {};
    var paged = !!(opts.pageSizes && opts.pageSizes.length);
    var extraHtml = opts.extraHtml || '';
    var titleInner = opts.titleHtml || esc(title);
    const html = `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
      <button class="retry-btn" id="libBackBtn">← 返回</button>
      <div>
        <div class="library-section-title" style="margin:0">${titleInner}</div>
        ${subtitle ? `<div style="font-size:11.5px;color:var(--text-3);margin-top:2px">${esc(subtitle)}</div>` : ''}
      </div>
      <div style="margin-left:auto;display:flex;gap:8px">
        <button class="pl-btn pl-btn-primary" id="libPlayAllBtn">${CM.icons.play}<span>播放全部</span></button>
        <button class="pl-btn" id="libAddToPlBtn">${CM.icons.plus}<span>添加到歌单</span></button>
      </div>
    </div>
    ${extraHtml}
    ${paged ? CM._pagerBarHtml('libDrill', typeof title === 'string' ? title : '曲目', tracks.length) : ''}
    <div class="dc-tracklist" id="libDrillRows"></div>`;
    els.libraryDetail.innerHTML = html;

    CM.$('libBackBtn').addEventListener('click', () => {
      if (opts.onBack) return opts.onBack();
      state.libraryView = state.libraryBack || 'artists';
      state.libraryArg = null;
      state.libScrollRestore = true; // 返回列表时恢复滚动位置
      CM.renderLibrary();
    });

    CM.$('libPlayAllBtn').addEventListener('click', () => CM.playAllTracks(tracks, title));
    CM.$('libAddToPlBtn').addEventListener('click', e => CM.addToPlaylistMenu(tracks, e.clientX, e.clientY));

    if (paged) {
      CM._bindPager('libDrill', tracks.length, opts.pageKey || 'drill', (start, size) => {
        CM.renderTrackRows(CM.$('libDrillRows'), tracks.slice(start, start + size), '未找到曲目', start);
      });
    } else {
      CM.renderTrackRows(CM.$('libDrillRows'), tracks, '未找到曲目');
    }
  };

  // 通用下钻详情：设置 backView → loading → API → drill 渲染
  // resultFilter/resultSorter：含引号标签走 ? 通配查询时，按原值客户端精确过滤并排序
  CM._renderLibraryDetail = function(backView, apiMethod, apiParams, title, subtitleBuilder, retryFn, resultFilter, resultSorter) {
    state.libraryBack = backView;
    var cancelLoading = CM.libLoadingDelayed();
    CM.api(apiMethod, apiParams).then(function(r) {
      cancelLoading();
      if (!r || r.success === false) { CM.libError(retryFn); return; }
      var tracks = CM.respTracks(r);
      if (resultFilter) tracks = tracks.filter(resultFilter);
      if (resultSorter) resultSorter(tracks);
      CM.renderLibraryDrill(title, subtitleBuilder(tracks), tracks);
      CM.libFadeIn();
    });
  };

  // 通配结果按碟号/音轨号排序，与 getAlbumTracks 行为一致
  function sortByDiscTrack(tracks) {
    return tracks.sort((a, b) =>
      (a.discNumber || 0) - (b.discNumber || 0) || (a.trackNumber || 0) - (b.trackNumber || 0));
  };

  CM.renderLibraryArtistDetail = function (artist) {
    const sub = tracks => `${tracks.length} 首曲目`;
    const retry = () => CM.renderLibraryArtistDetail(artist);

    // 艺术家名含引号：宿主 getArtistTracks 内部查询无法转义必然返回空，直接走 ? 通配查询
    const wild = artist.includes('"') ? wildValue(artist) : null;

    if (wild) {
      CM._renderLibraryDetail(
        'artists', 'library.search',
        { query: `(artist IS "${wild}" OR albumartist IS "${wild}")`, limit: 500 },
        artist, sub, retry,
        t => t.artist === artist || t.albumArtist === artist
      );
      return;
    }

    CM._renderLibraryDetail('artists', 'library.getArtistTracks', { artist, limit: 500 }, artist, sub, retry);
  };

  CM.renderLibraryAlbumDetail = function (arg) {
    if (!arg) {
      state.libraryView = 'albums';
      CM.renderLibrary();
      return;
    }

    const sub = tracks => `${arg.artist ? arg.artist + ' · ' : ''}${tracks.length} 首曲目`;    const retry = () => CM.renderLibraryAlbumDetail(arg);

    // 专辑名或艺术家名含引号：宿主 getAlbumTracks 内部查询无法转义必然返回空，直接走 ? 通配查询
    const wild = arg.album.includes('"') ? wildValue(arg.album) : null;
    const wildArtist = (arg.artist || '').includes('"') ? wildValue(arg.artist) : null;

    if (wild || wildArtist) {
      let q = wild ? `album IS "${wild}"` : `album HAS "${arg.album}"`;
      const artist = wildArtist || arg.artist;
      if (artist) {
        const a = wildArtist || arg.artist;
        q += ` AND (artist IS "${a}" OR albumartist IS "${a}")`;
      }
      CM._renderLibraryDetail(
        'albums', 'library.search',
        { query: q, limit: 500 },
        arg.album, sub, retry,
        t => t.album === arg.album,
        sortByDiscTrack
      );
      return;
    }

    CM._renderLibraryDetail(
      'albums', 'library.getAlbumTracks',
      { album: arg.album, artist: arg.artist || undefined },
      arg.album, sub, retry
    );
  };

  CM.renderLibraryGenreDetail = function (genre) {
    const sub = tracks => `${tracks.length} 首曲目`;
    const retry = () => CM.renderLibraryGenreDetail(genre);

    // 流派名含引号：查询无法转义，用 ? 通配替换 + 客户端精确过滤
    const wild = genre.includes('"') ? wildValue(genre) : null;
    const query = wild ? `genre IS "${wild}"` : `genre HAS "${genre}"`;

    CM._renderLibraryDetail(
      'genres', 'library.search',
      { query, limit: 500 },
      genre, sub, retry,
      wild ? (t => t.genre === genre) : undefined
    );
  };


})();
