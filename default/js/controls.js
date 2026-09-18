/* ============================================
 * CloudMusic controls.js — 交互事件绑定
 * 播放控制 / 进度音量 / 频谱 / 队列 / 更多菜单
 * 拖放 / 键盘快捷键 / 任务栏
 * ============================================ */
(function () {
  'use strict';
  const CM = window.CloudMusic,
    els = CM.els, state = CM.state;

  /* ============================================
   * 导航 / Tab
   * ============================================ */
  CM.bindNavigation = function () {
    document.querySelectorAll('.nav-item[data-tab]').forEach(el => {
      el.addEventListener('click', () => CM.switchTab(el.dataset.tab));
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') CM.switchTab(el.dataset.tab);
      });
    });
    document.querySelectorAll('.main-tab[data-tab]').forEach(el =>
      el.addEventListener('click', () => CM.switchTab(el.dataset.tab))
    );

    // 侧栏搜索 → 跳到搜索页
    els.sidebarSearch.addEventListener('input', () =>
      els.sidebarSearchWrap.classList.toggle('has-text', !!els.sidebarSearch.value)
    );
    els.sidebarSearch.addEventListener('keydown', e => {
      if (e.key === 'Enter' && els.sidebarSearch.value.trim()) {
        CM.switchTab('search');
        els.searchInput.value = els.sidebarSearch.value;
        CM.doSearch(els.searchInput.value);
      }
    });
    els.sidebarSearchClear.addEventListener('click', () => {
      els.sidebarSearch.value = '';
      els.sidebarSearchWrap.classList.remove('has-text');
      els.sidebarSearch.focus();
    });

    // 搜索页输入（防抖）
    els.searchInput.addEventListener('input', CM.debounce(() => CM.doSearch(els.searchInput.value), 350));

    // 新建歌单
    els.addPlaylistBtn.addEventListener('click', () => {
      CM.showModal({ title: '新建歌单', input: '', okText: '创建' }).then(name => {
        if (!name) return;
        CM.api('playlist.create', { name }).then(r => {
          if (r?.success !== false) CM.showToast('已创建歌单', name, 'success');
        });
      });
    });
  };

  /* ============================================
   * 发现页按钮
   * ============================================ */
  CM.bindDiscover = function () {
    els.btnPlayDaily.addEventListener('click', () => CM.playDaily());
    els.btnRefreshDiscover.addEventListener('click', () => CM.renderDiscover());
    els.refreshRandom.addEventListener('click', () => CM.renderDiscoverRandom());
    els.moreAlbums.addEventListener('click', () => CM.openLibraryDetail('albums', null));
    els.moreRecent.addEventListener('click', () => CM.openLibraryDetail('stats', null));
  };

  /* ============================================
   * 播放列表页按钮 / 表头排序
   * ============================================ */
  CM.bindPlaylistView = function () {
    els.btnPlayAll.addEventListener('click', () => {
      if (state.currentPlaylistIndex < 0) return;
      CM.api('playlist.playTrack', { playlist: state.currentPlaylistIndex, index: 0 });
    });
    els.btnPlaylistMore.addEventListener('click', e => {
      e.stopPropagation();
      const rect = els.btnPlaylistMore.getBoundingClientRect();
      const idx = state.currentPlaylistIndex;
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
            .then(r => { if (r?.success !== false) CM.showToast('已反转列表顺序', null, 'success'); }),
        },
        { divider: true },
        {
          label: '撤销上一步', icon: CM.icons.undo, disabled,
          action: () => CM.api('playlist.undo', { playlist: idx }),
        },
        {
          label: '恢复上一步', icon: CM.icons.redo, disabled,
          action: () => CM.api('playlist.redo', { playlist: idx }),
        },
      ];
      CM.showCtxMenu(rect.left, rect.bottom + 6, items);
    });
    // 表头点击排序（客户端视图排序）
    els.trackTable.querySelectorAll('thead th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (state.sortKey !== key) {
          state.sortKey = key;
          state.sortAsc = true;
        } else if (state.sortAsc) {
          state.sortAsc = false;
        } else {
          state.sortKey = null;
          state.sortAsc = true; // 第三次点击取消排序
        }
        CM.renderTrackTable();
      });
    });
  };

  CM.els.position.addEventListener('click', () =>
    els.trackTbody.querySelector(`tr[data-index="${state.playingTrackIndex}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  );

  /* ============================================
   * 通用 seekbar 绑定（主进度条 + 沉浸式进度条共用）
   * ============================================ */
  CM.bindSeekBar = function (bar, timeLabel, cssVar, seekingKey, updateFn) {
    bar.addEventListener('input', () => {
      state[seekingKey] = true;
      const pct = bar.value / 1000;
      bar.style.setProperty(cssVar, `${(pct * 100).toFixed(2)}%`);
      timeLabel.textContent = CM.formatTime(pct * state.duration);
    });
    bar.addEventListener('change', () => {
      const pct = bar.value / 1000;
      const seconds = pct * state.duration;
      // 不在此处更新 state.position，交给 playback:seeked / timeHighRes 事件统一处理，
      // 避免因 API 返回 undefined/null 时误把旧位置覆盖掉 seeked 事件已写入的正确位置。
      CM.api('playback.setPosition', { seconds }).then(r => {
        state[seekingKey] = false;
        updateFn();
      });
    });
  };

  /* ============================================
   * 底栏播放控制
   * ============================================ */
  CM.bindPlaybackControls = function () {
    els.btnPlayPause.addEventListener('click', () => CM.api('playback.playOrPause'));
    els.btnPrev.addEventListener('click', () => CM.api('playback.previous'));
    els.btnNext.addEventListener('click', () => CM.api('playback.next'));

    // 播放顺序：单按钮循环 顺序→列表循环→单曲循环→随机
    els.btnOrder.addEventListener('click', () => {
      const next = CM.ORDERS[(CM.orderIndexOf(state.order) + 1) % CM.ORDERS.length];
      CM.api('playback.setPlaybackOrder', { order: next.id }).then(r => {
        if (!r) return CM.showToast('切换失败', null, 'error');
        state.order = next.id;
        CM.updateOrderIcon();
        CM.showToast('播放顺序', next.name, 'success');
      });
    });

    // 停止播放
    els.btnStop.addEventListener('click', () => {
      fb2k.invoke('playback.stop');
      CM.showToast('已停止播放', null, 'success');
    });

    // 播完当前停止
    els.btnStop.addEventListener('contextmenu', () => {
      CM.api('playback.toggleStopAfterCurrent').then(r => {
        state.stopAfterCurrent = r.enabled;
        CM.updateStopIcon();
        CM.showToast(state.stopAfterCurrent ? '将在当前曲目播完后停止' : '已取消单曲停止', null);
      });
    });

    // 进度条
    CM.bindSeekBar(els.seekBar, els.seekCurrent, '--seek-pct', 'seeking', CM.updateSeekUI);

    // 音量
    els.volSlider.addEventListener('input', () => {
      const volume = parseInt(els.volSlider.value, 10);
      state.volume = volume;
      state.muted = false;
      els.volSlider.style.setProperty('--vol-pct', `${volume}%`);
      CM.api('playback.setVolume', { volume });
      CM.updateVolumeIcon();
    });
    els.volBtn.addEventListener('click', () => CM.api('playback.toggleMute'));
    // 音量滚轮微调
    els.volBtn.parentElement.addEventListener('wheel', e => {
      e.preventDefault();
      const volume = Math.max(0, Math.min(100, state.volume + (e.deltaY < 0 ? 5 : -5)));
      state.volume = volume;
      state.muted = false;
      CM.api('playback.setVolume', { volume });
      CM.updateVolumeIcon();
    }, { passive: false });

    // 队列抽屉
    els.btnQueue.addEventListener('click', () => CM.toggleQueue());
    els.queueClose.addEventListener('click', () => CM.toggleQueue(false));
    els.queueClear.addEventListener('click', () =>
      CM.api('queue.clear').then(() => {
        CM.renderQueue();
        CM.refreshQueueBadge();
        CM.showToast('已清空播放队列', null);
      })
    );

    // 歌词面板开关
    els.btnLyricsToggle.addEventListener('click', () => CM.setLyricsVisible(!state.lyricsVisible));
    // 底栏封面：单击展开歌词面板，双击进入沉浸式模式
    els.bottomArtWrap.addEventListener('click', () => {
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
    els.btnVisualizer.addEventListener('click', () => CM.setVisualizerActive(!state.visualizerActive));

    // 更多菜单
    els.btnMore.addEventListener('click', e => showMoreMenu(e.clientX, e.clientY));
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
    ];
    CM.showCtxMenu(x, y, items);
  }

  /* ============================================
   * 播放增益（ReplayGain）面板
   * ============================================ */
  let replaygain = [];
  function syncReplaygain() {
    const item = (label, field, value, current) => ({
      label, checked: current === value,
      action: () => {
        CM.api('replaygain.setMode', { [field]: value });
        syncReplaygain();
      }
    });

    CM.api('replaygain.getSettings').then(res => {
      replaygain = [
        {
          label: '增益来源',
          submenu: [
            item('无', 'sourceMode', 'none', res.sourceMode),
            item('音轨', 'sourceMode', 'track', res.sourceMode),
            item('专辑', 'sourceMode', 'album', res.sourceMode)
          ]
        },
        {
          label: '处理方式',
          submenu: [
            item('关闭', 'processingMode', 'none', res.processingMode),
            item('增益', 'processingMode', 'gain', res.processingMode),
            item('增益 + 峰值', 'processingMode', 'gain_and_peak', res.processingMode),
            item('峰值', 'processingMode', 'peak', res.processingMode)
          ]
        }
      ];
    });
  }
  syncReplaygain();

  /* ============================================
   * 迷你频谱
   * ============================================ */
  const SPEC_BARS = 16;
  let spectrumUnsub = null, specBarEls = [];

  // 通用频谱条生成器（迷你频谱 + 沉浸式频谱共用）
  CM.createSpectrumBars = function (container, count, barClass) {
    container.innerHTML = `<div class="${barClass}"></div>`.repeat(count);
    return [...container.children];
  };

  CM.initSpectrumBars = function () {
    specBarEls = CM.createSpectrumBars(els.miniSpectrum, SPEC_BARS, 'mini-spec-bar');
  };

  CM.setVisualizerActive = function (active) {
    state.visualizerActive = CM.settings.visualizer = active;
    CM.saveSettings();
    els.btnVisualizer.classList.toggle('active', active);
    els.miniSpectrum.style.display = active ? '' : 'none';
    if (active) CM.startSpectrum();
    else CM.stopSpectrum();
  };

  CM.startSpectrum = function () {
    if (spectrumUnsub || !fb.isAvailable()) return;
    spectrumUnsub = fb.audio.subscribeSpectrum(data => {
      CM.updateSpectrumBars(specBarEls, data?.spectrum, SPEC_BARS, 18, 20);
      // 同步更新沉浸式频谱
      CM.updateNpSpectrum(data);
    }, { fftSize: 8192, fps: 30, bands: 64 });
  };

  CM.stopSpectrum = function () {
    if (spectrumUnsub) { spectrumUnsub(); spectrumUnsub = null; }
    specBarEls.forEach(el => el.style.transform = 'scaleY(0.1)');
  };

  /* ============================================
   * 拖放（宿主 dnd API，回退 HTML5 提示）
   * ============================================ */
  const AUDIO_EXT = /\.(mp3|flac|wav|aac|m4a|mp4|opus|ogg|oga|wma|ape|wv|alac|aiff|aif|dsf|dff|tak|tta|mpc|mka|m4b|m4r)$/i;
  // 把拖入的路径展开成可播放的音频文件
  CM.expandPaths = async function (raw) {
    return (await Promise.all(
      raw.filter(Boolean).map(async path => {
        const info = await fb2k.invoke('file.getInfo', { path });
        if (info.isFile) return [path];
        if (info.isDirectory) return (await fb2k.invoke('file.list', { path, pattern: '*.*', recursive: true })).files ?? [];
      })
    )).flat().filter(f => AUDIO_EXT.test(f));
  };

  // 统一入口：把拖进来的（文件/文件夹）路径加到当前歌单
  CM.addDroppedPaths = function (raw) {
    CM.expandPaths(raw).then(paths => {
      if (!paths.length) return;

      const params = { paths };
      if (state.currentPlaylistIndex >= 0) params.playlist = state.currentPlaylistIndex;

      CM.api('playlist.addPathsAsync', params).then(res => {
        if (res?.success !== false) CM.showToast(`正在添加 ${paths.length} 个项目`, null, 'success');
      });
    });
  };

  CM.initDragDrop = function () {
    // v1.12.0 起 dnd 改为主机原生观察，不再注册 drop zone；
    // 读路径统一走 dnd.getPathsAsync（await 安全、不依赖消息顺序）。
    let lastDropAt = 0;
    // 宿主 dnd:drop 与 HTML5 window drop 先后顺序不定，谁先处理谁生效，
    // 另一路在 500ms 内直接跳过，避免同一批文件被重复添加
    const claimDrop = () => {
      const now = Date.now();
      if (now - lastDropAt < 500) return false;
      lastDropAt = now;
      return true;
    };
    const showOverlay = on => els.dropOverlay.classList.toggle('active', on);
    const isFileDrag = e => {
      const t = e.dataTransfer?.types;
      return !!t && (t.includes('Files') || t.includes('files'));
    };

    fb.on('dnd:enter', () => showOverlay(true));
    fb.on('dnd:leave', () => showOverlay(false));
    fb.on('dnd:drop', data => {
      showOverlay(false);
      if (!claimDrop()) return;
      CM.api('dnd.getPathsAsync', { sessionId: data?.sessionId }).then(r => {
        let paths = r?.paths || r?.files || [];
        if (!paths.length && data?.paths) paths = data.paths;
        CM.addDroppedPaths(paths);
      });
    });

    // 视觉反馈（WebView2 内 dragover 依然会触发）
    let dragDepth = 0;
    window.addEventListener('dragenter', e => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth++;
      showOverlay(true);
    });
    window.addEventListener('dragleave', e => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      if (--dragDepth <= 0) {
        dragDepth = 0;
        showOverlay(false);
      }
    });
    window.addEventListener('dragover', e => { if (isFileDrag(e)) e.preventDefault(); });
    window.addEventListener('drop', e => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth = 0;
      showOverlay(false);
      if (!claimDrop()) return;
      // 文档推荐在 HTML5 drop handler 内用 getPathsAsync 读取宿主会话的真实路径
      //（同步 getPaths 在快速拖放时会读到空数组，故不用它做唯一来源）。
      // 文件夹路径由宿主端 addPathsAsync 自动展开其中的音频文件。
      CM.api('dnd.getPathsAsync').then(r => {
        const paths = r?.paths || r?.files || [];
        if (paths.length) CM.addDroppedPaths(paths);
      });
    });
  };

  /* ============================================
   * 键盘快捷键
   * ============================================ */
  CM.initKeyboard = function () {
    document.addEventListener('keydown', e => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          CM.api('playback.playOrPause');
          break;
        case 'arrowleft':
          if (e.ctrlKey) CM.api('playback.previous');
          else CM.api('playback.setPosition', { seconds: Math.max(0, state.position - 5) });
          break;
        case 'arrowright':
          if (e.ctrlKey) CM.api('playback.next');
          else CM.api('playback.setPosition', { seconds: Math.min(state.duration, state.position + 5) });
          break;
        case 'arrowup':
          e.preventDefault();
          if (e.altKey) CM.keyboardMoveTracks(-1); // Alt+↑ 上移选中/聚焦曲目
          else CM.api('playback.volumeUp');
          break;
        case 'arrowdown':
          e.preventDefault();
          if (e.altKey) CM.keyboardMoveTracks(1);  // Alt+↓ 下移选中/聚焦曲目
          else CM.api('playback.volumeDown');
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
        case 'escape':
          if (state.queueOpen) CM.toggleQueue(false);
          CM.hideCtxMenu();
          // 关闭标签编辑器
          if (CM.$('tagEditorOverlay')?.classList.contains('open')) CM.hideTagEditor();
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
  CM.initTaskbar = function () {
    // 探测任务栏 API 可用性（进度条依赖）；不可用时静默跳过
    CM.api('taskbar.setProgress', { state: 'none' }).then(r => CM.taskbarAvailable = !!r?.success);
  };

  // 节流：仅当可见进度 1% 变化时才通过 IPC 更新任务栏，避免 timeHighRes 高频事件（~30次/秒）反复调用宿主 API
  let _lastTaskbarVal = -1, _lastTaskbarState = null;
  CM.updateTaskbarProgress = function () {
    if (!CM.taskbarAvailable) return;
    if (!CM.currentTrack || state.duration <= 0) {
      if (_lastTaskbarVal !== -2) {
        _lastTaskbarVal = -2;
        CM.api('taskbar.setProgress', { state: 'none' });
      }
      return;
    }

    const stateName = fb.state.isPlaying ? 'normal' : 'paused';
    const value = Math.min(1, Math.max(0, state.position / state.duration));
    const pct = Math.round(value * 100);

    if (pct === _lastTaskbarVal && stateName === _lastTaskbarState) return;

    _lastTaskbarVal = pct;
    _lastTaskbarState = stateName;
    CM.api('taskbar.setProgress', { state: stateName, value });
  };

  /* ============================================
   * 沉浸式 NowPlaying 事件绑定
   * ============================================ */
  CM.bindNpOverlay = function () {
    // 右侧面板进入沉浸式按钮
    els.rpImmersiveBtn.addEventListener('click', () => CM.toggleNpOverlay(true));
    // 关闭按钮
    els.npCloseBtn.addEventListener('click', () => CM.toggleNpOverlay(false));

    // 沉浸式顶部拖拽条：无系统标题栏时仍可移动窗口
    const npDrag = CM.$('npDragHandle');
    if (npDrag) {
      npDrag.addEventListener('mousedown', e => { if (e.button === 0) CM.api('window.startDrag'); });
      npDrag.addEventListener('dblclick', () => CM.api('window.toggleMaximize'));
    }

    // 模式切换
    els.npModeBtn.addEventListener('click', () => CM.toggleNpMode());

    // 播放控制（主视图 + 纯歌词模式两套，动作相同）
    const bindTransport = (play, prev, next) => {
      play.addEventListener('click', () => CM.api('playback.playOrPause'));
      prev.addEventListener('click', () => CM.api('playback.previous'));
      next.addEventListener('click', () => CM.api('playback.next'));
    };
    bindTransport(els.npBtnPlay, els.npBtnPrev, els.npBtnNext);
    bindTransport(els.npLcPlay, els.npLcPrev, els.npLcNext);

    // 沉浸式进度条
    CM.bindSeekBar(els.npSeekBar, els.npTimeCurrent, '--np-seek-pct', 'npSeeking', CM.updateNpSeekUI);

    // ESC 关闭沉浸式
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && state.npOpen) CM.toggleNpOverlay(false);
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
    [['显示桌面歌词', 'show'], ['窗口置顶', 'pin'], ['锁定桌面歌词', 'lock']].forEach((([query, key]) =>
      CM.api('discovery.searchCommands', { query, includeHidden: true })
        .then(cmd => ESLYRIC_STATE[key] = cmd?.results?.find(c => c.name.includes(query))?.checked ?? false)
    ));
  };
  syncEslyricState();

  // 桌面歌词开关
  CM.toggleDesktopLyric = function () {
    executeEslyricCommand('显示桌面歌词', () => {
      ESLYRIC_STATE.show = !ESLYRIC_STATE.show;
      CM.showToast(ESLYRIC_STATE.show ? '桌面歌词已开启' : '桌面歌词已关闭', null, 'success');
    });
  };

  // 桌面歌词置顶
  CM.toggleDesktopLyricPin = function () {
    executeEslyricCommand('窗口置顶', () => {
      ESLYRIC_STATE.pin = !ESLYRIC_STATE.pin;
      CM.showToast(ESLYRIC_STATE.pin ? '桌面歌词置顶已开启' : '桌面歌词置顶已关闭', null, 'success');
    });
  };

  // 桌面歌词锁定
  CM.toggleDesktopLyricLock = function () {
    executeEslyricCommand('锁定桌面歌词', () => {
      ESLYRIC_STATE.lock = !ESLYRIC_STATE.lock;
      CM.showToast(ESLYRIC_STATE.lock ? '桌面歌词锁定已开启' : '桌面歌词锁定已关闭', null, 'success');
    });
  };

  // 重置桌面歌词位置
  CM.execDesktopLyricReset = function () {
    executeEslyricCommand('重置位置', () => CM.showToast('桌面歌词位置已重置', null, 'success'));
  };

  /* ============================================
   * 均衡器 — 通过 DSP API 切换 EQ
   * 均衡器 GUID 来自 dsp.getAvailable
   * ============================================ */
  const EQ_GUID = '{82AEF845-DCC3-4DA5-9D80-E9A972B2140D}';
  let eqMode = false;

  // 在 DSP 链中查找 EQ 的索引（-1 表示不存在）
  const findEQInChain = function (dsps) {
    return dsps?.findIndex(dsp => dsp.guid === EQ_GUID) ?? -1;
  };

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
  CM.showAbout = function () {
    Promise.all([
      CM.api('config.getVersionInfo'),
      CM.api('playcount.getStats'),
      CM.api('config.getOutputConfig'),
      CM.api('audio.getStreamInfo')
    ]).then(([ver = {}, stats = {}, out = {}, stream = {}]) => {
      // plugin 可能是字符串或 {name,version} 对象
      let pluginVer = ver.plugin;
      if (pluginVer && typeof pluginVer === 'object') pluginVer = pluginVer.version || pluginVer.name;

      const info = (label, value, disabled) => ({
        disabled,
        html: `<span class="ctx-info-label">${label}</span><span class="ctx-info-value">${value}</span>`
      });
      const esc = CM.escHtml;

      const items = [
        { label: 'CloudMusic 主题', isLabel: true },
        info('版本', 'v2.5.1'),
        info('作者', '灵芝含'),
        info('foobar2000', esc(ver.foobar2000 || '--')),
        info('WebView2 组件', `v${esc(pluginVer || '--')}`),
        { divider: true },
        { label: '媒体库', isLabel: true },
        info('总曲目', stats.totalTracks || 0),
        info('已播放', stats.playedTracks || 0),
        info('未播放', stats.unplayedTracks || 0),
        info('总播放次数', stats.totalPlayCount || 0),
        info('平均播放', `${(+stats.averagePlayCount || 0).toFixed(1)} 次`),
        { divider: true },
        { label: '输出', isLabel: true },
        info('输出模式', esc(out.outputName || '--')),
        info('设备', esc(out.deviceName || '--')),
        info('位深', `${out.bitDepth || '--'} bit`),
        info('缓冲', `${out.bufferLength || '--'} s`),
        { divider: true },
        { label: '当前播放', isLabel: true },
        info('编码', esc(stream.codec || '--'), !stream.playing),
        info('采样率', `${stream.sampleRate ? (stream.sampleRate / 1000).toFixed(1) : '--'} kHz`, !stream.playing),
        info('比特率', `${stream.bitrate || '--'} kbps`, !stream.playing),
        info('声道', `${stream.channels || '--'} ch`, !stream.playing),
        { divider: true },
        info('已安装组件', `${CM.components.length || 0} 个`),
      ];

      const { left, bottom } = els.btnMore.getBoundingClientRect();
      CM.showCtxMenu(left, bottom + 6, items);
    }).catch(() => CM.showToast('获取信息失败', null, 'error'));
  };

  /* ============================================
   * 标签编辑器 — 事件绑定
   * ============================================ */
  CM.bindTagEditor = function () {
    // 关闭/取消
    els.tagEditorClose.addEventListener('click', CM.hideTagEditor);
    els.tagEditorCancel.addEventListener('click', CM.hideTagEditor);
    // 点击遮罩关闭
    els.tagEditorOverlay.addEventListener('mousedown', e => {
      if (e.target === els.tagEditorOverlay) CM.hideTagEditor();
    });
    // 保存
    els.tagEditorSave.addEventListener('click', CM._saveTagEditor);
    // 封面管理（事件委托，因为按钮是动态渲染的）
    els.tagEditorBody.addEventListener('click', e => {
      if (e.target.id === 'tagCoverReplace') CM._replaceCover();
      else if (e.target.id === 'tagCoverRemove') CM._removeCover();
    });
    // 文件选择回调
    els.tagCoverFile.addEventListener('change', CM._onCoverFileSelected);

    // 批量操作栏
    els.batchEditTags.addEventListener('click', CM._batchEditFromBar);
    els.batchDeleteTracks.addEventListener('click', CM._batchDeleteFromBar);
    els.batchClear.addEventListener('click', CM.clearBatchSelection);
  };

  /* ============================================
   * 在线标签获取 — 通过 discovery API 调用 foo_freedb2
   * 首次搜索后缓存命令，后续直接执行
   * ============================================ */
  CM.fetchTagsOnline = function (path) {
    if (!path) return;

    CM.api('discovery.executeContextMenuCommand', CM.getGuid('freedb')).then(r => {
      if (!r?.success) return CM.showToast('获取失败', '命令执行失败，请尝试在 foobar2000 中手动操作', 'error');
      CM.showToast('已触发在线获取', '请在弹出的窗口中完成操作', null);
    });
  };

  /* ============================================
   * 播放列表「更多」菜单 — 批量编辑入口
   * ============================================ */
  // 在 more 菜单中追加「批量编辑标签」选项（当有多选时显示）
  // 通过包装 showCtxMenu 实现：拦截 more 按钮的 click 事件
  // 在原菜单项后追加批量编辑项
  els.btnPlaylistMore.addEventListener('click', () => {
    if (state.batchSelected.size < 2) return;

    // 延迟追加，确保在原菜单渲染后执行
    setTimeout(() => {
      const menu = els.ctxMenu;
      if (menu.classList.contains('hidden')) return;

      const divider = document.createElement('div');
      divider.className = 'ctx-divider';

      const item = document.createElement('div');
      item.className = 'ctx-item';
      item.dataset.idx = menu.children.length;
      item.innerHTML = `${CM.icons.tag || ''}<span>批量编辑标签（${state.batchSelected.size}首）</span>`;
      item.addEventListener('click', () => {
        CM.hideCtxMenu();
        CM._batchEditFromBar();
      });

      menu.append(divider, item);
    }, 0);
  }, true); // 捕获阶段，确保在原 handler 之前执行

})();
