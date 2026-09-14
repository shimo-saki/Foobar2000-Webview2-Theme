/* ============================================
 * CloudMusic ui-nowplaying.js — 沉浸式 NowPlaying
 * 唱片/纯歌词双模式 / 波形进度条背景 / 频谱 / 编码信息栏
 * ============================================ */

(function () {
  'use strict';
  const CM = window.CloudMusic;
  const els = CM.els, state = CM.state;
  const DEFAULT_TRACK_COVER = CM.DEFAULT_TRACK_COVER;

  /* ============================================
   * 沉浸式 NowPlaying
   * ============================================ */
  CM.toggleNpOverlay = function (open) {
    state.npOpen = open ?? !state.npOpen;
    if (state.npOpen) {
      CM.renderNpOverlay();
      els.npOverlay.classList.add('open');
      document.body.style.overflow = 'hidden';
      els.npLyrics.replaceChildren(CM.player.getElement());
    } else {
      els.npOverlay.classList.remove('open');
      document.body.style.overflow = '';
      els.lyricsScroll.replaceChildren(CM.player.getElement());
    }
  };

  CM.renderNpOverlay = function () {
    // 同步封面（getAttribute 判断：未设置 src 时 .src 返回页面基址 URL，恒为 truthy）
    const artUrl = els.bottomArt.getAttribute('src') || DEFAULT_TRACK_COVER;
    els.npArtwork.src = artUrl;
    els.npBgBlur.style.backgroundImage = `url("${artUrl}")`;
    // 同步曲目信息
    els.npTrackTitle.textContent = els.bottomTitle.textContent;
    els.npTrackArtist.textContent = els.bottomArtist.textContent;
    CM.updateNpFormat();
    CM.loadNpWaveform(CM.trackPath(CM.currentTrack));
    // 同步进度条
    CM.updateNpSeekUI();
    // 初始化频谱
    CM.initNpSpectrum();
    // 设置初始模式
    els.npOverlay.classList.toggle('lyrics-only', state.npMode === 'lyrics');
    CM.updateNpModeIcon();
  };

  // 曲目编码信息栏（编码 · 比特率 · 采样率 · 声道）
  CM.updateNpFormat = function () {
    const el = els.npTrackFormat;
    if (!el) return;

    CM.api('audio.getStreamInfo').then(s => {
      if (!s?.codec) { el.textContent = ''; return; }

      const parts = [s.codec];
      if (s.bitrate) parts.push(`${Math.round(s.bitrate)} kbps`);
      if (s.sampleRate) parts.push(`${(s.sampleRate / 1000).toFixed(1)} kHz`);
      if (s.channels) parts.push(s.channels === 1 ? '单声道' : s.channels === 2 ? '立体声' : `${s.channels} 声道`);
      el.textContent = parts.join(' · ');
    });
  };

  // 沉浸式波形：把当前曲目完整波形作为进度条背景
  const _waveCache = new Map();
  let _wavePending = null, _waveBound = false;

  CM.waveformSVG = function (data, w, h) {
    const n = data.length, step = w / n, mid = h / 2, amp = (h - 6) / 2;
    const f = v => v.toFixed(1);
    const d = data.reduce((s, v, i) =>
      `${s} L${f(i * step)} ${f(mid - Math.min(Math.abs(v), 1) * amp)}`,
      `M0 ${f(mid)}`
    ) + ` L${w} ${f(mid)} Z`;
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d}" fill="var(--accent)" opacity="0.55"/></svg>`;
  };

  CM.loadNpWaveform = function (path) {
    const el = els.npWaveform;
    if (!el) return;

    const show = html => {
      if (html !== undefined) el.innerHTML = html;
      el.classList.remove('hide');
    };
    const hide = () => el.classList.add('hide');

    if (!path) return hide();
    if (_waveCache.has(path)) return show(_waveCache.get(path));

    if (!_waveBound) {
      _waveBound = true;

      fb.on('audio:fullWaveformReady', e => {
        if (!e?.taskId || e.taskId !== _wavePending?.taskId) return;
        _wavePending = null;
        if (!e.waveform?.length) return hide();

        const cur = CM.trackPath(CM.currentTrack);
        if (cur) {
          const svg = CM.waveformSVG(e.waveform, 100, 44);
          _waveCache.set(cur, svg);
          show(svg);
        } else show();
      });

      fb.on('audio:fullWaveformFailed', () => {
        _wavePending = null;
        hide();
      });
    }

    _wavePending = { taskId: null };
    CM.api('audio.generateFullWaveform', {
      path, resolution: 256, method: 'rms', preferCache: true
    }).then(r => {
      if (r?.taskId) {
        if (_wavePending) _wavePending.taskId = r.taskId;
      } else if (r?.waveform?.length) {
        _wavePending = null;
        const svg = CM.waveformSVG(r.waveform, 100, 44);
        _waveCache.set(path, svg);
        show(svg);
      } else {
        _wavePending = null;
        hide();
      }
    });
  };

  CM.updateNpModeIcon = function () {
    const vinylIcon = els.npModeBtn.querySelector('.np-mode-vinyl');
    const lyricsIcon = els.npModeBtn.querySelector('.np-mode-lyrics');
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

  CM.toggleNpMode = function () {
    state.npMode = state.npMode === 'vinyl' ? 'lyrics' : 'vinyl';
    els.npOverlay.classList.toggle('lyrics-only', state.npMode === 'lyrics');
    CM.updateNpModeIcon();
  };

  CM.updateNpSeekUI = function () {
    CM._updateSeekBar(els.npSeekBar, els.npTimeCurrent, els.npTimeTotal, '--np-seek-pct', 'npSeeking');
  };

  const NP_SPEC_BARS = 32;
  let npSpecBarEls = [];
  CM.initNpSpectrum = function () {
    npSpecBarEls = CM.createSpectrumBars(els.npSpectrum, NP_SPEC_BARS, 'np-spec-bar');
  };

  CM.updateNpSpectrum = function (data) {
    if (!state.npOpen || !npSpecBarEls.length) return;
    CM.updateSpectrumBars(npSpecBarEls, data?.spectrum, NP_SPEC_BARS, 36, 28);
  };

})();
