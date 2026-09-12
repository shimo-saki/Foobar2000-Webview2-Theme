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
      const pl = CM.playlists?.find(p => p.index === idx) ?? {};
      const disabled = pl.isAutoplaylist || pl.isLocked;
      const items = [
        { label: '添加到歌单', isLabel: true },
        {
          label: '添加本地文件', icon: CM.icons.file, disabled,
          action: () => CM.addFilesToPlaylist(idx),
        },
        {
          label: '添加文件夹', icon: CM.icons.addfolder, disabled,
          action: () => CM.addFolderToPlaylist(idx),
        },
        {
          label: '添加网络地址', icon: CM.icons.plus, disabled,
          action: () => CM.addUrlToPlaylist(idx),
        },
        { divider: true },
        {
          label: '随机排列', icon: CM.icons.random, disabled,
          action: () => CM.api('playlist.shuffle', { playlist: idx }),
        },
        {
          label: '按标题排序', icon: CM.icons.title, disabled,
          action: () => CM.api('playlist.sort', { playlist: idx, pattern: '%title%' }),
        },
        {
          label: '按艺术家排序', icon: CM.icons.artist, disabled,
          action: () => CM.api('playlist.sort', { playlist: idx, pattern: '%artist% | %album% | %tracknumber%' }),
        },
        {
          label: '反转列表', icon: CM.icons.reverse, disabled,
          action: () => CM.api('playlist.reverse', { playlist: idx })
            .then(r => {if (r?.success !== false) CM.showToast('已反转列表顺序', null, 'success')}),
        },
        { divider: true },
        {
          label: '撤销上一步', icon: CM.icons.undo, disabled,
          action: () => CM.api('playlist.undo', { playlist: idx }),
        },
        {
          label: '恢复上一步', icon: CM.icons.redo, disabled,
          action: () => CM.api('playlist.redo', { playlist: idx }),
        }
      ];
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
    els.bottomArtWrap.addEventListener('click', function () {
      if (this._clickTimer) {
        clearTimeout(this._clickTimer);
        this._clickTimer = null;
        CM.toggleNpOverlay(true);
      } else {
        this._clickTimer = setTimeout(() => {
          this._clickTimer = null;
          CM.setLyricsVisible(true);
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
      showMoreMenu(e.clientX, e.clientY);
    });
  };

  /* ============================================
   * 更多菜单（Popover）
   * ============================================ */
  function showMoreMenu(x, y) {
    const items = [
      { label: '歌词', isLabel: true, hidden: !CM.checkComponent('foo_uie_eslyric') },
      {
        label: '桌面歌词', icon: CM.icons.desktopLyric, hidden: !CM.checkComponent('foo_uie_eslyric'),
        submenu: [
          {
            label: '显示', icon: CM.icons.desktopLyric, checked: ESLYRIC_STATE.show,
            action: () => CM.toggleDesktopLyric()
          },
          {
            label: '置顶', icon: CM.icons.pin, checked: ESLYRIC_STATE.pin,
            action: () => CM.toggleDesktopLyricPin()
          },
          {
            label: '锁定', icon: CM.icons.lock, checked: ESLYRIC_STATE.lock,
            action: () => CM.toggleDesktopLyricLock()
          },
          {
            label: '重置位置', icon: CM.icons.refresh,
            action: () => CM.execDesktopLyricReset()
          }
        ]
      },
      { divider: true, hidden: !CM.checkComponent('foo_uie_eslyric') },
      { label: '窗口', isLabel: true },
      {
        label: '刷新界面', icon: CM.icons.refresh,
        action: () => location.reload()
      },
      { divider: true },
      { label: '音频', isLabel: true },
      {
        label: '均衡器', icon: CM.icons.eq, checked: eqMode,
        action: () => CM.toggleEQ()
      },
      {
        label: '输出设备', icon: CM.icons.output,
        submenu: outputDevice.map(d => ({
          label: d.name, checked: d.isCurrent,
          action: () => CM.api('config.setOutputDevice', { outputId: d.outputId, deviceId: d.deviceId })
            .then(() => { CM.showToast('已切换', d.name, 'success'); syncOutputDevice(); })
            .catch(() => CM.showToast('切换失败', null, 'error'))
          }))
      },
      { label: '播放增益', icon: CM.icons.eq, submenu: replaygain },
      { divider: true },
      { label: 'Foobar 2000', isLabel: true },
      {
        label: '打开控制台', icon: CM.icons.console,
        action: () => CM.api('misc.showConsole')
      },
      {
        label: '首选项', icon: CM.icons.preferences,
        action: () => CM.api('misc.showPreferences')
      },
      {
        label: '刷新媒体库缓存', icon: CM.icons.folder,
        action: () => CM.api('library.refresh').then(() => {
          CM.showToast('媒体库缓存已刷新', null, 'success');
          if (state.currentTab === 'discover') CM.renderDiscover();
        })
      },
      { divider: true },
      { label: '关于', isLabel: true },
      {
        label: 'CloudMusic 主题', icon: CM.icons.info,
        action: () => CM.showAbout()
      },
      {
        label: '使用帮助', icon: CM.icons.info,
        action: () => window.open('guide.html', '_blank')
      },
    ]
    CM.showCtxMenu(x, y, items);
  }

  /* ============================================
   * 播放增益（ReplayGain）面板
   * ============================================ */
  let replaygain = [];
  function syncReplaygain() {
    CM.api('replaygain.getSettings').then(res => {
      replaygain = [
        {
          label: '增益来源',
          submenu: [
            {
              label: '无', checked: res.sourceMode === 'none',
              action: () => { CM.api('replaygain.setMode', { sourceMode: 'none' }); syncReplaygain();}
            },
            {
              label: '音轨', checked: res.sourceMode === 'track',
              action: () => { CM.api('replaygain.setMode', { sourceMode: 'track' }); syncReplaygain(); }
            },
            {
              label: '专辑', checked: res.sourceMode === 'album',
              action: () => { CM.api('replaygain.setMode', { sourceMode: 'album' }); syncReplaygain(); }
            }
          ]
        },
        {
          label: '处理方式',
          submenu: [
            {
              label: '关闭', checked: res.processingMode === 'none',
              action: () => { CM.api('replaygain.setMode', { processingMode: 'none' }); syncReplaygain(); }
            },
            {
              label: '增益', checked: res.processingMode === 'gain',
              action: () => { CM.api('replaygain.setMode', { processingMode: 'gain' }); syncReplaygain();}
            },
            {
              label: '增益 + 峰值', checked: res.processingMode === 'gain_and_peak',
              action: () => { CM.api('replaygain.setMode', { processingMode: 'gain_and_peak' }); syncReplaygain(); }
            },
            {
              label: '峰值', checked: res.processingMode === 'peak',
              action: () => { CM.api('replaygain.setMode', { processingMode: 'peak' }); syncReplaygain();}
            },
          ]
        }
      ]
    });
  }
  syncReplaygain();

  /* ============================================
   * 迷你频谱
   * ============================================ */
  var SPEC_BARS = 16;
  var spectrumUnsub = null;
  var specBarEls = [];

  // 通用频谱条生成器（迷你频谱 + 沉浸式频谱共用）
  CM.createSpectrumBars = (container, count, barClass) => {
    container.innerHTML = Array.from({ length: count }, () => `<div class="${barClass}"></div>`).join('');
    return [...container.children];
  };

  CM.initSpectrumBars = function() {
    specBarEls = CM.createSpectrumBars(els.miniSpectrum, SPEC_BARS, 'mini-spec-bar');
  };

  CM.setVisualizerActive = function(active) {
    state.visualizerActive = CM.settings.visualizer = active;
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
  CM.updateTaskbarProgress = function () {
    if (!CM.taskbarAvailable) return;
    if (!CM.currentTrack || state.duration <= 0) {
      if (CM._lastTaskbarVal !== -2) {
        CM._lastTaskbarVal = -2;
        CM.api('taskbar.setProgress', { state: 'none' });
      }
      return;
    }

    const stateName = fb.state.isPlaying ? 'normal' : 'paused';
    const value = Math.min(1, Math.max(0, state.position / state.duration));
    const pct = Math.round(value * 100);

    if (pct === CM._lastTaskbarVal && stateName === CM._lastTaskbarState) return;

    CM._lastTaskbarVal = pct;
    CM._lastTaskbarState = stateName;
    CM.api('taskbar.setProgress', { state: stateName, value });
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
  * ============================================ */
  const ESLYRIC_STATE = { show: false, pin: false, lock: false };

  // ESLyric 插件命令
  function executeEslyricCommand(desc, onSuccess) {
    CM.getGuid(desc).then(cmd => {
      if (!cmd) return CM.showToast('执行失败', '请确认已安装 ESLyric 插件', 'error');
      CM.api('discovery.executeMainMenuCommand', cmd).then(r => {
        if (r?.success === false) return CM.showToast('执行失败', '命令执行失败', 'error');
        onSuccess();
      });
    });
  }

  // 同步状态
  function syncEslyricState() {
    [['显示桌面歌词', 'show'], ['窗口置顶', 'pin'], ['锁定桌面歌词', 'lock']].forEach((([ query, key ])  =>
      CM.api('discovery.searchCommands', { query, includeHidden: true })
        .then(cmd => ESLYRIC_STATE[key] = cmd?.results?.find(c => c.name.includes(query))?.checked ?? false)
    ));
  };
  syncEslyricState();

  // 桌面歌词开关
  CM.toggleDesktopLyric = function() {
    executeEslyricCommand('显示桌面歌词', () => {
      ESLYRIC_STATE.show = !ESLYRIC_STATE.show;
      CM.showToast(ESLYRIC_STATE.show ? '桌面歌词已开启' : '桌面歌词已关闭', null, 'success');
    });
  };

  // 桌面歌词置顶
  CM.toggleDesktopLyricPin = function() {
    executeEslyricCommand('窗口置顶', () => {
      ESLYRIC_STATE.pin = !ESLYRIC_STATE.pin;
      CM.showToast(ESLYRIC_STATE.pin ? '桌面歌词置顶已开启' : '桌面歌词置顶已关闭', null, 'success');
    });
  };

  // 桌面歌词锁定
  CM.toggleDesktopLyricLock = function() {
    executeEslyricCommand('锁定桌面歌词', () => {
      ESLYRIC_STATE.lock = !ESLYRIC_STATE.lock;
      CM.showToast(ESLYRIC_STATE.lock ? '桌面歌词锁定已开启' : '桌面歌词锁定已关闭', null, 'success');
    });
  };

  // 重置桌面歌词位置
  CM.execDesktopLyricReset = function() {
    executeEslyricCommand('重置位置', () => {
      CM.showToast('桌面歌词位置已重置', null, 'success');
    });
  };

  /* ============================================
   * 均衡器 — 通过 DSP API 切换 EQ
   * 均衡器 GUID 来自 dsp.getAvailable
   * ============================================ */
  var EQ_GUID = '{82AEF845-DCC3-4DA5-9D80-E9A972B2140D}';
  var eqMode = false;

  // 在 DSP 链中查找 EQ 的索引（-1 表示不存在）
  const findEQInChain = function (dsps) {
    return dsps?.findIndex(dsp => dsp.guid === EQ_GUID) ?? -1;
  }

  function syncEQState() {
    CM.api('dsp.getChain').then(r => eqMode = findEQInChain(r?.dsps) >= 0);
  }
  syncEQState();

  CM.toggleEQ = function () {
    CM.api('dsp.getChain').then(r => {
      if (!r) return CM.showToast('操作失败', '无法获取 DSP 链', 'error');
      const eqIndex = findEQInChain(r.dsps);
      const isActive = eqIndex >= 0;
      CM.api(`dsp.${isActive ? 'removeDsp' : 'addDsp'}`, isActive ? { index: eqIndex } : { guid: EQ_GUID }).then(res => {
        if (res?.success !== false) {
          eqMode = !isActive;
          CM.showToast(eqMode ? '均衡器已开启' : '均衡器已关闭', null, eqMode ? 'success' : null);
        } else CM.showToast('操作失败', null, 'error');
      });
    });
  };

  /* ============================================
   * 输出设备 — 列出设备并切换
   * ============================================ */
  let outputDevice = [];
  function syncOutputDevice() {
    fb2k.invoke('config.getOutputDevices').then(devices => {
      if (!devices.length) return CM.showToast('无法获取输出设备', null, 'error');
      outputDevice = devices;
    });
  }
  syncOutputDevice();

  /* ============================================
   * 关于 — 并行查询多 API，展示完整系统信息
   * ============================================ */
  CM.showAbout = function() {
    Promise.all([
      CM.api('config.getVersionInfo'),
      CM.api('playcount.getStats'),
      CM.api('config.getOutputConfig'),
      CM.api('audio.getStreamInfo')
    ]).then(function(results) {
      const [ver = {}, stats = {}, out = {}, stream = {}] = results;

      // plugin 可能是字符串或 {name,version} 对象
      var pluginVer = ver.plugin;
      if (pluginVer && typeof pluginVer === 'object') pluginVer = pluginVer.version || pluginVer.name;

      const items = [
        { label: 'CloudMusic 主题', isLabel: true },
        { html: '<span class="ctx-info-label">版本</span><span class="ctx-info-value">v2.4.1</span>' },
        { html: '<span class="ctx-info-label">作者</span><span class="ctx-info-value">灵芝含</span>' },
        { html: `<span class="ctx-info-label">foobar2000</span><span class="ctx-info-value">${CM.escHtml(ver.foobar2000 || '--')}</span>` },
        { html: `<span class="ctx-info-label">WebView2 组件</span><span class="ctx-info-value">v${CM.escHtml(pluginVer || '--')}</span>` },
        { divider: true },
        { label: '媒体库', isLabel: true },
        { html: `<span class="ctx-info-label">总曲目</span><span class="ctx-info-value">${stats.totalTracks || 0}</span>` },
        { html: `<span class="ctx-info-label">已播放</span><span class="ctx-info-value">${stats.playedTracks || 0}</span>` },
        { html: `<span class="ctx-info-label">未播放</span><span class="ctx-info-value">${stats.unplayedTracks || 0}</span>` },
        { html: `<span class="ctx-info-label">总播放次数</span><span class="ctx-info-value">${stats.totalPlayCount || 0}</span>` },
        { html: `<span class="ctx-info-label">平均播放</span><span class="ctx-info-value">${(+stats.averagePlayCount || 0).toFixed(1)} 次</span>` },
        { divider: true },
        { label: '输出', isLabel: true },
        { html: `<span class="ctx-info-label">输出模式</span><span class="ctx-info-value">${CM.escHtml(out.outputName || '--')}</span>` },
        { html: `<span class="ctx-info-label">设备</span><span class="ctx-info-value">${CM.escHtml(out.deviceName || '--')}</span>` },
        { html: `<span class="ctx-info-label">位深</span><span class="ctx-info-value">${out.bitDepth || '--'} bit</span>` },
        { html: `<span class="ctx-info-label">缓冲</span><span class="ctx-info-value">${out.bufferLength || '--'} s</span>` },
        { divider: true },
        { label: '当前播放', isLabel: true },
        { html: `<span class="ctx-info-label">编码</span><span class="ctx-info-value">${CM.escHtml(stream.codec || '--')}</span>`,disabled: !stream.playing },
        { html: `<span class="ctx-info-label">采样率</span><span class="ctx-info-value">${stream.sampleRate ? (stream.sampleRate / 1000).toFixed(1) + ' kHz' : '--'}</span>`, disabled: !stream.playing},
        { html: `<span class="ctx-info-label">比特率</span><span class="ctx-info-value">${stream.bitrate || '--'} kbps</span>`,disabled: !stream.playing },
        { html: `<span class="ctx-info-label">声道</span><span class="ctx-info-value">${stream.channels || '--'} ch</span>`,disabled: !stream.playing },
        { divider: true },
        { html: `<span class="ctx-info-label">已安装组件</span><span class="ctx-info-value">${CM.components.length || 0} 个</span>` }
      ];

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
        item.innerHTML = `${CM.icons.tag || ''}<span>批量编辑标签（${state.batchSelected.size}首）</span>`;
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
