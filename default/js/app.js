/* ============================================
 * CloudMusic app.js — 初始化编排
 * 顺序：设置 → UI 绑定 → fb.ready → 状态同步 → 事件订阅 → 首屏渲染
 * ============================================ */
(function() {
  'use strict';
  var CM = window.CloudMusic;

  /* ============================================
   * 播放/暂停可视状态（图标 + 表格均衡器动画 + 任务栏）
   * ============================================ */
  function setPlayingVisual(isPlaying) {
    CM.updatePlayPauseIcon(isPlaying);
    document.body.classList.toggle('is-playing', isPlaying);
    CM.updateTaskbarProgress();
    // 更新沉浸式唱片旋转 + 播放按钮状态
    if (CM.state.npOpen) {
      CM.updateNpVinylState();
      CM.els.npBtnPlay.classList.toggle('playing', !!isPlaying);
      CM.els.npLcPlay.classList.toggle('playing', !!isPlaying);
    }
  }

  /* ============================================
   * 曲目切换统一处理
   * ============================================ */
  function onTrackChanged(track) {
    CM.updateTrackInfo(track);
    CM.loadCurrentArtwork();
    CM.loadLyrics();
    CM.refreshLikeState();
    CM._renderQueueNow(); // 队列抽屉"正在播放"卡片
    // 如果沉浸式页面打开，重新渲染
    if (CM.state.npOpen) {
      setTimeout(function() { CM.renderNpOverlay(); }, 200);
    }
    // 同步"正在播放"标记（列表行 / 侧栏歌单徽标）
    Promise.all([
      CM.api('playback.getPlayingPlaylist'),
      CM.api('playback.getCurrentTrackIndex')
    ]).then(function(rs) {
      var pl = rs[0], ti = rs[1];
      var newPl = pl && pl.playlist != null ? pl.playlist : (pl && pl.index != null ? pl.index : -1);
      var changed = newPl !== CM.state.playingPlaylistIndex;
      CM.state.playingPlaylistIndex = newPl;
      CM.state.playingTrackIndex = ti && ti.index != null ? ti.index : -1;
      CM.refreshPlayingMarks();
      if (changed) CM.loadPlaylists();
    });
  }

  function onStopped() {
    CM.currentTrack = null;
    CM._renderQueueNow(); // 隐藏队列抽屉"正在播放"卡片
    CM.state.playingTrackIndex = -1;
    CM.state.position = 0;
    CM.state.duration = 0;
    CM.updateTrackInfo(null);
    CM.setArtwork(null);
    CM.renderLyricsEmpty('暂无播放曲目');
    CM.updateSeekUI();
    setPlayingVisual(false);
    CM.refreshPlayingMarks();
    // 不关闭沉浸式页面 — 切歌时 stopped 会短暂触发，关闭会导致闪烁退出
  }

  /* ============================================
   * 初始状态同步（fb.ready 之后）
   * ============================================ */
  function syncInitialState() {
    CM.api('playback.getState').then(function(r) {
      if (!r) return;
      var playing = r.isPlaying != null ? r.isPlaying : r.playing;
      var paused = r.isPaused != null ? r.isPaused : r.paused;
      CM.state.duration = r.duration || r.length || 0;
      CM.state.position = r.position || 0;
      CM.updateSeekUI();
      setPlayingVisual(!!playing && !paused);
    });
    CM.api('playback.getCurrentTrack').then(function(r) {
      var track = r && (r.track || (r.title || r.path ? r : null));
      if (track) onTrackChanged(track);
    });
    CM.api('playback.getVolume').then(function(r) {
      if (!r) return;
      if (r.volume != null) CM.state.volume = r.volume;
      if (r.isMuted != null) CM.state.muted = r.isMuted;
      if (CM.els.volSlider) CM.els.volSlider.value = CM.state.volume;
      CM.updateVolumeIcon();
    });
    CM.api('playback.getPlaybackOrder').then(function(r) {
      if (!r) return;
      CM.state.order = r.order != null ? r.order : (r.index != null ? r.index : 0);
      CM.updateOrderIcon();
    });
    CM.api('playback.getStopAfterCurrent').then(function(r) {
      if (!r) return;
      CM.state.stopAfterCurrent = !!(r.enabled != null ? r.enabled : r.stopAfterCurrent);
      CM.updateStopAfterIcon();
    });
    CM.refreshQueueBadge();
  }

  /* ============================================
   * 事件订阅（全部事件驱动，不做轮询）
   * ============================================ */
  function subscribeEvents() {
    fb.on('playback:trackChanged', function(data) {
      var track = data && (data.track || data);
      onTrackChanged(track);
      if (CM.state.npOpen) { CM.updateNpFormat(); CM.loadNpWaveform(CM.trackPath(CM.currentTrack)); }
      setPlayingVisual(true);
    });

    fb.on('playback:stateChanged', function(data) {
      if (!data) return;
      if (data.duration != null) CM.state.duration = data.duration;
      if (data.position != null && !CM.state.seeking) CM.state.position = data.position;
      CM.updateSeekUI();
      if (data.state != null) setPlayingVisual(data.state === 'playing' || data.state === 1);
    });

    fb.on('playback:paused', function(data) {
      setPlayingVisual(!(data && data.paused));
    });

    // 高分辨率进度事件 — 驱动进度条 + 歌词高亮 + 任务栏进度
    fb.on('playback:timeHighRes', function(data) {
      if (!data || data.position == null) return;
      if (!CM.state.seeking) {
        CM.state.position = data.position;
        CM.updateSeekUI();
      }
      CM.updateLyricHighlight();
      CM.updateTaskbarProgress();
      // 同步更新沉浸式页面
      if (CM.state.npOpen) {
        if (!CM.state.npSeeking) CM.updateNpSeekUI();
        CM.updateNpLyricHighlight();
      }
    });

    fb.on('playback:seeked', function(data) {
      if (data && data.position != null) CM.state.position = data.position;
      CM.state.seeking = false;
      CM.state.npSeeking = false;
      CM.updateSeekUI();
      if (CM.state.npOpen) CM.updateNpSeekUI();
      CM.updateLyricHighlight(true);
    });

    fb.on('playback:volumeChanged', function(data) {
      if (!data) return;
      if (data.volume != null) CM.state.volume = data.volume;
      if (data.isMuted != null) CM.state.muted = data.isMuted;
      if (CM.els.volSlider) CM.els.volSlider.value = CM.state.volume;
      CM.updateVolumeIcon();
      CM.settings.volume = CM.state.volume;
      CM.saveSettings();
    });

    fb.on('playback:orderChanged', function(data) {
      if (!data || data.order == null) return;
      CM.state.order = data.order;
      CM.updateOrderIcon();
    });

    fb.on('playback:stopAfterCurrentChanged', function(data) {
      CM.state.stopAfterCurrent = !!(data && data.enabled);
      CM.updateStopAfterIcon();
    });

    fb.on('playback:queueChanged', function() {
      CM.refreshQueueBadge();
      if (CM.state.queueOpen) CM.renderQueue();
    });

    // 输出设备切换（如接入解码器）会打断宿主侧的频谱计算管线，但页面仍持有旧订阅句柄，
    // 导致频谱流永久中断（直到刷新页面）。此处先停掉旧订阅再重新订阅即可恢复。
    fb.on('audio:outputDeviceChanged', function() {
      if (!CM.state.visualizerActive) return;
      CM.stopSpectrum();
      CM.startSpectrum();
    });

    fb.on('playback:stopped', onStopped);

    // 播放列表结构变化 → 刷新侧栏 + 当前列表视图
    var refreshPlaylistUI = CM.debounce(function() {
      CM.loadPlaylists();
      if (CM.state.currentTab === 'playlist' && CM.state.currentPlaylistIndex >= 0) {
        CM.renderPlaylistView(CM.state.currentPlaylistIndex);
      }
    }, 200);
    ['playlist:created', 'playlist:renamed', 'playlist:removed', 'playlist:activated',
     'playlist:itemsAdded', 'playlist:itemsRemoved', 'playlist:itemsReordered'
    ].forEach(function(ev) { fb.on(ev, refreshPlaylistUI); });

    // 媒体库就绪后重绘发现页（首次启动时库可能延迟初始化）
    fb.on('library:initialized', function() {
      if (CM.state.currentTab === 'discover') CM.renderDiscover();
    });

    // 标签写入完成事件（metadata.write / removeTag 异步完成时广播）
    fb.on('metadata:writeComplete', function(e) {
      if (e && e.success) {
        // 刷新播放列表表格以显示更新后的标签
        if (CM.state.currentTab === 'playlist') CM.renderTrackTable();
      }
    });
  }

  /* ============================================
   * 启动
   * ============================================ */
  function boot() {
    CM.loadSettings();
    CM.state.lyricsVisible = CM.settings.lyricsVisible !== false;
    CM.state.visualizerActive = CM.settings.visualizer !== false;

    // UI 绑定（不依赖宿主，先行执行保证界面可交互）
    CM.initTitlebar();
    CM.bindNavigation();
    CM.bindDiscover();
    CM.bindPlaylistView();
    CM.bindPlaybackControls();
    CM.initSpectrumBars();
    CM.initKeyboard();
    CM.bindNpOverlay();
    CM.bindTagEditor();

    CM.setLyricsVisible(CM.state.lyricsVisible);
    CM.setVisualizerActive(CM.state.visualizerActive);
    CM.updateOrderIcon();
    CM.updateVolumeIcon();
    CM.updateStopAfterIcon();

    // 首屏渲染（API 失败时各渲染函数自带空态/错误态）
    CM.renderDiscover();
    var plPromise = CM.loadPlaylists();
    CM.switchTab(CM.settings.tab || 'discover');

    // 宿主就绪后：状态同步 + 事件订阅 + 宿主专属能力
    var readyFn = (typeof fb.ready === 'function') ? fb.ready.bind(fb) : function() { return Promise.resolve(); };
    readyFn().then(function() {
      syncInitialState();
      subscribeEvents();
      CM.initDragDrop();
      CM.initTaskbar();
      // 打开“上次听歌的歌单”（按名称持久化），找不到/未记忆则退回活跃歌单
      plPromise.then(function() {
        var saved = CM.settings.lastPlaylist;
        var lists = CM.playlists || [];
        var target = -1;
        if (saved) {
          for (var i = 0; i < lists.length; i++) {
            if (lists[i].name === saved) { target = lists[i].index; break; }
          }
        }
        CM.api('playlist.getActive').then(function(r) {
          var idx = r && (r.index != null ? r.index : r.playlist);
          var use = target >= 0 ? target : (idx != null && idx >= 0 ? idx : target);
          if (use >= 0) {
            CM.state.currentPlaylistIndex = use;
            CM.loadPlaylists(); // 刷新侧栏“当前歌单”高亮
            if (CM.state.currentTab === 'playlist') CM.renderPlaylistView(use);
          }
        });
      });
    }).catch(function() {
      // 宿主桥接未就绪，以受限模式运行
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
