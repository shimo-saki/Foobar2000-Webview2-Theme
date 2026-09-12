/* ============================================
 * CloudMusic core.js — API 包装 + 状态 + 工具 + 配色
 * 挂载到 window.CloudMusic 命名空间
 * ============================================ */
(function() {
  'use strict';
  var CM = window.CloudMusic = window.CloudMusic || {};

  /* ============================================
   * API 包装器 — 出错时resolve null，调用方只需判空
   * ============================================ */
  CM.api = function(method, params) {
    return fb.invoke(method, params || {}).catch(function() {
      return null;
    });
  };

  /* ============================================
   * DOM 引用
   * ============================================ */
  CM.$ = function(id) { return document.getElementById(id); };

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
    btnOrder: CM.$('btnOrder'), iconOrderSeq: CM.$('iconOrderSeq'), iconOrderLoop: CM.$('iconOrderLoop'),
    iconOrderOne: CM.$('iconOrderOne'), iconOrderShuffle: CM.$('iconOrderShuffle'),
    btnPrev: CM.$('btnPrev'), btnPlayPause: CM.$('btnPlayPause'), iconPlay: CM.$('iconPlay'), iconPause: CM.$('iconPause'),
    btnNext: CM.$('btnNext'), btnStopAfter: CM.$('btnStopAfter'),
    seekBar: CM.$('seekBar'), seekCurrent: CM.$('seekCurrent'), seekTotal: CM.$('seekTotal'),
    miniSpectrum: CM.$('miniSpectrum'), btnVisualizer: CM.$('btnVisualizer'),
    volBtn: CM.$('volBtn'), volIcon: CM.$('volIcon'), volSlider: CM.$('volSlider'),
    btnQueue: CM.$('btnQueue'), queueBadge: CM.$('queueBadge'),
    btnLyricsToggle: CM.$('btnLyricsToggle'), btnMore: CM.$('btnMore'),
    // Queue drawer
    queueDrawer: CM.$('queueDrawer'), queueCount: CM.$('queueCount'), queueList: CM.$('queueList'), queueNow: CM.$('queueNow'),
    queueClear: CM.$('queueClear'), queueClose: CM.$('queueClose'),
    // Overlays
    modalMask: CM.$('modalMask'), modalTitle: CM.$('modalTitle'), modalDesc: CM.$('modalDesc'),
    modalInput: CM.$('modalInput'), modalOk: CM.$('modalOk'), modalCancel: CM.$('modalCancel'),
    toastContainer: CM.$('toastContainer'), ctxMenu: CM.$('ctxMenu'), dropOverlay: CM.$('dropOverlay'),
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
    tagEditorOverlay: CM.$('tagEditorOverlay'), tagEditorTitle: CM.$('tagEditorTitle'),
    tagEditorTrack: CM.$('tagEditorTrack'), tagEditorBody: CM.$('tagEditorBody'),
    tagEditorHint: CM.$('tagEditorHint'), tagEditorSave: CM.$('tagEditorSave'),
    tagEditorCancel: CM.$('tagEditorCancel'), tagEditorClose: CM.$('tagEditorClose'),
    tagCoverFile: CM.$('tagCoverFile'),
    // Batch Bar
    batchBar: CM.$('batchBar'), batchBarCount: CM.$('batchBarCount'),
    batchEditTags: CM.$('batchEditTags'), batchClear: CM.$('batchClear')
  };

  /* ============================================
   * 播放顺序（foobar2000 playback order）
   * 0=Default 1=Repeat(playlist) 2=Repeat(track) 4=Shuffle(tracks)
   * ============================================ */
  CM.ORDERS = [
    { id: 0, name: '顺序播放', icon: 'seq' },
    { id: 1, name: '列表循环', icon: 'loop' },
    { id: 2, name: '单曲循环', icon: 'one' },
    { id: 4, name: '随机播放', icon: 'shuffle' }
  ];
  CM.orderIndexOf = function(orderId) {
    for (var i = 0; i < CM.ORDERS.length; i++) if (CM.ORDERS[i].id === orderId) return i;
    return 0;
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
   * 设置持久化（localStorage）
   * ============================================ */
  var SETTINGS_KEY = 'cloudmusic-settings-v2';
  CM.settings = { lyricsVisible: true, visualizer: true, tab: 'discover', volume: null };
  CM.loadSettings = function() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        for (var k in CM.settings) if (s[k] !== undefined) CM.settings[k] = s[k];
      }
    } catch (e) {}
  };
  CM.saveSettings = function() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(CM.settings)); } catch (e) {}
  };

  /* ============================================
   * 工具函数
   * ============================================ */
  CM.formatTime = function(sec) {
    if (!sec || sec <= 0 || !isFinite(sec)) return '0:00';
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h > 0) return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    return m + ':' + (s < 10 ? '0' : '') + s;
  };

  // formatTime 的小容量缓存：timeHighRes ~30fps 对同一秒值重复格式化，
  // position 每秒才变一次、duration 恒定，16 项 FIFO 命中率接近 100%
  var _ftCache = {}, _ftKeys = [];
  CM.formatTimeCached = function(sec) {
    if (!sec || sec <= 0 || !isFinite(sec)) return '0:00';
    var k = Math.floor(sec);
    var hit = _ftCache[k];
    if (hit !== undefined) return hit;
    var s = CM.formatTime(k);
    _ftCache[k] = s;
    _ftKeys.push(k);
    if (_ftKeys.length > 16) delete _ftCache[_ftKeys.shift()];
    return s;
  };

  CM.formatSize = function(bytes) {
    bytes = +bytes || 0;
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  };

  // foobar 查询引擎的字符串无任何转义机制（\"、/\"、双写引号、单引号包裹实测均不支持），
  // 但 IS/HAS 支持 glob 通配符：含引号的标签值用 ? 逐位替换引号，构造等长近精确查询，
  // 再由调用方按原值在客户端二次过滤
  CM.wildValue = function(v) {
    return typeof v === 'string' && v ? v.replace(/"/g, '?') : null;
  };

  CM.trackName = function(t) {
    if (!t) return '未知曲目';
    return t.title || (t.path ? String(t.path).replace(/\\/g, '/').split('/').pop() : '未知曲目');
  };

  CM.trackArtist = function(t) {
    if (!t) return '';
    return t.artist || t.albumArtist || '未知艺术家';
  };

  // 用于 artwork/rating 等 API 的最佳路径
  CM.trackPath = function(t) {
    if (!t) return '';
    return t.absolutePath || t.path || '';
  };

  CM.escHtml = function(s) {
    return s == null ? '' : String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  CM.debounce = function(fn, ms) {
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
  CM.delayedLoading = function(showFn, ms) {
    var timer = setTimeout(showFn, ms == null ? 150 : ms);
    return function() { clearTimeout(timer); };
  };

  // 按钮 loading 状态：禁用并替换文本，返回恢复函数（自动还原原文本）
  // 用法：var resetBtn = CM.setBtnLoading(btn, '加载中...'); ... resetBtn();
  CM.setBtnLoading = function(btn, loadingText) {
    if (!btn) return function() {};
    var span = btn.querySelector('span');
    var prevText = span ? span.textContent : null;
    btn.disabled = true;
    if (span) span.textContent = loadingText;
    return function() {
      btn.disabled = false;
      if (span) span.textContent = prevText;
    };
  };

  // 通用频谱条更新（迷你频谱 + 沉浸式频谱共用）
  // 对数压缩 (pow 0.7) 使视觉更平滑；maxH/mult 由调用方按频谱条尺寸传入
  // 使用 transform:scaleY 代替 height，避免每帧 layout 重排（composite-only）
  // Math.pow(v, 0.7) 每帧每条都调用，量化为 256 级查找表（频谱值为 0..1 归一化）
  var _powLut = new Float32Array(256);
  for (var _pi = 0; _pi < 256; _pi++) _powLut[_pi] = Math.pow(_pi / 255, 0.7);
  CM.updateSpectrumBars = function(barEls, spec, count, maxH, mult) {
    if (!barEls || !barEls.length || !spec || !spec.length) return;
    var step = spec.length / count;
    for (var i = 0; i < count; i++) {
      var v = spec[Math.floor(i * step)] || 0;
      var q = (v * 255 + 0.5) | 0; // 四舍五入量化到 0..255
      if (q < 0) q = 0; else if (q > 255) q = 255;
      var h = Math.max(2, Math.min(maxH, _powLut[q] * mult));
      barEls[i].style.transform = 'scaleY(' + (h / maxH).toFixed(3) + ')';
    }
  };

  // 把时间文本解析成毫秒，无效返回 null
  function parseClock(s) {
    // 匹配以下格式：
    // (HH:)mm:ss([.|:]SSS)
    const match = s.match(/^(?:(\d{1,2}):)?([0-5]?\d):([0-5]?\d)(?:[:.](\d{1,3}))?$/);
    if (!match) return null;

    const [_, h, m, sec, ms] = match;
    const hours = h ? +h : 0, minutes = +m,
      seconds = +sec, millis = ms ? +ms.padEnd(3, '0') : 0;

    return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000 + millis);
  }
  // 提取行内全部 LRC 时间戳（含小时前缀），返回 [{ time, start, end }]（start/end 为行内下标）
  function collectTimeTags(line) {
    var out = [], re = /\[([^\]\[]+)\]/g, m, t;
    while ((m = re.exec(line)) !== null) {
      t = parseClock(m[1]);
      if (t !== null) out.push({ time: t, start: m.index, end: re.lastIndex });
    }
    return out;
  }

  // 逐字歌词（word-level）：把 [mm:ss.xx]字[mm:ss.xx]字... 拆成 {time, text} 片段对。
  // 语义：时间戳前的文本在其后那个时间戳吟唱；前导文本归第一个时间戳、尾部文本归末个时间戳。
  // 仅保留非空文本片段，避免"带空格的多时间戳普通歌词行"被误判成逐字歌词。
  function parseWordLevelPairs(line, tags) {
    var pairs = [], t = tags || collectTimeTags(line);
    if (!t.length) return pairs;
    // 去掉片段内可能残留的元数据/注释方括号（如 [hash:]），其余逻辑不变
    var frag = function(s) { return s.replace(/\[[^\]]*\]/g, '').trim(); };
    var lead = frag(line.slice(0, t[0].start));
    if (lead) pairs.push({ time: t[0].time, text: lead });
    for (var i = 0; i < t.length - 1; i++) {
      var chunk = frag(line.slice(t[i].end, t[i + 1].start));
      if (chunk) pairs.push({ time: t[i].time, text: chunk });
    }
    var tail = frag(line.slice(t[t.length - 1].end));
    if (tail) pairs.push({ time: t[t.length - 1].time, text: tail });
    return pairs;
  }

  // 逐字片段按句读边界分组为显示行，避免整段逐字全部挤成一行
  function trimLine(cur) {
    while (cur.words.length && /^\s*$/.test(cur.words[cur.words.length - 1].text)) cur.words.pop();
    cur.text = cur.text.replace(/\s+$/, '');
    return cur;
  }
  function groupWordLevelPairs(pairs) {
    // 借鉴 befeast/karaoke 的成行模型：不按时间阈值激进重组句子（业界主流均不自动断句）。
    //   - 仅在强句读标点后开启新句；
    //   - 单行总跨度不得超过 MAX_LINE_SPAN 秒，超限则贪心在"最大且 >= MIN_SPLIT_GAP 的词间空隙"处拆成两段。
    var MAX_SPAN = 12.0, MIN_SPLIT_GAP = 1.0;
    var PUNCT_RE = /[。！？!?；;]$/;
    var lines = [], cur = null;
    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i];
      // 上一条结尾是强标点 → 新句
      if (i > 0 && cur && PUNCT_RE.test(pairs[i - 1].text)) { lines.push(trimLine(cur)); cur = null; }
      if (!cur) cur = { time: p.time, text: '', words: [] };
      cur.words.push({ text: p.text, time: p.time });
      cur.text += p.text;
    }
    if (cur) lines.push(trimLine(cur));
    // 超长行保护：跨度 > MAX_SPAN 的行在最大(且 >= MIN_SPLIT_GAP)空隙处拆开，贪心最大间隙优先，递归到无超限
    var splitOverlong = function(line) {
      var span = line.words[line.words.length - 1].time - line.words[0].time;
      if (span <= MAX_SPAN) return [line];
      var best = -1, bestGap = -1;
      for (var j = 0; j < line.words.length - 1; j++) {
        var g = line.words[j + 1].time - line.words[j].time;
        if (g >= MIN_SPLIT_GAP && g > bestGap) { bestGap = g; best = j; }
      }
      if (best < 0) return [line];
      var a = { time: line.words[0].time, text: '', words: line.words.slice(0, best + 1) };
      var b = { time: line.words[best + 1].time, text: '', words: line.words.slice(best + 1) };
      a.text = a.words.map(function(w) { return w.text; }).join('');
      b.text = b.words.map(function(w) { return w.text; }).join('');
      return splitOverlong(trimLine(a)).concat(splitOverlong(trimLine(b)));
    };
    var out = [];
    for (var k = 0; k < lines.length; k++) out = out.concat(splitOverlong(lines[k]));
    return out;
  }

  CM.parseLRC = function(lrcText) {
    if (!lrcText) return [];
    // 剥离首部 BOM（内嵌歌词可能残留 \uFEFF）
    if (lrcText.charCodeAt(0) === 0xFEFF) lrcText = lrcText.slice(1);
    // 提取全局时间偏移：[offset:±毫秒] 与 [ts:±毫秒] 同为全局偏移（正偏移 = 歌词整体延后，时间戳 + 偏移/1000），可叠加
    const off = /\[offset:([+-]?\d+)\]/i.exec(lrcText),
      ts = /\[ts:([+-]?\d+)\]/i.exec(lrcText);
    const offsetMs = (off ? +off[1] : 0) + (ts ? +ts[1] : 0);

    // 剥离元数据标签（ti/ar/al/by/re/ve/length/au/la/language/offset/ts 等），容忍冒号两侧空白，避免其泄漏进歌词文本
    var clean = lrcText.replace(/\[(?:ti|ar|al|by|re|ve|length|au|la|language|offset|ts)\s*:\s*[^\]]*\]/gi, '');
    var result = [], lines = clean.split('\n');
    // 增强型 LRC（精准歌词）：行内逐字时间戳 <mm:ss.xx>字<mm:ss.xx>字...
    const wordReg = /<([^>]*)>([^<]*)(?=<([^>]*)>)/g;
    lines.forEach(line => {
      if (!line) return;
      // 用统一解析器收集行内全部时间戳（含 [h:mm:ss] 小时前缀），非时间括号（如（翻译））不计为时间
      var tags = collectTimeTags(line);
      if (!tags.length) return;
      // 去掉全部方括号分组得到歌词文本：时间戳已单独捕获，其余 [ti:] [hash:] 等元数据/注释
      // 一律清除，避免与时间戳同行的元数据泄漏进歌词文字
      var text = line.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!text) return;
      const times = tags.map(tag => tag.time);
      const preLine = result.at(-1);
      if (times[0] === preLine?.startTime) {
        preLine.translatedLyric = text;
        return;
      }
      if (preLine?.endTime === Infinity) {
        preLine.endTime = preLine.words[0].endTime = times[0];
      }
      const words = Array.from(text.matchAll(wordReg), ([_, start, word, end]) =>
      ({ word, startTime: parseClock(start), endTime: parseClock(end) }));

      if (words.length) {
        // 兼容"相对行起点的逐字时间戳"：整段逐字的最末时间早于该行时间，说明 <mm:ss> 是相对行首的
        // （不少工具/歌词站生成的逐字时间从 00:00 起算）。此时整体平移到与该行时间戳对齐；
        // 绝对时间戳文件（末字时间 >= 行时间）不受影响。
        if (times.length && words.at(-1).startTime < times[0] - 0.05) {
          var shift = times[0] - words[0].startTime;
          if (Math.abs(shift) > 0.05) {
            words.forEach(w => {
              w.startTime += shift;
              w.endTime += shift;
            });
          }
        }
        // 去除行内逐字时间戳，得到纯文本
        text = text.replace(/<[^>]*>/g, '').trim();
        const endTime = words.at(-1).endTime;
        result.push(...times.map(startTime => ({ startTime, endTime, text, words })));
      } else {
        // 逐字歌词（word-level）：多个时间戳与文本片段交替出现。
        // 仅当存在多个"非空白文本片段"时才按逐字分组为显示行，
        // 否则把整行文本复制到每个时间戳下（卡拉OK重复行的正确行为）。
        var pairs = parseWordLevelPairs(line, tags);
        var grouped = pairs.length > 1 ? groupWordLevelPairs(pairs) : null;
        if (grouped?.length) {
          result.push(...grouped);
          return;
        }
        result.push(...times.map(startTime => ({ startTime, endTime: Infinity, words: [{ startTime, endTime: Infinity, word: text }] })));
      }
    });
    // 应用全局时间偏移（正偏移 = 歌词延后）
    if (offsetMs) {
      const off = offsetMs / 1000;
      result.forEach(item => {
        item.startTime += off;
        item.endTime += off;
        item.words?.forEach(w => {
          w.startTime += off;
          w.endTime += off;
        });
      });
    }
    return result.sort((a, b) => a.startTime - b.startTime);
  };

  CM.GuidCache = new Map();
  CM.getGuid = async function(query) {
    if (!query) return;
    if (CM.GuidCache.has(query)) return CM.GuidCache.get(query);

    const { results } = await fb2k.invoke('discovery.searchCommands', { query, includeHidden: true });
    const cmd = results.find(item => item.name.includes(query));
    const guid = { name: cmd?.name, guid: cmd?.guid, subGuid: cmd?.subGuid };
    CM.GuidCache.set(query, guid);
    return guid;
  }

  // 获取所有组件
  fb2k.invoke('discovery.getComponents').then(data => CM.components = data.components);

  CM.checkCompCache = new Map();
  CM.checkComponent = function(name) {
    if (CM.checkCompCache.has(name)) return CM.checkCompCache.get(name);
    const found = CM.components.some(c => c.filename === name);
    CM.checkCompCache.set(name, found);
    return found;
  }

  /* ============================================
   * 动态配色 — 从封面提取活力色写入 HSL 令牌
   * ============================================ */
  CM.rgbToHsl = function(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        default: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return [h, s, l];
  };

  // 按饱和度加权取样，避免平均色发灰
  // 复用 Image 和 canvas 对象，避免每次切歌都创建新对象
  var _colorImg = new Image();
  _colorImg.crossOrigin = 'anonymous';
  var _colorCanvas = document.createElement('canvas');
  _colorCanvas.width = 48; _colorCanvas.height = 48;
  var _colorCtx = _colorCanvas.getContext('2d');
  var _colorSize = 48;

  CM.extractColorFromImage = function(url) {
    if (!url) { CM.resetAccent(); return; }
    _colorImg.onload = function() {
      try {
        _colorCtx.clearRect(0, 0, _colorSize, _colorSize);
        _colorCtx.drawImage(_colorImg, 0, 0, _colorSize, _colorSize);
        var data = _colorCtx.getImageData(0, 0, _colorSize, _colorSize).data;
        var wr = 0, wg = 0, wb = 0, wSum = 0;
        for (var i = 0; i < data.length; i += 4) {
          var r = data[i], g = data[i + 1], b = data[i + 2];
          var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          var sat = mx === 0 ? 0 : (mx - mn) / mx;
          var lum = (mx + mn) / 510;
          // 偏好饱和且亮度适中的像素
          var w = sat * sat * (1 - Math.abs(lum - 0.5) * 1.2) + 0.02;
          wr += r * w; wg += g * w; wb += b * w; wSum += w;
        }
        if (wSum <= 0) return;
        var hsl = CM.rgbToHsl(wr / wSum, wg / wSum, wb / wSum);
        var h = Math.round(hsl[0] * 360);
        var s = Math.round(Math.max(0.55, Math.min(0.9, hsl[1])) * 100);
        var l = Math.round(Math.max(0.5, Math.min(0.62, hsl[2])) * 100);
        var root = document.documentElement.style;
        root.setProperty('--accent', 'hsl(' + h + ',' + s + '%,' + l + '%)');
        root.setProperty('--accent-h', h);
        root.setProperty('--accent-s', s + '%');
        root.setProperty('--accent-l', l + '%');
      } catch (e) { /* 跨域或解码失败时保持默认色 */ }
    };
    _colorImg.onerror = function() {};
    _colorImg.src = url;
  };

  CM.resetAccent = function() {
    var root = document.documentElement.style;
    root.setProperty('--accent', '#EC4141');
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
