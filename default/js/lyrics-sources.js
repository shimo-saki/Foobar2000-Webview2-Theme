/* ============================================================
 * CloudMusic lyrics-sources.js — 在线取词「多源聚合」
 * ------------------------------------------------------------
 * 背景（改进指南 §3.1）：原来的在线取词只有「QQ 桥接兜底」一条路，
 * 匹配不到就没辙。这里加一层多源聚合，每个源实现同一套接口：
 *
 *     search(meta) -> Promise<Candidate[]>    // 搜索候选（只发曲名/艺人/专辑/时长，不发文件路径）
 *     fetch(cand)  -> Promise<string>         // 取回该候选的歌词原文（LRC 文本）
 *
 * 候选统一归一化成同一形状（见 normalize 注释），调用方（lyrics-resolver.js
 * 自动匹配 / ui-lyrics.js 候选面板）不关心它来自哪个平台。
 *
 * 三个源：
 *   · LRCLIB  —— 免 key、覆盖广，`/api/search` 直接回带明文/同步两种歌词，
 *                是"补命中率"的主力（QQ/网易云没有的曲目它常有）。
 *   · 网易云  —— 复用页内 NeteaseBridge.search / lyricById。
 *   · QQ音乐  —— 复用页内 QQBridge.search / lyricById。
 *
 * 隐私（照抄作者版口径）：只把曲名/艺人/专辑/时长发给第三方，**绝不发文件路径**。
 *
 * HTTP 走宿主原生客户端（异步 + http:response 事件 + http.abort 超时）——
 * 与 qqmusic-core / netease-core 同一套；async:false 会冻住 foobar 主窗口。
 * 本文件是第三个这么写的模块（前两个各存一份），属于项目既有约定，不做抽取。
 *
 * 加载位置：index.html 里紧跟 netease-core.js，且在 lyrics-resolver.js 之前。
 * ============================================================ */

(function () {
  'use strict';

  var CM = window.CloudMusic;
  if (!CM || typeof CM.api !== 'function') return;

  var LRCLIB = 'https://lrclib.net';
  /* LRCLIB 要求客户端自我标识；浏览器 fetch 会丢掉 User-Agent，所以同时给
     X-User-Agent 兜底（宿主原生客户端两者都吃得下）。 */
  var UA = 'CloudMusic-foobar2000-theme/' + (CM.VERSION || '3') + ' (foo_ui_webview2)';
  var LR_HEADERS = { Accept: 'application/json', 'User-Agent': UA, 'X-User-Agent': UA };

  var MIN_SCORE = 0.8;          // 低于此分视为"没匹配上"（与 QQ/网易云桥接同口径，宁缺勿错）
  var MAX_TRY = 4;              // 自动匹配最多依次试几个候选（分数降序）

  /* ============================================================
   * 宿主 HTTP（异步）
   * ============================================================ */
  var _inflight = {}, _httpListening = false;

  function httpListen() {
    if (_httpListening || typeof fb.on !== 'function') return;
    _httpListening = true;
    fb.on('http:response', function (e) {
      if (!e || !e.requestId) return;
      var w = _inflight[e.requestId];
      if (!w) return;
      delete _inflight[e.requestId];
      clearTimeout(w.timer);
      if (e.success === false) w.reject(new Error(e.error || ('HTTP ' + (e.status || '失败'))));
      else w.resolve(e);
    });
  }

  function httpGet(url, headers, ms, tag) {
    if (typeof fb.invoke !== 'function') return Promise.reject(new Error('宿主 HTTP 不可用'));
    httpListen();
    return fb.invoke('http.get', { url: url, async: true, headers: headers || {} })
      .then(function (init) {
        if (!init) throw new Error('宿主没有响应');
        if (init.async !== true || !init.requestId) {
          // 宿主忽略 async、当场回了全量：直接当最终回包
          if (init.success === false && !init.status) throw new Error(init.error || init.code || '宿主请求失败');
          return init;
        }
        return new Promise(function (resolve, reject) {
          _inflight[init.requestId] = {
            resolve: resolve, reject: reject,
            timer: setTimeout(function () {
              delete _inflight[init.requestId];
              fb.invoke('http.abort', { requestId: init.requestId }).catch(function () {});
              reject(new Error('超时:' + (tag || 'http')));
            }, ms || 12000)
          };
        });
      });
  }

  function httpJson(url, headers, ms, tag) {
    return httpGet(url, headers, ms, tag).then(function (r) {
      var body = r && r.body;
      if (body == null || body === '') throw new Error('空响应（HTTP ' + ((r && r.status) || '?') + '）');
      try { return { status: (r && r.status) || 0, json: JSON.parse(body) }; }
      catch (e) { throw new Error('返回不是 JSON（HTTP ' + ((r && r.status) || '?') + '）'); }
    });
  }

  /* ============================================================
   * 名字归一化 / 相似度（与 netease-core 同口径，避免各写一套判据）
   * ============================================================ */
  function toSimplified(s) {
    if (window.QQBridge && typeof QQBridge.toSimplified === 'function') return QQBridge.toSimplified(s);
    return String(s == null ? '' : s);
  }
  function normKey(s) {
    s = toSimplified(String(s == null ? '' : s).toLowerCase());
    s = s.replace(/[\(\[（【{].*?[\)\]）】}]/g, '');
    // 与 qqmusic-core / netease-core 同一口径（含谚文：缺了它韩语标题会被整串清空）
    s = s.replace(/[^0-9a-z\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\u1100-\u11ff]/g, '');
    return s;
  }
  function shareRatio(a, b) {
    a = normKey(a); b = normKey(b);
    if (!a || !b) return 0;
    var ca = {}, cb = {}, common = 0, i;
    for (i = 0; i < a.length; i++) ca[a.charAt(i)] = (ca[a.charAt(i)] || 0) + 1;
    for (i = 0; i < b.length; i++) cb[b.charAt(i)] = (cb[b.charAt(i)] || 0) + 1;
    for (var k in cb) { if (ca[k]) common += Math.min(ca[k], cb[k]); }
    return common / Math.max(a.length, b.length);
  }

  /* ============================================================
   * 候选打分（标题 1.0 + 艺人 0.6 + 时长吻合 + 源偏好；伴奏/翻唱降权）
   * ============================================================ */
  var ZH = /^zh/i.test(navigator.language || '');
  function srcBonus(src) {
    if (ZH) return src === 'netease' ? 0.2 : (src === 'qq' ? 0.15 : 0.1);
    return src === 'lrclib' ? 0.2 : 0.1;
  }
  function scoreOf(c, meta) {
    var s = 0;
    if (meta.title) s += shareRatio(meta.title, c.title) * 1.0;
    if (meta.artist) s += shareRatio(meta.artist, c.artist) * 0.6;
    if (meta.duration > 0 && c.duration > 0) {
      var d = Math.abs(c.duration - meta.duration);
      if (d <= 2) s += 1.3;
      else if (d <= 5) s += 0.6;
      else if (d <= 12) s += 0.15;
      else if (d > 30) s -= 0.5;
    }
    var low = (c.title + ' ' + c.artist).toLowerCase();
    if (/伴奏|remix|instrumental|纯音乐|off vocal/.test(low)) s -= 0.8;
    if (/伴奏|纯音乐|instrumental|off vocal/.test(String(c.title).toLowerCase())) s -= 99;
    if (c.instrumental) s -= 0.6;
    s += srcBonus(c.src);
    return s;
  }
  function rank(list, meta) {
    var out = (list || []).map(function (c) { return { cand: c, score: scoreOf(c, meta) }; });
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  /* ============================================================
   * 源 1：LRCLIB
   * ------------------------------------------------------------
   * /api/search?track_name=&artist_name=[&album_name=]  -> 记录数组（最多 20 条）
   * 记录自带 syncedLyrics（LRC 带时间轴）/ plainLyrics（纯文本）/ hasWordSync，
   * 所以搜索一次就把歌词拿到手了，fetch 基本不再发请求。
   * 精确单曲接口 /api/get 需要时长 ±2s 才命中，作为搜索命不中时的补充。
   * ============================================================ */
  function lrSearch(meta) {
    var q = [];
    if (meta.title && meta.artist) {
      q.push('track_name=' + encodeURIComponent(meta.title));
      q.push('artist_name=' + encodeURIComponent(meta.artist));
      if (meta.album) q.push('album_name=' + encodeURIComponent(meta.album));
    } else if (meta.title) {
      q.push('q=' + encodeURIComponent(meta.title));
    } else if (meta.artist) {
      q.push('q=' + encodeURIComponent(meta.artist));
    } else {
      return Promise.resolve([]);
    }
    var url = LRCLIB + '/api/search?' + q.join('&');
    return httpJson(url, LR_HEADERS, 12000, 'lrclib-search').then(function (r) {
      var arr = r.json;
      if (!Array.isArray(arr)) return [];
      return arr.map(function (rec) {
        return {
          src: 'lrclib', label: 'LRCLIB',
          id: rec && rec.id != null ? String(rec.id) : '',
          title: (rec && (rec.trackName || rec.name)) || '',
          artist: (rec && rec.artistName) || '',
          album: (rec && rec.albumName) || '',
          duration: (rec && rec.duration) | 0,
          synced: !!(rec && rec.syncedLyrics),
          plain: !!(rec && rec.plainLyrics),
          words: !!(rec && rec.hasWordSync),
          trans: false,
          instrumental: !!(rec && rec.instrumental),
          // 搜索结果自带歌词：先存着，点选时零延迟
          extra: {
            syncedLyrics: (rec && rec.syncedLyrics) || '',
            plainLyrics: (rec && rec.plainLyrics) || ''
          }
        };
      }).filter(function (c) { return c.title || c.artist; });
    });
  }

  function lrFetch(cand) {
    if (cand.extra && (cand.extra.syncedLyrics || cand.extra.plainLyrics)) {
      return Promise.resolve(cand.extra.syncedLyrics || cand.extra.plainLyrics);
    }
    // 跨会话的"按文件记忆"只存了 id，没有歌词正文 → 按 id 再取一次
    if (!cand.id) return Promise.reject(new Error('缺少 LRCLIB id'));
    return httpJson(LRCLIB + '/api/get/' + encodeURIComponent(cand.id), LR_HEADERS, 12000, 'lrclib-get')
      .then(function (r) {
        var j = r.json || {};
        var text = j.syncedLyrics || j.plainLyrics || '';
        if (!text) throw new Error('这首歌没有歌词');
        return text;
      });
  }

  /* ============================================================
   * 源 2：网易云（页内桥接）
   * ============================================================ */
  function bridgeKw(meta) {
    var kw = (String(meta.title || '') + (meta.artist ? ' ' + meta.artist : '')).trim();
    return kw;
  }

  function neSearch(meta) {
    if (!window.NeteaseBridge || typeof NeteaseBridge.search !== 'function') return Promise.resolve([]);
    var kw = bridgeKw(meta);
    if (!kw) return Promise.resolve([]);
    return NeteaseBridge.search(kw, 1, 8).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || '网易云搜索失败');
      return (r.songs || []).map(function (it) {
        return {
          src: 'netease', label: '网易云',
          id: it && it.id != null ? String(it.id) : '',
          title: (it && it.title) || '', artist: (it && it.artist) || '',
          album: (it && it.album) || '', duration: (it && it.interval) | 0,
          synced: null, plain: null, words: false, trans: null, instrumental: false,
          extra: {}
        };
      }).filter(function (c) { return c.id && c.title; });
    });
  }

  function neFetch(cand) {
    if (!window.NeteaseBridge) return Promise.reject(new Error('网易云桥接未加载'));
    if (typeof NeteaseBridge.lyricById === 'function' && cand.id) {
      return NeteaseBridge.lyricById(cand.id).then(function (t) {
        if (!t) throw new Error('这首歌没有歌词');
        return t;
      });
    }
    return NeteaseBridge.lyric(cand.title, cand.artist, cand.duration).then(function (r) {
      if (!r || !r.ok || !r.lrc) throw new Error((r && r.note) || '这首歌没有歌词');
      return r.lrc;
    });
  }

  /* ============================================================
   * 源 3：QQ 音乐（页内桥接）
   * ============================================================ */
  function qqSearch(meta) {
    if (!window.QQBridge || typeof QQBridge.search !== 'function') return Promise.resolve([]);
    var kw = bridgeKw(meta);
    if (!kw) return Promise.resolve([]);
    return QQBridge.search(kw, 1, 8).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || 'QQ 搜索失败');
      return (r.songs || []).map(function (it) {
        return {
          src: 'qq', label: 'QQ音乐',
          id: (it && it.songmid) || '',
          title: (it && it.title) || '', artist: (it && it.artist) || '',
          album: (it && it.album) || '', duration: (it && it.interval) | 0,
          synced: null, plain: null, words: false, trans: null, instrumental: false,
          extra: {}
        };
      }).filter(function (c) { return c.id && c.title; });
    });
  }

  function qqFetch(cand) {
    if (!window.QQBridge) return Promise.reject(new Error('QQ 桥接未加载'));
    if (typeof QQBridge.lyricById === 'function' && cand.id) {
      return QQBridge.lyricById(cand.id).then(function (t) {
        if (!t) throw new Error('这首歌没有歌词');
        return t;
      });
    }
    return QQBridge.lyric(cand.title, cand.artist, cand.duration).then(function (r) {
      if (!r || !r.ok || !r.lrc) throw new Error((r && r.note) || '这首歌没有歌词');
      return r.lrc;
    });
  }

  /* ============================================================
   * 源注册表 + 开关（设置里可逐源启停，落 CM.settings.lyricSources）
   * ============================================================ */
  var SOURCES = [
    { id: 'lrclib', label: 'LRCLIB', search: lrSearch, fetch: lrFetch },
    { id: 'netease', label: '网易云', search: neSearch, fetch: neFetch },
    { id: 'qq', label: 'QQ音乐', search: qqSearch, fetch: qqFetch }
  ];

  function enabledMap() {
    var m = CM.settings.lyricSources;
    if (!m || typeof m !== 'object' || Array.isArray(m)) m = CM.settings.lyricSources = {};
    for (var i = 0; i < SOURCES.length; i++) {
      if (typeof m[SOURCES[i].id] !== 'boolean') m[SOURCES[i].id] = true;   // 默认全开
    }
    return m;
  }
  function activeSources() {
    var m = enabledMap();
    return SOURCES.filter(function (s) { return m[s.id] !== false; });
  }
  function sourceById(id) {
    for (var i = 0; i < SOURCES.length; i++) if (SOURCES[i].id === id) return SOURCES[i];
    return null;
  }

  /* ============================================================
   * 公共接口
   * ============================================================ */
  function metaFor() {
    var t = CM.currentTrack;
    if (!t) return { title: '', artist: '', album: '', duration: 0, path: '' };
    return {
      title: CM.trackName ? CM.trackName(t) : (t.title || ''),
      artist: CM.trackArtist ? CM.trackArtist(t) : (t.artist || ''),
      album: t.album || '',
      duration: t.duration || t.length || CM.state.duration || 0,
      path: CM.trackPath ? CM.trackPath(t) : (t.path || '')
    };
  }

  /* 并行问所有启用的源；某个源失败只记 errors，不拖垮整次搜索。
     anyOk = 至少一个源正常应答（用来区分"在线没有"与"取词失败"）。 */
  function searchAll(meta) {
    meta = meta || metaFor();
    var srcs = activeSources();
    var errors = [], anyOk = false;
    var jobs = srcs.map(function (s) {
      return s.search(meta).then(function (list) { anyOk = true; return list || []; },
        function (e) {
          errors.push({ src: s.id, label: s.label, message: (e && e.message) || '搜索失败' });
          return [];
        });
    });
    return Promise.all(jobs).then(function (lists) {
      var all = [];
      for (var i = 0; i < lists.length; i++) all = all.concat(lists[i]);
      return { candidates: all, errors: errors, anyOk: anyOk, meta: meta };
    });
  }

  function fetchCand(cand) {
    var s = sourceById(cand && cand.src);
    if (!s) return Promise.reject(new Error('未知来源：' + (cand && cand.src)));
    return s.fetch(cand);
  }

  function miss(res, note) {
    return { ok: false, lrc: '', cand: null, note: note || 'no-match',
             candidates: res.candidates, errors: res.errors, anyOk: res.anyOk };
  }

  /* 自动匹配：搜索 → 打分排序 → 依次试（前几个）直到取到词。
     依次试是为了避免"分数最高那条恰好没词/取不到"直接判失败。 */
  function auto(meta) {
    meta = meta || metaFor();
    return searchAll(meta).then(function (res) {
      var ranked = rank(res.candidates, meta).filter(function (r) { return r.score >= MIN_SCORE; }).slice(0, MAX_TRY);
      if (!ranked.length) return miss(res, res.candidates.length ? 'low-score' : 'no-candidate');
      var i = 0;
      function next() {
        if (i >= ranked.length) return miss(res);
        var c = ranked[i++];
        return fetchCand(c.cand).then(function (text) {
          if (text) return { ok: true, lrc: text, cand: c.cand, score: c.score,
                             candidates: res.candidates, errors: res.errors, anyOk: res.anyOk };
          return next();
        }, function () { return next(); });
      }
      return next();
    });
  }

  /* 按文件记忆的手动选择（落 CM.settings.lyricPicks，上限 500 条，同 lyricModes 策略） */
  function picks() {
    var p = CM.settings.lyricPicks;
    if (!p || typeof p !== 'object' || Array.isArray(p)) p = CM.settings.lyricPicks = {};
    return p;
  }
  function pick(path) {
    if (!path) return null;
    var c = picks()[path];
    return (c && c.src) ? c : null;
  }
  function setPick(path, cand) {
    if (!path || !cand) return;
    var p = picks();
    p[path] = { src: cand.src, id: cand.id || '', title: cand.title || '', artist: cand.artist || '',
                album: cand.album || '', duration: cand.duration | 0, at: Date.now() };
    var keys = Object.keys(p);
    for (var i = 0; keys.length - i > 500; i++) delete p[keys[i]];
    CM.saveSettings();
  }
  function clearPick(path) {
    if (!path) return;
    var p = picks();
    if (p[path]) { delete p[path]; CM.saveSettings(); }
  }

  CM.lyricSources = {
    MIN_SCORE: MIN_SCORE,
    sources: SOURCES,
    enabledMap: enabledMap,
    activeSources: activeSources,
    sourceById: sourceById,
    metaFor: metaFor,
    searchAll: searchAll,
    fetch: fetchCand,
    score: scoreOf,
    rank: rank,
    auto: auto,
    pick: pick,
    setPick: setPick,
    clearPick: clearPick
  };
})();