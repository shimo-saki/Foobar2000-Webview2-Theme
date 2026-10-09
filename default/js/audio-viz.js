/* ============================================
 * CloudMusic audio-viz.js — 可视化数据源 + 统一调度器（插件 v2）
 *
 * 定位：只做"取数据"，不做任何显示元件 —— 主题自己的两处频谱（底栏迷你
 * 频谱 16 条、沉浸页频谱 32 条 / 声场 / 瀑布图 / 示波器 / 矢量示波器）是
 * 显示层，本模块把宿主的频谱帧与实时波形换算成它们要的形状喂过去。
 *
 * 相比旧实现（直接吃宿主的 48/64 段频带输出）：
 *   1. 订阅用 output:'bins'（原始 FFT 频点，scale:'db'）+ channels:'stereo'
 *      —— 频点比频带细腻得多，且带左右声道；宿主不支持频点输出（ready 报
 *      bands）或 1.5 秒没有帧时自动回退到频带输出，任何宿主版本都有频谱。
 *   2. 由本模块按"对数频率轴"把频点合并成调用方要的条数（barsFor），
 *      每条取该频段内的最大值 —— 而不是让消费方在长数组上等距抽样，
 *      低频不再糊成一根、高频也不再大片空白。
 *   3. fftSize 8192 → 2048：频带/频点都够用，宿主侧每帧 FFT 计算量降到 1/4。
 *
 * 数据拉取统一走 CM.sched（本文件下半部分）：
 *   · 频谱帧是宿主 push（subscribeSpectrum）：多个视图各注册自己的 onFrame，
 *     调度器把同一帧按各自 fps 分发。旧实现只有一个 onFrame 槽位，后注册的
 *     会顶掉先注册的 —— 底栏频谱开关关掉后沉浸页那条就再也不动。
 *   · 实时波形是页面 pull（audio.getWaveform）：调度器统一轮询、单飞
 *     （上一次没回来不发下一次）、未播放即停。
 *   调度器还负责：最后一个消费方离开才真正退订（订阅同时是可视化流的保活）；
 *   页面隐藏时频谱降到 2fps、波形停拉。
 *
 * 消费方式：
 *   CM.sched.want('mini', { fps: 30, onFrame: function (frame) {
 *     CM.updateSpectrumBars(barEls, CM.viz.barsFor(frame, N), N, maxH, mult);
 *   }});
 *   CM.sched.release('mini');
 *   CM.sched.wantWave('np', { fps: 30, channels: 'stereo', points: 512,
 *     onWave: function (r) { ... } });
 *   CM.sched.releaseWave('np');
 * ============================================ */
(function() {
  'use strict';
  var CM = window.CloudMusic;

  var FFT = 2048;            // 原始频点模式用 2048 点（旧代码 8192 点每帧都在烧 CPU）
  var FPS = 30;
  var MIN_F = 30, MAX_F = 16000;
  var BANDS = 64;            // 回退模式的频带数
  var DB_FLOOR = -78;        // bins 是 dB 值（宿主下限 -160），音乐基本落在这以上
  var NO_FRAME_MS = 1500;    // 订阅后多久没帧就判定不可用并回退
  var STALE_MS = 3000;       // 播放中多久没帧判定流断了（输出设备切换等）
  var WATCH_MS = 2000;
  var HIDDEN_FPS = 2;        // 页面隐藏时的分发上限（"离屏降帧"）
  var GAP_TOL = 4;           // 帧间隔抖动容差（ms），见 dispatch()

  var viz = {
    binsMode: false,        // 当前帧来自频点（bins）还是频带（bands）输出
    frame: null,            // 最近一帧（原始回包）
    unsub: null,
    lastState: '',          // 最近一帧的 state（playing/paused/stopped）
    lastFrameAt: 0,         // 最近一帧的到达时间（0 = 本次订阅还没收到帧）
    noFrameTimer: 0,
    watchTimer: 0
  };
  CM.viz = viz;

  function normDb(v) {
    if (typeof v !== 'number' || !isFinite(v)) return 0;
    var n = (v - DB_FLOOR) * (1 / -DB_FLOOR);
    return n < 0 ? 0 : (n > 1 ? 1 : n);
  }

  /* 把一帧 bins 按对数频率轴合并成 n 条（每条取频段内最大值） */
  function barsFromBins(arr, frame, n) {
    var out = new Array(n);
    var len = arr ? arr.length : 0;
    if (!len) { for (var z = 0; z < n; z++) out[z] = 0; return out; }
    var sr = frame.sampleRate || 44100;
    var nyq = sr / 2;
    var fMin = frame.minFrequency > 0 ? frame.minFrequency : MIN_F;
    var fMax = frame.maxFrequency > 0 ? Math.min(frame.maxFrequency, nyq) : nyq;
    if (!(fMax > fMin)) fMax = nyq;
    var firstBin = frame.firstBin || 0;
    var binHz = sr / (frame.fftSize || FFT);
    var ratio = Math.log(fMax / fMin) / n;
    for (var k = 0; k < n; k++) {
      var f0 = fMin * Math.exp(ratio * k);
      var f1 = fMin * Math.exp(ratio * (k + 1));
      var b0 = Math.floor(f0 / binHz) - firstBin;
      var b1 = Math.ceil(f1 / binHz) - firstBin;
      if (b0 < 0) b0 = 0;
      if (b1 <= b0) b1 = b0 + 1;
      if (b1 > len) b1 = len;
      var mx = DB_FLOOR;
      for (var b = b0; b < b1; b++) { var vv = arr[b]; if (vv > mx) mx = vv; }
      out[k] = normDb(mx);
    }
    return out;
  }

  /* 频带帧（回退模式）重采样到 n 条：加权值本身就是 0..1，按段取最大值 */
  function barsFromBands(arr, n) {
    var out = new Array(n);
    var len = arr ? arr.length : 0;
    if (!len) { for (var z = 0; z < n; z++) out[z] = 0; return out; }
    for (var k = 0; k < n; k++) {
      var b0 = Math.floor(k * len / n);
      var b1 = Math.max(b0 + 1, Math.floor((k + 1) * len / n));
      if (b1 > len) b1 = len;
      var mx = 0;
      for (var b = b0; b < b1; b++) { var v = arr[b]; if (typeof v === 'number' && v > mx) mx = v; }
      out[k] = mx > 1 ? 1 : mx;
    }
    return out;
  }

  /* 时间平滑：上升快、回落慢（经典频谱手感）。
     直接喂每帧原始值会在 30fps 上抖得很毛躁 —— 低音量区尤其明显。
     同一帧的缓存保证每帧每个"条数:声道"只平滑一次（不会因多处消费而重复衰减）。 */
  var _smooth = {};
  function smoothBars(key, bars) {
    var prev = _smooth[key];
    if (!prev || prev.length !== bars.length) {
      _smooth[key] = Float32Array.from(bars);   // 首次即基准值，无需再遍历（此前有个空转的自赋值循环）
      return bars;
    }
    for (var i = 0; i < bars.length; i++) {
      var v = bars[i], p = prev[i];
      // 上升：跟随 65%（留一点惯性）；下降：每帧最多掉 0.055（约 0.3 秒从满到半）
      var nv = (v >= p) ? (p + (v - p) * 0.65) : Math.max(v, p - 0.055);
      prev[i] = nv;
      bars[i] = nv;
    }
    return bars;
  }

  /* 供消费方调用：取本帧的 n 条频谱值（0..1，已做时间平滑）。
     channel：'mix'（默认，合轨）/ 'left' / 'right'（声场模式用）。
     回退到频带输出时没有左右声道，left/right 会落回合轨数据（声场退化成对称蝶形）。
     同一帧会被多处（迷你 16 / 沉浸 32 / 声场左右各半 / 瀑布 96）各要一次，
     按"条数:声道"缓存。 */
  viz.barsFor = function(frame, n, channel) {
    frame = frame || viz.frame;
    if (!frame) {
      var zeros = new Array(n);
      for (var i = 0; i < n; i++) zeros[i] = 0;
      return zeros;
    }
    if (!frame._barCache) frame._barCache = {};
    var chan = (channel === 'left' || channel === 'right') ? channel : 'mix';
    var key = n + ':' + chan;
    if (frame._barCache[key]) return frame._barCache[key];
    var arr;
    if (frame.output === 'bins') {
      if (chan === 'left') arr = frame.left || frame.spectrum || frame._mix || [];
      else if (chan === 'right') arr = frame.right || frame.spectrum || frame._mix || [];
      // 合轨：优先用两层较大值合成的 _mix（立体声帧只给 left/right，视觉更饱满）
      else arr = frame._mix || frame.spectrum || frame.left || [];
    } else {
      arr = frame.spectrum || [];
    }
    var bars = (frame.output === 'bins') ? barsFromBins(arr, frame, n) : barsFromBands(arr, n);
    frame._barCache[key] = smoothBars(key, bars);
    return frame._barCache[key];
  };

  /* ============================================
   * 统一调度器 CM.sched
   *
   * 两个数据源、一套账本：
   *   subs   —— 频谱帧消费方（宿主 push）
   *   waves  —— 实时波形消费方（页面 pull）
   * 订阅本身是"可视化流"的保活，所以只要任一消费方在，订阅就得开着；
   * 最后一个消费方离开才退订（等价于旧版的持有者计数，但消费方各自带回调）。
   * ============================================ */
  var sched = {
    subs: {},            // key -> { fps, onFrame, last }
    waves: {},           // key -> { fps, channels, points, onWave }
    subCount: 0,
    waveCount: 0,
    raf: 0,              // 波形轮询的 rAF 句柄（0 = 循环未运行）
    hidden: !!(typeof document !== 'undefined' && document.hidden),
    waveLast: {},        // 波形分组签名 -> 上次发起时间
    wavePending: {}      // 波形分组签名 -> 是否有请求在途（单飞）
  };
  CM.sched = sched;

  function consumerCount() { return sched.subCount + sched.waveCount; }

  function ensureSub() {
    if (consumerCount() === 1 && !viz.unsub) {
      if (fb.audio && typeof fb.audio.subscribeSpectrum === 'function') subscribeBins();
    }
  }

  function maybeTeardown() {
    if (consumerCount() <= 0) teardown();
  }

  /* 频谱帧分发：同一帧喂给所有消费方，各按自己的 fps 节流。
     宿主帧间隔自带抖动（30fps ≈ 33ms，实测 32~35ms 都有），阈值必须留容差，
     否则请求 30fps 的消费方会因 33 < 33.3 被隔帧跳过一次，实际掉到 15fps。 */
  function dispatch(frame) {
    var now = Date.now();
    for (var k in sched.subs) {
      var s = sched.subs[k];
      var fps = sched.hidden ? HIDDEN_FPS : (s.fps || FPS);
      if (now - s.last < 1000 / fps - GAP_TOL) continue;
      s.last = now;
      try { s.onFrame(frame); } catch (e) { /* 消费方异常不能中断分发 */ }
    }
  }

  sched.want = function(key, opts) {
    key = key || 'default';
    opts = opts || {};
    var existed = !!sched.subs[key];
    sched.subs[key] = {
      fps: opts.fps || FPS,
      onFrame: opts.onFrame || function() {},
      last: 0            // 0 = 下一帧立刻交付，不让新视图等一个周期
    };
    if (!existed) { sched.subCount++; ensureSub(); }
  };

  sched.release = function(key) {
    key = key || 'default';
    if (!sched.subs[key]) return;
    delete sched.subs[key];
    sched.subCount--;
    if (sched.subCount < 0) sched.subCount = 0;
    maybeTeardown();
  };

  /* ---------- 实时波形（页面 pull） ---------- */
  // 按 (channels, points) 分组：同一拍里每种参数只发一次请求，再分发给同组消费方
  function waveGroups() {
    var groups = {};
    for (var k in sched.waves) {
      var w = sched.waves[k];
      var sig = w.channels + ':' + w.points;
      (groups[sig] || (groups[sig] = [])).push(w);
    }
    return groups;
  }

  function pollWaves() {
    var groups = waveGroups();
    var now = Date.now();
    for (var sig in groups) {
      var list = groups[sig];
      if (sched.wavePending[sig]) continue;             // 单飞：上一次还没回来
      var fps = 0;
      for (var i = 0; i < list.length; i++) if (list[i].fps > fps) fps = list[i].fps;
      if (now - (sched.waveLast[sig] || 0) < 1000 / fps - GAP_TOL) continue;
      sched.waveLast[sig] = now;
      sched.wavePending[sig] = true;
      pollWaveOne(sig, list);
    }
  }

  function pollWaveOne(sig, list) {
    var w0 = list[0];
    CM.api('audio.getWaveform', {
      duration: 0.05, signed: true,
      channels: w0.channels === 'stereo' ? 'stereo' : 'mix',
      points: w0.points
    }).then(function(r) {
      sched.wavePending[sig] = false;
      for (var i = 0; i < list.length; i++) {
        try { list[i].onWave(r); } catch (e) { /* 同上：消费方异常不能中断分发 */ }
      }
    });
  }

  // 轮询循环：rAF 既当节拍源又天然在页面隐藏时被浏览器节流。
  // 隐藏 / 未播放时不发起请求（暂停时宿主本来也没有新 PCM，白拉）
  function waveTick() {
    sched.raf = 0;
    if (!sched.waveCount) return;                        // 没有消费方：循环结束
    sched.raf = requestAnimationFrame(waveTick);
    if (sched.hidden) return;
    if (CM.clockPlaying && !CM.clockPlaying()) return;   // 暂停 / 停止即停
    pollWaves();
  }

  function ensureWaveLoop() {
    if (sched.raf || !sched.waveCount) return;
    sched.raf = requestAnimationFrame(waveTick);
  }

  sched.wantWave = function(key, opts) {
    key = key || 'default';
    opts = opts || {};
    var existed = !!sched.waves[key];
    sched.waves[key] = {
      fps: opts.fps || FPS,
      channels: opts.channels === 'stereo' ? 'stereo' : 'mix',
      points: opts.points || 600,
      onWave: opts.onWave || function() {}
    };
    if (!existed) { sched.waveCount++; ensureSub(); }
    ensureWaveLoop();
  };

  sched.releaseWave = function(key) {
    key = key || 'default';
    if (!sched.waves[key]) return;
    delete sched.waves[key];
    sched.waveCount--;
    if (sched.waveCount <= 0) {
      sched.waveCount = 0;
      if (sched.raf) { cancelAnimationFrame(sched.raf); sched.raf = 0; }
    }
    maybeTeardown();
  };

  sched.stats = function() {
    return {
      subCount: sched.subCount,
      waveCount: sched.waveCount,
      subs: Object.keys(sched.subs),
      waves: Object.keys(sched.waves),
      hidden: sched.hidden,
      binsMode: viz.binsMode,
      subscribed: !!viz.unsub,
      lastState: viz.lastState
    };
  };

  // 全部退订（设置里关掉可视化 / 页面卸载）：消费方一并清空
  sched.stop = function() {
    sched.subs = {}; sched.subCount = 0;
    sched.waves = {}; sched.waveCount = 0;
    sched.waveLast = {}; sched.wavePending = {};
    if (sched.raf) { cancelAnimationFrame(sched.raf); sched.raf = 0; }
    teardown();
    viz.lastState = '';
  };
  viz.stop = function() { sched.stop(); };

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', function() {
      sched.hidden = !!document.hidden;
      if (!sched.hidden) {
        // 回到可见：把各消费方的时间戳清零，立刻补一帧，别让画面"停一拍才动"
        for (var k in sched.subs) sched.subs[k].last = 0;
        ensureWaveLoop();
      }
    });
  }

  /* ---------- 订阅 ---------- */
  function onSpectrum(data) {
    if (!data || !data.output) return;
    if (viz.noFrameTimer) { clearTimeout(viz.noFrameTimer); viz.noFrameTimer = 0; }
    // 帧自己带 output：宿主不支持频点输出时投递的是频带帧（旧宿主没有这个字段，
    // SDK 会把它当频带帧放进回调）—— 以帧为准，不靠"我们请求了什么"
    viz.binsMode = (data.output === 'bins');
    viz.lastFrameAt = Date.now();
    if (typeof data.state === 'string') viz.lastState = data.state;
    if (viz.binsMode && !data.spectrum && (data.left || data.right)) {
      // stereo 模式只给 left/right：合轨一次，供 barsFor 复用
      var l = data.left || [], r = data.right || [];
      var n = Math.max(l.length, r.length);
      var mix = new Array(n);
      for (var i = 0; i < n; i++) {
        var a = l[i], b = r[i];
        mix[i] = (typeof a === 'number' && typeof b === 'number') ? (a > b ? a : b)
               : (typeof a === 'number' ? a : b);
      }
      data._mix = mix;
    }
    viz.frame = data;
    dispatch(data);
  }

  function clearTimers() {
    if (viz.noFrameTimer) { clearTimeout(viz.noFrameTimer); viz.noFrameTimer = 0; }
    if (viz.watchTimer) { clearInterval(viz.watchTimer); viz.watchTimer = 0; }
  }

  function teardown() {
    clearTimers();
    if (viz.unsub) { try { viz.unsub(); } catch (e) {} viz.unsub = null; }
    viz.lastFrameAt = 0;
  }

  // 播放中长时间没有帧 = 流断了（输出设备切换 / 宿主重建可视化管线）。
  // 暂停与停止本来就不发帧（只发一帧静音帧），那种"没帧"是正常的。
  function startWatch() {
    if (viz.watchTimer) return;
    viz.watchTimer = setInterval(function() {
      if (!consumerCount() || !viz.unsub) return;
      if (viz.lastState !== 'playing') return;
      if (!viz.lastFrameAt) return;                     // 首帧还没来，交给 noFrame 计时器
      if (Date.now() - viz.lastFrameAt < STALE_MS) return;
      viz.restart();
    }, WATCH_MS);
  }

  function subscribeBins() {
    teardown();
    var unsub = null;
    try {
      unsub = fb.audio.subscribeSpectrum(onSpectrum, {
        output: 'bins',
        channels: 'stereo',
        scale: 'db',
        fftSize: FFT,
        fps: FPS,
        minFrequency: MIN_F,
        maxFrequency: MAX_F,
        backgroundThrottle: true
      });
    } catch (e) { unsub = null; }
    if (!unsub) { subscribeBands(); return; }
    viz.unsub = unsub;
    viz.binsMode = true;
    // 宿主不支持频点输出时 ready 会报 bands（且不会投递帧）→ 立刻换频带订阅
    if (unsub.ready && typeof unsub.ready.then === 'function') {
      unsub.ready.then(function(o) {
        if (viz.unsub !== unsub) return;                // 已被换掉
        if (!o || o.ok === false || o.output !== 'bins') subscribeBands();
      }, function() { /* 失败交给 noFrame 计时器兜底 */ });
    }
    // 宿主拒绝或没有可视化数据时不会有任何帧：超时后回退频带输出，
    // 否则频谱会永久停在"全是 0"（旧代码在输出设备切换后就是这样）
    viz.noFrameTimer = setTimeout(function() {
      viz.noFrameTimer = 0;
      if (viz.lastFrameAt) return;                      // 收到过帧，不是这个原因
      subscribeBands();
    }, NO_FRAME_MS);
    startWatch();
  }

  function subscribeBands() {
    teardown();
    var unsub = null;
    try {
      unsub = fb.audio.subscribeSpectrum(onSpectrum, { fftSize: FFT, fps: FPS, bands: BANDS });
    } catch (e) { unsub = null; }
    if (!unsub) return;
    viz.unsub = unsub;
    viz.binsMode = false;
    startWatch();
  }

  // 断流 / 输出设备切换后重订阅：先按首选的频点输出重来
  viz.restart = function() {
    if (!consumerCount()) { teardown(); return; }
    if (!fb.audio || typeof fb.audio.subscribeSpectrum !== 'function') return;
    if (viz.binsMode) subscribeBins(); else subscribeBands();
  };
})();