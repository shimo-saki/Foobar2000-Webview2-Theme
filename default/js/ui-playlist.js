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
        return '<div class="' + cls + '" data-index="' + idx + '">' +
          CM.icons.note +
          '<span class="pl-item-name">' + esc(pl.name) + '</span>' +
          (pl.isAutoplaylist ? '<span class="pl-auto-badge">AUTO</span>' : '') +
          '<span class="pl-item-count">' + count + '</span>' +
          '</div>';
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
      if (paths.length) CM._addPaths(playlistIdx, paths, '正在添加 ' + paths.length + ' 个文件');
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
        CM._addPaths(playlistIdx, paths, '正在添加 ' + paths.length + ' 个文件');
      });
    });
  };

  // 统一路径添加（本地/文件夹/网络共用）
  CM._addPaths = function(playlistIdx, paths, okMsg) {
    var params = { paths: paths };
    if (playlistIdx !== undefined && playlistIdx >= 0) params.playlist = playlistIdx;
    CM.api('playlist.addPathsAsync', params).then(function(res) {
      if (res && res.success !== false) CM.showToast(okMsg, null, 'success');
      else CM.showToast('添加失败', res && res.error ? res.error : '路径可能无效', 'error');
    });
  };

  CM.showPlaylistCtxMenu = function(x, y, idx) {
    var pl = (CM.playlists || []).find(function(p) { return p.index === idx; }) || {};
    // 自动歌单/锁定歌单（如默认「媒体库」）不接受手动编辑：隐藏 添加/重命名/清空/删除
    var editable = !pl.isAutoplaylist && !pl.isLocked;
    var items = [
      { label: '播放', icon: CM.icons.play, action: function() {
        CM.api('playlist.playTrack', { playlist: idx, index: 0 });
      } }
    ];
    if (editable) {
      items.push({ isLabel: true, label: '添加到歌单' });
      items.push({ label: '添加本地文件', icon: CM.icons.folder, action: function() {
        CM.addFilesToPlaylist(idx);
      } });
      items.push({ label: '添加文件夹', icon: CM.icons.folder, action: function() {
        CM.addFolderToPlaylist(idx);
      } });
      items.push({ label: '添加网络地址', icon: CM.icons.plus, action: function() {
        CM.addUrlToPlaylist(idx);
      } });
      items.push({ label: '重命名', icon: CM.icons.edit, action: function() {
        CM.showModal({ title: '重命名歌单', input: pl.name || '', okText: '重命名' }).then(function(name) {
          if (!name) return;
          CM.api('playlist.rename', { playlist: idx, name: name }).then(function(r) {
            if (r && r.success) CM.showToast('已重命名', name, 'success');
          });
        });
      } });
      items.push({ divider: true });
      items.push({ label: '清空歌单', icon: CM.icons.trash, action: function() {
        CM.showModal({ title: '清空歌单', desc: '将移除「' + (pl.name || '') + '」中的全部曲目，此操作不可撤销。', okText: '清空', danger: true }).then(function(ok) {
          if (ok) CM.api('playlist.clear', { playlist: idx });
        });
      } });
      items.push({ label: '删除歌单', icon: CM.icons.trash, danger: true, action: function() {
        CM.showModal({ title: '删除歌单', desc: '确定删除「' + (pl.name || '') + '」吗？此操作不可撤销。', okText: '删除', danger: true }).then(function(ok) {
          if (ok) CM.api('playlist.remove', { playlist: idx });
        });
      } });
    } else {
      items.push({ isLabel: true, label: pl.isAutoplaylist ? '自动播放列表' : '锁定播放列表' });
    }
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
  CM.renderPlaylistView = function(idx) {
    var pl = (CM.playlists || []).find(function(p) { return p.index === idx; }) || {};
    els.playlistHeaderName.textContent = pl.name || '播放列表';
    els.playlistHeaderTag.textContent = pl.isAutoplaylist ? 'AUTOPLAYLIST' : 'PLAYLIST';
    // 记忆最近打开的歌单（按名称持久化，启动时据此自动恢复上次听歌的歌单）
    if (CM.settings.lastPlaylist !== (pl.name || '')) {
      CM.settings.lastPlaylist = pl.name || '';
      CM.saveSettings();
    }

    var loadId = ++CM._playlistViewLoadId;
    // 延迟加载指示器：API 快速返回（<150ms）时不闪烁，保留旧表格内容
    var cancelLoading = CM.delayedLoading(function() {
      if (loadId !== CM._playlistViewLoadId) return;
      els.trackTbody.innerHTML = '<tr><td colspan="6"><div class="table-loading"><div class="spinner"></div>加载中...</div></td></tr>';
    });

    CM.api('playlist.getTracks', { playlist: idx, start: 0, count: 5000 }).then(function(r) {
      if (loadId !== CM._playlistViewLoadId) { cancelLoading(); return; }
      cancelLoading();
      if (!r || r.success === false) {
        els.trackTbody.innerHTML = '<tr><td colspan="6"><div class="table-error">加载失败</div></td></tr>';
        return;
      }
      var tracks = CM.respTracks(r);
      state.trackCache = tracks;
      state.playlistTracksTotal = r.total != null ? r.total : tracks.length;
      var totalDur = 0;
      tracks.forEach(function(t) { totalDur += t.duration || 0; });
      els.playlistHeaderMeta.textContent = state.playlistTracksTotal + ' 首曲目 · ' + CM.formatTime(totalDur);
      // 歌单封面取第一首歌；无封面或空歌单回退占位图
      if (tracks.length) {
        CM.api('artwork.getFb2kUrlByPath', { path: CM.trackPath(tracks[0]), type: 'front', maxSize: 300 }).then(function(ar) {
          if (loadId !== CM._playlistViewLoadId) return;
          els.plCover.onerror = ar && ar.dataUrl && ar.available !== false
            ? function() { els.plCover.onerror = null; els.plCover.src = CM.DEFAULT_TRACK_COVER; els.plCover.style.display = ''; }
            : null;
          els.plCover.src = (ar && ar.dataUrl && ar.available !== false) ? ar.dataUrl : CM.DEFAULT_TRACK_COVER;
          els.plCover.style.display = '';
        });
      } else {
        els.plCover.onerror = null;
        els.plCover.src = CM.DEFAULT_TRACK_COVER;
        els.plCover.style.display = '';
      }
      CM.renderTrackTable();
      // 预加载缺失元数据（foobar2000 延迟加载机制：异步添加文件时不立即读取标签）
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
    var missing = [];
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      if (!t.artist && !t.album && !t.albumArtist) {
        var p = CM.trackPath(t);
        if (p) missing.push({ idx: i, path: p });
      }
    }
    if (!missing.length) return;

    var currentCache = state.trackCache; // 捕获当前引用，防止快速切歌后写入错误歌单
    var BATCH = 50;
    for (var b = 0; b < missing.length; b += BATCH) {
      (function(batch) {
        var paths = batch.map(function(m) { return m.path; });
        CM.api('metadata.readBatch', { paths: paths }).then(function(r) {
          if (!r || r.success === false || !r.results) return;
          if (state.trackCache !== currentCache) return; // 歌单已切换，放弃写入
          var changedIdxs = [];
          r.results.forEach(function(res, ri) {
            if (!res.success || !res.tags) return;
            var t = state.trackCache[batch[ri].idx];
            if (!t) return;
            var tags = res.tags, changed = false;
            for (var up in META_TAG_MAP) {
              var lo = META_TAG_MAP[up];
              if (tags[up] && !t[lo]) { t[lo] = tags[up]; changed = true; }
            }
            for (var up in META_INT_TAGS) {
              var lo = META_INT_TAGS[up];
              if (tags[up] && t[lo] == null) { t[lo] = parseInt(tags[up], 10) || 0; changed = true; }
            }
            if (changed) changedIdxs.push(batch[ri].idx);
          });
          if (!changedIdxs.length) return;
          if (state.sortKey) {
            // 排序模式下防抖全量重渲染（多批合并为一次）
            clearTimeout(_metaRenderTimer);
            _metaRenderTimer = setTimeout(CM.renderTrackTable, 100);
          } else {
            CM._updateTrackRows(changedIdxs);
          }
        });
      })(missing.slice(b, b + BATCH));
    }
  };

  // 增量更新表格行（仅更新指定索引的单元格内容，不重建整个表格）
  CM._updateTrackRows = function(idxs) {
    idxs.forEach(function(idx) {
      var tr = els.trackTbody.querySelector('tr[data-index="' + idx + '"]');
      if (!tr) return;
      var t = state.trackCache[idx];
      if (!t) return;
      var cells = tr.children;
      // cells[0]=track-num, [1]=title, [2]=artist, [3]=album, [4]=duration, [5]=bitrate
      if (cells[1]) cells[1].textContent = CM.trackName(t);
      if (cells[2]) cells[2].textContent = CM.trackArtist(t);
      if (cells[3]) cells[3].textContent = t.album || '';
    });
  };

  // 播放列表表格事件委托（一次性绑定，避免每次渲染都逐行 attach N 个监听器）
  var _sortHeaders = null; // 缓存排序表头单元格
  function ensureTrackTableDelegation() {
    CM.runOnce('trackTableDelegation', function() {
    els.trackTbody.addEventListener('click', function(e) {
      var tr = e.target.closest('tr[data-index]');
      if (!tr) return;
      var realIdx = parseInt(tr.dataset.index, 10);
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+click：批量多选
        if (state.batchSelected.has(realIdx)) {
          state.batchSelected.delete(realIdx);
          tr.classList.remove('batch-selected');
        } else {
          state.batchSelected.add(realIdx);
          tr.classList.add('batch-selected');
        }
        CM._updateBatchBar();
      } else {
        // 普通点击：清除多选，单选高亮，并记录聚焦行（Alt+↑/↓ 移动用）
        if (state.batchSelected.size > 0) CM.clearBatchSelection();
        var sel = els.trackTbody.querySelector('tr.selected');
        if (sel) sel.classList.remove('selected');
        tr.classList.add('selected');
        state.focusedTrackIndex = realIdx;
        state.focusedPlaylistIndex = state.currentPlaylistIndex;
      }
    });
    els.trackTbody.addEventListener('dblclick', function(e) {
      var tr = e.target.closest('tr[data-index]');
      if (!tr) return;
      CM.api('playlist.playTrack', { playlist: state.currentPlaylistIndex, index: parseInt(tr.dataset.index, 10) });
    });
    els.trackTbody.addEventListener('contextmenu', function(e) {
      var tr = e.target.closest('tr[data-index]');
      if (!tr) return;
      e.preventDefault();
      var realIdx = parseInt(tr.dataset.index, 10);
      CM.showTrackCtxMenu(e.clientX, e.clientY, state.trackCache[realIdx], {
        playlist: state.currentPlaylistIndex, index: realIdx
      });
    });
    });
  }

  /* ============================================
   * 播放列表曲目调序（右键菜单 / Alt+↑↓ 快捷键）
   * 宿主侧：playlist.moveTracks({ playlist, items, delta }) — 按增量移动（负上正下）
   * 宿主完成后 playlist:itemsReordered 事件会自动刷新视图（见 app.js）
   * 注：不提供表格行拖拽 — 会与"拖入外部文件导入歌单"的全局 drop 冲突
   * ============================================ */
  // 歌单是否允许手动排序（自动歌单/锁定歌单不可编辑）
  CM.canReorderPlaylist = function(playlistIdx) {
    var idx = playlistIdx != null ? playlistIdx : state.currentPlaylistIndex;
    if (idx < 0) return false;
    var pl = (CM.playlists || []).find(function(p) { return p.index === idx; }) || {};
    return !pl.isAutoplaylist && !pl.isLocked;
  };
  // 参与移动的索引集合：多选集含锚点时返回排序后的整个选择集，否则仅锚点
  CM._selectionIndices = function(anchorIdx) {
    if (state.batchSelected.size >= 2 && state.batchSelected.has(anchorIdx)) {
      var arr = [];
      state.batchSelected.forEach(function(i) { arr.push(i); });
      return arr.sort(function(a, b) { return a - b; });
    }
    return [anchorIdx];
  };
  // moveTracks 包装：校验可编辑性，统一错误提示；msg=[title, sub] 时成功后弹 toast
  CM.movePlaylistTracks = function(indices, delta, msg) {
    var idx = state.currentPlaylistIndex;
    if (idx < 0 || !indices || !indices.length || !delta) return Promise.resolve(null);
    if (!CM.canReorderPlaylist(idx)) {
      CM.showToast('无法调整顺序', '该歌单为锁定或自动播放列表', 'error');
      return Promise.resolve(null);
    }
    if (state.sortKey) {
      CM.showToast('无法调整顺序', '请先点击已排序的表头取消排序', 'error');
      return Promise.resolve(null);
    }
    return CM.api('playlist.moveTracks', { playlist: idx, items: indices, delta: delta }).then(function(r) {
      if (!r || r.success === false) {
        CM.showToast('移动失败', (r && r.error) ? r.error : '请稍后重试', 'error');
        return null;
      }
      if (msg) CM.showToast(msg[0], msg[1] || null, 'success');
      return r;
    });
  };
  // 快捷键移动：批量选择优先，否则移动聚焦行；焦点随移动跟随
  CM.keyboardMoveTracks = function(delta) {
    if (state.currentTab !== 'playlist' || state.currentPlaylistIndex < 0) return;
    if (!state.trackCache.length) return;
    var indices, anchor;
    if (state.batchSelected.size > 0) {
      indices = CM._selectionIndices(state.batchSelected.values().next().value);
      // 焦点跟随移动方向的前缘：上移取最顶行，下移取最底行
      anchor = delta < 0 ? indices[0] : indices[indices.length - 1];
    } else if (state.focusedPlaylistIndex === state.currentPlaylistIndex && state.focusedTrackIndex >= 0) {
      // 聚焦索引仅在录制时的歌单内有效，且需钳制在当前曲目数内
      anchor = Math.min(state.focusedTrackIndex, state.trackCache.length - 1);
      indices = [anchor];
    } else {
      return;
    }
    if (!CM.canReorderPlaylist() || state.sortKey) {
      CM.movePlaylistTracks(indices, delta); // 走统一提示
      return;
    }
    var n = state.trackCache.length;
    // 先本地重映射焦点，保证长按连按时目标跟随（宿主事件随后会完整刷新）
    var newFocus = Math.max(0, Math.min(n - 1, anchor + delta));
    CM.movePlaylistTracks(indices, delta).then(function(r) {
      if (r) {
        state.focusedTrackIndex = newFocus;
        state.focusedPlaylistIndex = state.currentPlaylistIndex;
      }
    });
  };
  CM.renderTrackTable = function() {
    CM._lastPlayingTr = null; // 清除旧引用（innerHTML 替换后旧 DOM 已分离）
    // 清除批量选择（表格重建后旧索引失效）
    if (state.batchSelected.size > 0) {
      state.batchSelected.clear();
      CM._updateBatchBar();
    }
    var tracks = state.trackCache.slice();
    // 客户端排序视图（不改动实际播放列表顺序）
    var viewIndex = tracks.map(function(_, i) { return i; });
    if (state.sortKey) {
      var key = state.sortKey, asc = state.sortAsc ? 1 : -1;
      viewIndex.sort(function(a, b) {
        var va = tracks[a][key], vb = tracks[b][key];
        if (key === 'duration' || key === 'bitrate') {
          return ((va || 0) - (vb || 0)) * asc;
        }
        return String(va || '').localeCompare(String(vb || ''), 'zh-CN') * asc;
      });
    }
    // 排序箭头（缓存表头单元格，避免每次渲染都 querySelectorAll）
    if (!_sortHeaders) _sortHeaders = els.trackTable.querySelectorAll('thead th[data-sort]');
    _sortHeaders.forEach(function(th) {
      var arrow = th.querySelector('.sort-arrow');
      if (th.dataset.sort === state.sortKey) {
        th.classList.add('sorted');
        arrow.textContent = state.sortAsc ? '▲' : '▼';
      } else {
        th.classList.remove('sorted');
        arrow.textContent = '';
      }
    });

    if (!tracks.length) {
      els.trackTbody.innerHTML = '<tr><td colspan="6"><div class="table-empty">这个歌单还没有曲目<br><span style="font-size:11.5px;opacity:0.7">拖放音频文件到窗口即可添加</span></div></td></tr>';
      return;
    }

    var isPlayingList = state.currentPlaylistIndex === state.playingPlaylistIndex;
    // 预转义曲目字段，避免循环内重复调用 esc()
    var escTracks = tracks.map(function(t) {
      return {
        name: esc(CM.trackName(t)),
        artist: esc(CM.trackArtist(t)),
        album: esc(t.album || ''),
        duration: CM.formatTime(t.duration),
        bitrate: t.bitrate ? t.bitrate + 'k' : ''
      };
    });
    // —— keyed 差量渲染：按 data-index 复用内容未变的行节点 ——
    // 全量 innerHTML 重写时 N 行 = N 行 HTML 解析 + 全表重排；差量仅重建签名变化的行，
    // 纯排序场景 0 次 HTML 解析（仅节点移动 + 行号 textContent 更新）
    var EQ_HTML = '<span class="eq-bars"><i></i><i></i><i></i></span>';
    var tbody = els.trackTbody;
    // 收集现有可复用行（仅差量渲染产生的行带 _rowSig；empty/loading 行无此标记自动失配）
    var oldByIdx = {};
    for (var ci = 0; ci < tbody.children.length; ci++) {
      var ctr = tbody.children[ci];
      if (ctr._rowSig != null) oldByIdx[ctr.dataset.index] = ctr;
    }
    var frag = document.createDocumentFragment();
    viewIndex.forEach(function(realIdx, row) {
      var t = escTracks[realIdx];
      var playing = isPlayingList && realIdx === state.playingTrackIndex;
      // 行签名 = 除行号外的全部渲染输入（行号在复用时单独更新；签名不含 refreshPlayingMarks
      // 命令式改动的 playing 态——该改动会使签名失配触发单行重建，结果自愈为正确状态）
      var sig = realIdx + '|' + (playing ? 1 : 0) + '|' + t.name + '|' + t.artist + '|' + t.album + '|' + t.duration + '|' + t.bitrate;
      var tr = oldByIdx[realIdx];
      if (tr && tr._rowSig === sig) {
        // 复用：与全量重建行为一致地清除选择态（入口已 clear batchSelected）
        if (tr.classList.contains('batch-selected') || tr.classList.contains('selected')) {
          tr.classList.remove('batch-selected', 'selected');
        }
        var numCell = tr.children[0];
        if (playing) { if (!numCell.querySelector('.eq-bars')) numCell.innerHTML = EQ_HTML; }
        else if (numCell.textContent !== String(row + 1)) numCell.textContent = row + 1;
      } else {
        tr = document.createElement('tr');
        if (playing) tr.className = 'playing';
        tr.setAttribute('data-index', realIdx);
        tr._rowSig = sig;
        tr.innerHTML =
          '<td class="track-num">' + (playing ? EQ_HTML : (row + 1)) + '</td>' +
          '<td class="track-title">' + t.name + '</td>' +
          '<td class="track-artist-cell">' + t.artist + '</td>' +
          '<td class="track-artist-cell">' + t.album + '</td>' +
          '<td class="track-duration">' + t.duration + '</td>' +
          '<td class="track-bitrate">' + t.bitrate + '</td>';
      }
      // 登记播放行，供 refreshPlayingMarks 切换时清除，避免残留导致两行同时高亮
      if (playing) CM._lastPlayingTr = tr;
      frag.appendChild(tr); // 复用节点为 move 操作，不触发 HTML 解析
    });
    tbody.textContent = ''; // 移除未被复用的旧行（已复用的行已移入 frag）
    tbody.appendChild(frag);
    ensureTrackTableDelegation();
  };

  // 标记表格/发现页/搜索中的"正在播放"行
  // 只更新变化的行（旧播放行 → 恢复序号，新播放行 → 显示均衡器），避免全表扫描
  CM._lastPlayingTr = null;
  CM._lastPlayingDc = null; // 上一次标记为 playing 的 dc-track/search-result-item
  CM.refreshPlayingMarks = function() {
    var isPlayingList = state.currentPlaylistIndex === state.playingPlaylistIndex;
    // 清除旧的播放行
    if (CM._lastPlayingTr && CM._lastPlayingTr.parentNode) {
      CM._lastPlayingTr.classList.remove('playing');
      var oldNum = CM._lastPlayingTr.querySelector('.track-num');
      if (oldNum && oldNum.querySelector('.eq-bars')) {
        oldNum.textContent = String(CM._lastPlayingTr.sectionRowIndex + 1);
      }
      CM._lastPlayingTr = null;
    }
    // 设置新的播放行
    if (isPlayingList && state.playingTrackIndex >= 0) {
      var tr = els.trackTbody.querySelector('tr[data-index="' + state.playingTrackIndex + '"]');
      if (tr) {
        tr.classList.add('playing');
        // 自动滚动到当前播放项
        tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
        var numCell = tr.querySelector('.track-num');
        if (numCell) numCell.innerHTML = '<span class="eq-bars"><i></i><i></i><i></i></span>';
        CM._lastPlayingTr = tr;
      }
    }
    // dc-track / search-result-item：只更新变化的元素，避免每次都全量扫描 mainContent
    var curPath = CM.trackPath(CM.currentTrack);
    // 清除旧的 playing 标记
    if (CM._lastPlayingDc && CM._lastPlayingDc.parentNode) {
      CM._lastPlayingDc.classList.remove('playing');
      CM._lastPlayingDc = null;
    }
    // 设置新的 playing 标记：逐项比较 dataset.path（属性选择器在下划线/引号等特殊路径下会失效）
    if (curPath) {
      var _nodes = els.mainContent.querySelectorAll('.dc-track, .search-result-item');
      for (var _ni = 0; _ni < _nodes.length; _ni++) {
        if (_nodes[_ni].dataset.path === curPath) {
          _nodes[_ni].classList.add('playing');
          CM._lastPlayingDc = _nodes[_ni];
          break;
        }
      }
    }
  };

  /* ============================================
   * 曲目右键菜单（通用）
   * track: 曲目对象；ctx: {playlist?, index?} 在播放列表内时可删除
   * ============================================ */
  CM.showTrackCtxMenu = function(x, y, track, ctx) {
    if (!track) return;
    var path = CM.trackPath(track);
    var items = [
      { label: '跳转到当前播放', action: () =>
          els.trackTbody.querySelector(`tr[data-index="${state.playingTrackIndex}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      },
      { label: '播放', icon: CM.icons.play, action: function() {
        if (ctx && ctx.playlist != null) {
          CM.stopPreviewIfActive().then(function() {
            CM.api('playlist.playTrack', { playlist: ctx.playlist, index: ctx.index });
          });
        } else {
          CM.playNow(path);
        }
      } },
      { label: '试听（不加入歌单）', action: function() {
        CM.previewTrack(track, path);
      } },
      { label: '下一首播放', icon: CM.icons.queue, action: function() {
        // queue.add 接受 tracks 数组（不是 index）
        var p = (ctx && ctx.playlist != null)
          ? CM.api('queue.add', { playlist: ctx.playlist, tracks: [ctx.index] })
          : CM.api('queue.addPaths', { paths: [path] });
        p.then(function(r) {
          if (r && r.success !== false) { CM.showToast('已加入播放队列', CM.trackName(track), 'success'); CM.refreshQueueBadge(); }
        });
      } },
      { label: '添加到歌单', icon: CM.icons.plus, action: function() {
        CM.showAddToPlaylistMenu(x, y, [path]);
      } },
      { divider: true },
      { isLabel: true, label: '评分' }
    ];
    // 星级评分行
    for (var s = 5; s >= 1; s--) {
      (function(stars) {
        items.push({
          html: '<span class="ctx-stars">' + '★'.repeat(stars) + '<span style="opacity:0.25">' + '★'.repeat(5 - stars) + '</span></span>',
          action: function() {
            CM.api('rating.set', { path: path, rating: stars }).then(function(r) {
              if (r && r.success !== false) {
                CM.showToast('已评分 ' + stars + ' 星', CM.trackName(track), 'success');
                if (path === CM.trackPath(CM.currentTrack)) CM.refreshLikeState();
              } else {
                CM.showToast('评分失败', '需要安装 foo_playcount 组件', 'error');
              }
            });
          }
        });
      })(s);
    }
    items.push({ label: '清除评分', action: function() {
      CM.api('rating.set', { path: path, rating: 0 }).then(function() {
        if (path === CM.trackPath(CM.currentTrack)) CM.refreshLikeState();
      });
    } });
    if (CM.state.previewActive) {
      items.push({ divider: true });
      items.push({ label: '停止试听', danger: true, action: function() {
        CM.stopPreview();
      } });
    }
    items.push({ divider: true });
    items.push({ label: '在资源管理器中显示', icon: CM.icons.folder, action: function() {
      CM.api('shell.showInExplorer', { path: path });
    } });
    items.push({ label: '编辑标签', icon: CM.icons.tag, action: function() {
      CM.showTagEditor(track);
    } });
    items.push({ label: '在线获取标签', icon: CM.icons.download, action: function() {
      CM.fetchTagsOnline(path);
    } });
    // 批量编辑入口（有多选时显示）
    if (ctx && ctx.playlist != null && state.batchSelected.size >= 2) {
      items.push({ divider: true });
      items.push({ label: '批量编辑标签（' + state.batchSelected.size + '首）', icon: CM.icons.tag, action: function() {
        var tracks = [];
        state.batchSelected.forEach(function(idx) {
          if (state.trackCache[idx]) tracks.push(state.trackCache[idx]);
        });
        if (tracks.length >= 2) CM.showBatchTagEditor(tracks);
      } });
    }
    if (ctx && ctx.playlist != null) {
      // 调整顺序（仅可编辑歌单且曲目 > 1 时显示；多选时整组移动）
      var plInfo = (CM.playlists || []).find(function(p) { return p.index === ctx.playlist; }) || {};
      if (!plInfo.isAutoplaylist && !plInfo.isLocked && state.trackCache.length > 1) {
        var selIdxs = CM._selectionIndices(ctx.index);
        var nTracks = state.trackCache.length;
        var topDelta = -selIdxs[0];
        var botDelta = (nTracks - 1) - selIdxs[selIdxs.length - 1];
        var suffix = selIdxs.length > 1 ? '（' + selIdxs.length + ' 首）' : '';
        items.push({ divider: true });
        items.push({ isLabel: true, label: '调整顺序' });
        items.push({ label: '上移' + suffix, icon: CM.icons.up, disabled: topDelta === 0, action: function() {
          CM.movePlaylistTracks(selIdxs, -1);
        } });
        items.push({ label: '下移' + suffix, icon: CM.icons.down, disabled: botDelta === 0, action: function() {
          CM.movePlaylistTracks(selIdxs, 1);
        } });
        items.push({ label: '移到顶部' + suffix, icon: CM.icons.toTop, disabled: topDelta === 0, action: function() {
          CM.movePlaylistTracks(selIdxs, topDelta, ['已移到顶部', selIdxs.length > 1 ? selIdxs.length + ' 首曲目' : CM.trackName(track)]);
        } });
        items.push({ label: '移到底部' + suffix, icon: CM.icons.toBottom, disabled: botDelta === 0, action: function() {
          CM.movePlaylistTracks(selIdxs, botDelta, ['已移到底部', selIdxs.length > 1 ? selIdxs.length + ' 首曲目' : CM.trackName(track)]);
        } });
      }
      items.push({ divider: true });
      items.push({ label: '从歌单中删除', icon: CM.icons.trash, danger: true, action: function() {
        CM.api('playlist.removeTracks', { playlist: ctx.playlist, items: [ctx.index] });
      } });
    }
    CM.showCtxMenu(x, y, items);
  };

  /* ============================================
   * JIT 无痕试听（不改变播放列表）
   * ============================================ */
  CM.previewTrack = function(track, path) {
    if (!path) { CM.showToast('无法试听', '未找到文件路径', 'error'); return; }
    if (!CM._previewBound) {
      CM._previewBound = true;
      fb.on('jitQueue:listExhausted', function() { CM.state.previewActive = false; });
      fb.on('jitQueue:error', function() { CM.state.previewActive = false; });
    }
    var title = CM.trackName(track);
    CM.api('jitQueue.playNow', { title: title, trackId: path, url: path }).then(function(r) {
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
      var items = [{ isLabel: true, label: '添加 ' + paths.length + ' 首到歌单' }];
      if (lists.length) {
        lists.forEach(function(pl) {
          var idx = pl.index !== undefined ? pl.index : null;
          if (idx === null || pl.isLocked || pl.isAutoplaylist) return;
          var name = pl.name || '未命名';
          var count = pl.trackCount != null ? pl.trackCount : (pl.itemCount != null ? pl.itemCount : '');
          items.push({
            label: name + (count ? ' (' + count + ')' : ''),
            action: function() {
              CM.api('playlist.addPathsAsync', { playlist: idx, paths: paths }).then(function(res) {
                if (res && res.success !== false) {
                  CM.showToast('已添加', paths.length + ' 首到「' + name + '」', 'success');
                } else {
                  CM.showToast('添加失败', res && res.error ? res.error : '歌单可能被锁定', 'error');
                }
              });
            }
          });
        });
      }
      items.push({ divider: true });
      items.push({ label: '新建歌单并添加', icon: CM.icons.plus, action: function() {
        CM.showModal({ title: '新建歌单', input: '', okText: '创建并添加' }).then(function(name) {
          if (!name) return;
          CM.api('playlist.create', { name: name }).then(function(cr) {
            if (cr && cr.success !== false && cr.index != null) {
              CM.api('playlist.addPathsAsync', { playlist: cr.index, paths: paths }).then(function() {
                CM.showToast('已创建并添加', name + ' · ' + paths.length + ' 首', 'success');
              });
            } else {
              CM.showToast('创建失败', '无法创建歌单', 'error');
            }
          });
        });
      } });
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
   * 批量选择（Ctrl+click 多选）
   * ============================================ */
  CM.clearBatchSelection = function() {
    state.batchSelected.clear();
    els.trackTbody.querySelectorAll('tr.batch-selected').forEach(function(tr) {
      tr.classList.remove('batch-selected');
    });
    CM._updateBatchBar();
  };

  CM._updateBatchBar = function() {
    var count = state.batchSelected.size;
    if (count >= 2) {
      els.batchBarCount.textContent = count;
      els.batchBar.classList.remove('hidden');
    } else {
      els.batchBar.classList.add('hidden');
    }
  };

  // 批量编辑入口（从 batch bar 触发）
  CM._batchEditFromBar = function() {
    if (state.batchSelected.size < 2) return;
    var tracks = [];
    state.batchSelected.forEach(function(idx) {
      if (state.trackCache[idx]) tracks.push(state.trackCache[idx]);
    });
    if (tracks.length >= 2) CM.showBatchTagEditor(tracks);
  };
})();
