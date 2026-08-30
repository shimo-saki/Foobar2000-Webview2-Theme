/* ============================================
 * CloudMusic ui-nowplaying.js — 沉浸式 NowPlaying
 * 唱片/纯歌词双模式 / 波形进度条背景 / 频谱 / 编码信息栏
 * ============================================ */

(function() {
  'use strict';
  var CM = window.CloudMusic;
  var els = CM.els, state = CM.state, esc = CM.escHtml;
  var DEFAULT_TRACK_COVER = CM.DEFAULT_TRACK_COVER;

  /* ============================================
   * 沉浸式 NowPlaying
   * ============================================ */
  CM.toggleNpOverlay = function(open) {
    state.npOpen = open !== undefined ? open : !state.npOpen;
    if (state.npOpen) {
      CM.renderNpOverlay();
      els.npOverlay.classList.add('open');
      document.body.style.overflow = 'hidden';
      // 关闭歌词面板节省资源
      if (state.lyricsVisible) CM.setLyricsVisible(false, true);
    } else {
      els.npOverlay.classList.remove('open');
      document.body.style.overflow = '';
      // 恢复歌词面板
      if (!state.lyricsVisible) CM.setLyricsVisible(true, true);
    }
  };

  CM.renderNpOverlay = function() {
    // 同步封面（getAttribute 判断：未设置 src 时 .src 返回页面基址 URL，恒为 truthy）
    var artUrl = els.bottomArt.getAttribute('src');
    if (artUrl) {
      els.npArtwork.src = artUrl;
      els.npBgBlur.style.backgroundImage = 'url("' + artUrl + '")';
    } else {
      els.npArtwork.src = DEFAULT_TRACK_COVER;
      els.npBgBlur.style.backgroundImage = 'url("' + DEFAULT_TRACK_COVER + '")';
    }
    // 同步曲目信息
    els.npTrackTitle.textContent = els.bottomTitle.textContent;
    els.npTrackArtist.textContent = els.bottomArtist.textContent;
    CM.updateNpFormat();
    CM.loadNpWaveform(CM.trackPath(CM.currentTrack));
    // 同步播放按钮状态
    var playing = !!(fb.state && fb.state.isPlaying);
    els.npBtnPlay.classList.toggle('playing', playing);
    els.npLcPlay.classList.toggle('playing', playing);
    // 同步进度条
    CM.updateNpSeekUI();
    // 渲染歌词
    CM.renderNpLyrics();
    // 初始化频谱
    CM.initNpSpectrum();
    // 更新唱片动画
    CM.updateNpVinylState();
    // 设置初始模式
    els.npOverlay.classList.toggle('lyrics-only', state.npMode === 'lyrics');
    CM.updateNpModeIcon();
  };

  // 曲目编码信息栏（编码 · 比特率 · 采样率 · 声道）
  CM.updateNpFormat = function() {
    var el = els.npTrackFormat; if (!el) return;
    CM.api('audio.getStreamInfo').then(function(s) {
      if (!s || !s.codec) { el.textContent = ''; return; }
      var parts = [s.codec];
      if (s.bitrate) parts.push(Math.round(s.bitrate) + ' kbps');
      if (s.sampleRate) parts.push((s.sampleRate / 1000).toFixed(1) + ' kHz');
      if (s.channels) parts.push(s.channels === 1 ? '单声道' : s.channels === 2 ? '立体声' : s.channels + ' 声道');
      el.textContent = parts.join(' · ');
    });
  };

  // 沉浸式波形：把当前曲目完整波形作为进度条背景
  var _waveCache = {}, _wavePending = null, _waveBound = false;
  CM.waveformSVG = function(data, w, h) {
    var n = data.length, step = w / n, mid = h / 2, amp = (h - 6) / 2;
    var d = 'M0 ' + mid.toFixed(1);
    for (var i = 0; i < n; i++) {
      var v = data[i]; if (v < 0) v = -v; if (v > 1) v = 1;
      d += ' L' + (i * step).toFixed(1) + ' ' + (mid - v * amp).toFixed(1);
    }
    d += ' L' + w + ' ' + mid.toFixed(1) + ' Z';
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="' + d + '" fill="var(--accent)" opacity="0.55"/></svg>';
  };
  CM.loadNpWaveform = function(path) {
    var el = els.npWaveform; if (!el) return;
    if (!path) { el.classList.add('hide'); return; }
    if (_waveCache[path]) { el.innerHTML = _waveCache[path]; el.classList.remove('hide'); return; }
    if (!_waveBound) {
      _waveBound = true;
      fb.on('audio:fullWaveformReady', function(e) {
        if (!e || !e.taskId || !_wavePending || e.taskId !== _wavePending.taskId) return;
        _wavePending = null;
        if (e.waveform && e.waveform.length) {
          var cur = CM.trackPath(CM.currentTrack);
          if (cur) { _waveCache[cur] = CM.waveformSVG(e.waveform, 100, 44); el.innerHTML = _waveCache[cur]; }
          el.classList.remove('hide');
        } else el.classList.add('hide');
      });
      fb.on('audio:fullWaveformFailed', function() { _wavePending = null; el.classList.add('hide'); });
    }
    _wavePending = { taskId: null };
    CM.api('audio.generateFullWaveform', { path: path, resolution: 256, method: 'rms', preferCache: true }).then(function(r) {
      if (r && r.taskId) { if (_wavePending) _wavePending.taskId = r.taskId; }
      else if (r && r.waveform && r.waveform.length) {
        _wavePending = null;
        _waveCache[path] = CM.waveformSVG(r.waveform, 100, 44);
        el.innerHTML = _waveCache[path]; el.classList.remove('hide');
      } else { _wavePending = null; el.classList.add('hide'); }
    });
  };

  CM.updateNpModeIcon = function() {
    var vinylIcon = els.npModeBtn.querySelector('.np-mode-vinyl');
    var lyricsIcon = els.npModeBtn.querySelector('.np-mode-lyrics');
    if (state.npMode === 'lyrics') {
      vinylIcon.style.display = 'none';
      lyricsIcon.style.display = 'inline';
      els.npModeBtn.title = '显示唱片';
    } else {
      vinylIcon.style.display = 'inline';
      lyricsIcon.style.display = 'none';
      els.npModeBtn.title = '纯歌词模式';
    }
  };

  CM.toggleNpMode = function() {
    state.npMode = state.npMode === 'vinyl' ? 'lyrics' : 'vinyl';
    els.npOverlay.classList.toggle('lyrics-only', state.npMode === 'lyrics');
    CM.updateNpModeIcon();
    // 切换模式后重新高亮歌词
    setTimeout(function() { CM.updateNpLyricHighlight(true); }, 400);
  };

  CM.updateNpVinylState = function() {
    var isPlaying = fb.state && fb.state.isPlaying;
    els.npVinylDisc.classList.toggle('playing', !!isPlaying);
    els.npTonearm.classList.toggle('playing', !!isPlaying);
  };

  CM.renderNpLyrics = function() {
    var lines = CM.currentLyrics;
    if (!lines.length) {
      els.npLyrics.innerHTML = '<div class="lyrics-empty" style="padding:40px;text-align:center;color:var(--text-3)"><svg viewBox="0 0 24 24" style="width:40px;height:40px;margin:0 auto 12px;stroke:var(--text-4);fill:none"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg><span>暂无歌词</span></div>';
      return;
    }
    els.npLyrics.innerHTML = CM._renderLyricHTML(lines, 'np-lyric-line', 30);
    CM._npLyricNodesCache = null;
    CM._npWordCache = null;
    CM._bindLyricClicks(els.npLyrics, '.np-lyric-line');
    CM.updateNpLyricHighlight(true);
  };

  CM.updateNpLyricHighlight = function(force) {
    if (!state.npOpen) return;
    CM._updateLyricHighlight(els.npLyrics, '.np-lyric-line', 'npActiveLyricIndex', force, state.position, '_npLyricNodesCache', '_npWordCache');
  };

  CM.updateNpSeekUI = function() {
    CM._updateSeekBar(els.npSeekBar, els.npTimeCurrent, els.npTimeTotal, '--np-seek-pct', 'npSeeking');
  };

  var NP_SPEC_BARS = 32;
  var npSpecBarEls = [];
  CM.initNpSpectrum = function() {
    npSpecBarEls = CM.createSpectrumBars(els.npSpectrum, NP_SPEC_BARS, 'np-spec-bar');
  };

  CM.updateNpSpectrum = function(data) {
    if (!state.npOpen || !npSpecBarEls.length) return;
    CM.updateSpectrumBars(npSpecBarEls, data && data.spectrum, NP_SPEC_BARS, 36, 28);
  };

  CM.npActiveLyricIndex = -1;
})();
