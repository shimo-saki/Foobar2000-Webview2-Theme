/* ============================================
 * CloudMusic core.js — API 包装 + 状态 + 工具 + 配色
 * 挂载到 window.CloudMusic 命名空间
 * ============================================ */
(function () {
  'use strict';
  const CM = window.CloudMusic = window.CloudMusic || {};
  CM.version = 'V2.5.1-modify';

  /* ============================================
   * API 包装器 — 出错时resolve null，调用方只需判空
   * ============================================ */
  CM.api = function (method, params) {
    return fb.invoke(method, params || {}).catch(() => null);
  };

  /* ============================================
   * DOM 引用
   * ============================================ */
  CM.$ = function (id) {
    return document.getElementById(id);
  };

  CM.els = {
    app: CM.$('app'),
    titlebar: CM.$('titlebar'), titlebarDrag: CM.$('titlebarDrag'), titlebarControls: CM.$('titlebarControls'),
    sidebarSearchWrap: CM.$('sidebarSearchWrap'), sidebarSearch: CM.$('sidebarSearch'), sidebarSearchClear: CM.$('sidebarSearchClear'),
    sidebarNav: CM.$('sidebarNav'), playlistList: CM.$('playlistList'), addPlaylistBtn: CM.$('addPlaylistBtn'),
    mainTabs: CM.$('mainTabs'), mainBody: CM.$('mainBody'), mainContent: CM.$('mainContent'),
    // Discover
    heroDate: CM.$('heroDate'), heroTitle: CM.$('heroTitle'), heroSub: CM.$('heroSub'),
    btnPlayDaily: CM.$('btnPlayDaily'), btnRefreshDiscover: CM.$('btnRefreshDiscover'),
    discoverAlbums: CM.$('discoverAlbums'), discoverRecent: CM.$('discoverRecent'), discoverRandom: CM.$('discoverRandom'),
    moreAlbums: CM.$('moreAlbums'), moreRecent: CM.$('moreRecent'), refreshRandom: CM.$('refreshRandom'),
    // Playlist
    playlistHeader: CM.$('playlistHeader'), plCoverWrap: CM.$('plCoverWrap'), plCover: CM.$('plCover'),
    playlistHeaderName: CM.$('playlistHeaderName'), playlistHeaderMeta: CM.$('playlistHeaderMeta'),
    playlistHeaderTag: CM.$('playlistHeaderTag'),
    btnPlayAll: CM.$('btnPlayAll'), btnPlaylistMore: CM.$('btnPlaylistMore'),
    trackTableWrap: CM.$('trackTableWrap'), trackTable: CM.$('trackTable'), trackTbody: CM.$('trackTbody'),
    position: CM.$('position'),
    // Library / Search
    libraryTree: CM.$('libraryTree'), libraryDetail: CM.$('libraryDetail'),
    searchInput: CM.$('searchInput'), searchResults: CM.$('searchResults'),
    // Right panel
    rightPanel: CM.$('rightPanel'), lyricsBlurBg: CM.$('lyricsBlurBg'), lyricsArt: CM.$('lyricsArt'),
    lyricsTrackTitle: CM.$('lyricsTrackTitle'), lyricsTrackArtist: CM.$('lyricsTrackArtist'),
    lyricsScroll: CM.$('lyricsScroll'), lyricsEmpty: CM.$('lyricsEmpty'),
    // Bottom bar
    bottomArtWrap: CM.$('bottomArtWrap'), bottomArt: CM.$('bottomArt'),
    bottomTitle: CM.$('bottomTitle'), bottomArtist: CM.$('bottomArtist'),
    btnOrder: CM.$('btnOrder'),
    btnPrev: CM.$('btnPrev'), btnPlayPause: CM.$('btnPlayPause'), iconPlay: CM.$('iconPlay'), iconPause: CM.$('iconPause'),
    btnNext: CM.$('btnNext'), btnStop: CM.$('btnStop'),
    seekBar: CM.$('seekBar'), seekCurrent: CM.$('seekCurrent'), seekTotal: CM.$('seekTotal'),
    miniSpectrum: CM.$('miniSpectrum'), btnVisualizer: CM.$('btnVisualizer'),
    volBtn: CM.$('volBtn'), volIcon: CM.$('volIcon'), volSlider: CM.$('volSlider'),
    btnQueue: CM.$('btnQueue'), queueBadge: CM.$('queueBadge'),
    btnLyricsToggle: CM.$('btnLyricsToggle'), btnMore: CM.$('btnMore'),
    // Queue drawer
    queueDrawer: CM.$('queueDrawer'), queueCount: CM.$('queueCount'), queueList: CM.$('queueList'), queueNow: CM.$('queueNow'),
    queueClear: CM.$('queueClear'), queueClose: CM.$('queueClose'),
    // Overlays
    modal: CM.$('modal'), modalTitle: CM.$('modalTitle'), modalDesc: CM.$('modalDesc'),
    modalInput: CM.$('modalInput'), modalOk: CM.$('modalOk'), modalCancel: CM.$('modalCancel'),
    toastContainer: CM.$('toastContainer'), ctxMenu: CM.$('ctxMenu'), drop: CM.$('drop'),
    // Immersive NowPlaying
    npOverlay: CM.$('npOverlay'), npBgBlur: CM.$('npBgBlur'), npVinylDisc: CM.$('npVinylDisc'),
    npTonearm: CM.$('npTonearm'), npArtwork: CM.$('npArtwork'),
    npTrackTitle: CM.$('npTrackTitle'), npTrackArtist: CM.$('npTrackArtist'),
    npTrackFormat: CM.$('npTrackFormat'), npWaveform: CM.$('npWaveform'),
    npSpectrum: CM.$('npSpectrum'), npLyrics: CM.$('npLyrics'),
    npSeekBar: CM.$('npSeekBar'), npTimeCurrent: CM.$('npTimeCurrent'), npTimeTotal: CM.$('npTimeTotal'),
    npCloseBtn: CM.$('npCloseBtn'), npModeBtn: CM.$('npModeBtn'),
    npBtnPrev: CM.$('npBtnPrev'), npBtnPlay: CM.$('npBtnPlay'), npBtnNext: CM.$('npBtnNext'),
    npLcPrev: CM.$('npLcPrev'), npLcPlay: CM.$('npLcPlay'), npLcNext: CM.$('npLcNext'),
    rpImmersiveBtn: CM.$('rpImmersiveBtn'),
    // Tag Editor
    tagEditor: CM.$('tagEditor'), tagEditorTitle: CM.$('tagEditorTitle'),
    tagEditorTrack: CM.$('tagEditorTrack'), tagEditorBody: CM.$('tagEditorBody'),
    tagEditorHint: CM.$('tagEditorHint'), tagEditorSave: CM.$('tagEditorSave'),
    tagEditorCancel: CM.$('tagEditorCancel'), tagEditorClose: CM.$('tagEditorClose'),
    tagCoverFile: CM.$('tagCoverFile'),
    // Batch Bar
    batchBar: CM.$('batchBar'), batchBarCount: CM.$('batchBarCount'),
    batchEditTags: CM.$('batchEditTags'), batchDeleteTracks: CM.$('batchDeleteTracks'), batchClear: CM.$('batchClear')
  };

  /* ============================================
  * 播放顺序（foobar2000 playback order）
  * 0=Default 1=Repeat(playlist) 2=Repeat(track) 4=Shuffle(tracks) 6=Shuffle(folders)
  * ============================================ */
  CM.ORDERS = [
    { id: 0, name: '顺序播放', icon: '' },
    { id: 1, name: '列表循环', icon: '' },
    { id: 2, name: '单曲循环', icon: '' },
    { id: 4, name: '随机播放', icon: '' },
    { id: 6, name: '随机目录', icon: '' },
  ];
  CM.orderIndexOf = function (orderId) {
    return CM.ORDERS.findIndex(o => o.id === orderId) || 0;
  };

  /* ============================================
   * 状态
   * ============================================ */
  CM.state = {
    currentTab: 'discover',
    currentPlaylistIndex: -1,   // 正在查看的播放列表
    playingPlaylistIndex: -1,   // 正在播放的播放列表
    playingTrackIndex: -1,      // 正在播放的曲目索引
    order: 0,                   // 当前 playback order id
    stopAfterCurrent: false,
    lyricsVisible: true,
    visualizerActive: true,
    queueOpen: false,
    seeking: false,
    npOpen: false,              // 沉浸式页面是否打开
    npMode: 'vinyl',            // 'vinyl' | 'lyrics'
    npSeeking: false,
    duration: 0,
    position: 0,
    volume: 100,
    muted: false,
    libraryView: 'stats',       // stats | artists | albums | genres | artist | album | genre
    libraryArg: null,
    libScrollTop: 0,             // 进入下钻详情前的列表滚动位置（返回时恢复）
    libScrollRestore: false,     // 标志：从详情返回列表时需恢复滚动位置
    sortKey: null,
    sortAsc: true,
    trackCache: [],             // 当前播放列表曲目缓存（排序/右键用）
    playlistTracksTotal: 0,
    searchTracks: [],            // 最近一次搜索结果缓存（添加到歌单用）
    batchSelected: new Set(),    // 批量选中的曲目索引集合（Ctrl+click 多选）
    focusedTrackIndex: -1,       // 播放列表中最后单击聚焦的曲目索引（Alt+↑/↓ 移动用）
    focusedPlaylistIndex: -1     // 聚焦行所属歌单（仅在当前歌单内有效，防止跨歌单误移动）
  };
  CM.currentTrack = null;
  CM.currentLyrics = [];

  /* ============================================
   * 设置持久化
   * ============================================ */
  CM.settings = { lyricsVisible: true, visualizer: true, tab: 'discover', volume: null, autoUpdate: true };
  CM.loadSettings = function () {
    fb2k.invoke('config.getAll').then(({ success, items }) => {
      if (!success) return CM.showToast('获取配置失败', null, 'error');
      Object.assign(CM.settings, items);
    });
  };
  CM.loadSettings();

  CM.setSettings = function (key, value) {
    if (CM.settings[key] === value) return;
    fb2k.invoke('config.set', { key, value }).then(({ success }) => {
      if (!success) return CM.showToast('保存配置失败', `${key}: ${value}`, 'error');
      CM.settings[key] = value;
    });
  };

  /* ============================================
   * 工具函数
   * ============================================ */
  CM.formatTime = function (sec) {
    if (!sec || sec <= 0 || !isFinite(sec)) return '0:00';
    const t = Math.floor(sec);
    const p = n => String(n).padStart(2, '0');
    const h = Math.floor(t / 3600);
    const m = Math.floor(t / 60) % 60;
    const s = t % 60;
    return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
  };

  // formatTime 的小容量缓存：timeHighRes ~30fps 对同一秒值重复格式化，
  // position 每秒才变一次、duration 恒定，16 项 FIFO 命中率接近 100%
  const _ftCache = new Map();
  CM.formatTimeCached = function (sec) {
    if (!sec || sec <= 0 || !isFinite(sec)) return '0:00';
    const k = Math.floor(sec);
    let s = _ftCache.get(k);
    if (s === undefined) {
      s = CM.formatTime(k);
      if (_ftCache.size >= 16) _ftCache.delete(_ftCache.keys().next().value);
      _ftCache.set(k, s);
    }
    return s;
  };

  CM.formatSize = function (bytes) {
    bytes = +bytes || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  };

  // foobar 查询引擎的字符串无任何转义机制（\"、/\"、双写引号、单引号包裹实测均不支持），
  // 但 IS/HAS 支持 glob 通配符：含引号的标签值用 ? 逐位替换引号，构造等长近精确查询，
  // 再由调用方按原值在客户端二次过滤
  CM.wildValue = function (v) {
    return typeof v === 'string' && v ? v.replaceAll('"', '?') : null;
  };

  CM.trackName = function (t) {
    return t?.title || String(t?.path || '').replace(/\\/g, '/').split('/').pop() || '未知曲目';
  };

  CM.trackArtist = function (t) {
    return t?.artist || t?.albumArtist || '未知艺术家';
  };

  // 用于 artwork/rating 等 API 的最佳路径
  CM.trackPath = function (t) {
    return t?.absolutePath || t?.path || '';
  };

  CM.escHtml = function (s) {
    return s == null ? '' : String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  CM.debounce = function (fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  };

  // 一次性执行工厂：统一各模块"事件委托只绑一次"的守卫模式
  // 用法：CM.runOnce('ctxMenuDelegation', function() { ...addEventListener... });
  const _runOnceSet = new Set();
  CM.runOnce = function (key, setupFn) {
    if (_runOnceSet.has(key)) return false;
    _runOnceSet.add(key);
    setupFn();
    return true;
  };

  // 延迟加载指示器：API 快速返回（<ms）时不闪烁，保留旧内容
  // 返回 cancel 函数，在 API 回调中调用以取消转圈
  CM.delayedLoading = function (showFn, ms) {
    const timer = setTimeout(showFn, ms ?? 150);
    return () => clearTimeout(timer);
  };

  // 按钮 loading 状态：禁用并替换文本，返回恢复函数（自动还原原文本）
  // 用法：var resetBtn = CM.setBtnLoading(btn, '加载中...'); ... resetBtn();
  CM.setBtnLoading = function (btn, loadingText) {
    if (!btn) return () => { };
    const span = btn.querySelector('span');
    const prevText = span?.textContent;
    btn.disabled = true;
    if (span) span.textContent = loadingText;
    return () => {
      btn.disabled = false;
      if (span) span.textContent = prevText;
    };
  };

  // 通用频谱条更新（迷你频谱 + 沉浸式频谱共用）
  // 对数压缩 (pow 0.7) 使视觉更平滑；maxH/mult 由调用方按频谱条尺寸传入
  // 使用 transform:scaleY 代替 height，避免每帧 layout 重排（composite-only）
  // Math.pow(v, 0.7) 每帧每条都调用，量化为 256 级查找表（频谱值为 0..1 归一化）
  const _powLut = Float32Array.from({ length: 256 }, (_, i) => (i / 255) ** 0.7);
  CM.updateSpectrumBars = function (barEls, spec, count, maxH, mult) {
    if (!barEls?.length || !spec?.length) return;
    const step = spec.length / count;
    for (let i = 0; i < count; i++) {
      const v = spec[Math.floor(i * step)] || 0;
      const q = Math.max(0, Math.min(255, (v * 255 + 0.5) | 0));
      const scale = Math.max(2 / maxH, Math.min(1, _powLut[q] * mult / maxH));
      barEls[i].style.transform = `scaleY(${scale.toFixed(3)})`;
    }
  };

  CM.GuidCache = new Map();
  CM.getGuid = async function (query) {
    if (!query) return;
    if (CM.GuidCache.has(query)) return CM.GuidCache.get(query);

    const { results } = await fb2k.invoke('discovery.searchCommands', { query, includeHidden: true });
    const cmd = results.find(item => item.name.includes(query));
    const guid = { name: cmd?.name, guid: cmd?.guid, subGuid: cmd?.subGuid };
    CM.GuidCache.set(query, guid);
    return guid;
  };

  // 获取所有组件
  fb2k.invoke('discovery.getComponents').then(data => CM.components = data.components);

  CM.checkCompCache = new Map();
  CM.checkComponent = function (name) {
    if (CM.checkCompCache.has(name)) return CM.checkCompCache.get(name);
    const found = CM.components.some(c => c.filename === name);
    CM.checkCompCache.set(name, found);
    return found;
  };

  /* ============================================
 * 动态配色 — 从封面提取活力色写入 HSL 令牌
 * ============================================ */
  function _hueOf(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    if (!d) return 0; // 灰色，无明确色相
    return (max === r ? (g - b) / d + (g < b ? 6 : 0)
      : max === g ? (b - r) / d + 2
        : (r - g) / d + 4) * 60;
  };

  // 按饱和度加权取样，避免平均色发灰
  const _colorSize = 48;
  const _colorCtx = new OffscreenCanvas(_colorSize, _colorSize)
    .getContext('2d', { willReadFrequently: true });

  CM.extractColorFromImage = function (url) {
    if (!url) return CM.resetAccent();

    fetch(url)
      .then(res => res.blob())
      .then(blob => createImageBitmap(
        blob,
        { resizeWidth: _colorSize, resizeHeight: _colorSize, resizeQuality: 'low' })
      )
      .then(bitmap => {
        _colorCtx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const data = _colorCtx.getImageData(0, 0, _colorSize, _colorSize).data;

        let wr = 0, wg = 0, wb = 0, wSum = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          if (!mx) continue; // 纯黑，跳过
          const sat = (mx - mn) / mx;
          const lum = (mx + mn) / 510;
          // 偏好饱和且亮度适中的像素
          const wgt = sat * sat * (1 - Math.abs(lum - 0.5) * 1.2) + 0.02;
          wr += r * wgt; wg += g * wgt; wb += b * wgt; wSum += wgt;
        }
        if (!wSum) return;

        const hue = Math.round(_hueOf(wr / wSum, wg / wSum, wb / wSum));
        const sat = 68, lit = 56;

        const root = document.documentElement.style;
        root.setProperty('--accent-h', hue);
        root.setProperty('--accent-s', `${sat}%`);
        root.setProperty('--accent-l', `${lit}%`);
      })
      .catch(() => { /* 跨域/解码失败时保持默认色 */ });
  };

  CM.resetAccent = function () {
    const root = document.documentElement.style;
    root.setProperty('--accent-h', '0');
    root.setProperty('--accent-s', '81%');
    root.setProperty('--accent-l', '59%');
  };

  /* ============================================
   * 图标库（供渲染函数复用）
   * ============================================ */
  CM.icons = {
    play: '<span class="icon"></span>',
    note: '<span class="icon"></span>',
    plus: '<span class="icon"></span>',
    trash: '<span class="icon"></span>',
    edit: '<span class="icon"></span>',
    rename: '<span class="icon"></span>',
    file: '<span class="icon"></span>',
    queue: '<span class="icon"></span>',
    info: '<span class="icon"></span>',
    check: '<span class="icon"></span>',
    cancel: '<span class="icon"></span>',
    error: '<span class="icon"></span>',
    folder: '<span class="icon"></span>',
    addfolder: '<span class="icon"></span>',
    refresh: '<span class="icon"></span>',
    random: '<span class="icon"></span>',
    search: '<span class="icon"></span>',
    copy: '<span class="icon"></span>',
    redo: '<span class="icon"></span>',
    undo: '<span class="icon"></span>',
    artist: '<span class="icon"></span>',
    album: '<span class="icon"></span>',
    group: '<span class="icon"></span>',
    headphone: '<span class="icon"></span>',
    title: '<span class="icon"></span>',
    eq: '<span class="icon"></span>',
    position: '<span class="icon"></span>',
    window: '<span class="icon"></span>',
    history: '<span class="icon"></span>',
    recently_added: '<span class="icon"></span>',
    // Popover 专用图标
    desktopLyric: '<span class="icon"></span>',
    pin: '<span class="icon"></span>',
    lock: '<span class="icon"></span>',
    output: '<span class="icon"></span>',
    console: '<span class="icon"></span>',
    preferences: '<span class="icon"></span>',
    // 标签编辑/封面/下载
    tag: '<span class="icon"></span>',
    download: '<span class="icon"></span>',
    // 曲目排序 / 调整顺序
    sort: '<span class="icon"></span>',
    up: '<span class="icon"></span>',
    down: '<span class="icon"></span>',
    toTop: '<span class="icon"></span>',
    toBottom: '<span class="icon"></span>',
    reverse: '<span class="icon"></span>',
    pre: '<span class="icon"></span>',
    next: '<span class="icon"></span>',
    grip: '<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none"/></svg>',
  };
})();
