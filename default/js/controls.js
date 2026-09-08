/* ============================================
 * CloudMusic controls.js — 交互事件绑定
 * 播放控制 / 进度音量 / 频谱 / 队列 / 更多菜单
 * 拖放 / 键盘快捷键 / 任务栏
 * ============================================ */
(function() {
  'use strict';
  var CM = window.CloudMusic;
  var els = CM.els, state = CM.state;


  /* ============================================
   * 导航 / Tab
   * ============================================ */
  CM.bindNavigation = function() {
    document.querySelectorAll('.nav-item[data-tab]').forEach(function(el) {
      el.addEventListener('click', function() { CM.switchTab(el.dataset.tab); });
      el.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); CM.switchTab(el.dataset.tab); }
      });
    });
    document.querySelectorAll('.main-tab[data-tab]').forEach(function(el) {
      el.addEventListener('click', function() { CM.switchTab(el.dataset.tab); });
    });

    // 侧栏搜索 → 跳到搜索页
    els.sidebarSearch.addEventListener('input', function() {
      els.sidebarSearchWrap.classList.toggle('has-text', !!els.sidebarSearch.value);
    });
    els.sidebarSearch.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && els.sidebarSearch.value.trim()) {
        CM.switchTab('search');
        els.searchInput.value = els.sidebarSearch.value;
        CM.doSearch(els.searchInput.value);
      }
    });
    els.sidebarSearchClear.addEventListener('click', function() {
      els.sidebarSearch.value = '';
      els.sidebarSearchWrap.classList.remove('has-text');
      els.sidebarSearch.focus();
    });

    // 搜索页输入（防抖）
    els.searchInput.addEventListener('input', CM.debounce(function() {
      CM.doSearch(els.searchInput.value);
    }, 350));

    // 新建歌单
    els.addPlaylistBtn.addEventListener('click', function() {
      CM.showModal({ title: '新建歌单', input: '', okText: '创建' }).then(function(name) {
        if (!name) return;
        CM.api('playlist.create', { name: name }).then(function(r) {
          if (r && r.success !== false) CM.showToast('已创建歌单', name, 'success');
        });
      });
    });
  };

  /* ============================================
   * 发现页按钮
   * ============================================ */
  CM.bindDiscover = function() {
    els.btnPlayDaily.addEventListener('click', function() { CM.playDaily(); });
    els.btnRefreshDiscover.addEventListener('click', function() { CM.renderDiscover(); });
    els.refreshRandom.addEventListener('click', function() { CM.renderDiscoverRandom(); });
    els.moreAlbums.addEventListener('click', function() {
      CM.openLibraryDetail('albums', null);
    });
    els.moreRecent.addEventListener('click', function() {
      CM.openLibraryDetail('stats', null);
    });
  };

  /* ============================================
   * 播放列表页按钮 / 表头排序
   * ============================================ */
  CM.bindPlaylistView = function() {
    els.btnPlayAll.addEventListener('click', function() {
      if (state.currentPlaylistIndex < 0) return;
      CM.api('playlist.playTrack', { playlist: state.currentPlaylistIndex, index: 0 });
    });
    els.btnPlaylistMore.addEventListener('click', function(e) {
      e.stopPropagation();
      var rect = els.btnPlaylistMore.getBoundingClientRect();
      var idx = state.currentPlaylistIndex;
      if (idx < 0) return;
      // 自动歌单/锁定歌单不接受手动编辑：隐藏 添加/排序/撤销 等操作
      var pl = (CM.playlists || []).find(function(p) { return p.index === idx; }) || {};
      var editable = !pl.isAutoplaylist && !pl.isLocked;
      var items = [
        { isLabel: true, label: '添加到歌单' }
      ];
      if (editable) {
        items.push({ label: '添加本地文件', icon: CM.icons.folder, action: function() {
          CM.addFilesToPlaylist(idx);
        } });
        items.push({ label: '添加文件夹', icon: CM.icons.folder, action: function() {
          CM.addFolderToPlaylist(idx);
        } });
        items.push({ label: '添加网络地址', icon: CM.icons.plus, action: function() {
          CM.addUrlToPlaylist(idx);
        } });
        items.push({ divider: true });
        items.push({ label: '随机排列', icon: CM.icons.refresh, action: function() {
          CM.api('playlist.shuffle', { playlist: idx });
        } });
        items.push({ label: '按标题排序', action: function() {
          CM.api('playlist.sort', { playlist: idx, pattern: '%title%' });
        } });
        items.push({ label: '按艺术家排序', action: function() {
          CM.api('playlist.sort', { playlist: idx, pattern: '%artist% | %album% | %tracknumber%' });
        } });
        items.push({ label: '反转列表', icon: CM.icons.reverse, action: function() {
          CM.api('playlist.reverse', { playlist: idx }).then(function(r) {
            if (r && r.success !== false) CM.showToast('已反转列表顺序', null, 'success');
          });
        } });
        items.push({ divider: true });
        items.push({ label: '撤销上一步', action: function() {
          CM.api('playlist.undo', { playlist: idx });
        } });
      }
      CM.showCtxMenu(rect.left, rect.bottom + 6, items);
    });
    // 表头点击排序（客户端视图排序）
    els.trackTable.querySelectorAll('thead th[data-sort]').forEach(function(th) {
      th.addEventListener('click', function() {
        var key = th.dataset.sort;
        if (state.sortKey === key) {
          if (state.sortAsc) { state.sortAsc = false; }
          else { state.sortKey = null; state.sortAsc = true; } // 第三次点击取消排序
        } else {
          state.sortKey = key; state.sortAsc = true;
        }
        CM.renderTrackTable();
      });
    });
  };

  /* ============================================
   * 通用 seekbar 绑定（主进度条 + 沉浸式进度条共用）
   * ============================================ */
  CM.bindSeekBar = function(bar, timeLabel, cssVar, seekingKey, updateFn) {
    bar.addEventListener('input', function() {
      state[seekingKey] = true;
      var pct = bar.value / 1000;
      bar.style.setProperty(cssVar, (pct * 100).toFixed(2) + '%');
      timeLabel.textContent = CM.formatTime(pct * state.duration);
    });
    bar.addEventListener('change', function() {
      var pct = bar.value / 1000;
      var target = pct * state.duration;
      // 不在此处更新 state.position，交给 playback:seeked / timeHighRes 事件统一处理，
      // 避免因 API 返回 undefined/null 时误把旧位置覆盖掉 seeked 事件已写入的正确位置。
      CM.api('playback.setPosition', { seconds: target }).then(function(r) {
        state[seekingKey] = false;
        updateFn();
      });
    });
  };

  /* ============================================
   * 底栏播放控制
   * ============================================ */
  CM.bindPlaybackControls = function() {
    els.btnPlayPause.addEventListener('click', function() { CM.api('playback.playOrPause'); });
    els.btnPrev.addEventListener('click', function() { CM.api('playback.previous'); });
    els.btnNext.addEventListener('click', function() { CM.api('playback.next'); });

    // 播放顺序：单按钮循环 顺序→列表循环→单曲循环→随机
    els.btnOrder.addEventListener('click', function() {
      var next = CM.ORDERS[(CM.orderIndexOf(state.order) + 1) % CM.ORDERS.length];
      CM.api('playback.setPlaybackOrder', { order: next.id }).then(function(r) {
        if (!r) { CM.showToast('切换失败', null, 'error'); return; }
        state.order = next.id;
        CM.updateOrderIcon();
        CM.showToast(next.name, null);
      });
    });

    // 播完当前停止
    els.btnStopAfter.addEventListener('click', function() {
      CM.api('playback.toggleStopAfterCurrent').then(function(r) {
        if (r && r.enabled !== undefined) state.stopAfterCurrent = !!r.enabled;
        else if (r && r.success !== false) state.stopAfterCurrent = !state.stopAfterCurrent;
        else { CM.showToast('操作失败', null, 'error'); return; }
        CM.updateStopAfterIcon();
        CM.showToast(state.stopAfterCurrent ? '将在当前曲目播完后停止' : '已取消单曲停止', null);
      });
    });

    // 喜欢 = 评分 5 星 / 清除
    els.likeBtn.addEventListener('click', function() {
      var path = CM.trackPath(CM.currentTrack);
      if (!path) return;
      var liked = els.likeBtn.classList.contains('liked');
      var target = liked ? 0 : 5;
      CM.api('rating.set', { path: path, rating: target }).then(function(r) {
        if (r && r.success !== false) {
          els.likeBtn.classList.toggle('liked', !liked);
          CM.showToast(liked ? '已取消喜欢' : '已添加到喜欢', CM.trackName(CM.currentTrack), liked ? null : 'success');
        } else {
          CM.showToast('操作失败', '评分功能需要 foo_playcount 组件', 'error');
        }
      });
    });

    // 进度条
    CM.bindSeekBar(els.seekBar, els.seekCurrent, '--seek-pct', 'seeking', CM.updateSeekUI);

    // 音量
    els.volSlider.addEventListener('input', function() {
      var v = parseInt(els.volSlider.value, 10);
      state.volume = v;
      state.muted = false;
      els.volSlider.style.setProperty('--vol-pct', v + '%');
      CM.api('playback.setVolume', { volume: v });
      CM.updateVolumeIcon();
    });
    els.volBtn.addEventListener('click', function() { CM.api('playback.toggleMute'); });
    // 音量滚轮微调
    els.volBtn.parentElement.addEventListener('wheel', function(e) {
      e.preventDefault();
      var v = Math.max(0, Math.min(100, state.volume + (e.deltaY < 0 ? 5 : -5)));
      state.volume = v; state.muted = false;
      CM.api('playback.setVolume', { volume: v });
      CM.updateVolumeIcon();
    }, { passive: false });

    // 队列抽屉
    els.btnQueue.addEventListener('click', function() { CM.toggleQueue(); });
    els.queueClose.addEventListener('click', function() { CM.toggleQueue(false); });
    els.queueClear.addEventListener('click', function() {
      CM.api('queue.clear').then(function() {
        CM.renderQueue();
        CM.refreshQueueBadge();
        CM.showToast('已清空播放队列', null);
      });
    });

    // 歌词面板开关
    els.btnLyricsToggle.addEventListener('click', function() {
      CM.setLyricsVisible(!state.lyricsVisible);
    });
    // 底栏封面：单击展开歌词面板，双击进入沉浸式模式
    var artClickTimer = null;
    els.bottomArtWrap.addEventListener('click', function() {
      if (artClickTimer) {
        clearTimeout(artClickTimer);
        artClickTimer = null;
        CM.toggleNpOverlay(true);
      } else {
        artClickTimer = setTimeout(function() {
          artClickTimer = null;
          if (!state.lyricsVisible) CM.setLyricsVisible(true);
        }, 250);
      }
    });

    // 频谱开关
    els.btnVisualizer.addEventListener('click', function() {
      CM.setVisualizerActive(!state.visualizerActive);
    });

    // 更多菜单
    els.btnMore.addEventListener('click', function(e) {
      e.stopPropagation();
      CM.toggleMorePopover();
    });
    document.addEventListener('mousedown', function(e) {
      if (els.morePopover.classList.contains('open') &&
          !els.morePopover.contains(e.target) && e.target !== els.btnMore && !els.btnMore.contains(e.target)) {
        els.morePopover.classList.remove('open');
      }
      if (els.rgPopover.classList.contains('open') &&
          !els.rgPopover.contains(e.target) && e.target !== els.btnMore && !els.btnMore.contains(e.target)) {
        els.rgPopover.classList.remove('open');
      }
    });
  };

  /* ============================================
   * 更多菜单（Popover）
   * ============================================ */
  // Popover 一次构建 + 状态更新（避免每次打开重建 innerHTML + 重绑监听器）
  var popoverBuilt = false;
  function buildMorePopover() {
    if (popoverBuilt) return;
    popoverBuilt = true;
    var pop = els.morePopover;
    pop.innerHTML =
      '<div class="popover-section">' +
      '<div class="popover-label">歌词</div>' +
      // 桌面歌词
      '<button class="pop-sub-header" id="popSubDesktop">' + CM.icons.desktopLyric + '<span>桌面歌词</span><span class="pop-sub-arrow">▶</span></button>' +
      '<div class="pop-sub-body" id="popSubDesktopBody">' +
        '<button class="pop-sub-item" id="popDesktopLyricShow">' + CM.icons.desktopLyric + '<span>显示</span><span class="pop-item-note" id="popDesktopLyricNote"></span></button>' +
        '<button class="pop-sub-item" id="popDesktopLyricPin" disabled>' + CM.icons.pin + '<span>置顶</span><span class="pop-item-note" id="popDesktopLyricPinNote"></span></button>' +
        '<button class="pop-sub-item" id="popDesktopLyricLock" disabled>' + CM.icons.lock + '<span>锁定</span><span class="pop-item-note" id="popDesktopLyricLockNote"></span></button>' +
        '<button class="pop-sub-item" id="popDesktopLyricReset">' + CM.icons.refresh + '<span>重置位置</span></button>' +
      '</div>' +
      // ESLyric
      '<button class="pop-sub-header" id="popSubEslyric">' + CM.icons.console + '<span>ESLyric</span><span class="pop-sub-arrow">▶</span></button>' +
      '<div class="pop-sub-body" id="popSubEslyricBody">' +
        '<button class="pop-sub-item" id="popEslyricSearch">' + CM.icons.info + '<span>搜索歌词</span></button>' +
        '<button class="pop-sub-item" id="popEslyricReload">' + CM.icons.refresh + '<span>重载歌词</span></button>' +
        '<button class="pop-sub-item" id="popEslyricScript">' + CM.icons.console + '<span>脚本测试</span></button>' +
      '</div>' +
      '</div>' +
      '<div class="popover-section">' +
      '<div class="popover-label">窗口</div>' +
      '<button class="pop-item" id="popRefresh">' + CM.icons.refresh + '<span>刷新界面</span></button>' +
      '</div>' +
      '<div class="popover-section">' +
      '<div class="popover-label">音频</div>' +
      '<button class="pop-item" id="popEQ">' + CM.icons.eq + '<span>均衡器</span><span class="pop-item-note" id="popEQNote"></span></button>' +
      '<button class="pop-item" id="popOutput">' + CM.icons.output + '<span>输出设备</span><span class="pop-item-note" id="popOutputNote"></span></button>' +
      '<button class="pop-item" id="popRG">' + CM.icons.eq + '<span>播放增益</span><span class="pop-item-note" id="popRGNote"></span></button>' +
      '</div>' +
      '<div class="popover-section">' +
      '<div class="popover-label">foobar2000</div>' +
      '<button class="pop-item" id="popConsole">' + CM.icons.console + '<span>打开控制台</span></button>' +
      '<button class="pop-item" id="popPrefs">' + CM.icons.preferences + '<span>首选项</span></button>' +
      '<button class="pop-item" id="popRescan">' + CM.icons.folder + '<span>刷新媒体库缓存</span></button>' +
      '</div>' +
      '<div class="popover-section">' +
      '<div class="popover-label">关于</div>' +
      '<button class="pop-item" id="popAbout">' + CM.icons.info + '<span>CloudMusic 主题</span><span class="pop-item-note">v2.4.1</span></button>' +
      '<button class="pop-item" id="popHelp">' + CM.icons.info + '<span>使用帮助</span><span class="pop-item-note">功能指南</span></button>' +
      '</div>';
    // 绑定一次，永久有效
    // 子菜单折叠/展开
    function toggleSubMenu(headerId, bodyId) {
      var header = CM.$(headerId);
      var body = CM.$(bodyId);
      if (!header || !body) return;
      var isOpen = header.classList.toggle('open');
      body.classList.toggle('open', isOpen);
    }
    CM.$('popSubDesktop').addEventListener('click', function() { toggleSubMenu('popSubDesktop', 'popSubDesktopBody'); });
    CM.$('popSubEslyric').addEventListener('click', function() { toggleSubMenu('popSubEslyric', 'popSubEslyricBody'); });

    // 桌面歌词子项
    CM.$('popDesktopLyricShow').addEventListener('click', function() {
      CM.toggleDesktopLyric();
    });
    CM.$('popDesktopLyricPin').addEventListener('click', function() {
      CM.toggleDesktopLyricPin();
    });
    CM.$('popDesktopLyricLock').addEventListener('click', function() {
      CM.toggleDesktopLyricLock();
    });
    CM.$('popDesktopLyricReset').addEventListener('click', function() {
      CM.execDesktopLyricReset();
    });

    // ESLyric 子项
    CM.$('popEslyricSearch').addEventListener('click', function() {
      CM.execEslyricSearch();
    });
    CM.$('popEslyricReload').addEventListener('click', function() {
      CM.execEslyricReload();
    });
    CM.$('popEslyricScript').addEventListener('click', function() {
      CM.execEslyricScript();
    });
    CM.$('popEQ').addEventListener('click', function() {
      CM.toggleEQ();
      pop.classList.remove('open');
    });
    CM.$('popOutput').addEventListener('click', function() {
      CM.showOutputDevices();
      pop.classList.remove('open');
    });
    CM.$('popRG').addEventListener('click', function() {
      pop.classList.remove('open');
      CM.toggleRgPopover();
    });
    CM.$('popRefresh').addEventListener('click', function() { location.reload(); });
    CM.$('popConsole').addEventListener('click', function() {
      CM.api('misc.showConsole');
      pop.classList.remove('open');
    });
    CM.$('popPrefs').addEventListener('click', function() {
      CM.api('misc.showPreferences');
      pop.classList.remove('open');
    });
    CM.$('popRescan').addEventListener('click', function() {
      CM.api('library.refresh').then(function() {
        CM.showToast('媒体库缓存已刷新', null, 'success');
        pop.classList.remove('open');
        if (state.currentTab === 'discover') CM.renderDiscover();
      });
    });
    CM.$('popAbout').addEventListener('click', function() {
      CM.showAbout();
      pop.classList.remove('open');
    });
    CM.$('popHelp').addEventListener('click', function() {
      pop.classList.remove('open');
      window.open('guide.html', '_blank');
    });
  }
  function updateMorePopoverState() {
    // 桌面歌词状态
    var dlNote = CM.$('popDesktopLyricNote');
    var dlItem = CM.$('popDesktopLyricShow');
    if (dlNote) dlNote.textContent = eslyricMode ? '开' : '关';
    if (dlItem) dlItem.classList.toggle('checked', eslyricMode);
    // 桌面歌词置顶状态（显示关闭时禁用）
    var dlPinNote = CM.$('popDesktopLyricPinNote');
    var dlPinItem = CM.$('popDesktopLyricPin');
    if (dlPinNote) dlPinNote.textContent = eslyricPinMode ? '开' : '关';
    if (dlPinItem) {
      dlPinItem.classList.toggle('checked', eslyricPinMode);
      dlPinItem.disabled = !eslyricMode;
    }
    // 桌面歌词锁定状态（显示关闭时禁用）
    var dlLockNote = CM.$('popDesktopLyricLockNote');
    var dlLockItem = CM.$('popDesktopLyricLock');
    if (dlLockNote) dlLockNote.textContent = eslyricLockMode ? '开' : '关';
    if (dlLockItem) {
      dlLockItem.classList.toggle('checked', eslyricLockMode);
      dlLockItem.disabled = !eslyricMode;
    }
    // 均衡器状态
    CM.syncEQState();
    // 输出设备名称
    CM.api('config.getOutputConfig').then(function(r) {
      var note = CM.$('popOutputNote');
      if (note && r) note.textContent = r.outputName || r.deviceName || '';
    });
    // 播放增益状态
    CM.api('replaygain.getSettings').then(function(s) {
      var note = CM.$('popRGNote'), txt = '';
      if (s) {
        if (s.sourceMode === 'album') txt = '专辑';
        else if (s.sourceMode === 'track') txt = '音轨';
        if (s.processingMode !== 'none') txt += ' · 已启用';
        else txt += ' · 关闭';
      }
      if (note) note.textContent = txt;
    });
  }
  CM.toggleMorePopover = function() {
    var pop = els.morePopover;
    if (pop.classList.contains('open')) { pop.classList.remove('open'); return; }
    buildMorePopover();
    syncEslyricStates();  // 异步，完成后会调用 updateMorePopoverState
    pop.classList.add('open');
  };

  /* ============================================
   * 同步 ESLyric 命令的实际勾选状态
   * ============================================ */
  function syncEslyricStates() {
    CM.api('discovery.searchCommands', { query: '桌面歌词', includeHidden: true }).then(function(r) {
      if (r && r.results) {
        for (var i = 0; i < r.results.length; i++) {
          var c = r.results[i];
          if (c.type && c.type !== 'mainmenu') continue;
          var hay = (c.name || '') + (c.description || '');
          // 桌面歌词：显示
          if (hay.indexOf('显示桌面歌词') >= 0 || (hay.indexOf('桌面歌词') >= 0 && hay.indexOf('显示') >= 0)) {
            eslyricMode = !!c.checked;
          }
          // 桌面歌词：置顶
          if (hay.indexOf('窗口置顶') >= 0) {
            eslyricPinMode = !!c.checked;
          }
          // 桌面歌词：锁定
          if (hay.indexOf('锁定') >= 0 && hay.indexOf('桌面歌词') >= 0) {
            eslyricLockMode = !!c.checked;
          }
        }
      }
      updateMorePopoverState();
    });
  }

  /* ============================================
   * 播放增益（ReplayGain）面板
   * ============================================ */
  var rgBuilt = false;
  var RG_MODES = [
    { v: 'none', name: '关闭' },
    { v: 'gain', name: '增益' },
    { v: 'gain_and_peak', name: '增益+峰值' },
    { v: 'peak', name: '峰值' }
  ];
  function setSegActive(containerId, val) {
    var c = CM.$(containerId); if (!c) return;
    c.querySelectorAll('button').forEach(function(b) { b.classList.toggle('on', b.dataset.v === val); });
  }
  function setRg(key, val) {
    var params = key === 'sourceMode' ? { sourceMode: val } : { processingMode: val };
    CM.api('replaygain.setMode', params).then(function(r) {
      if (!r || r.success === false) CM.showToast('增益设置失败', null, 'error');
    });
  }
  function buildRgPopover() {
    if (rgBuilt) return;
    rgBuilt = true;
    var pop = els.rgPopover;
    pop.innerHTML =
      '<div class="popover-section">' +
      '<div class="popover-label">增益来源</div>' +
      '<div class="rg-seg" id="rgSource">' +
      '<button data-v="track">音轨</button><button data-v="album">专辑</button>' +
      '</div>' +
      '<div class="popover-label">处理方式</div>' +
      '<div class="rg-seg" id="rgMode">' +
      RG_MODES.map(function(m) { return '<button data-v="' + m.v + '">' + m.name + '</button>'; }).join('') +
      '</div>' +
      '<div class="popover-label">前置增益 <span class="rg-val" id="rgPreampVal">--</span></div>' +
      '<input type="range" class="rg-slider" id="rgPreamp" min="-12" max="12" step="0.5" value="0" />' +
      '</div>';
    CM.$('rgSource').addEventListener('click', function(e) {
      var b = e.target.closest('button'); if (!b) return;
      setSegActive('rgSource', b.dataset.v);
      setRg('sourceMode', b.dataset.v);
    });
    CM.$('rgMode').addEventListener('click', function(e) {
      var b = e.target.closest('button'); if (!b) return;
      setSegActive('rgMode', b.dataset.v);
      setRg('processingMode', b.dataset.v);
    });
    CM.$('rgPreamp').addEventListener('input', function() {
      var v = parseFloat(CM.$('rgPreamp').value);
      CM.$('rgPreampVal').textContent = (v >= 0 ? '+' : '') + v.toFixed(1) + ' dB';
    });
    CM.$('rgPreamp').addEventListener('change', function() {
      CM.api('replaygain.setPreamp', { withRg: parseFloat(CM.$('rgPreamp').value) });
    });
  }
  CM.toggleRgPopover = function() {
    var pop = els.rgPopover;
    if (pop.classList.contains('open')) { pop.classList.remove('open'); return; }
    buildRgPopover();
    // 载入当前状态
    CM.api('replaygain.getSettings').then(function(s) {
      if (!s) return;
      var src = s.sourceMode === 'album' ? 'album' : 'track';
      setSegActive('rgSource', src);
      setSegActive('rgMode', s.processingMode || 'none');
    });
    CM.api('replaygain.getPreamp').then(function(p) {
      if (!p || p.withRg === undefined) return;
      var v = p.withRg;
      CM.$('rgPreamp').value = v;
      CM.$('rgPreampVal').textContent = (v >= 0 ? '+' : '') + v.toFixed(1) + ' dB';
    });
    pop.classList.add('open');
  };

  /* ============================================
   * 迷你频谱
   * ============================================ */
  var SPEC_BARS = 16;
  var spectrumUnsub = null;
  var specBarEls = [];

  // 通用频谱条生成器（迷你频谱 + 沉浸式频谱共用）
  CM.createSpectrumBars = function(container, count, barClass) {
    var html = '';
    for (var i = 0; i < count; i++) html += '<div class="' + barClass + '"></div>';
    container.innerHTML = html;
    return Array.prototype.slice.call(container.children);
  };

  CM.initSpectrumBars = function() {
    specBarEls = CM.createSpectrumBars(els.miniSpectrum, SPEC_BARS, 'mini-spec-bar');
  };

  CM.setVisualizerActive = function(active) {
    state.visualizerActive = active;
    CM.settings.visualizer = active;
    CM.saveSettings();
    els.btnVisualizer.classList.toggle('active', active);
    els.miniSpectrum.style.display = active ? '' : 'none';
    if (active) CM.startSpectrum();
    else CM.stopSpectrum();
  };

  CM.startSpectrum = function() {
    if (spectrumUnsub || !fb.isAvailable()) return;
    spectrumUnsub = fb.audio.subscribeSpectrum(function(data) {
      CM.updateSpectrumBars(specBarEls, data && data.spectrum, SPEC_BARS, 18, 20);
      // 同步更新沉浸式频谱
      CM.updateNpSpectrum(data);
    }, { fftSize: 8192, fps: 30, bands: 64 });
  };

  CM.stopSpectrum = function() {
    if (spectrumUnsub) { spectrumUnsub(); spectrumUnsub = null; }
    specBarEls.forEach(function(el) { el.style.transform = 'scaleY(0.1)'; });
  };

  /* ============================================
   * 拖放（宿主 dnd API，回退 HTML5 提示）
   * ============================================ */
  var AUDIO_EXT = /\.(mp3|flac|wav|aac|m4a|mp4|opus|ogg|oga|wma|ape|wv|alac|aiff|aif|dsf|dff|tak|tta|mpc|mka|m4b|m4r)$/i;

  // 把拖入的路径展开成可播放的音频文件：
  // 目录用 utils.ListFiles 递归枚举其下音频文件，普通文件保留（仅音频）。宿主 addPathsAsync
  // 不会展开文件夹，会把文件夹当一个音轨直接加入导致"无法打开（文件格式不支持）"。
  CM.expandDroppedPaths = function(raw) {
    var rawPaths = (raw || []).map(function(f) {
      return typeof f === 'string' ? f : (f.path || f.name || '');
    }).filter(Boolean);
    var jobs = rawPaths.map(function(p) {
      return Promise.resolve().then(function() {
        if (!window.utils || !window.utils.IsDirectory || !window.utils.ListFiles) return AUDIO_EXT.test(p) ? [p] : [];
        return window.utils.IsDirectory(p).then(function(isDir) {
          if (!isDir) return AUDIO_EXT.test(p) ? [p] : [];
          return window.utils.ListFiles(p, true).then(function(files) {
            return (files || []).filter(function(f) { return AUDIO_EXT.test(f); });
          });
        });
      }).catch(function() { return AUDIO_EXT.test(p) ? [p] : []; });
    });
    return Promise.all(jobs).then(function(groups) {
      return Array.prototype.concat.apply([], groups);
    });
  };

  // 统一入口：把拖进来的（文件/文件夹）路径加到当前歌单
  CM.addDroppedPaths = function(raw) {
    CM.expandDroppedPaths(raw).then(function(paths) {
      if (!paths.length) return;
      var target = state.currentPlaylistIndex >= 0 ? state.currentPlaylistIndex : undefined;
      var params = { paths: paths };
      if (target !== undefined) params.playlist = target;
      CM.api('playlist.addPathsAsync', params).then(function(res) {
        if (res && res.success !== false) {
          CM.showToast('正在添加 ' + paths.length + ' 个项目', null, 'success');
        }
      });
    });
  };

  CM.initDragDrop = function() {
    // v1.12.0 起 dnd 改为主机原生观察，不再注册 drop zone；
    // 读路径统一走 dnd.getPathsAsync（await 安全、不依赖消息顺序）。
    var lastDropAt = 0;
    // 宿主 dnd:drop 事件与 HTML5 window drop 事件先后顺序不定，谁先处理谁生效，
    // 另一路在 500ms 内直接跳过，避免同一批文件被重复添加
    function claimDrop() {
      var now = Date.now();
      if (now - lastDropAt < 500) return false;
      lastDropAt = now;
      return true;
    }
    fb.on('dnd:enter', function() { els.dropOverlay.classList.add('active'); });
    fb.on('dnd:leave', function() { els.dropOverlay.classList.remove('active'); });
    fb.on('dnd:drop', function(data) {
      els.dropOverlay.classList.remove('active');
      if (!claimDrop()) return;
      var sessionId = data && data.sessionId;
      CM.api('dnd.getPathsAsync', sessionId ? { sessionId: sessionId } : {}).then(function(r) {
        var paths = (r && (r.paths || r.files)) || [];
        if (!paths.length && data && data.paths) paths = data.paths;
        CM.addDroppedPaths(paths);
      });
    });
    // 视觉反馈（WebView2 内 dragover 依然会触发）
    // 仅处理"外部文件拖入"（dataTransfer 含 Files）
    function isFileDrag(e) {
      var t = e.dataTransfer && e.dataTransfer.types;
      if (!t) return false;
      for (var i = 0; i < t.length; i++) {
        if (t[i] === 'Files' || t[i] === 'files') return true;
      }
      return false;
    }
    var dragDepth = 0;
    window.addEventListener('dragenter', function(e) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth++;
      els.dropOverlay.classList.add('active');
    });
    window.addEventListener('dragleave', function(e) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      if (--dragDepth <= 0) { dragDepth = 0; els.dropOverlay.classList.remove('active'); }
    });
    window.addEventListener('dragover', function(e) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
    });
    window.addEventListener('drop', function(e) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth = 0;
      els.dropOverlay.classList.remove('active');
      if (!claimDrop()) return;
      // 文档推荐在 HTML5 drop handler 内用 getPathsAsync 读取宿主会话的真实路径
      //（同步 getPaths 在快速拖放时会读到空数组，故不用它做唯一来源）。
      // 文件夹路径由宿主端 addPathsAsync 自动展开其中的音频文件。
      CM.api('dnd.getPathsAsync').then(function(r) {
        var paths = (r && (r.paths || r.files)) || [];
        if (!paths.length) return;
        CM.addDroppedPaths(paths);
      });
    });
  };

  /* ============================================
   * 键盘快捷键
   * ============================================ */
  CM.initKeyboard = function() {
    document.addEventListener('keydown', function(e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          CM.api('playback.playOrPause');
          break;
        case 'ArrowLeft':
          if (e.ctrlKey) { CM.api('playback.previous'); }
          else { CM.api('playback.setPosition', { seconds: Math.max(0, state.position - 5) }); }
          break;
        case 'ArrowRight':
          if (e.ctrlKey) { CM.api('playback.next'); }
          else { CM.api('playback.setPosition', { seconds: Math.min(state.duration, state.position + 5) }); }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (e.altKey) { CM.keyboardMoveTracks(-1); }  // Alt+↑ 上移选中/聚焦曲目
          else { CM.api('playback.volumeUp'); }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (e.altKey) { CM.keyboardMoveTracks(1); }   // Alt+↓ 下移选中/聚焦曲目
          else { CM.api('playback.volumeDown'); }
          break;
        case 'm': case 'M':
          CM.api('playback.toggleMute');
          break;
        case 'l': case 'L':
          CM.setLyricsVisible(!state.lyricsVisible);
          break;
        case 'q': case 'Q':
          CM.toggleQueue();
          break;
        case 'Escape':
          if (state.queueOpen) CM.toggleQueue(false);
          els.morePopover.classList.remove('open');
          CM.hideCtxMenu();
          // 关闭标签编辑器
          var teo = CM.$('tagEditorOverlay');
          if (teo && teo.classList.contains('open')) CM.hideTagEditor();
          // 清除批量选择
          if (state.batchSelected.size > 0) CM.clearBatchSelection();
          break;
      }
    });
  };

  /* ============================================
   * 任务栏进度条
   * 缩略按钮交给 foobar 原生系统媒体控制（SMTC / 全局媒体键），后台也能用；
   * 主题自设按钮在窗口最小化时页面 JS 挂起、taskbar:buttonClicked 不可靠，故不再设置，
   * 仅保留 taskbar.setProgress 进度条（调用即下发、无后台依赖）。
   * ============================================ */
  CM.initTaskbar = function() {
    // 探测任务栏 API 可用性（进度条依赖）；不可用时静默跳过
    CM.api('taskbar.setProgress', { state: 'none' }).then(function(r) {
      CM.taskbarAvailable = !!(r && r.success);
    });
  };

  // 节流：仅当可见进度 1% 变化时才通过 IPC 更新任务栏，避免 timeHighRes 高频事件（~30次/秒）反复调用宿主 API
  CM._lastTaskbarVal = -1;
  CM._lastTaskbarState = '';
  CM.updateTaskbarProgress = function() {
    if (!CM.taskbarAvailable) return;
    if (!CM.currentTrack || state.duration <= 0) {
      if (CM._lastTaskbarVal !== -2) {
        CM._lastTaskbarVal = -2;
        CM.api('taskbar.setProgress', { state: 'none' });
      }
      return;
    }
    var stateName = fb.state.isPlaying ? 'normal' : 'paused';
    var v = Math.max(0, Math.min(1, state.position / state.duration));
    var pct = Math.round(v * 100);
    if (pct === CM._lastTaskbarVal && stateName === CM._lastTaskbarState) return;
    CM._lastTaskbarVal = pct;
    CM._lastTaskbarState = stateName;
    CM.api('taskbar.setProgress', { state: stateName, value: v });
  };

  /* ============================================
   * 沉浸式 NowPlaying 事件绑定
   * ============================================ */
  CM.bindNpOverlay = function() {
    // 右侧面板进入沉浸式按钮
    els.rpImmersiveBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      CM.toggleNpOverlay(true);
    });

    // 关闭按钮
    els.npCloseBtn.addEventListener('click', function() {
      CM.toggleNpOverlay(false);
    });

    // 沉浸式顶部拖拽条：无系统标题栏时仍可移动窗口
    var npDrag = CM.$('npDragHandle');
    if (npDrag) {
      npDrag.addEventListener('mousedown', function(e) { if (e.button === 0) CM.api('window.startDrag'); });
      npDrag.addEventListener('dblclick', function() { CM.api('window.toggleMaximize'); });
    }

    // 模式切换按钮
    els.npModeBtn.addEventListener('click', function() {
      CM.toggleNpMode();
    });

    // 播放控制
    els.npBtnPlay.addEventListener('click', function() { CM.api('playback.playOrPause'); });
    els.npBtnPrev.addEventListener('click', function() { CM.api('playback.previous'); });
    els.npBtnNext.addEventListener('click', function() { CM.api('playback.next'); });
    // 歌词侧控制（纯歌词模式）
    els.npLcPlay.addEventListener('click', function() { CM.api('playback.playOrPause'); });
    els.npLcPrev.addEventListener('click', function() { CM.api('playback.previous'); });
    els.npLcNext.addEventListener('click', function() { CM.api('playback.next'); });

    // 沉浸式进度条
    CM.bindSeekBar(els.npSeekBar, els.npTimeCurrent, '--np-seek-pct', 'npSeeking', CM.updateNpSeekUI);

    // ESC 关闭沉浸式
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && state.npOpen) {
        CM.toggleNpOverlay(false);
      }
    });
  };

  /* ============================================
   * 桌面歌词 — 通过主菜单命令调用 ESLyric 原生桌面歌词
   * 首次搜索后缓存命令，后续直接执行
   * ============================================ */
  var eslyricMode = false;
  var eslyricCmd = null;
  var _eslyricBusy = false;

  CM.toggleDesktopLyric = function() {
    if (_eslyricBusy) return; // 防止连点时重复执行（搜索/执行是异步的）
    var exec = function(cmd) {
      _eslyricBusy = true;
      var params = cmd.subGuid ? { guid: cmd.guid, subGuid: cmd.subGuid } : { guid: cmd.guid };
      CM.api('discovery.executeMainMenuCommand', params).then(function(r) {
        _eslyricBusy = false;
        if (!r || r.success === false) {
          // 执行失败：缓存 GUID 可能已失效（插件更新/重装变更），清掉让下次重新搜索
          if (r && (r.unaddressable || r.code)) eslyricCmd = null;
          else eslyricCmd = null; // 保守起见：失败一律重新搜索
          CM.showToast('启动失败', '命令执行失败，将重新检测组件', 'error');
          return;
        }
        eslyricMode = !eslyricMode;
        CM.showToast(eslyricMode ? '桌面歌词已开启' : '桌面歌词已关闭',
          null, eslyricMode ? 'success' : null);
        updateMorePopoverState(); // 同步 popover 中「桌面歌词」的 开/关 状态
      });
    };
    var findCmd = function(r) {
      if (!r || !r.results) return null;
      for (var i = 0; i < r.results.length; i++) {
        var c = r.results[i];
        if (c.type && c.type !== 'mainmenu') continue; // 只认主菜单命令
        var hay = (c.name || '') + (c.description || '');
        if (hay.indexOf('显示桌面歌词') >= 0 || hay.indexOf('桌面歌词') >= 0) {
          return { guid: c.guid, subGuid: c.subGuid || null };
        }
      }
      return null;
    };
    if (eslyricCmd) { exec(eslyricCmd); return; }
    // includeHidden 避免命令被判为“宿主不显示”而被过滤；type 过滤只取主菜单命令
    CM.api('discovery.searchCommands', { query: '显示桌面歌词', includeHidden: true }).then(function(r) {
      var cmd = findCmd(r);
      if (cmd) { eslyricCmd = cmd; exec(cmd); return; }
      // 兜底：第一次搜不到时再按“歌词”宽泛搜一次（命令名可能因版本而异）
      CM.api('discovery.searchCommands', { query: '歌词', includeHidden: true }).then(function(r2) {
        var cmd2 = findCmd(r2);
        if (cmd2) { eslyricCmd = cmd2; exec(cmd2); return; }
        eslyricCmd = null;
        CM.showToast('启动失败', '请确认已安装 ESLyric 插件', 'error');
      });
    });
  };

  /* ============================================
   * 桌面歌词置顶 — 通过主菜单命令调用 ESLyric "窗口置顶"
   * ============================================ */
  var eslyricPinMode = false;
  var eslyricPinCmd = null;
  var _eslyricPinBusy = false;

  CM.toggleDesktopLyricPin = function() {
    if (_eslyricPinBusy) return;
    var exec = function(cmd) {
      _eslyricPinBusy = true;
      var params = cmd.subGuid ? { guid: cmd.guid, subGuid: cmd.subGuid } : { guid: cmd.guid };
      CM.api('discovery.executeMainMenuCommand', params).then(function(r) {
        _eslyricPinBusy = false;
        if (!r || r.success === false) {
          eslyricPinCmd = null;
          CM.showToast('操作失败', '命令执行失败，将重新检测组件', 'error');
          return;
        }
        eslyricPinMode = !eslyricPinMode;
        CM.showToast(eslyricPinMode ? '桌面歌词置顶已开启' : '桌面歌词置顶已关闭',
          null, eslyricPinMode ? 'success' : null);
        updateMorePopoverState();
      });
    };
    var findPinCmd = function(r) {
      if (!r || !r.results) return null;
      for (var i = 0; i < r.results.length; i++) {
        var c = r.results[i];
        if (c.type && c.type !== 'mainmenu') continue;
        var hay = (c.name || '') + (c.description || '');
        if (hay.indexOf('窗口置顶') >= 0 || (hay.indexOf('置顶') >= 0 && hay.indexOf('歌词') >= 0)) {
          return { guid: c.guid, subGuid: c.subGuid || null };
        }
      }
      return null;
    };
    if (eslyricPinCmd) { exec(eslyricPinCmd); return; }
    CM.api('discovery.searchCommands', { query: '窗口置顶', includeHidden: true }).then(function(r) {
      var cmd = findPinCmd(r);
      if (cmd) { eslyricPinCmd = cmd; exec(cmd); return; }
      CM.api('discovery.searchCommands', { query: '置顶', includeHidden: true }).then(function(r2) {
        var cmd2 = findPinCmd(r2);
        if (cmd2) { eslyricPinCmd = cmd2; exec(cmd2); return; }
        eslyricPinCmd = null;
        CM.showToast('启动失败', '未找到置顶命令，请确认 ESLyric 已安装', 'error');
      });
    });
  };

  /* ============================================
   * 桌面歌词锁定 — 通过主菜单命令调用 ESLyric "锁定"
   * ============================================ */
  var eslyricLockMode = false;
  var eslyricLockCmd = null;
  var _eslyricLockBusy = false;

  CM.toggleDesktopLyricLock = function() {
    if (_eslyricLockBusy) return;
    var exec = function(cmd) {
      _eslyricLockBusy = true;
      var params = cmd.subGuid ? { guid: cmd.guid, subGuid: cmd.subGuid } : { guid: cmd.guid };
      CM.api('discovery.executeMainMenuCommand', params).then(function(r) {
        _eslyricLockBusy = false;
        if (!r || r.success === false) {
          eslyricLockCmd = null;
          CM.showToast('操作失败', '命令执行失败，将重新检测组件', 'error');
          return;
        }
        eslyricLockMode = !eslyricLockMode;
        CM.showToast(eslyricLockMode ? '桌面歌词锁定已开启' : '桌面歌词锁定已关闭',
          null, eslyricLockMode ? 'success' : null);
        updateMorePopoverState();
      });
    };
    var findLockCmd = function(r) {
      if (!r || !r.results) return null;
      for (var i = 0; i < r.results.length; i++) {
        var c = r.results[i];
        if (c.type && c.type !== 'mainmenu') continue;
        var hay = (c.name || '') + (c.description || '');
        if (hay.indexOf('锁定') >= 0 && (hay.indexOf('歌词') >= 0 || hay.indexOf('桌面') >= 0)) {
          return { guid: c.guid, subGuid: c.subGuid || null };
        }
      }
      return null;
    };
    if (eslyricLockCmd) { exec(eslyricLockCmd); return; }
    CM.api('discovery.searchCommands', { query: '锁定桌面歌词', includeHidden: true }).then(function(r) {
      var cmd = findLockCmd(r);
      if (cmd) { eslyricLockCmd = cmd; exec(cmd); return; }
      CM.api('discovery.searchCommands', { query: '锁定', includeHidden: true }).then(function(r2) {
        var cmd2 = findLockCmd(r2);
        if (cmd2) { eslyricLockCmd = cmd2; exec(cmd2); return; }
        eslyricLockCmd = null;
        CM.showToast('启动失败', '未找到锁定命令，请确认 ESLyric 已安装', 'error');
      });
    });
  };

  /* ============================================
   * ESLyric 通用命令执行辅助
   * ============================================ */
  var _eslyricExecBusy = false;

  function eslyricExecOne(query, matchFn, onOk, onErr) {
    if (_eslyricExecBusy) return;
    _eslyricExecBusy = true;
    CM.api('discovery.searchCommands', { query: query, includeHidden: true }).then(function(r) {
      if (!r || !r.results) { _eslyricExecBusy = false; onErr('未找到命令'); return; }
      for (var i = 0; i < r.results.length; i++) {
        var c = r.results[i];
        if (c.type && c.type !== 'mainmenu') continue;
        if (matchFn(c)) {
          var params = c.subGuid ? { guid: c.guid, subGuid: c.subGuid } : { guid: c.guid };
          CM.api('discovery.executeMainMenuCommand', params).then(function(r2) {
            _eslyricExecBusy = false;
            if (!r2 || r2.success === false) { onErr('命令执行失败'); return; }
            onOk();
          });
          return;
        }
      }
      _eslyricExecBusy = false;
      onErr('未找到匹配命令');
    });
  }

  // 桌面歌词：重置位置
  CM.execDesktopLyricReset = function() {
    eslyricExecOne('重置位置',
      function(c) {
        var hay = (c.name || '') + (c.description || '');
        return hay.indexOf('重置位置') >= 0;
      },
      function() {
        CM.showToast('桌面歌词位置已重置', null, 'success');
      },
      function(err) {
        CM.showToast('启动失败', err === '未找到命令' ? '未找到重置位置命令' : err, 'error');
      });
  };

  /* ============================================
   * ESLyric 工具 — 搜索歌词 / 重载歌词 / 脚本测试
   * ============================================ */
  CM.execEslyricSearch = function() {
    eslyricExecOne('搜索歌词',
      function(c) {
        var hay = (c.name || '') + (c.description || '');
        return hay.indexOf('搜索歌词') >= 0;
      },
      function() { CM.showToast('搜索歌词已触发', null, 'success'); },
      function(err) { CM.showToast('启动失败', err === '未找到命令' ? '未找到搜索歌词命令' : err, 'error'); });
  };

  CM.execEslyricReload = function() {
    eslyricExecOne('重载歌词',
      function(c) {
        var hay = (c.name || '') + (c.description || '');
        return hay.indexOf('重载歌词') >= 0;
      },
      function() { CM.showToast('重载歌词已触发', null, 'success'); },
      function(err) { CM.showToast('启动失败', err === '未找到命令' ? '未找到重载歌词命令' : err, 'error'); });
  };

  CM.execEslyricScript = function() {
    eslyricExecOne('脚本测试',
      function(c) {
        var hay = (c.name || '') + (c.description || '');
        return hay.indexOf('脚本测试') >= 0;
      },
      function() { CM.showToast('脚本测试已触发', null, 'success'); },
      function(err) { CM.showToast('启动失败', err === '未找到命令' ? '未找到脚本测试命令' : err, 'error'); });
  };

  /* ============================================
   * 均衡器 — 通过 DSP API 切换 EQ
   * 均衡器 GUID 来自 dsp.getAvailable
   * ============================================ */
  var EQ_GUID = '{82AEF845-DCC3-4DA5-9D80-E9A972B2140D}';
  var eqMode = false;

  // 在 DSP 链中查找 EQ 的索引（-1 表示不存在）
  function findEQInChain(dsps) {
    if (!dsps) return -1;
    for (var i = 0; i < dsps.length; i++) {
      if (dsps[i].guid === EQ_GUID) return i;
    }
    return -1;
  }

  // 更新 EQ 按钮状态
  function updateEQUI() {
    var note = CM.$('popEQNote');
    var item = CM.$('popEQ');
    if (note) note.textContent = eqMode ? '开' : '关';
    if (item) item.classList.toggle('checked', eqMode);
  }

  CM.syncEQState = function() {
    CM.api('dsp.getChain').then(function(r) {
      eqMode = findEQInChain(r && r.dsps) >= 0;
      updateEQUI();
    });
  };

  CM.toggleEQ = function() {
    CM.api('dsp.getChain').then(function(r) {
      if (!r) { CM.showToast('操作失败', '无法获取 DSP 链', 'error'); return; }
      var eqIndex = findEQInChain(r.dsps);
      if (eqIndex >= 0) {
        CM.api('dsp.removeDsp', { index: eqIndex }).then(function(res) {
          if (res && res.success !== false) { eqMode = false; updateEQUI(); CM.showToast('均衡器已关闭', null); }
          else { CM.showToast('操作失败', null, 'error'); }
        });
      } else {
        CM.api('dsp.addDsp', { guid: EQ_GUID }).then(function(res) {
          if (res && res.success !== false) { eqMode = true; updateEQUI(); CM.showToast('均衡器已开启', null, 'success'); }
          else { CM.showToast('操作失败', null, 'error'); }
        });
      }
    });
  };

  /* ============================================
   * 输出设备 — 列出设备并切换
   * ============================================ */
  CM.showOutputDevices = function() {
    CM.api('config.getOutputDevices').then(function(resp) {
      var devices = Array.isArray(resp) ? resp : (resp && Array.isArray(resp.devices) ? resp.devices : []);
      if (!devices.length) {
        CM.showToast('无法获取输出设备', null, 'error');
        return;
      }
      var items = [{ label: '输出设备', isLabel: true }];
      devices.forEach(function(d) {
        items.push({
          label: d.name,
          checked: !!d.isCurrent,
          action: function() {
            CM.api('config.setOutputDevice', { outputId: d.outputId, deviceId: d.deviceId }).then(function(r) {
              if (r && r.success !== false) {
                CM.showToast('已切换', d.name, 'success');
              } else {
                CM.showToast('切换失败', null, 'error');
              }
            });
          }
        });
      });
      var rect = els.btnMore.getBoundingClientRect();
      CM.showCtxMenu(rect.left, rect.bottom + 6, items);
    });
  };

  /* ============================================
   * 关于 — 并行查询多 API，展示完整系统信息
   * ============================================ */
  CM.showAbout = function() {
    Promise.all([
      CM.api('config.getVersionInfo'),
      CM.api('playcount.getStats'),
      CM.api('config.getOutputConfig'),
      CM.api('config.getComponents'),
      CM.api('audio.getStreamInfo')
    ]).then(function(results) {
      var ver = results[0] || {};
      var stats = results[1] || {};
      var out = results[2] || {};
      var compsRaw = results[3];
      var comps = Array.isArray(compsRaw) ? compsRaw : (compsRaw && Array.isArray(compsRaw.components) ? compsRaw.components : []);
      var stream = results[4] || {};

      // plugin 可能是字符串或 {name,version} 对象
      var pluginVer = ver.plugin;
      if (pluginVer && typeof pluginVer === 'object') pluginVer = pluginVer.version || pluginVer.name;

      var items = [
        { label: 'CloudMusic 主题', isLabel: true },
        { html: '<span class="ctx-info-label">版本</span><span class="ctx-info-value">v2.4.1</span>' },
        { html: '<span class="ctx-info-label">作者</span><span class="ctx-info-value">灵芝含</span>' },
        { html: '<span class="ctx-info-label">foobar2000</span><span class="ctx-info-value">' + CM.escHtml(ver.foobar2000 || '--') + '</span>' },
        { html: '<span class="ctx-info-label">WebView2 组件</span><span class="ctx-info-value">v' + CM.escHtml(pluginVer || '--') + '</span>' },
        { divider: true },
        { label: '媒体库', isLabel: true },
        { html: '<span class="ctx-info-label">总曲目</span><span class="ctx-info-value">' + (stats.totalTracks || 0) + '</span>' },
        { html: '<span class="ctx-info-label">已播放</span><span class="ctx-info-value">' + (stats.playedTracks || 0) + '</span>' },
        { html: '<span class="ctx-info-label">未播放</span><span class="ctx-info-value">' + (stats.unplayedTracks || 0) + '</span>' },
        { html: '<span class="ctx-info-label">总播放次数</span><span class="ctx-info-value">' + (stats.totalPlayCount || 0) + '</span>' },
        { html: '<span class="ctx-info-label">平均播放</span><span class="ctx-info-value">' + (parseFloat(stats.averagePlayCount) || 0).toFixed(1) + ' 次</span>' },
        { divider: true },
        { label: '输出', isLabel: true },
        { html: '<span class="ctx-info-label">输出模式</span><span class="ctx-info-value">' + CM.escHtml(out.outputName || '--') + '</span>' },
        { html: '<span class="ctx-info-label">设备</span><span class="ctx-info-value">' + CM.escHtml(out.deviceName || '--') + '</span>' },
        { html: '<span class="ctx-info-label">位深</span><span class="ctx-info-value">' + (out.bitDepth || '--') + ' bit</span>' },
        { html: '<span class="ctx-info-label">缓冲</span><span class="ctx-info-value">' + (out.bufferLength || '--') + ' s</span>' }
      ];

      if (stream.playing) {
        items.push({ divider: true });
        items.push({ label: '当前播放', isLabel: true });
        items.push({ html: '<span class="ctx-info-label">编码</span><span class="ctx-info-value">' + CM.escHtml(stream.codec || '--') + '</span>' });
        items.push({ html: '<span class="ctx-info-label">采样率</span><span class="ctx-info-value">' + (stream.sampleRate ? (stream.sampleRate / 1000).toFixed(1) + ' kHz' : '--') + '</span>' });
        items.push({ html: '<span class="ctx-info-label">比特率</span><span class="ctx-info-value">' + (stream.bitrate || '--') + ' kbps</span>' });
        items.push({ html: '<span class="ctx-info-label">声道</span><span class="ctx-info-value">' + (stream.channels || '--') + ' ch</span>' });
      }

      items.push({ divider: true });
      items.push({ html: '<span class="ctx-info-label">已安装组件</span><span class="ctx-info-value">' + (comps.length || 0) + ' 个</span>' });

      var rect = els.btnMore.getBoundingClientRect();
      CM.showCtxMenu(rect.left, rect.bottom + 6, items);
    }).catch(function() {
      CM.showToast('获取信息失败', null, 'error');
    });
  };

  /* ============================================
   * 标签编辑器 — 事件绑定
   * ============================================ */
  CM.bindTagEditor = function() {
    // 关闭/取消
    els.tagEditorClose.addEventListener('click', CM.hideTagEditor);
    els.tagEditorCancel.addEventListener('click', CM.hideTagEditor);
    // 点击遮罩关闭
    els.tagEditorOverlay.addEventListener('mousedown', function(e) {
      if (e.target === els.tagEditorOverlay) CM.hideTagEditor();
    });
    // 保存
    els.tagEditorSave.addEventListener('click', CM._saveTagEditor);
    // 封面管理（事件委托，因为按钮是动态渲染的）
    els.tagEditorBody.addEventListener('click', function(e) {
      if (e.target.id === 'tagCoverReplace') CM._replaceCover();
      else if (e.target.id === 'tagCoverRemove') CM._removeCover();
    });
    // 文件选择回调
    els.tagCoverFile.addEventListener('change', CM._onCoverFileSelected);

    // 批量操作栏
    els.batchEditTags.addEventListener('click', CM._batchEditFromBar);
    els.batchClear.addEventListener('click', CM.clearBatchSelection);
  };

  /* ============================================
   * 在线标签获取 — 通过 discovery API 调用 foo_freedb2
   * 首次搜索后缓存命令，后续直接执行
   * ============================================ */
  var _freedbCmd = null; // 缓存：{ guid, name } 或 null（已确认不可用）

  CM.fetchTagsOnline = function(path) {
    if (!path) return;

    var execCmd = function(cmd) {
      // 通过右键菜单命令执行（作用于当前播放曲目或选中项）
      var params = cmd.subGuid ? { guid: cmd.guid, subGuid: cmd.subGuid } : { guid: cmd.guid };
      CM.api('discovery.executeContextMenuCommand', params).then(function(r) {
        if (!r || r.success === false) {
          _freedbCmd = null; // 清除失效的缓存命令，下次重新探测
          CM.showToast('获取失败', '命令执行失败，请尝试在 foobar2000 中手动操作', 'error');
          return;
        }
        CM.showToast('已触发在线获取', '请在弹出的窗口中完成操作', null);
      });
    };

    if (_freedbCmd) { execCmd(_freedbCmd); return; }

    // 搜索右键菜单中包含 freedb 关键词的命令
    CM.api('discovery.getContextMenuCommands').then(function(r) {
      if (!r || !r.commands) {
        CM.showToast('获取失败', '请确认已安装「在线标签获取器」(foo_freedb2) 组件', 'error');
        return;
      }
      // 搜索包含 freedb 或 "在线" 或 "获取标签" 的命令
      var found = null;
      for (var i = 0; i < r.commands.length; i++) {
        var c = r.commands[i];
        var name = (c.name || '').toLowerCase();
        var desc = (c.description || '').toLowerCase();
        if (name.indexOf('freedb') >= 0 || desc.indexOf('freedb') >= 0 ||
            name.indexOf('在线') >= 0 || name.indexOf('获取') >= 0 ||
            name.indexOf('tag from') >= 0 || name.indexOf('get tags') >= 0) {
          found = c;
          break;
        }
      }
      if (!found) {
        CM.showToast('未找到组件', '请确认已安装「在线标签获取器」(foo_freedb2) 组件', 'error');
        return;
      }
      _freedbCmd = { guid: found.guid, subGuid: found.subGuid || null, name: found.name };
      execCmd(_freedbCmd);
    });
  };

  /* ============================================
   * 播放列表「更多」菜单 — 批量编辑入口
   * ============================================ */
  // 在 more 菜单中追加「批量编辑标签」选项（当有多选时显示）
  // 通过包装 showCtxMenu 实现：拦截 more 按钮的 click 事件
  // 在原菜单项后追加批量编辑项
  els.btnPlaylistMore.addEventListener('click', function(e) {
    if (state.batchSelected.size >= 2) {
      // 延迟追加，确保在原菜单渲染后执行
      setTimeout(function() {
        var menu = els.ctxMenu;
        if (menu.classList.contains('hidden')) return;
        var divider = document.createElement('div');
        divider.className = 'ctx-divider';
        var item = document.createElement('div');
        item.className = 'ctx-item';
        item.dataset.idx = menu.children.length;
        item.innerHTML = (CM.icons.tag || '') + '<span>批量编辑标签（' + state.batchSelected.size + '首）</span>';
        item.addEventListener('click', function() {
          CM.hideCtxMenu();
          CM._batchEditFromBar();
        });
        menu.appendChild(divider);
        menu.appendChild(item);
      }, 0);
    }
  }, true); // 使用捕获阶段，确保在原 handler 之前执行

})();
