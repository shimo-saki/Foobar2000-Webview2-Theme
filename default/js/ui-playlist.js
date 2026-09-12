/* ============================================
 * CloudMusic ui-playlist.js — 播放列表
 * 侧栏歌单列表 / 歌单详情曲目表格（差量渲染/排序/元数据预加载）
 * 曲目右键菜单 / JIT 无痕试听 / 添加到歌单 / 批量多选
 * ============================================ */

(function() {
  'use strict';
  var CM = window.CloudMusic;
  var els = CM.els, state = CM.state, esc = CM.escHtml;

  /* ============================================
   * 侧栏歌单列表
   * ============================================ */
  // 侧栏歌单列表事件委托（一次性绑定，避免每次 loadPlaylists 都逐个 attach）
  function ensurePlaylistDelegation() {
    CM.runOnce('playlistDelegation', function() {
      els.playlistList.addEventListener('click', function(e) {
        var el = e.target.closest('.pl-item');
        if (!el) return;
        CM.openPlaylist(parseInt(el.dataset.index, 10));
      });
      els.playlistList.addEventListener('contextmenu', function(e) {
        var el = e.target.closest('.pl-item');
        if (!el) return;
        e.preventDefault();
        CM.showPlaylistCtxMenu(e.clientX, e.clientY, parseInt(el.dataset.index, 10));
      });
    });
  }

  CM.loadPlaylists = function() {
    return CM.api('playlist.getAll').then(function(r) {
      // 宿主直接返回数组 [{index,name,trackCount,isActive,isPlaying,...}]
      var lists = Array.isArray(r) ? r : ((r && r.playlists) || []);
      CM.playlists = lists;
      // 预计算所有歌单项的 HTML 片段，避免循环内重复条件判断
      var parts = lists.map(function(pl, i) {
        var idx = pl.index !== undefined ? pl.index : i;
        var cls = 'pl-item';
        if (idx === state.currentPlaylistIndex) cls += ' active';
        if (idx === state.playingPlaylistIndex) cls += ' playing';
        var count = pl.trackCount != null ? pl.trackCount : (pl.itemCount != null ? pl.itemCount : '');
        return `<div class="${cls}" data-index="${idx}">
          ${CM.icons.note}
          <span class="pl-item-name">${esc(pl.name)}</span>
          ${pl.isAutoplaylist ? '<span class="pl-auto-badge">AUTO</span>' : ''}
          <span class="pl-item-count">${count}</span>
        </div>`;
      });
      els.playlistList.innerHTML = parts.length ? parts.join('') : '<div class="queue-empty" style="padding:24px">暂无歌单</div>';
      ensurePlaylistDelegation();
      return lists;
    });
  };

  // 网络地址 → 歌单（弹出输入框 → 校验 → addPathsAsync）
  CM.addUrlToPlaylist = function(playlistIdx) {
    CM.showModal({
      title: '添加网络地址',
      input: '',
      desc: '输入音频流或文件 URL（http:// 或 https://）',
      okText: '添加'
    }).then(function(url) {
      if (!url) return;
      if (!/^https?:\/\//i.test(url)) {
        CM.showToast('地址无效', '请以 http:// 或 https:// 开头', 'error');
        return;
      }
      CM._addPaths(playlistIdx, [url], '正在添加' + (url.length > 50 ? url.slice(0, 50) + '…' : url));
    });
  };

  // 本地文件 → 歌单（系统文件对话框）
  var AUDIO_FILTERS = [
    { name: '音频文件', extensions: ['mp3', 'flac', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'mp4', 'ape', 'wv', 'tta', 'ac3', 'dts', 'dsf', 'dff', 'aiff', 'au'] },
    { name: '播放列表', extensions: ['cue', 'm3u', 'm3u8', 'pls', 'xspf'] }
  ];
  CM.addFilesToPlaylist = function(playlistIdx) {
    CM.api('dialog.openFile', { title: '选择要添加的音频文件', multiple: true, filters: AUDIO_FILTERS }).then(function(r) {
      if (!r || r.canceled) return;
      var paths = (r.filePaths || []).filter(Boolean);
      if (paths.length) CM._addPaths(playlistIdx, paths, `正在添加 ${paths.length} 个文件`);
    });
  };

  // 本地文件夹 → 歌单（系统文件夹对话框）
  CM.addFolderToPlaylist = function(playlistIdx) {
    CM.api('dialog.openFolder', { title: '选择要添加的音乐文件夹' }).then(function(r) {
      if (!r || r.canceled || !r.folderPath) return;
      // 宿主 addPathsAsync 不会展开文件夹，会把它当单音轨加入导致"格式不支持"，
      // 这里复用 expandDroppedPaths 递归枚举文件夹内的音频文件后再添加。
      CM.expandDroppedPaths([r.folderPath]).then(function(paths) {
        if (!paths.length) return;
        CM._addPaths(playlistIdx, paths, `正在添加 ${paths.length} 个文件`);
      });
    });
  };

  // 统一路径添加（本地/文件夹/网络共用）
  CM._addPaths = function(playlistIdx, paths, okMsg) {
    var params = { paths };
    if (playlistIdx !== undefined && playlistIdx >= 0) params.playlist = playlistIdx;
    CM.api('playlist.addPathsAsync', params).then(function (res) {
      if (res?.success !== false) CM.showToast(okMsg, null, 'success');
      else CM.showToast('添加失败', res?.error ?? '路径可能无效', 'error');
    });
  };

  CM.showPlaylistCtxMenu = function(x, y, idx) {
    const pl = CM.playlists?.find(p => p.index === idx) ?? {};
    // 自动歌单/锁定歌单（如默认「媒体库」）不接受手动编辑：禁用 添加/清空
    const items = [
      { label: pl.isAutoplaylist ? '自动播放列表' : pl.isLocked ? '锁定播放列表' : '普通播放列表', isLabel: true },
      {
        label: '播放', icon: CM.icons.play,
        action: () => CM.api('playlist.playTrack', { playlist: idx, index: 0 })
      },
      { divider: true },
      { label: '添加到歌单', isLabel: true },
      {
        label: '添加本地文件', icon: CM.icons.file, disabled: pl.isAutoplaylist,
        action: () => CM.addFolderToPlaylist(idx)
      },
      {
        label: '添加文件夹', icon: CM.icons.addfolder, disabled: pl.isAutoplaylist,
        action: () => CM.addFolderToPlaylist(idx)
      },
      {
        label: '添加网络地址', icon: CM.icons.plus, disabled: pl.isAutoplaylist,
        action: () => CM.addUrlToPlaylist(idx)
      },
      { divider: true },
      { label: '歌单操作', isLabel: true },
      {
        label: '复制歌单', icon: CM.icons.copy,
        action: () => CM.api('playlist.duplicate', { playlist: idx })
      },
      {
        label: '重命名', icon: CM.icons.rename,
        action: () => CM.showModal({ title: '重命名歌单', input: pl.name || '', okText: '重命名' })
          .then(name => CM.api('playlist.rename', { playlist: idx, name })
            .then(r => { if (r?.success) CM.showToast('已重命名', name, 'success'); })
          )
      },
      {
        label: '清空歌单', icon: CM.icons.trash, disabled: pl.isAutoplaylist,
        action: () => CM.showModal({ title: '清空歌单', desc: `将移除「${pl.name || ''}」中的全部曲目，此操作不可撤销。`, okText: '清空', danger: true })
          .then(ok => { if (ok) CM.api('playlist.clear', { playlist: idx }); })
      },
      {
        label: '删除歌单', icon: CM.icons.trash, danger: true,
        action: () => CM.showModal({ title: '删除歌单', desc: `确定删除「${pl.name || ''}」吗？此操作不可撤销。`, okText: '删除', danger: true })
          .then(ok => {
            if (!ok) return;
            CM.api('playlist.remove', { playlist: idx }).then(r => {
              if (r?.success === false) return CM.showToast('删除失败', r?.error || '未知错误', 'error');
              CM.showToast('删除成功', pl.name, 'success');
              CM.openPlaylist(0);
            });
          })
      },
    ];
    CM.showCtxMenu(x, y, items);
  };

  /* ============================================
   * 播放列表详情（曲目表格）
   * ============================================ */
  CM.openPlaylist = function(idx) {
    state.currentPlaylistIndex = idx;
    state.sortKey = null;
    CM.switchTab('playlist'); // 进入播放列表标签会自行渲染该歌单
    CM.loadPlaylists();
  };

  CM._playlistViewLoadId = 0;
  CM.renderPlaylistView = function (idx) {
    const pl = (CM.playlists || []).find(p => p.index === idx) || {};
    els.playlistHeaderName.textContent = pl.name || '播放列表';
    els.playlistHeaderTag.textContent = pl.isAutoplaylist ? 'AUTOPLAYLIST' : 'PLAYLIST';

    // 记忆最近打开的歌单
    if (CM.settings.lastPlaylist !== (pl.name || '')) {
      CM.settings.lastPlaylist = pl.name || '';
      CM.saveSettings();
    }

    const loadId = ++CM._playlistViewLoadId;
    const cancelLoading = CM.delayedLoading(() => {
      if (loadId === CM._playlistViewLoadId) {
        els.trackTbody.innerHTML = `<tr><td colspan="6"><div class="table-loading"><div class="spinner"></div>加载中...</div></td></tr>`;
      }
    });

    CM.api('playlist.getTracks', { playlist: idx, start: 0, count: 5000 }).then(r => {
      cancelLoading();
      if (loadId !== CM._playlistViewLoadId) return;

      if (!r) {
        els.trackTbody.innerHTML = '<tr><td colspan="6"><div class="table-error">加载失败</div></td></tr>';
        return;
      }

      const tracks = CM.respTracks(r);
      state.trackCache = tracks;
      state.playlistTracksTotal = r.total ?? tracks.length;
      const totalDur = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
      els.playlistHeaderMeta.textContent = `${state.playlistTracksTotal} 首曲目 · ${CM.formatTime(totalDur)}`;

      // 封面处理
      if (tracks.length) {
        CM.api('artwork.getFb2kUrlByPath', { path: CM.trackPath(tracks[Math.max(state.playingTrackIndex, 0)]), type: 'front', maxSize: 300 })
          .then(ar => {
            if (loadId !== CM._playlistViewLoadId) return;
            const hasCover = ar?.dataUrl && ar.available !== false;
            els.plCover.onerror = hasCover ? () => { els.plCover.onerror = null; els.plCover.src = CM.DEFAULT_TRACK_COVER; } : null;
            els.plCover.src = hasCover ? ar.dataUrl : CM.DEFAULT_TRACK_COVER;
            els.plCover.style.display = '';
          });
      } else {
        els.plCover.onerror = null;
        els.plCover.src = CM.DEFAULT_TRACK_COVER;
        els.plCover.style.display = '';
      }

      CM.renderTrackTable();
      CM.preloadTrackMetadata(tracks);

      // 滚动到当前播放曲目
      els.trackTbody.querySelector(`tr[data-index="${state.playingTrackIndex}"]`)?.scrollIntoView({ block: 'center' });
    });
  };

  // 大写键名（readBatch）→ 小写键名（playlist.getTracks）映射
  var META_TAG_MAP = {
    ARTIST: 'artist', ALBUM: 'album', 'ALBUM ARTIST': 'albumArtist',
    TITLE: 'title', GENRE: 'genre', DATE: 'date'
  };
  var META_INT_TAGS = { TRACKNUMBER: 'trackNumber', DISCNUMBER: 'discNumber' };

  // 批量预加载缺失元数据（foobar2000 延迟加载：异步添加文件时不立即读取标签）
  // 增量更新：无排序时只更新变化的行，避免全量重渲染闪烁；有排序时防抖重渲染
  var _metaRenderTimer = null;
  CM.preloadTrackMetadata = function(tracks) {
    if (!tracks || !tracks.length) return;
    const missing = tracks
      .map((track, idx) => ({ idx, path: CM.trackPath(track), track }))
      .filter(({ track, path }) => path && !track.artist && !track.album && !track.albumArtist)
    if (!missing.length) return;

    const currentCache = state.trackCache;   // 捕获当前歌单引用，防止切换后污染
    const BATCH = 50;

    const applyMeta = (tags, track, mapping, transform) => {
      let changed = false;
      for (const [up, lo] of Object.entries(mapping)) {
        if (tags[up] && track[lo] == null) {
          track[lo] = transform ? transform(tags[up]) : tags[up];
          changed = true;
        }
      }
      return changed;
    };

    // 分片
    Array.from(
      { length: Math.ceil(missing.length / BATCH) },
      (_, i) => missing.slice(i * BATCH, (i + 1) * BATCH)
    ).forEach(batch => {
      CM.api('metadata.readBatch', { paths: batch.map(track => track.path) }).then(({ results }) => {
        if (!results || state.trackCache !== currentCache) return; // 歌单已切换，放弃写入

        // 主逻辑
        const changedIdxs = results.flatMap((res, i) => {
          const track = state.trackCache[batch[i].idx];
          if (!res.success || !res.tags || !track) return [];

          const tags = res.tags;
          const changed1 = applyMeta(tags, track, META_TAG_MAP)
          const changed2 = applyMeta(tags, track, META_INT_TAGS, v => +v || 0);

          return changed1 || changed2 ? [batch[i].idx] : [];
        });

        if (!changedIdxs.length) return;

        // 有变更时触发重渲染
        if (state.sortKey) {
          clearTimeout(_metaRenderTimer);
          _metaRenderTimer = setTimeout(CM.renderTrackTable, 100);
        } else {
          CM._updateTrackRows(changedIdxs);
        }
      });
    });
  };

  // 增量更新表格行（仅更新指定索引的单元格内容，不重建整个表格）
  CM._updateTrackRows = function(idxs) {
    idxs.forEach(idx => {
      const tr = els.trackTbody.querySelector(`tr[data-index="${idx}"]`);
      if (!tr) return;
      const track = state.trackCache[idx];
      if (!track) return;

      const cells = tr.children;
      // cells[0]=track-num, [1]=title, [2]=artist, [3]=album, [4]=duration, [5]=bitrate
      if (cells[1]) cells[1].textContent = CM.trackName(track);
      if (cells[2]) cells[2].textContent = CM.trackArtist(track);
      if (cells[3]) cells[3].textContent = track.album || '';
    });
  };

  // 播放列表表格事件
  var _sortHeaders = null; // 缓存排序表头单元格
  let rangeAnchor = null;
  els.trackTbody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-index]');
    if (!tr) return;
    const idx = +tr.dataset.index;

    const clearAll = () => {
      state.batchSelected.clear();
      els.trackTbody.querySelectorAll('tr').forEach(r =>
        r.classList.remove('batch-selected', 'selected')
      );
    };

    // Ctrl/Cmd + Click
    if (e.ctrlKey || e.metaKey) {
      const isSelected = state.batchSelected.has(idx);
      state.batchSelected[isSelected ? 'delete' : 'add'](idx);
      tr.classList.toggle('batch-selected', !isSelected);
      if (state.batchSelected.size > 0)
        els.trackTbody.querySelector('tr.selected')?.classList.remove('selected');
      CM._updateBatchBar();
      return;
    }

    // Shift + Click
    if (e.shiftKey && rangeAnchor != null) {
      clearAll();
      const start = Math.min(rangeAnchor, idx);
      const end = Math.max(rangeAnchor, idx);
      for (let i = start; i <= end; i++) {
        state.batchSelected.add(i);
        els.trackTbody.querySelector(`tr[data-index="${i}"]`)?.classList.add('batch-selected');
      }
      state.focusedTrackIndex = idx;
      CM._updateBatchBar();
      return;
    }

    // Click
    clearAll();
    tr.classList.add('selected');
    state.focusedTrackIndex = idx;
    rangeAnchor = idx;
    CM._updateBatchBar();
  });
  els.trackTbody.addEventListener('dblclick', (e) => {
    const tr = e.target.closest('tr[data-index]');
    if (!tr) return;
    const idx = +tr.dataset.index;
    CM.api('playlist.playTrack', { playlist: state.currentPlaylistIndex, index: idx });
  });
  els.trackTbody.addEventListener('contextmenu', (e) => {
    const tr = e.target.closest('tr[data-index]');
    if (!tr) return;
    e.preventDefault();
    const idx = +tr.dataset.index;
    state.focusedTrackIndex = idx;
    CM.showTrackCtxMenu(e.clientX, e.clientY, state.trackCache[idx], { playlist: state.currentPlaylistIndex, index: idx });
  });

  /* ============================================
   * 播放列表曲目调序（右键菜单 / Alt+↑↓ 快捷键）
   * 宿主侧：playlist.moveTracks({ playlist, items, delta }) — 按增量移动（负上正下）
   * 宿主完成后 playlist:itemsReordered 事件会自动刷新视图（见 app.js）
   * 注：不提供表格行拖拽 — 会与"拖入外部文件导入歌单"的全局 drop 冲突
   * ============================================ */
  // 歌单是否允许手动排序（自动歌单/锁定歌单不可编辑）
  CM.canReorderPlaylist = function(playlistIdx) {
    const idx = playlistIdx ?? state.currentPlaylistIndex;
    if (idx < 0) return false;
    const pl = CM.playlists?.find(p => p.index === idx) ?? {};
    return !(pl.isAutoplaylist || pl.isLocked);
  };
  // 参与移动的索引集合：多选集含锚点时返回排序后的整个选择集，否则仅锚点
  CM._selectionIndices = function(anchorIdx) {
    const set = state.batchSelected;
    if (set.size < 2 || !set.has(anchorIdx)) return [anchorIdx];
    return Array.from(set).sort((a, b) => a - b);
  };
  // moveTracks 包装：校验可编辑性，统一错误提示；msg=[title, sub] 时成功后弹 toast
  CM.movePlaylistTracks = function(indices, delta, msg) {
    var idx = state.currentPlaylistIndex;
    if (idx < 0 || !indices?.length || !delta) return Promise.resolve(null);
    if (!CM.canReorderPlaylist(idx)) {
      CM.showToast('无法调整顺序', '该歌单为锁定或自动播放列表', 'error');
      return Promise.resolve(null);
    }
    if (state.sortKey) {
      CM.showToast('无法调整顺序', '请先点击已排序的表头取消排序', 'error');
      return Promise.resolve(null);
    }
    return CM.api('playlist.moveTracks', { playlist: idx, items: indices, delta: delta }).then(function(r) {
      if (r?.success !== true) {
        CM.showToast('移动失败', r?.error ?? '请稍后重试', 'error');
        return null;
      }
      if (msg) CM.showToast(...msg, 'success');
      return r;
    });
  };
  // 快捷键移动：批量选择优先，否则移动聚焦行；焦点随移动跟随
  CM.keyboardMoveTracks = function(delta) {
    if (state.currentTab !== 'playlist' || state.currentPlaylistIndex < 0 || !state.trackCache.length) return;

    let indices, anchor;
    if (state.batchSelected.size > 0) {
      // 焦点跟随移动方向的前缘：上移取最顶行，下移取最底行
      indices = CM._selectionIndices(state.batchSelected.values().next().value);
      anchor = delta < 0 ? indices[0] : indices[indices.length - 1];
    } else if (state.focusedPlaylistIndex === state.currentPlaylistIndex && state.focusedTrackIndex >= 0) {
      // 聚焦索引仅在录制时的歌单内有效，且需钳制在当前曲目数内
      anchor = Math.min(state.focusedTrackIndex, state.trackCache.length - 1);
      indices = [anchor];
    } else return;

    if (!CM.canReorderPlaylist() || state.sortKey) {
      CM.movePlaylistTracks(indices, delta); // 走统一提示
      return;
    }

    // 本地计算新焦点，异步执行移动后更新状态
    const n = state.trackCache.length;
    const newFocus = Math.max(0, Math.min(n - 1, anchor + delta));
    CM.movePlaylistTracks(indices, delta).then(r => {
      if (r) {
        state.focusedTrackIndex = newFocus;
        state.focusedPlaylistIndex = state.currentPlaylistIndex;
      }
    });
  };
  CM.renderTrackTable = function () {
    // 清除旧引用与批量选择状态
    CM._lastPlayingTr = null;
    if (state.batchSelected.size) {
      state.batchSelected.clear();
      CM._updateBatchBar();
    }

    const tracks = state.trackCache.slice();
    const viewIndex = Array.from({ length: tracks.length }, (_, i) => i);
    const hasSort = state.sortKey && state.sortKey.length;

    // 客户端排序
    if (hasSort) {
      const key = state.sortKey, asc = state.sortAsc ? 1 : -1;
      viewIndex.sort((a, b) => {
        const va = tracks[a][key], vb = tracks[b][key];
        if (key === 'duration' || key === 'bitrate') {
          return ((va || 0) - (vb || 0)) * asc;
        }
        return String(va || '').localeCompare(String(vb || ''), 'zh-CN') * asc;
      });
    }

    // 更新表头排序箭头
    if (!_sortHeaders) _sortHeaders = els.trackTable.querySelectorAll('thead th[data-sort]');
    _sortHeaders.forEach(th => {
      const arrow = th.querySelector('.sort-arrow');
      if (th.dataset.sort === state.sortKey) {
        th.classList.add('sorted');
        arrow.textContent = state.sortAsc ? '▲' : '▼';
      } else {
        th.classList.remove('sorted');
        arrow.textContent = '';
      }
    });

    // 空状态处理
    if (!tracks.length) {
      els.trackTbody.innerHTML = `
        <tr><td colspan="6">
          <div class="table-empty">这个歌单还没有曲目<br>
            <span style="font-size:11.5px;opacity:0.7">拖放音频文件到窗口即可添加</span>
          </div>
        </td></tr>`;
      return;
    }

    const isPlayingList = state.currentPlaylistIndex === state.playingPlaylistIndex;
    const EQ_HTML = '<span class="eq-bars"><i></i><i></i><i></i></span>';

    // 预转义曲目字段，避免循环内重复调用 esc()
    const escTracks = tracks.map(t => ({
      name: esc(CM.trackName(t)),
      artist: esc(CM.trackArtist(t)),
      album: esc(t.album || ''),
      duration: CM.formatTime(t.duration),
      bitrate: t.bitrate ? t.bitrate + 'k' : ''
    }));

    // 收集现有可复用行（仅差量渲染产生的行附带 _rowSig）
    const tbody = els.trackTbody;
    const oldByIdx = {};
    for (const tr of tbody.children) {
      if (tr._rowSig != null) oldByIdx[tr.dataset.index] = tr;
    }

    const frag = document.createDocumentFragment();

    viewIndex.forEach((realIdx, row) => {
      const track = escTracks[realIdx];
      const playing = isPlayingList && realIdx === state.playingTrackIndex;

      // 行签名 除行号外的全部渲染输入（行号在复用时单独更新）
      const sig = [ realIdx, playing ? 1 : 0, track.name, track.artist, track.album, track.duration, track.bitrate].join('|');

      let tr = oldByIdx[realIdx];
      if (tr && tr._rowSig === sig) {
        // 复用行 清除可能残留的类名
        tr.classList.remove('batch-selected', 'selected');
        const numCell = tr.children[0];
        if (playing) {
          if (!numCell.querySelector('.eq-bars')) numCell.innerHTML = EQ_HTML;
        } else if (numCell.textContent !== String(row + 1)) {
          numCell.textContent = row + 1;
        }
      } else {
        // 新建行
        tr = document.createElement('tr');
        if (playing) tr.className = 'playing';
        tr.setAttribute('data-index', realIdx);
        tr._rowSig = sig;
        tr.innerHTML = `
          <td class="track-num">${playing ? EQ_HTML : row + 1}</td>
          <td class="track-title">${track.name}</td>
          <td class="track-artist-cell">${track.artist}</td>
          <td class="track-artist-cell">${track.album}</td>
          <td class="track-duration">${track.duration}</td>
          <td class="track-bitrate">${track.bitrate}</td>`;
      }

      // 记录正在播放的行
      if (playing) CM._lastPlayingTr = tr;
      frag.appendChild(tr); // 复用节点为 move 操作
    });

    tbody.replaceChildren(frag);
  };

  // // 标记表格/发现页/搜索中的"正在播放"行
  // // 只更新变化的行（旧播放行 → 恢复序号，新播放行 → 显示均衡器），避免全表扫描
  CM.refreshPlayingMarks = function () {
    const isPlayingList = state.currentPlaylistIndex === state.playingPlaylistIndex;

    // 清除旧的播放行
    const tr = CM._lastPlayingTr;
    if (tr?.parentNode) {
      tr.classList.remove('playing');
      const num = tr.querySelector('.track-num');
      if (num?.querySelector('.eq-bars')) num.textContent = String(tr.sectionRowIndex + 1);
      CM._lastPlayingTr = null;
    }

    // 设置新的播放行
    if (isPlayingList && state.playingTrackIndex >= 0) {
      const tr = els.trackTbody.querySelector(`tr[data-index="${state.playingTrackIndex}"]`);
      if (tr) {
        tr.classList.add('playing');
        tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
        tr.querySelector('.track-num').innerHTML = '<span class="eq-bars"><i></i><i></i><i></i></span>';
        CM._lastPlayingTr = tr;
      }
    }

    // 清除旧的 playing 标记
    if (CM._lastPlayingDc?.parentNode) {
      CM._lastPlayingDc.classList.remove('playing');
      CM._lastPlayingDc = null;
    }

    // 设置新的 playing 标记
    const curPath = CM.trackPath(CM.currentTrack);
    if (!curPath) return;

    const node = Array.from(els.mainContent.querySelectorAll('.dc-track, .search-result-item'))
      .find(n => n.dataset.path === curPath);

    if (node) {
      node.classList.add('playing');
      CM._lastPlayingDc = node;
    }
  };

  let foo_run_submenu = [];
  fb2k.invoke('menu.getContextMenu').then(res =>
    foo_run_submenu = res.items.find(item => item.label === '运行服务')?.children
  )

  /* ============================================
   * 曲目右键菜单（通用）
   * track: 曲目对象；ctx: {playlist?, index?} 在播放列表内时可删除
   * ============================================ */
  CM.showTrackCtxMenu = function (x, y, track, ctx) {
    if (!track) return;
    const pl = (CM.playlists || []).find(p => p.index === ctx?.playlist) || {};
    const path = CM.trackPath(track);
    const selIdxs = CM._selectionIndices(ctx?.index);
    const topDelta = -selIdxs[0] || 0;
    const botDelta = (state.trackCache.length - selIdxs.at(-1) - 1) || 0;
    const hidden = !CM.checkComponent('foo_run');
    const items = [
      {
        label: '跳转到当前播放', icon: CM.icons.position, disabled: !CM.currentTrack || ctx?.playlist !== state.playingPlaylistIndex,
        action: () => els.trackTbody.querySelector(`tr[data-index="${state.playingTrackIndex}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      },
      {
        label: '播放', icon: CM.icons.play,
        action: () => {
          if (ctx?.playlist != null) {
            CM.stopPreviewIfActive().then(() => CM.api('playlist.playTrack', { playlist: ctx.playlist, index: ctx.index }));
          } else CM.playNow(path);
        }
      },
      {
        label: '试听', icon: CM.icons.headphone, hidden: CM.state.previewActive,
        action: () => CM.previewTrack(track, path)
      },
      {
        label: '停止试听', icon: CM.icons.headphone, danger: true, hidden: !CM.state.previewActive,
        action: () => CM.stopPreview()
      },
      {
        label: '下一首播放', icon: CM.icons.queue,
        action: () => (ctx?.playlist != null
          ? CM.api('queue.add', { playlist: ctx.playlist, tracks: [ctx.index] })
          : CM.api('queue.addPaths', { paths: [path] })
        ).then(r => {
          if (r?.success !== false) {
            CM.showToast('已加入播放队列', CM.trackName(track), 'success');
            CM.refreshQueueBadge();
          }
        })
      },
      {
        label: '添加到歌单', icon: CM.icons.plus,
        action: () => CM.showAddToPlaylistMenu(x, y, [path])
      },
      {
        label: '属性', icon: CM.icons.console,
        action: async () => {
          const handles = [state.trackCache.at(state.focusedTrackIndex)?.absolutePath];
          const res = await fb2k.invoke('menu.getContextMenu', { mode: 'handles', handles });
          const id = res?.items?.find(i => i.label === '属性')?.commandId;
          await fb2k.invoke('menu.runContextCommandById', { id, mode: 'handles', handles });
        }
      },
      { divider: true },
      {
        label: '快捷查找', icon: CM.icons.search,
        submenu: [
          {
            label: '相同标题', icon: CM.icons.title ,disabled: !track.title,
            action: () => fb2k.invoke('playlist.createAutoplaylist', { name: `查找 - ${track.title}`, query: `%title% HAS ${track.title}` })
              .then(r => CM.openPlaylist(r?.index ?? 0))
          },
          {
            label: '相同艺术家', icon: CM.icons.group ,disabled: !track.artist,
            submenu: track.artist?.split(', ').map(artist => ({
              label: artist,icon: CM.icons.artist ,
              action: () => fb2k.invoke('playlist.createAutoplaylist', { name: `查找 - ${artist}`, query: `%artist% HAS ${artist}` })
              .then(r => CM.openPlaylist(r?.index ?? 0))
            }))
          },
          {
            label: '相同专辑', icon: CM.icons.album ,disabled: !track.album,
            action: () => fb2k.invoke('playlist.createAutoplaylist', { name: `查找 - ${track.album}`, query: `%album% HAS ${track.album}` })
            .then(r => CM.openPlaylist(r?.index ?? 0))
          }
        ]
      },
      { divider: true },
      {
        label: '在资源管理器中显示', icon: CM.icons.folder,
        action: () => CM.api('shell.showInExplorer', { path })
      },
      {
        label: '编辑标签', icon: CM.icons.tag,
        action: () => CM.showTagEditor(track)
      },
      {
        label: '在线获取标签', icon: CM.icons.download, hidden: !CM.checkComponent('foo_freedb2'),
        action: () => CM.fetchTagsOnline(path)
      },
      { divider: true, hidden },
      {
        label: '运行服务', hidden,
        submenu: foo_run_submenu.map(item => ({
          label: item.label,
          action: async () => await fb2k.invoke('menu.runContextCommandById', { id: item.commandId, mode: 'selection' })
        }))
      },
      { divider: true },
      {
        label: '调整顺序', icon: CM.icons.sort,
        submenu: [
          {
            label: '上移', icon: CM.icons.up, disabled: pl.isLocked || topDelta === 0,
            action: () => CM.movePlaylistTracks(selIdxs, -1)
          },
          {
            label: "下移", icon: CM.icons.down, disabled: pl.isLocked || botDelta === 0,
            action: () => CM.movePlaylistTracks(selIdxs, 1)
          },
          {
            label: "移到顶部", icon: CM.icons.toTop, disabled: pl.isLocked || topDelta === 0,
            action: () => CM.movePlaylistTracks(selIdxs, topDelta, ['已移到顶部', selIdxs.length > 1 ? `${selIdxs.length} 首曲目` : CM.trackName(track)])
          },
          {
            label: "移到底部", icon: CM.icons.toBottom, disabled: pl.isLocked || botDelta === 0,
            action: () => CM.movePlaylistTracks(selIdxs, botDelta, ['已移到底部', selIdxs.length > 1 ? `${selIdxs.length} 首曲目` : CM.trackName(track)])
          },
        ]
       },
      { divider: true },
      {
        label: '从歌单中删除', icon: CM.icons.trash, disabled: pl.isLocked, danger: true,
        action: () => CM.api('playlist.removeTracks', { playlist: ctx.playlist, items: state.batchSelected.size ? [...state.batchSelected] : [ctx.index] })
      }
    ];
    CM.showCtxMenu(x, y, items);
  };

  /* ============================================
   * JIT 无痕试听（不改变播放列表）
   * ============================================ */
  CM.previewTrack = function(track, path) {
    if (!path) { return CM.showToast('无法试听', '未找到文件路径', 'error'); }
    if (!CM._previewBound) {
      CM._previewBound = true;
      fb.on('jitQueue:listExhausted', function() { CM.state.previewActive = false; });
      fb.on('jitQueue:error', function() { CM.state.previewActive = false; });
    }
    var title = CM.trackName(track);
    CM.api('jitQueue.playNow', { title, trackId: path, url: path }).then(function(r) {
      if (r && r.success !== false) {
        CM.state.previewActive = true;
        CM.showToast('正在试听', title, 'success');
      } else {
        CM.showToast('试听失败', r && r.error ? r.error : '当前曲目可能无法试听', 'error');
      }
    });
  };
  CM.stopPreview = function() {
    CM.api('jitQueue.stop').then(function(r) {
      if (r && r.success !== false) {
        CM.state.previewActive = false;
        CM.showToast('已停止试听');
      }
    });
  };

  /* ============================================
   * 添加到歌单 — 弹出歌单选择菜单
   * paths: 要添加的文件路径数组
   * ============================================ */
  CM.showAddToPlaylistMenu = function(x, y, paths) {
    if (!paths || !paths.length) return;
    // 优先复用已缓存的歌单列表（loadPlaylists 已缓存至 CM.playlists），
    // 避免每次打开菜单都发起 playlist.getAll 请求；缓存为空时回退到 API
    var renderMenu = function(lists) {
      var items = [
        { label: `添加 ${paths.length} 首到歌单`, isLabel: true },
        ...lists.filter(pl => pl.index != null && !pl.isLocked && !pl.isAutoplaylist)
          .map(pl => ({
              label: `${pl.name}${(pl.trackCount || pl.itemCount) ? ` (${pl.trackCount || pl.itemCount})` : ''}`,
              action: () => CM.api('playlist.addPathsAsync', { playlist: pl.index, paths })
                .then(res => {
                  if (res?.success !== false) CM.showToast('已添加', `${paths.length} 首到「${pl.name}」`, 'success');
                  else CM.showToast('添加失败', res?.error || '歌单可能被锁定', 'error');
                })
          })),
        { divider: true },
        {
          label: '新建歌单并添加', icon: CM.icons.plus,
          action: () => CM.showModal({ title: '新建歌单', input: '', okText: '创建并添加' })
            .then(async name => {
              if (!name) return;
              // 使用 await 减少回调层级
              const res = await fb2k.invoke('playlist.create', { name });
              if (res?.success !== false) {
                await fb2k.invoke('playlist.addPathsAsync', { playlist: cr.index, paths });
                CM.showToast('已创建并添加', `${name} · ${paths.length} 首`, 'success');
              } else CM.showToast('创建失败', '无法创建歌单', 'error');
            })
        }
      ];
      CM.showCtxMenu(x, y, items);
    };
    if (CM.playlists && CM.playlists.length) {
      renderMenu(CM.playlists);
    } else {
      CM.api('playlist.getAll').then(function(r) {
        renderMenu(Array.isArray(r) ? r : ((r && r.playlists) || []));
      });
    }
  };

  /* ============================================
   * 批量选择
   * ============================================ */
  CM.clearBatchSelection = function() {
    state.batchSelected.clear();
    els.trackTbody.querySelectorAll('tr.batch-selected').forEach(tr => tr.classList.remove('batch-selected'));
    CM._updateBatchBar();
  };

  CM._updateBatchBar = () => {
    const count = state.batchSelected.size;
    els.batchBarCount.textContent = count;
    els.batchBar.classList.toggle('hidden', count < 2);
  };

  // 批量编辑入口（从 batch bar 触发）
  CM._batchEditFromBar = () => {
    if (state.batchSelected.size < 2) return;
    const tracks = Array.from(state.batchSelected, idx => state.trackCache[idx]).filter(Boolean);
    if (tracks.length >= 2) CM.showBatchTagEditor(tracks);
  };
})();
