/* ============================================
 * CloudMusic ui-library.js — 媒体库
 * 库树导航 / 概览统计 / 艺术家·流派·专辑网格
 * 文件夹浏览（面包屑/子目录） / 下钻详情 / 客户端分页
 * ============================================ */

import { $, CM } from 'core';
import { fb } from 'foo-webview-sdk';
const { els, icons, state, esc } = CM;

// 视图渲染器映射
const LIB_RENDERERS = {
  stats: renderLibraryStats,
  tracks: renderLibraryTracks,
  artists: renderLibraryArtists,
  albums: renderLibraryAlbums,
  genres: renderLibraryGenres,
  artist: renderLibraryArtistDetail,
  album: renderLibraryAlbumDetail,
  genre: renderLibraryGenreDetail,
  folder: renderLibraryFolder,
  folders: renderLibraryFolders,
};

// 事件委托：一次性绑定在 libraryTree 上
els.libraryTree.addEventListener('click', e => {
  const el = e.target.closest('.tree-node');
  if (!el) return;
  state.libraryView = el.dataset.view;
  CM.renderLibrary();
});

// 媒体库树节点缓存
const _libTreeNodes = els.libraryTree.$$('.tree-node');
CM.renderLibrary = function (arg) {
  _libTreeNodes.forEach(el => el.classList.toggle('active', el.dataset.view === state.libraryView));

  LIB_RENDERERS[state.libraryView]?.(arg);
};

function libFadeIn() {
  els.libraryDetail.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 })
    .onfinish = e => e.target.cancel();
}

function libError(retry) {
  els.libraryDetail.innerHTML = `<div class="section-error">${icons.error}<span>加载失败，媒体库可能未就绪</span><button class="retry-btn">重试</button></div>`;
  els.libraryDetail.$('.retry-btn')?.addEventListener('click', retry, { once: true });
}

// 从下钻详情返回列表时恢复滚动位置（专辑/艺术家/流派网格通用）
function _restoreLibScroll() {
  els.libraryDetail.scrollTop = state.libScrollTop || 0;
  state.libScrollTop = 0;
}

function renderLibraryStats() {
  fb.library.getStats().then(r => {
    if (!r) return libError(renderLibraryStats);

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
          <button class="pl-btn" id="libAddAllBtn" style="margin-left:auto">${icons.plus}<span>添加全部到歌单</span></button>
        </div>
        <div class="dc-tracklist" id="libRecentRows"></div>`;

    libFadeIn();

    // 添加全部按钮
    const addAllBtn = $('#libAddAllBtn');
    if (addAllBtn) {
      addAllBtn.addEventListener('click', e =>
        fb.library.getCount().then(cr => {
          if (!cr) return CM.showToast('加载失败', null, 'error');
          const total = CM.respCount(cr);
          if (!total) return CM.showToast('媒体库为空', null, 'error');

          const pageSize = 2000;
          let collected = [];
          let pos = 0;

          const fetchPage = () => {
            fb.library.getAll(pos, Math.min(pageSize, total - pos)).then(pr => {
              if (!pr) return CM.showToast('加载失败', null, 'error');

              const batch = CM.respTracks(pr);
              collected = collected.concat(batch);
              pos += batch.length;

              if (pos < total && batch.length > 0) return fetchPage();

              const paths = CM.trackPaths(collected);
              if (!paths.length) return CM.showToast('未找到曲目路径', null, 'error');
              CM.showAddToPlaylistMenu(e.clientX, e.clientY, paths);
            });
          };
          fetchPage();
        })
      );
    }

    // 最近添加列表
    fb.library.getRecentlyAdded(10).then(rr => {
      const box = $('#libRecentRows');
      if (box) CM.renderTrackRows(box, CM.respTracks(rr), '暂无曲目');
    });
  });
}

// 通用卡片网格渲染（艺术家 / 流派共用；传入 pageKey 则启用客户端分页）
function _renderLibraryGrid(method, params, title, emptyText, cardRenderer, pageKey) {
  fb.invoke(method, params).then(r => {
    if (!r.success) return libError(() => _renderLibraryGrid(method, params, title, emptyText, cardRenderer, pageKey));

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
      els.libraryDetail.innerHTML = _pagerBarHtml('libGrid', title, items.length) + '<div class="artist-grid" id="libGridRows"></div>';
      _bindPager('libGrid', items.length, pageKey, (start, size) => {
        const box = $('#libGridRows');
        if (box) box.innerHTML = cardsHTML(start, start + size);
      });
    } else {
      els.libraryDetail.innerHTML =
        `<div class="library-section-title" style="margin-top:0">${title}（${items.length}）</div>
          <div class="artist-grid">${cardsHTML(0, items.length)}</div>`;
    }

    libFadeIn();
    _restoreLibScroll();
  });
}

// 媒体库详情区事件委托（艺术家/流派卡片点击，一次性绑定避免每次渲染都逐卡 attach）
els.libraryDetail.addEventListener('click', e => {
  const card = e.target.closest('.artist-card');
  if (!card) return;
  const { artist, genre } = card.dataset;
  if (artist) CM.openLibraryDetail('artist', artist);
  else if (genre) CM.openLibraryDetail('genre', genre);
});

function renderLibraryArtists() {
  _renderLibraryGrid(
    'library.getArtists', { limit: 1000000 }, '全部艺术家', '媒体库为空',
    (name, count) => `
      <div class="artist-card" data-artist="${esc(name)}">
        <div class="artist-avatar">${esc(name.charAt(0).toUpperCase())}</div>
        <div class="artist-name">${esc(name)}</div>
        ${count ? `<div class="artist-meta">${count} 首曲目</div>` : ''}
      </div>`,
    'artists'
  );
}

// 全部歌曲视图：自动分页加载全部曲目
function renderLibraryTracks() {
  state.libraryBack = 'stats';

  fb.library.getCount().then(cr => {
    const total = CM.respCount(cr);
    if (!total) {
      els.libraryDetail.innerHTML = CM.emptyHTML('媒体库为空');
      return;
    }

    const PAGE = 500;
    const all = [];
    let offset = 0;

    // 串行拉取下一页：全部加载完 resolve，任一出错 reject
    const loadNext = () =>
      fb.library.getAll(offset, Math.min(PAGE, total - offset))
        .then(r => {
          const batch = CM.respTracks(r);
          all.push(...batch);
          offset += batch.length;
          // batch 为空视为结束，防御 API 异常导致的死循环
          if (batch.length && offset < total) return loadNext();
        });

    loadNext()
      .then(() => {
        renderLibraryDrill(
          '全部歌曲', `${total} 首曲目`, all,
          { pageSizes: LIB_PAGE_SIZES, pageKey: 'songTracks' }
        );
        libFadeIn();
        _addRefreshLibButton();
      })
      .catch(() => { if (!all.length) libError(renderLibraryTracks); });
  });
}

// 在“添加到播放列表”按钮旁插入“刷新媒体库”按钮
function _addRefreshLibButton() {
  const parent = $('#libAddToPlBtn')?.parentElement;
  if (!parent) return;

  const btn = document.createElement('button');
  btn.className = 'pl-btn';
  btn.innerHTML = `${icons.refresh}<span>刷新媒体库</span>`;
  parent.prepend(btn);

  btn.addEventListener('click', () => {
    fb.library.refresh().then(res => {
      if (!res.success) return CM.showToast('刷新失败', null, 'error');

      CM.showToast('媒体库已刷新', '正在重新加载歌曲列表', 'success');
      renderLibraryTracks();
    });
  });
}
/* 媒体库客户端分页（专辑/艺术家/流派共用）：全量拉取后按页渲染，页尺寸可切、页码记忆 */
const LIB_PAGE_SIZES = [50, 100, 300, 500];
function _libPageSize() {
  const n = parseInt(state.libPageSize, 10);
  return LIB_PAGE_SIZES.includes(n) ? n : 50;
}

// 媒体库浮动分页栏（sticky 吸顶）：标题+数量徽标 + 每页尺寸 + 上一页/页码/下一页
function _pagerBarHtml(prefix, title, total) {
  const pageSize = _libPageSize();
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
          <button class="lib-page-btn" id="${prefix}Prev" type="button">${icons.pre}<span>上一页</span></button>
          <span class="lib-page-info" id="${prefix}PageInfo"></span>
          <button class="lib-page-btn" id="${prefix}Next" type="button"><span>下一页</span>${icons.next}</button>
        </div>
      </div>
    </div>`;
}

function _bindPager(prefix, total, pageKey, onPage) {
  if (!state.libPages) state.libPages = {};

  let pageSize = _libPageSize();
  let page = state.libPages[pageKey] || 1;
  let totalPages = 1;

  const renderPage = (scrollTop) => {
    totalPages = Math.max(1, Math.ceil((total || 0) / pageSize));
    page = Math.min(Math.max(page, 1), totalPages);
    state.libPages[pageKey] = page;
    state.libPageSize = pageSize;

    onPage((page - 1) * pageSize, pageSize, page, totalPages);

    const info = $(`#${prefix}PageInfo`);
    if (info) info.textContent = `${page} / ${totalPages}`;

    const prev = $(`#${prefix}Prev`);
    const next = $(`#${prefix}Next`);
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= totalPages;

    if (scrollTop) els.libraryDetail.scrollTop = 0;
  };

  const sizeEl = $(`#${prefix}PageSize`);
  if (sizeEl) {
    sizeEl.addEventListener('change', () => {
      pageSize = parseInt(sizeEl.value, 10) || LIB_PAGE_SIZES[0];
      page = 1;
      renderPage(true);
    });
  }

  const prevBtn = $(`#${prefix}Prev`);
  const nextBtn = $(`#${prefix}Next`);
  if (prevBtn) prevBtn.addEventListener('click', () => {
    if (page > 1) { page--; renderPage(true); }
  });
  if (nextBtn) nextBtn.addEventListener('click', () => {
    if (page < totalPages) { page++; renderPage(true); }
  });

  renderPage(false);
}

function renderLibraryAlbums() {
  // 全量拉取专辑（解除 limit:200 上限），客户端分页渲染
  fb.library.getAlbums({ limit: 1000000 }).then(r => {
    if (!r) return libError(renderLibraryAlbums);

    const albums = r.albums || [];
    if (!albums.length) { els.libraryDetail.innerHTML = CM.emptyHTML('媒体库为空'); return; }

    els.libraryDetail.innerHTML = _pagerBarHtml('libAlbum', '全部专辑', albums.length) + '<div class="album-grid" id="libAlbumRows"></div>';

    _bindPager('libAlbum', albums.length, 'albums', (start, size) => {
      const box = $('#libAlbumRows');
      if (!box) return;

      const slice = albums.slice(start, start + size);
      box.innerHTML = slice.map(CM._renderAlbumCard).join('');

      // 异步批量加载封面：并行获取每张专辑首曲路径，再批量请求封面
      CM._loadAlbumCovers(box, slice, 320);
    });

    libFadeIn();
    _restoreLibScroll();
  });
}

function renderLibraryGenres() {
  _renderLibraryGrid(
    'library.getGenres', null, '全部流派', '暂无流派信息',
    (name, count) => `
        <div class="artist-card" data-genre="${esc(name)}">
          <div class="artist-avatar">♪</div>
          <div class="artist-name">${esc(name)}</div>
          ${count ? `<div class="artist-meta">${count} 首曲目</div>` : ''}
        </div>`,
    'genres'
  );
}

// 文件夹卡片渲染（根目录 + 子目录共用）
// root 结构: { id, displayName, absolutePath, trackCount }
// dir 结构:  { pathId, displayName/name, trackCount }（rootId 由调用方 parentRootId 传入）
function _renderFolderCard(folder, parentRootId) {
  const name = folder.displayName || folder.name || folder.title || folder.path || '未命名文件夹';
  const isRoot = folder.pathId === undefined && folder.id !== undefined;
  const rootId = (isRoot ? folder.id : parentRootId) || folder.rootId || '';
  const pathId = isRoot ? '' : folder.pathId || folder.path_id || '';
  const sub = folder.absolutePath || folder.path || folder.relativePath || '';

  return `<div class="artist-card folder-card" data-root-id="${esc(rootId)}" data-path-id="${esc(pathId)}" data-folder-name="${esc(name)}">
      <div class="artist-avatar">${icons.folder}</div>
      <div class="artist-name">${esc(name)}</div>
      ${sub ? `<div class="artist-meta">${esc(sub)}</div>` : ''}
    </div>`;
}

function _pushFolderTrail(rootId, pathId, name) {
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
      (lastPath ? pathId.indexOf(`${lastPath}/`) === 0 : !!pathId));

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
}

function _folderCrumbHtml() {
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
}

function _goFolderCrumb(index) {
  if (index <= 0) {
    state.libraryView = 'folders';
    state.libFolderTrail = [];
    CM.renderLibrary();
    return;
  }
  const trail = state.libFolderTrail || [];
  const target = trail[index - 1];
  if (!target) return;
  state.libFolderTrail = trail.slice(0, index);
  CM.openLibraryDetail('folder', { rootId: target.rootId, pathId: target.pathId || '' });
}

function _folderGoBack() {
  _goFolderCrumb((state.libFolderTrail || []).length - 1);
}

function _openLibraryFolder(rootId, pathId, name) {
  _pushFolderTrail(rootId, pathId, name);
  CM.openLibraryDetail('folder', { rootId: rootId || '', pathId: pathId || '' });
}

els.libraryDetail.addEventListener('click', e => {
  const crumb = e.target.closest('.lib-crumb');
  if (crumb) return _goFolderCrumb(+crumb.dataset.crumb || 0);

  const card = e.target.closest('.folder-card');
  if (card) {
    const { rootId, pathId, folderName } = card.dataset;
    _openLibraryFolder(rootId, pathId, folderName);
  }
});

// 文件夹视图：列出媒体库根目录
function renderLibraryFolders() {
  state.libraryBack = 'stats';
  fb.library.getRoots().then(r => {
    if (!r.success) return libError(renderLibraryFolders);

    const roots = r.roots || r.items || r.directories || [];
    if (!roots.length) {
      els.libraryDetail.innerHTML = CM.emptyHTML('媒体库未配置文件夹');
      return;
    }

    els.libraryDetail.innerHTML =
      `<div class="library-section-title" style="margin-top:0">媒体库文件夹（${roots.length}）</div>
        <div class="artist-grid">${roots.map(_renderFolderCard).join('')}</div>`;

    libFadeIn();
    _restoreLibScroll();
  });
}

// 文件夹详情：面包屑导航 + 子文件夹网格 + 分页曲目 + 播放全部/添加到歌单
function renderLibraryFolder(arg) {
  const rootId = arg.rootId || '';
  const pathId = arg.pathId || '';

  if (!state.libFolderTrail || !state.libFolderTrail.length)
    _pushFolderTrail(rootId, pathId, pathId ? pathId.split('/').pop() : '');

  state.libraryBack = 'folders';
  fb.library.browseTree({ rootId, pathId, includeFiles: true, recursiveFiles: false }).then(r => {
    if (!r.success) return libError(() => renderLibraryFolder(arg));

    const dirs = r.directories || r.dirs || [];
    const files = r.files || r.tracks || [];

    const trail = state.libFolderTrail || [];
    const title = (trail.length && trail.at(-1).name) || (pathId ? pathId.split('/').pop() : '文件夹');
    const crumb = _folderCrumbHtml();

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
      $('#libBackBtn').addEventListener('click', _folderGoBack);
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
         <div class="artist-grid">${dirs.map(d => _renderFolderCard(d, rootId)).join('')}</div>`
      : '';

    const stats = `${dirs.length} 个子文件夹 · ${files.length} 首曲目`;
    if (files.length) {
      renderLibraryDrill(
        title, stats, files,
        { extraHtml, pageSizes: LIB_PAGE_SIZES, pageKey: 'folder', onBack: _folderGoBack, titleHtml: crumb }
      );
    } else {
      els.libraryDetail.innerHTML = header(stats) + extraHtml;
      $('#libBackBtn').addEventListener('click', _folderGoBack);
    }

    libFadeIn();
  });
}

// 下钻详情通用：标题 + 播放全部 + 添加到歌单 + 曲目行
// opts.extraHtml: 标题与曲目之间的附加内容（如子文件夹网格）
// opts.pageSizes: 启用曲目分页；播放全部/添加到歌单始终使用完整 tracks
// opts.pageKey: 分页页码缓存键；opts.onBack: 自定义返回；opts.titleHtml: 自定义标题（如面包屑）
function renderLibraryDrill(title, subtitle, tracks, opts) {
  opts = opts || {};
  const paged = !!opts.pageSizes?.length;
  const extraHtml = opts.extraHtml || '';
  const titleInner = opts.titleHtml || esc(title);
  const html = `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
      <button class="retry-btn" id="libBackBtn">← 返回</button>
      <div>
        <div class="library-section-title" style="margin:0">${titleInner}</div>
        ${subtitle ? `<div style="font-size:11.5px;color:var(--text-3);margin-top:2px">${esc(subtitle)}</div>` : ''}
      </div>
      <div style="margin-left:auto;display:flex;gap:8px">
        <button class="pl-btn pl-btn-primary" id="libPlayAllBtn">${icons.play}<span>播放全部</span></button>
        <button class="pl-btn" id="libAddToPlBtn">${icons.plus}<span>添加到歌单</span></button>
      </div>
    </div>
    ${extraHtml}
    ${paged ? _pagerBarHtml('libDrill', typeof title === 'string' ? title : '曲目', tracks.length) : ''}
    <div class="dc-tracklist" id="libDrillRows"></div>`;
  els.libraryDetail.innerHTML = html;

  $('#libBackBtn').addEventListener('click', () => {
    if (opts.onBack) return opts.onBack();
    state.libraryView = state.libraryBack || 'artists';
    CM.renderLibrary();
  });

  $('#libPlayAllBtn').addEventListener('click', () => CM.playAllTracks(tracks, title));
  $('#libAddToPlBtn').addEventListener('click', e => CM.addToPlaylistMenu(tracks, e.clientX, e.clientY));

  if (paged) {
    _bindPager(
      'libDrill', tracks.length, opts.pageKey || 'drill',
      (start, size) => CM.renderTrackRows($('#libDrillRows'), tracks.slice(start, start + size), '未找到曲目', start)
    );
  } else {
    CM.renderTrackRows($('#libDrillRows'), tracks, '未找到曲目');
  }
}

// 通用下钻详情：设置 backView → loading → API → drill 渲染
// resultFilter/resultSorter：含引号标签走 ? 通配查询时，按原值客户端精确过滤并排序
function _renderLibraryDetail(backView, method, params, title, subtitleBuilder, retryFn, resultFilter, resultSorter) {
  state.libraryBack = backView;
  fb.invoke(method, params).then(r => {
    if (!r.success) return libError(retryFn);

    const tracks = CM.respTracks(r);
    if (resultFilter) tracks = tracks.filter(resultFilter);
    if (resultSorter) resultSorter(tracks);
    renderLibraryDrill(title, subtitleBuilder(tracks), tracks);
    libFadeIn();
  });
}

// 通配结果按碟号/音轨号排序，与 getAlbumTracks 行为一致
function sortByDiscTrack(tracks) {
  return tracks.sort((a, b) =>
    (a.discNumber || 0) - (b.discNumber || 0) || (a.trackNumber || 0) - (b.trackNumber || 0));
}

function renderLibraryArtistDetail(artist) {
  const sub = tracks => `${tracks.length} 首曲目`;
  const retry = () => renderLibraryArtistDetail(artist);

  // 艺术家名含引号：宿主 getArtistTracks 内部查询无法转义必然返回空，直接走 ? 通配查询
  const wild = artist.includes('"') ? CM.wildValue(artist) : null;

  if (wild) {
    _renderLibraryDetail(
      'artists', 'library.search',
      { query: `(artist IS "${wild}" OR albumartist IS "${wild}")`, limit: 500 },
      artist, sub, retry,
      t => t.artist === artist || t.albumArtist === artist
    );
    return;
  }

  _renderLibraryDetail('artists', 'library.getArtistTracks', { artist, limit: 500 }, artist, sub, retry);
}

function renderLibraryAlbumDetail(arg) {
  if (!arg) {
    state.libraryView = 'albums';
    CM.renderLibrary();
    return;
  }

  const sub = tracks => `${arg.artist ? `${arg.artist} · ` : ''}${tracks.length} 首曲目`;
  const retry = () => renderLibraryAlbumDetail(arg);

  // 专辑名或艺术家名含引号：宿主 getAlbumTracks 内部查询无法转义必然返回空，直接走 ? 通配查询
  const wild = arg.album.includes('"') ? CM.wildValue(arg.album) : null;
  const wildArtist = (arg.artist || '').includes('"') ? CM.wildValue(arg.artist) : null;

  if (wild || wildArtist) {
    let q = wild ? `album IS "${wild}"` : `album HAS "${arg.album}"`;
    const artist = wildArtist || arg.artist;
    if (artist) {
      const a = wildArtist || arg.artist;
      q += ` AND (artist IS "${a}" OR albumartist IS "${a}")`;
    }
    _renderLibraryDetail(
      'albums', 'library.search',
      { query: q, limit: 500 },
      arg.album, sub, retry,
      t => t.album === arg.album,
      sortByDiscTrack
    );
    return;
  }

  _renderLibraryDetail(
    'albums', 'library.getAlbumTracks',
    { album: arg.album, artist: arg.artist || undefined },
    arg.album, sub, retry
  );
}

function renderLibraryGenreDetail(genre) {
  const sub = tracks => `${tracks.length} 首曲目`;
  const retry = () => renderLibraryGenreDetail(genre);

  // 流派名含引号：查询无法转义，用 ? 通配替换 + 客户端精确过滤
  const wild = genre.includes('"') ? CM.wildValue(genre) : null;
  const query = wild ? `genre IS "${wild}"` : `genre HAS "${genre}"`;

  _renderLibraryDetail(
    'genres', 'library.search',
    { query, limit: 500 },
    genre, sub, retry,
    wild ? (t => t.genre === genre) : undefined
  );
}
