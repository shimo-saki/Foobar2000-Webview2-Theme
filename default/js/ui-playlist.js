/* ============================================
 * CloudMusic ui-playlist.js — 播放列表
 * 侧栏歌单列表 / 歌单详情曲目表格（差量渲染/排序/元数据预加载）
 * 曲目右键菜单 / JIT 无痕试听 / 添加到歌单 / 批量多选
 * ============================================ */

import { CM } from 'core';
import { fb } from 'foo-webview-sdk';
const { els, icons, state, esc } = CM;

/* ============================================
 * 侧栏歌单列表
 * ============================================ */
// 侧栏歌单列表事件委托（一次性绑定，避免每次 loadPlaylists 都逐个 attach）
els.playlistList.addEventListener('click', e => {
  const i = +e.target.closest('.pl-item')?.dataset.index;
  if (!isNaN(i)) openPlaylist(i);
});

els.playlistList.addEventListener('contextmenu', e => {
  const i = +e.target.closest('.pl-item')?.dataset.index;
  if (!isNaN(i)) showPlaylistCtxMenu(e.clientX, e.clientY, i);
});

CM.loadPlaylists = function () {
  return fb.playlist.getAll().then(r => {
    // 宿主直接返回数组 [{index,name,trackCount,isActive,isPlaying,...}]
    const lists = Array.isArray(r) ? r : (r?.playlists || []);
    CM.playlists = lists;

    // 预计算所有歌单项的 HTML 片段，避免循环内重复条件判断
    const parts = lists.map((pl, i) => {
      const idx = pl.index ?? i;
      let cls = 'pl-item';
      if (idx === state.currentPlaylistIndex) cls += ' active';
      if (idx === state.playingPlaylistIndex) cls += ' playing';

      const count = pl.trackCount ?? pl.itemCount ?? '';
      const badge = pl.isAutoplaylist ? '<span class="pl-auto-badge">AUTO</span>' : '';

      return `<button class="${cls}" data-index="${idx}" tooltip="${esc(pl.name)}" tooltip-pos="right">
          ${icons.note}
          <span class="pl-item-name">${esc(pl.name)}</span>
          ${badge}
          <span class="pl-item-count">${count}</span>
        </button>`;
    });

    els.playlistList.innerHTML = parts.length
      ? parts.join('')
      : '<div class="queue-empty" style="padding:24px">暂无歌单</div>';

    return lists;
  });
};

// 网络地址 → 歌单（弹出输入框 → 校验 → addPathsAsync）
CM.addUrlToPlaylist = function (playlistIdx) {
  CM.showModal({ title: '添加网络地址', input: '', desc: '输入音频流或文件 URL（http:// 或 https://）', okText: '添加' }).then(url => {
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) return CM.showToast('地址无效', '请以 http:// 或 https:// 开头', 'error');

    CM._addPaths(playlistIdx, [url], `正在添加${url.length > 50 ? `${url.slice(0, 50)}…` : url}`);
  });
};

// 本地文件 → 歌单（系统文件对话框）
const AUDIO_FILTERS = [
  { name: '音频文件', extensions: ['mp3', 'flac', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'mp4', 'ape', 'wv', 'tta', 'ac3', 'dts', 'dsf', 'dff', 'aiff', 'au'] },
  { name: '播放列表', extensions: ['cue', 'm3u', 'm3u8', 'pls', 'xspf'] }
];
CM.addFilesToPlaylist = function (playlistIdx) {
  fb.dialog.openFile({ title: '选择要添加的音频文件', multiple: true, filters: AUDIO_FILTERS }).then(r => {
    if (r.canceled) return;
    const paths = (r.filePaths || []).filter(Boolean);
    if (paths.length) CM._addPaths(playlistIdx, paths, `正在添加 ${paths.length} 个文件`);
  });
};

// 本地文件夹 → 歌单（系统文件夹对话框）
CM.addFolderToPlaylist = function (playlistIdx) {
  fb.dialog.openFolder({ title: '选择要添加的音乐文件夹' }).then(r => {
    if (r.canceled || !r.folderPath) return;
    // 宿主 addPathsAsync 不会展开文件夹，会把它当单音轨加入导致"格式不支持"，
    // 这里复用 expandPaths 递归枚举文件夹内的音频文件后再添加。
    CM.expandPaths([r.folderPath]).then(paths => {
      if (paths.length) CM._addPaths(playlistIdx, paths, `正在添加 ${paths.length} 个文件`);
    });
  });
};

// 统一路径添加（本地 / 文件夹 / 网络 / 拖拽共用）
CM._addPaths = function (playlistIdx, paths, okMsg) {
  fb.playlist.addAsync(playlistIdx >= 0 ? playlistIdx : null, paths).then(res => {
    if (res.success) CM.showToast(okMsg, null, 'success');
    else CM.showToast('添加失败', res?.error ?? '路径可能无效', 'error');
  });
};

function showPlaylistCtxMenu(x, y, idx) {
  const pl = CM.playlists?.find(p => p.index === idx) ?? {};
  // 自动歌单/锁定歌单（如默认「媒体库」）不接受手动编辑：禁用 添加/清空
  const items = [
    { label: pl.isAutoplaylist ? '自动播放列表' : pl.isLocked ? '锁定播放列表' : '普通播放列表', isLabel: true },
    {
      label: '播放', icon: icons.play,
      action: () => fb.playlist.playTrack(idx, 0)
    },
    { divider: true },
    { label: '添加到歌单', isLabel: true },
    {
      label: '添加本地文件', icon: icons.file, disabled: pl.isAutoplaylist,
      action: () => CM.addFilesToPlaylist(idx)
    },
    {
      label: '添加文件夹', icon: icons.addfolder, disabled: pl.isAutoplaylist,
      action: () => CM.addFolderToPlaylist(idx)
    },
    {
      label: '添加网络地址', icon: icons.plus, disabled: pl.isAutoplaylist,
      action: () => CM.addUrlToPlaylist(idx)
    },
    { divider: true },
    { label: '歌单操作', isLabel: true },
    {
      label: '复制歌单', icon: icons.copy,
      action: () => fb.playlist.duplicate(idx)
    },
    {
      label: '重命名', icon: icons.rename,
      action: () => CM.showModal({ title: '重命名歌单', input: pl.name || '', okText: '重命名' })
        .then(name => {
          if (!name) return;
          fb.playlist.rename(idx, name).then(r => { if (r.success) CM.showToast('已重命名', name, 'success'); });
        })
    },
    {
      label: '清空歌单', icon: icons.trash, disabled: pl.isAutoplaylist,
      action: () => CM.showModal({ title: '清空歌单', desc: `将移除「${pl.name || ''}」中的全部曲目，此操作不可撤销。`, okText: '清空', danger: true })
        .then(ok => { if (ok) fb.playlist.clear(idx); })
    },
    {
      label: '删除歌单', icon: icons.trash, danger: true,
      action: () => CM.showModal({ title: '删除歌单', desc: `确定删除「${pl.name || ''}」吗？此操作不可撤销。`, okText: '删除', danger: true })
        .then(ok => {
          if (!ok) return;
          fb.playlist.remove(idx).then(r => {
            if (!r.success) return CM.showToast('删除失败', null, 'error');
            CM.showToast('删除成功', pl.name, 'success');
            openPlaylist(0);
          });
        })
    },
  ];
  CM.showCtxMenu(x, y, items);
}

/* ============================================
 * 播放列表详情（曲目表格）
 * ============================================ */
function openPlaylist(idx) {
  state.currentPlaylistIndex = idx;
  state.sortKey = null;
  CM.switchTab('playlist'); // 进入播放列表标签会自行渲染该歌单
  CM.loadPlaylists();
}

let _playlistViewLoadId = 0;
CM.renderPlaylistView = function (idx) {
  const pl = (CM.playlists || []).find(p => p.index === idx) || {};
  els.playlistHeaderName.textContent = pl.name || '播放列表';
  els.playlistHeaderTag.textContent = pl.isAutoplaylist ? 'AUTOPLAYLIST' : 'PLAYLIST';

  // 记忆最近打开的歌单
  if (CM.settings.lastPlaylist !== (pl.name || '')) {
    CM.setSettings('lastPlaylist', pl.name || '');
  }

  const loadId = ++_playlistViewLoadId;
  fb.playlist.getTracks(idx, 0, 5000).then(tracks => {
    if (loadId !== _playlistViewLoadId) return;

    state.trackCache = tracks;
    state.playlistTracksTotal = tracks.length;
    const totalDur = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
    els.playlistHeaderMeta.textContent = `${state.playlistTracksTotal} 首曲目 · ${CM.formatTime(totalDur)}`;

    els.plCover.onerror = () => els.plCover.src = CM.DEFAULT_TRACK_COVER;
    els.plCover.style.display = '';
    // 封面处理
    if (tracks.length) {
      const i = state.playingPlaylistIndex === idx ? Math.max(state.playingTrackIndex, 0) : 0;
      fb.artwork.getFb2kUrlByPath(CM.trackPath(tracks[i]), 'front', { maxSize: 600 })
        .then(ar => {
          if (loadId !== _playlistViewLoadId) return;
          els.plCover.src = ar?.dataUrl ?? CM.DEFAULT_TRACK_COVER;
        });
    } else {
      els.plCover.src = CM.DEFAULT_TRACK_COVER;
    }

    CM.renderTrackTable();

    // 滚动到当前播放曲目
    CM.scrollToTrack(undefined, undefined, 'instant');
  });
};

// 播放列表表格事件
let rangeAnchor = null;
els.trackRows.addEventListener('click', e => {
  const row = e.target.closest('div[data-index]');
  if (!row) return;
  const idx = +row.dataset.index;

  const clearAll = () => {
    state.batchSelected.clear();
    els.trackRows.$$('div').forEach(r =>
      r.classList.remove('batch-selected', 'selected')
    );
  };

  // Ctrl/Cmd + Click
  if (e.ctrlKey || e.metaKey) {
    const isSelected = state.batchSelected.has(idx);
    state.batchSelected[isSelected ? 'delete' : 'add'](idx);
    row.classList.toggle('batch-selected', !isSelected);
    if (state.batchSelected.size > 0)
      els.trackRows.$$('div.selected')?.forEach(r => r.classList.remove('selected'));
    _updateBatchBar();
    return;
  }

  // Shift + Click
  if (e.shiftKey && rangeAnchor != null) {
    clearAll();
    const start = Math.min(rangeAnchor, idx);
    const end = Math.max(rangeAnchor, idx);
    for (let i = start; i <= end; i++) {
      state.batchSelected.add(i);
      els.trackRows.$(`div[data-index="${i}"]`)?.classList.add('batch-selected');
    }
    state.focusedTrackIndex = idx;
    _updateBatchBar();
    return;
  }

  // Click
  clearAll();
  row.classList.add('selected');
  state.focusedTrackIndex = idx;
  rangeAnchor = idx;
  _updateBatchBar();
});
els.trackRows.addEventListener('dblclick', e => {
  const row = e.target.closest('div[data-index]');
  if (!row) return;
  const idx = +row.dataset.index;
  fb.playlist.playTrack(state.currentPlaylistIndex, idx);
});
els.trackRows.addEventListener('contextmenu', e => {
  const row = e.target.closest('div[data-index]');
  if (!row) return;
  const idx = +row.dataset.index;
  state.focusedTrackIndex = idx;
  CM.showTrackCtxMenu(e.clientX, e.clientY, state.trackCache[idx], { playlist: state.currentPlaylistIndex, index: idx });
});

const pool = [];
function ensurePool(n) {
  while (pool.length < n) {
    const row = document.createElement('div');
    row.className = 'track-row hidden';
    row.innerHTML = '<span></span>'.repeat(6);
    els.trackRows.appendChild(row);
    pool.push(row);
  }
}

const EQ_HTML = '<span class="eq-bars"><i></i><i></i><i></i></span>';
const ROW_H = 35, HEADER_H = 40, BUFFER = 10;
let prevStart = -1, prevEnd = -1, prevPlayingIdx = -1;
CM.renderTrackTable = function () { // 虚拟列表渲染
  const { trackCache, playingTrackIndex, currentPlaylistIndex, playingPlaylistIndex } = state;
  const wrap = els.trackListWrap;
  const len = trackCache.length;

  els.trackEmpty.style.display = len ? 'none' : 'block';
  els.trackPhantom.style.height = `${len * ROW_H}px`;

  const viewportH = wrap.clientHeight;

  const start = Math.max(0, Math.floor((wrap.scrollTop - HEADER_H) / ROW_H) - BUFFER);
  const end = Math.min(len, Math.ceil((wrap.scrollTop + viewportH - HEADER_H) / ROW_H) + BUFFER);

  if (!(start !== prevStart || end !== prevEnd || playingTrackIndex !== prevPlayingIdx)) return;
  prevStart = start, prevEnd = end, prevPlayingIdx = playingTrackIndex;

  const showEq = currentPlaylistIndex === playingPlaylistIndex;
  const count = end - start;
  ensurePool(count);

  pool.forEach((row, i) => {
    row.classList.toggle('hidden', i >= count);
    if (i >= count) return;

    const index = start + i;
    const playing = index === playingTrackIndex;

    if (row.dataset.index !== String(index)) {
      row.dataset.index = index;
      const track = trackCache[index];
      [
        index + 1,
        esc(CM.trackName(track)),
        esc(CM.trackArtist(track)),
        esc(track.album || ''),
        CM.formatTime(track.duration),
        track.bitrate ? `${track.bitrate}k` : ''
      ].forEach((v, j) => row.children[j].textContent = v);
    }

    row.classList.toggle('playing', playing);
    row.children[0].innerHTML = playing && showEq ? EQ_HTML : String(index + 1);
  });
};

els.trackListWrap.style.setProperty('--row-h', `${ROW_H}px`);
els.trackListWrap.style.setProperty('--header-h', `${HEADER_H}px`);

els.trackListWrap.addEventListener('scroll', () => requestAnimationFrame(CM.renderTrackTable), { passive: true });

window.addEventListener('resize', () => {
  prevStart = prevEnd = -1;
  CM.renderTrackTable();
});

CM.scrollToTrack = function (index = state.playingTrackIndex, align = 'center', behavior = 'smooth') {
  const wrap = els.trackListWrap;
  const { clientHeight: h, scrollHeight, offsetTop } = wrap;
  const offset = { start: 0, center: (h - ROW_H) / 2, end: h - ROW_H }[align] ?? 0;
  const top = Math.max(0, Math.min(index * ROW_H - offset, scrollHeight - h) + offsetTop / 2);

  wrap.scrollTo({ top, behavior });
};

/* ============================================
 * 曲目右键菜单（通用）
 * track: 曲目对象；ctx: {playlist?, index?} 在播放列表内时可删除
 * ============================================ */
CM.showTrackCtxMenu = async function (x, y, track, ctx) {
  if (!track) return;
  const pl = (CM.playlists || []).find(p => p.index === ctx?.playlist) || {};
  const path = CM.trackPath(track);
  const selIdxs = _selectionIndices(ctx?.index);
  const topDelta = -selIdxs[0] || 0;
  const botDelta = (state.trackCache.length - selIdxs.at(-1) - 1) || 0;
  const items = [
    {
      label: '播放', icon: icons.play,
      action: () => {
        if (ctx?.playlist != null) {
          CM.stopPreviewIfActive().then(() => fb.playlist.playTrack(ctx.playlist, ctx.index));
        } else CM.playNow(path);
      }
    },
    {
      label: '试听', icon: icons.headphone, hidden: state.previewActive,
      action: () => previewTrack(track, path)
    },
    {
      label: '停止试听', icon: icons.headphone, danger: true, hidden: !state.previewActive,
      action: stopPreview
    },
    {
      label: '下一首播放', icon: icons.queue,
      action: () => (ctx?.playlist != null
        ? fb.queue.add({ playlist: ctx.playlist, tracks: [ctx.index] })
        : fb.queue.addPaths({ paths: [path] })
      ).then(r => {
        if (!r.success) return;
        CM.showToast('已加入播放队列', CM.trackName(track), 'success');
        CM.refreshQueueBadge();
      })
    },
    {
      label: '添加到歌单', icon: icons.plus,
      action: () => CM.showAddToPlaylistMenu(x, y, [path])
    },
    { divider: true },
    {
      label: '快捷查找', icon: icons.search,
      submenu: [
        {
          label: '相同标题', icon: icons.title, disabled: !track.title,
          action: () => fb.playlist.createAutoplaylist(`查找 - ${track.title}`, `%title% HAS ${track.title}`, '%artist% | %album% | %tracknumber%', true)
            .then(r => openPlaylist(r?.index ?? 0))
        },
        {
          label: '相同艺术家', icon: icons.group, disabled: !track.artist,
          submenu: track.artist?.split(', ').map(artist => ({
            label: artist, icon: icons.artist,
            action: () => fb.playlist.createAutoplaylist(`查找 - ${artist}`, `%artist% HAS ${artist}`, '%artist% | %album% | %tracknumber%', true)
              .then(r => openPlaylist(r?.index ?? 0))
          }))
        },
        {
          label: '相同专辑', icon: icons.album, disabled: !track.album,
          action: () => fb.playlist.createAutoplaylist(`查找 - ${track.album}`, `%album% HAS ${track.album}`, '%artist% | %album% | %tracknumber%', true)
            .then(r => openPlaylist(r?.index ?? 0))
        }
      ]
    },
    { divider: true },
    {
      label: '在资源管理器中显示', icon: icons.folder,
      action: () => fb.shell.showInExplorer(path)
    },
    {
      label: '编辑标签', icon: icons.tag,
      action: () => CM.showTagEditor(track)
    },
    {
      label: '在线获取标签', icon: icons.download, hidden: !CM.checkComponent('foo_freedb2'),
      action: () => CM.fetchTagsOnline(path)
    },
    { divider: true },
    {
      label: '从歌单中删除', icon: icons.trash, disabled: pl.isLocked, danger: true,
      action: () => fb.playlist.removeTracks(ctx.playlist, state.batchSelected.size ? [...state.batchSelected] : [ctx.index])
    },
    {
      label: '菜单选项',
      submenu: await getCtxMenu(),
    },
  ];
  CM.showCtxMenu(x, y, items);
};

async function getCtxMenu() {
  const { batchSelected, trackCache, focusedTrackIndex } = state;
  const handles = batchSelected.size
    ? trackCache.slice(Math.min(...batchSelected), Math.max(...batchSelected) + 1)
    : [trackCache.at(focusedTrackIndex)];

  const toItem = ({ type, label, commandId, children, enabled }) =>
    type === 'separator'
      ? { divider: true }
      : {
        label, disabled: !children && !enabled,
        action: children ? null : () => fb.menu.runContextCommandById(commandId, { mode: 'handles', handles }),
        submenu: children?.map(toItem),
      };

  const { items } = await fb.menu.getContextMenu({ mode: 'handles', handles });
  return items?.map(toItem);
}

/* ============================================
 * JIT 无痕试听（不改变播放列表）
 * ============================================ */
fb.on('jitQueue:listExhausted', () => state.previewActive = false);
fb.on('jitQueue:error', () => state.previewActive = false);
function previewTrack(track, path) {
  if (!path) return CM.showToast('无法试听', '未找到文件路径', 'error');
  const title = CM.trackName(track);
  fb.jitQueue.playNow({ title, trackId: path, url: path }).then(r => {
    if (!r.success) return CM.showToast('试听失败', r?.error ?? '当前曲目可能无法试听', 'error');
    state.previewActive = true;
    CM.showToast('正在试听', title, 'success');
  });
}

function stopPreview() {
  fb.jitQueue.stop().then(r => {
    if (!r.success) return;
    state.previewActive = false;
    CM.showToast('已停止试听');
  });
}

/* ============================================
 * 添加到歌单 — 弹出歌单选择菜单
 * paths: 要添加的文件路径数组
 * ============================================ */
CM.showAddToPlaylistMenu = function (x, y, paths) {
  if (!paths?.length) return;

  // 优先复用已缓存的歌单列表（loadPlaylists 已缓存至 CM.playlists），
  // 避免每次打开菜单都发起 playlist.getAll 请求；缓存为空时回退到 API
  const renderMenu = lists => {
    const items = [
      { label: `添加 ${paths.length} 首到歌单`, isLabel: true },
      ...lists.filter(pl => pl.index != null && !pl.isLocked && !pl.isAutoplaylist).map(pl => {
        const count = pl.trackCount || pl.itemCount;
        return {
          label: `${pl.name}${count ? ` (${count})` : ''}`,
          action: () => fb.playlist.addAsync(pl.index, paths).then(res => {
            if (!res.success) return CM.showToast('添加失败', res?.error || '歌单可能被锁定', 'error');
            CM.showToast('已添加', `${paths.length} 首到「${pl.name}」`, 'success');
          })
        };
      }),
      { divider: true },
      {
        label: '新建歌单并添加',
        icon: icons.plus,
        action: async () => {
          const name = await CM.showModal({ title: '新建歌单', input: '', okText: '创建并添加' });
          if (!name) return;
          const res = await fb.playlist.create(name);
          if (!res.success) return CM.showToast('创建失败', '无法创建歌单', 'error');
          await fb.playlist.addAsync(res.index, paths);
          CM.showToast('已创建并添加', `${name} · ${paths.length} 首`, 'success');
        }
      }
    ];
    CM.showCtxMenu(x, y, items);
  };

  if (CM.playlists?.length) renderMenu(CM.playlists);
  else fb.playlist.getAll().then(r => renderMenu(r));
};

/* ============================================
 * 批量选择
 * ============================================ */
CM.clearBatchSelection = function () {
  state.batchSelected.clear();
  els.trackRows.$$('div.batch-selected').forEach(div => div.classList.remove('batch-selected'));
  _updateBatchBar();
};

// 获取当前播放列表被选中曲目的索引列表，按升序排列
function _selectionIndices(anchorIdx) {
  const set = state.batchSelected;
  if (set.size < 2 || !set.has(anchorIdx)) return [anchorIdx];
  return Array.from(set).sort((a, b) => a - b);
}

function _updateBatchBar() {
  const count = state.batchSelected.size;
  els.batchBarCount.textContent = count;
  els.batchBar.classList.toggle('hidden', count < 2);
}

// 批量编辑入口（从 batch bar 触发）
CM._batchEditFromBar = function () {
  if (state.batchSelected.size < 2) return;
  const tracks = Array.from(state.batchSelected, idx => state.trackCache[idx]).filter(Boolean);
  if (tracks.length >= 2) CM.showBatchTagEditor(tracks);
};

// 批量删除入口（从 batch bar 触发）：把整组选中曲目从当前歌单移除
CM._batchDeleteFromBar = function () {
  const n = state.batchSelected.size;
  if (n < 2) return;
  fb.playlist.removeTracks(state.currentPlaylistIndex, [...state.batchSelected])
    .then(r => { if (r.success) CM.showToast(`已从歌单删除 ${n} 首曲目`, null, 'success'); });
};
