/* ============================================================
 * CloudMusic 主题扩展 · 网易云音乐页内桥接（netease-core.js）
 * ------------------------------------------------------------
 * 与 js/qqmusic-core.js 同构的**页内桥接**：
 *   · 没有本地进程 / 端口 / 开关脚本，随主题页加载，随 foobar 启动而在；
 *   · 上游 HTTP 全部走宿主 foo_ui_webview2 的原生客户端（无 CORS）；
 *   · 一律 async:true + http:response 事件 + http.abort 超时（同 QQ 桥接：
 *     async:false 会让宿主在自己的 UI 线程上做完整个请求，请求多慢 foobar
 *     主窗口就假死多久）；
 *   · Cookie / 音质 / 直链↔曲目映射存 localStorage，随 WebView2 配置持久化。
 *
 * 上游接口（2026-10-06 实测，**全部免签名**，不需要 AES/RSA 那套 weapi/eapi）：
 *
 *   搜索   POST https://music.163.com/api/cloudsearch/pc
 *          s / type=1 / offset / limit / total=true（表单编码）
 *          → result.songs[] 自带 id、name、ar[]、al{name,picUrl}、dt(毫秒)、
 *            fee、privilege{pl,plLevel,dlLevel,maxBrLevel}
 *          免登录可用，而且**响应直接带封面直链**（不需要 picId 加密换算）。
 *   搜索兜底 GET /api/search/get/web?s=&type=1&offset=&limit=
 *          无封面字段，cloudsearch 被限流时用。
 *   直链   GET  https://music.163.com/api/song/enhance/player/url?ids=[..]&br=320000
 *          **批量**：实测一次 20 首 161ms。返回每首的**实际**档位 —— 要不到的
 *          档位会自动降级而不是报错（匿名请求无损会拿到 320K MP3），所以音质
 *          一律以返回的 level/br 为准回填，不按请求值假设。
 *          freeTrialInfo 非空 = 会员曲目的 30/45 秒试听切片，**必须过滤**：
 *          接口照样给一个能播的 URL，不理它 foobar 歌单里就会混进 30 秒的歌。
 *   歌词   GET  https://music.163.com/api/song/lyric?id=&lv=1&kv=1&tv=-1
 *          → lrc.lyric 原文 + tlyric.lyric 译文（同刻时间戳，直接追加在原文
 *            之后，交给主题的「同刻归组」配对成主/副行）；rv=1 另给 romalrc。
 *   歌单   GET  https://music.163.com/api/v6/playlist/detail?id=&n=1000&s=8
 *          公开歌单 / 官方榜单免 Cookie 直接读全曲目，每条带 al.picUrl ——
 *          所以这里**不需要** QQ 那套「导出脚本 + 文本匹配」。
 *   封面   https://p*.music.126.net/….jpg?param=500y500
 *          无防盗链（无 Referer / 任意 Referer 都 200），param 把原图 5MB
 *          压到 328KB，可以直接给 <img>。
 *
 * 为什么网易云可以**在线无损**而 QQ 不行：
 *   实测网易云 FLAC 直链的 Content-Type 是 application/octet-stream
 *   （MP3 是 audio/mpeg），foobar 按内容嗅探就能正确识别；QQ 给所有直链打
 *   audio/x-ogg，FLAC/AAC 会被误当 Ogg 拒解。所以这里播放不再限制 MP3 ——
 *   无损 / Hi-Res 直接流播，音质下拉框同时管播放与下载。
 *
 * 链接过期：网易云 CDN **不校验查询串签名**（实测把 vuutv / authSecret 删掉
 *   或改成假值都照常 206），接口里的 expi=1200 只是建议缓存时长。稳妥起见仍按
 *   「播放失败回页面重新勾选」设计（和 QQ 页一致）。
 *
 * 会员：免费曲库免登录（多为 128K，部分 320K）；无损 / 会员曲目需要 Cookie。
 *   注意 **MUSIC_U 是 HttpOnly** —— 浏览器控制台里 copy(document.cookie) 拿不到
 *   它，登录态必须从开发者工具的请求头/存储里复制，见 UI 里的说明。
 *
 * 导出（window.NeteaseBridge）：见文件末尾。
 * ============================================================ */

(function () {
  'use strict';

  var VERSION = '1.0.0';
  var SITE = 'https://music.163.com';
  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

  /* ------------------------------------------------------------
   * 宿主 HTTP（异步）—— 与 js/qqmusic-core.js 同一套：
   * async:false 会把 foobar 主窗口冻住整个请求时长，必须用
   * async:true + http:response 事件，超时用 http.abort 真取消。
   * responseType:'binary' 也要给：音频/图片字节按 UTF-8 序列化会直接报错，
   * 异步模式下连事件都不发（请求凭空消失）。
   * ---------------------------------------------------------- */
  var _inflight = {};              // requestId -> { resolve, reject, timer }
  var _httpListening = false;

  function httpListen() {
    if (_httpListening) return;
    if (typeof fb.on !== 'function') return;
    _httpListening = true;
    fb.on('http:response', function (e) {
      if (!e || !e.requestId) return;
      var w = _inflight[e.requestId];
      if (!w) return;
      delete _inflight[e.requestId];
      clearTimeout(w.timer);
      if (e.success === false) w.reject(new Error(e.error || ('HTTP ' + (e.status || '失败'))));
      else w.resolve(e);                          // { status, body, headers }
    });
  }

  function inflightCount() { return Object.keys(_inflight).length; }

  function hostHttp(opt) {
    if (typeof fb.invoke !== 'function') {
      return Promise.reject(new Error('宿主 HTTP 不可用'));
    }
    httpListen();
    var fn = opt.method === 'POST' ? 'http.post' : 'http.get';
    var params = { url: opt.url, async: true };
    if (opt.body != null) params.body = opt.body;
    if (opt.responseType) params.responseType = opt.responseType;
    if (opt.headers) params.headers = opt.headers;
    var tag = opt.tag || 'http';
    var ms = opt.ms || 15000;

    return fb.invoke(fn, params).then(function (init) {
      if (!init) throw new Error('宿主没有响应');
      if (init.async !== true || !init.requestId) {
        // 宿主忽略 async、当场回了全量：直接当最终回包用
        if (init.success === false && !init.status) {
          throw new Error(init.error || init.code || '宿主请求失败');
        }
        return init;
      }
      return new Promise(function (resolve, reject) {
        _inflight[init.requestId] = {
          resolve: resolve,
          reject: reject,
          timer: setTimeout(function () {
            delete _inflight[init.requestId];
            /* abort 之后宿主不会再发 http:response，就地失败即可 */
            fb.invoke('http.abort', { requestId: init.requestId }).catch(function () {});
            reject(new Error('超时:' + tag));
          }, ms)
        };
      });
    });
  }

  /* ------------------------------------------------------------
   * 配置：Cookie / 音质 / 直链映射（localStorage）
   * ---------------------------------------------------------- */
  var LS_COOKIE = 'cm.netease.cookie';
  var LS_QUALITY = 'cm.netease.quality';
  var LS_URLMETA = 'cm.netease.urlmeta';

  function lsGet(k) {
    try { return localStorage.getItem(k) || ''; } catch (e) { return ''; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); } catch (e) {}
  }
  function lsDel(k) {
    try { localStorage.removeItem(k); } catch (e) {}
  }

  /* 匿名请求也要带的一对方便键：实测不带 Cookie 头也能搜、能解析，
     但带上 appver/os 更接近客户端，减小被风控的概率。 */
  var BASE_COOKIE = 'appver=8.9.70; os=pc';

  /* 只留与登录态/接口有关的键：从 DevTools 里复制出来的整串通常混着
     Hm_lvt_* / HMACCOUNT 这类统计 Cookie，全塞进请求头只会让头部变长 */
  var KEEP_COOKIE = { MUSIC_U: 1, __csrf: 1, NMTID: 1, __remember_me: 1, MUSIC_A: 1, _ntes_nuid: 1 };

  /* 粘贴内容容错：既接受裸 Cookie 串，也接受
     「Copy as cURL」出来的一整条命令（-H 'cookie: …'），
     还接受从 DevTools 应用面板里整行复制的 "Cookie: xxx"。 */
  function parseCookieInput(raw) {
    var s = String(raw || '');
    var m = /cookie\s*:\s*([^'"]+)/i.exec(s);
    if (m) s = m[1];
    var out = [], seen = {};
    s.split(/[;\n\r]+/).forEach(function (part) {
      var i = part.indexOf('=');
      if (i <= 0) return;
      var k = part.slice(0, i).trim().replace(/^-\S*\s*/, '');
      var v = part.slice(i + 1).trim();
      if (!/^[A-Za-z0-9_]+$/.test(k) || !v) return;
      if (!KEEP_COOKIE[k] || seen[k]) return;
      seen[k] = 1;
      out.push(k + '=' + v);
    });
    return out.join('; ');
  }

  function getCookie() { return lsGet(LS_COOKIE).trim(); }
  function setCookie(ck) {
    var parsed = parseCookieInput(ck);
    /* 解析不出东西按"清除"处理，但必须返回 false：clearCookie() 回的是 true，
       直接 `return clearCookie()` 会让调用方把"什么都没存下"当成保存成功，
       提示变成"已保存但账号接口不认"，用户完全猜不到原 Cookie 已被清掉。 */
    if (!parsed) { clearCookie(); return false; }
    lsSet(LS_COOKIE, parsed);
    return /(?:^|;\s*)MUSIC_U=/.test(parsed);     // 返回是否含登录态
  }

  /* 删键而不是写空串：留一个空键会让"到底清没清"看不出来 */
  function clearCookie() { lsDel(LS_COOKIE); return true; }
  function hasLogin() { return /(?:^|;\s*)MUSIC_U=/.test(getCookie()); }

  function cookieHeader() {
    var ck = getCookie();
    return ck ? (BASE_COOKIE + '; ' + ck) : BASE_COOKIE;
  }

  /* ------------------------------------------------------------
   * 音质表
   * ------------------------------------------------------------
   * 档位名用网易云自己的 level 命名（接口返回的 level 字段就是这几个），
   * br 是「普通直链接口」的参数值。请求高档位拿不到会自动降级，所以
   * **以返回的 level/br 为准**，见 RESOLVED_LEVEL_LABEL。
   * ---------------------------------------------------------- */
  var QUALS = ['standard', 'higher', 'exhigh', 'lossless', 'hires'];
  var QUAL_INFO = {
    standard: { br: 128000, label: '标准 128K' },
    higher: { br: 192000, label: '较高 192K' },
    exhigh: { br: 320000, label: '极高 320K' },
    lossless: { br: 999000, label: '无损 FLAC' },
    hires: { br: 1999000, label: 'Hi-Res' }
  };
  var LEVEL_LABEL = {
    standard: '128K MP3', higher: '192K MP3', exhigh: '320K MP3',
    lossless: '无损 FLAC', hires: 'Hi-Res', jyeffect: '空间音频',
    sky: '沉浸环绕', dolby: '杜比全景声', jymaster: '超清母带'
  };

  function normQuality(q) {
    q = String(q || '').toLowerCase();
    return QUAL_INFO[q] ? q : 'lossless';
  }
  function getQuality() { return normQuality(lsGet(LS_QUALITY) || 'lossless'); }
  function setQuality(q) { lsSet(LS_QUALITY, normQuality(q)); return getQuality(); }

  /* ------------------------------------------------------------
   * 基础请求
   * ---------------------------------------------------------- */
  var _netErr = 0;                                  // 网络/接口失败计数（区分"没匹配到"与"连不上"）
  function netErrs() { return _netErr; }

  function neHeaders(opt) {
    var headers = {
      'User-Agent': UA,
      Referer: SITE + '/',
      Cookie: cookieHeader()
    };
    if (opt && opt.headers) {
      for (var k in opt.headers) {
        if (Object.prototype.hasOwnProperty.call(opt.headers, k)) headers[k] = opt.headers[k];
      }
    }
    return headers;
  }

  /* 一次请求 → { status, headers, body }（headers 也带回来，便于诊断） */
  function neRequest(path, opt) {
    opt = opt || {};
    return hostHttp({
      method: opt.method || 'GET',
      url: /^https?:/i.test(path) ? path : (SITE + path),
      body: opt.body,
      headers: neHeaders(opt),
      ms: opt.ms || 15000,
      tag: opt.tag || 'ne'
    }).then(function (r) { return r; }, function (e) {
      _netErr++;
      throw e;
    });
  }

  function getJson(path, opt) {
    return neRequest(path, opt).then(function (r) {
      try {
        return JSON.parse(r.body);
      } catch (e) {
        /* 解析失败同样是"这次没问成"：不计数的话，一次抖动（宿主回空体 /
           网关回 HTML）会被 findLyric 当成权威的"没有歌词"缓存 30 分钟。
           QQ 桥接的各个搜索通道也是这个口径（_netErr++ 后才返回空数组）。 */
        _netErr++;
        throw new Error('返回不是 JSON（HTTP ' + (r.status || '?') + '）');
      }
    });
  }


  function postForm(path, body, ms, tag) {
    return getJson(path, {
      method: 'POST',
      body: body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      ms: ms || 15000,
      tag: tag || 'ne-post'
    });
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ------------------------------------------------------------
   * 账号 / 会员
   * ---------------------------------------------------------- */
  function account() {
    if (!hasLogin()) return Promise.resolve({ ok: false, loggedIn: false });
    return getJson('/api/nuser/account/get', { ms: 8000, tag: 'account' }).then(function (j) {
      var p = j && j.profile;
      if (!p) return { ok: false, loggedIn: true };              // Cookie 在但接口不认（多半失效了）
      return { ok: true, loggedIn: true, nickname: p.nickname || '',
               userId: p.userId || 0, vipType: p.vipType || 0 };
    }, function () {
      return { ok: false, loggedIn: true, error: '账号接口不可用' };
    });
  }

  /* 会员到期时间（黑胶 VIP / 音乐包任一生效即视为会员） */
  function vipInfo() {
    if (!hasLogin()) return Promise.resolve({ vip: false });
    return getJson('/api/music-vip-membership/client/vip/info', { ms: 8000, tag: 'vip' })
      .then(function (j) {
        var d = (j && j.data) || {};
        var now = Date.now();
        function alive(x) { return !!(x && x.expireTime && x.expireTime > now); }
        var a = d.associator, m = d.musicPackage;
        var exp = Math.max((a && a.expireTime) || 0, (m && m.expireTime) || 0);
        return { vip: alive(a) || alive(m), expire: exp,
                 assoc: !!(a && a.expireTime), pack: !!(m && m.expireTime),
                 redVipLevel: d.redVipLevel || 0 };
      }, function () {
        return { vip: false, error: '会员接口不可用' };
      });
  }

  /* ------------------------------------------------------------
   * 搜索
   * ------------------------------------------------------------
   * 网易云的搜索接口有**显式限流**（实测连打 10 次就回 code=406
   * 「操作频繁，请稍候再试」，约 15 秒自行恢复；限流只作用于搜索 ——
   * 同一时刻直链/歌词/封面接口全部照常）。所以这里做了两件事：
   *   1) 串行化 + 最小间隔：同一时刻只有一个搜索在飞，两次之间隔 SEARCH_GAP；
   *   2) 被限流后进入冷却（LIMIT_COOLDOWN），冷却期内不再打接口而是直接
   *      报「稍后再试」，避免越点越久。
   * ---------------------------------------------------------- */
  var SEARCH_GAP = 1200;
  var LIMIT_COOLDOWN = 12000;
  var _searchQ = Promise.resolve();
  var _lastSearchAt = 0;
  var _limitedUntil = 0;

  function rateLimitErr() {
    var sec = Math.max(1, Math.ceil((_limitedUntil - Date.now()) / 1000));
    var e = new Error('网易云请求过于频繁，请等 ' + sec + ' 秒再搜');
    e.limited = true;
    e.retryAfter = sec;
    return e;
  }

  function queuedSearch(fn) {
    var p = _searchQ.then(function () {
      var gap = Math.max(0, SEARCH_GAP - (Date.now() - _lastSearchAt));
      var cool = Math.max(0, _limitedUntil - Date.now());
      var wait = Math.max(gap, cool);
      return wait ? sleep(wait) : null;
    }).then(fn);
    _searchQ = p.then(function () { _lastSearchAt = Date.now(); },
                      function () { _lastSearchAt = Date.now(); });
    return p;
  }

  function normalize(it) {
    if (!it) return null;
    var al = it.al || it.album || {};
    var ar = it.ar || it.artists || [];
    var priv = it.privilege || {};
    var dt = it.dt != null ? it.dt : (it.duration || 0);
    var names = [];
    for (var i = 0; i < (ar || []).length; i++) {
      if (ar[i] && ar[i].name) names.push(ar[i].name);
    }
    /* pl = 当前账号能播到的最高码率：0 表示只能试听 / 无版权 ——
       比 fee 更能说明"这首歌现在能不能放"（VIP 登录后 VIP 曲的 pl 会变成 999000） */
    var pl = priv.pl != null ? priv.pl : null;
    return {
      id: it.id,
      title: it.name || '',
      artist: names.join(' / '),
      album: al.name || '',
      albumId: al.id || 0,
      picUrl: al.picUrl || '',
      interval: Math.round(dt / 1000),
      fee: it.fee != null ? it.fee : 0,
      vip: (it.fee === 1),
      pl: pl,
      trialOnly: pl === 0,
      level: priv.plLevel || priv.maxBrLevel || '',
      dlLevel: priv.dlLevel || ''
    };
  }

  function normalizeList(list) {
    var out = [];
    for (var i = 0; i < (list || []).length; i++) {
      var n = normalize(list[i]);
      if (n && n.id) out.push(n);
    }
    return out;
  }

  /* 新版聚合搜索（带封面 / 时长 / 权限，优先用这个） */
  function cloudSearch(kw, page, size) {
    var body = 's=' + encodeURIComponent(kw) + '&type=1' +
               '&offset=' + ((page - 1) * size) + '&limit=' + size + '&total=true';
    return postForm('/api/cloudsearch/pc', body, 15000, 'search')
      .then(function (j) {
        if (j.code === 406) {
          _limitedUntil = Date.now() + LIMIT_COOLDOWN;
          throw rateLimitErr();
        }
        // 应用层错误体（风控 / 限流口径变化）按"这次没问成"计：歌词匹配据此把它标成
        // transient，不会被当成权威的"没有搜到"缓存 30 分钟（同 QQ 桥接的通道计数）
        if (j.code !== 200) { _netErr++; throw new Error('搜索接口返回 code=' + j.code); }
        var r = j.result || {};
        return { list: r.songs || [], total: r.songCount || 0 };
      });
  }

  /* 旧版搜索：没有封面字段，但结构简单、限流口径略有不同，用作兜底 */
  function webSearch(kw, page, size) {
    var qs = 's=' + encodeURIComponent(kw) + '&type=1' +
             '&offset=' + ((page - 1) * size) + '&limit=' + size;
    return getJson('/api/search/get/web?' + qs, { ms: 12000, tag: 'search-web' })
      .then(function (j) {
        if (j.code === 406) {
          _limitedUntil = Date.now() + LIMIT_COOLDOWN;
          throw rateLimitErr();
        }
        // 应用层错误体（风控 / 限流口径变化）按"这次没问成"计：歌词匹配据此把它标成
        // transient，不会被当成权威的"没有搜到"缓存 30 分钟（同 QQ 桥接的通道计数）
        if (j.code !== 200) { _netErr++; throw new Error('搜索接口返回 code=' + j.code); }
        var r = j.result || {};
        return { list: r.songs || [], total: r.songCount || 0 };
      });
  }

  function doSearch(kw, page, size) {
    return cloudSearch(kw, page, size).catch(function (e) {
      if (e && e.limited) throw e;               // 限流不再用兜底通道加重限流
      return webSearch(kw, page, size);
    });
  }

  /* 搜到 0 首 ≠ 搜索失败：ok 表示「这次查询问成了」，UI 才能把
     「没有搜到结果」和「网络/接口出错」分开显示 */
  function search(kw, page, size) {
    kw = String(kw || '').trim();
    page = Math.max(1, page | 0);
    size = Math.max(1, size | 0);
    if (!kw) return Promise.resolve({ ok: false, songs: [], more: false, error: '缺少关键词' });
    return queuedSearch(function () { return doSearch(kw, page, size); })
      .then(function (r) {
        var songs = normalizeList(r.list);
        var more = r.total ? ((page - 1) * size + songs.length < r.total)
                           : (songs.length >= size);
        return { ok: true, songs: songs, more: more, total: r.total, error: null };
      }, function (e) {
        return { ok: false, songs: [], more: false, error: (e && e.message) || '搜索失败',
                 limited: !!(e && e.limited), retryAfter: (e && e.retryAfter) || 0 };
      });
  }

  /* ------------------------------------------------------------
   * 直链解析（批量）
   * ------------------------------------------------------------
   * 一次请求解析一批 id，返回每首的**实际**档位；拿不到（无版权 / 未登录的
   * 会员曲目）返回 url:null，只拿到试听切片返回 trial:true。
   * ---------------------------------------------------------- */
  var RESOLVE_CHUNK = 10;      // 每个请求塞多少首（实测 20 首也没问题，留余量）
  var RESOLVE_PARALLEL = 3;    // 同时几个请求

  function resolveChunk(ids, quality) {
    var q = QUAL_INFO[normQuality(quality)];
    var url = '/api/song/enhance/player/url?ids=%5B' + ids.join(',') + '%5D&br=' + q.br;
    return getJson(url, { ms: 20000, tag: 'url' }).then(function (j) {
      if (j.code !== 200) throw new Error('直链接口返回 code=' + j.code);
      var by = {};
      (j.data || []).forEach(function (x) { if (x && x.id) by[x.id] = x; });
      return ids.map(function (id) {
        var x = by[id];
        if (!x || !x.url) return { id: id, url: null, code: x ? x.code : 0 };
        var trial = !!(x.freeTrialInfo && (x.freeTrialInfo.end > 0));
        return {
          id: id,
          url: x.url,
          md5: x.md5 || '',
          br: x.br || 0,
          size: x.size || 0,
          type: x.type || '',
          level: x.level || '',
          time: x.time || 0,
          trial: trial,
          trialEnd: trial ? x.freeTrialInfo.end : 0
        };
      });
    });
  }

  /* ------------------------------------------------------------
   * 直链 ↔ 曲目信息（封面兜底 + 歌词精确匹配）
   * ------------------------------------------------------------
   * 在线曲目的「路径」是 CDN 直链：宿主取不到原生封面，文件系统里也无处
   * 可扫。直链文件名是音频文件的 md5（接口会一并给 md5 字段），把它映射回
   * 歌曲 id / 封面直链，封面兜底与歌词匹配就能从播放路径反查回来
   * （网易云直链里不带歌曲 id，所以只能这样记）。持久化上限 400 条。
   * ---------------------------------------------------------- */
  var URLMETA_MAX = 400;
  var _urlMeta = null;

  function urlMetaMap() {
    if (_urlMeta) return _urlMeta;
    try { _urlMeta = JSON.parse(lsGet(LS_URLMETA) || '{}') || {}; }
    catch (e) { _urlMeta = {}; }
    return _urlMeta;
  }

  function md5OfUrl(u) {
    var s = String(u || '').split('?')[0];
    var seg = s.slice(s.lastIndexOf('/') + 1);
    return seg.replace(/\.[a-z0-9]{2,4}$/i, '').toLowerCase();
  }

  /* 只写内存，返回"是否新增/更新"；落盘由调用方在整批结束后做一次 ——
     逐首 persistUrlMeta 会让 300 首的导入在主线程上做 300 次全量
     JSON.stringify（400 条约 80KB）+ 300 次同步 localStorage 写。 */
  function rememberUrlMeta(track, rv) {
    if (!track || !rv || !rv.url) return false;
    var key = rv.md5 ? String(rv.md5).toLowerCase() : md5OfUrl(rv.url);
    if (!key || key.length < 16) return false;        // 不像 md5 就不记，免得污染映射
    var map = urlMetaMap();
    map[key] = {
      id: track.id, picUrl: track.picUrl || '', title: track.title || '',
      artist: track.artist || '', album: track.album || '',
      level: rv.level || '', ts: Date.now()
    };
    return true;
  }

  function persistUrlMeta() {
    var map = _urlMeta || {};
    var keys = Object.keys(map);
    if (keys.length > URLMETA_MAX) {
      keys.sort(function (a, b) { return (map[a].ts || 0) - (map[b].ts || 0); });
      for (var i = 0; i < (keys.length - URLMETA_MAX); i++) delete map[keys[i]];
    }
    try { lsSet(LS_URLMETA, JSON.stringify(map)); } catch (e) {}
  }

  /* CDN 直链 → 曲目信息（播放路径反查；没有记录时返回 null） */
  function metaFromUrl(u) {
    u = String(u || '');
    if (!u) return null;
    /* 兼容「外链」形式 https://music.163.com/song/media/outer/url?id=123.mp3 */
    var m = /[?&]id=(\d+)/.exec(u);
    if (m && /music\.163\.com\/song\/media\/outer/i.test(u)) {
      var hit = null;
      var map = urlMetaMap();
      for (var k in map) {
        if (Object.prototype.hasOwnProperty.call(map, k) && String(map[k].id) === m[1]) { hit = map[k]; break; }
      }
      return { id: Number(m[1]), picUrl: hit ? hit.picUrl : '', title: hit ? hit.title : '',
               artist: hit ? hit.artist : '', album: hit ? hit.album : '', key: '' };
    }
    if (!/music\.126\.net|music\.163\.com/i.test(u)) return null;
    var key = md5OfUrl(u);
    var rec = key ? urlMetaMap()[key] : null;
    if (!rec) return null;
    return { id: rec.id, picUrl: rec.picUrl, title: rec.title, artist: rec.artist,
             album: rec.album, level: rec.level, key: key };
  }

  /* 这个路径是不是网易云的在线曲目（按域名判断，不要求有映射记录） */
  function isNeteaseUrl(u) {
    return /music\.126\.net|music\.163\.com/i.test(String(u || ''));
  }

  /* 把「直链 → 歌名/歌手」注册给主题：在线曲目在 foobar 里没有任何标签，
     CM.trackName / CM.trackArtist 取名时优先查这里 —— 否则界面会把直链
     签名参数里的碎片当成歌名（实测显示成 "GsvWzqeUwhOhb+2GUTYfbcNo="）。 */
  if (window.CloudMusic && window.CloudMusic.registerOnlineName) {
    window.CloudMusic.registerOnlineName(function (path) {
      var m = metaFromUrl(path);
      return m ? { title: m.title, artist: m.artist, album: m.album } : null;
    });
  }

  /* ------------------------------------------------------------
   * 批量解析（勾选播放 / 下载共用）
   * ---------------------------------------------------------- */
  function resolveMany(tracks, quality) {
    tracks = (tracks || []).filter(function (t) { return t && t.id; });
    if (!tracks.length) {
      return Promise.resolve({ ok: false, urls: [], resolves: [], skipped: [],
                               usedLabel: '', error: '没有可解析的曲目' });
    }
    var ids = tracks.map(function (t) { return t.id; });
    var chunks = [];
    for (var i = 0; i < ids.length; i += RESOLVE_CHUNK) chunks.push(ids.slice(i, i + RESOLVE_CHUNK));

    var out = new Array(ids.length);
    var next = 0;
    function worker() {
      if (next >= chunks.length) return Promise.resolve();
      var at = next++;
      return resolveChunk(chunks[at], quality).then(function (list) {
        var base = at * RESOLVE_CHUNK;
        for (var k = 0; k < list.length; k++) out[base + k] = list[k];
      }, function (e) {
        // 某一批失败不该让整批报废：标记空结果，其它批照常
        var base = at * RESOLVE_CHUNK;
        for (var k = 0; k < (chunks[at] || []).length; k++) out[base + k] = { id: chunks[at][k], url: null, failed: true, error: e && e.message };
      }).then(worker);
    }
    var runners = [];
    for (var w = 0; w < Math.min(RESOLVE_PARALLEL, chunks.length); w++) runners.push(worker());

    return Promise.all(runners).then(function () {
      var urls = [], resolves = [], skipped = [], levels = {};
      var noLogin = !hasLogin();
      var netFail = 0, touched = false;
      for (var k = 0; k < tracks.length; k++) {
        var t = tracks[k], rv = out[k] || { id: t.id, url: null };
        if (rv.url && !rv.trial) {
          resolves.push({ id: t.id, url: rv.url, md5: rv.md5, br: rv.br, size: rv.size,
                          type: rv.type, level: rv.level, time: rv.time, trial: false });
          urls.push(rv.url);
          levels[rv.level || '?'] = (levels[rv.level || '?'] || 0) + 1;
          touched = rememberUrlMeta(t, rv) || touched;
        } else if (rv.trial) {
          skipped.push(t.title + '（仅 ' + (rv.trialEnd || 45) + ' 秒试听' +
                       (noLogin ? '，需登录会员' : '，需会员') + '）');
        } else if (rv.failed) {
          // 这一批请求根本没成（网络 / 接口异常），不是"没有音源"：
          // 混进「无版权 / 需会员」会让用户去登录一个根本没问题的账号
          netFail++;
          skipped.push(t.title + '（解析请求失败：' + (rv.error || '网络异常') + '）');
        } else {
          skipped.push(t.title + '（' + (noLogin ? '未登录 / 无版权 / 需会员' : '无版权 / 需会员') + '）');
        }
      }
      if (touched) persistUrlMeta();               // 整批只落盘一次
      var best = '', bestRank = -1;
      Object.keys(levels).forEach(function (lv) {
        var rank = QUALS.indexOf(lv);
        if (rank > bestRank) { bestRank = rank; best = lv; }
      });
      return {
        ok: urls.length > 0,
        urls: urls,
        resolves: resolves,
        skipped: skipped,
        usedLabel: LEVEL_LABEL[best] || '',
        levels: levels,
        error: urls.length ? null
             : (netFail && netFail === tracks.length
                ? '音源解析请求全部失败（网络或接口异常），请稍后重试'
                : (noLogin ? '这批曲目都没有可用音源（会员曲目请先在右上角「设置 Cookie」登录）'
                           : '这批曲目都没有可用音源'))
      };
    });
  }

  /* 单首解析（歌单导入 / 诊断用） */
  function resolveStream(id, quality) {
    return resolveChunk([id], quality).then(function (list) {
      var rv = (list || [])[0];
      if (!rv || !rv.url) throw new Error('拿不到直链（无版权 / 需要会员）');
      if (rv.trial) throw new Error('只有 ' + (rv.trialEnd || 45) + ' 秒试听片段（需要会员）');
      return rv;
    });
  }

  /* ------------------------------------------------------------
   * 歌词
   * ------------------------------------------------------------
   * 上游给原文 lrc + 译文 tlyric（同刻时间戳）。主题的「同刻归组」会把它们
   * 配成 主行/副行，所以直接「原文 + 空行 + 译文」交给主题即可。
   * ---------------------------------------------------------- */
  var NO_LYRIC_RE = /纯音乐[，,]\s*请欣赏|此歌曲为没有填词的纯音乐|暂无歌词/;

  function lyricById(id) {
    return getJson('/api/song/lyric?id=' + encodeURIComponent(id) + '&lv=1&kv=1&tv=-1',
                   { ms: 12000, tag: 'lyric' }).then(function (j) {
      if (!j || j.code !== 200) {
        throw new Error('歌词接口返回错误' + (j && j.code != null ? ' code=' + j.code : ''));
      }
      var text = (j.lrc && j.lrc.lyric) || '';
      var trans = (j.tlyric && j.tlyric.lyric) || '';
      if (!text || NO_LYRIC_RE.test(text)) return '';        // 上游明确回「没有歌词」
      return trans ? (text + '\n\n' + trans) : text;
    });
  }

  /* 繁→简：网易云曲库以简体为主，而本地文件名常是繁体。复用 QQ 桥接里那张
     对照表（同一个页面里已加载），取不到就退化成原样 —— 只是匹配略弱。 */
  function toSimplified(s) {
    if (window.QQBridge && typeof QQBridge.toSimplified === 'function') {
      return QQBridge.toSimplified(s);
    }
    return s;
  }

  function normKey(s) {
    s = toSimplified(String(s == null ? '' : s).toLowerCase());
    s = s.replace(/[\(\[（【{].*?[\)\]）】}]/g, '');
    s = s.replace(/[^0-9a-z\u3400-\u9fff\u3040-\u30ff]/g, '');
    return s;
  }

  /* 两个归一化名字的字符重合度（0~1），容忍「姚苏容/姚苏蓉」这类异写 */
  function shareRatio(a, b) {
    a = normKey(a); b = normKey(b);
    if (!a || !b) return 0;
    var ca = {}, cb = {}, common = 0, i;
    for (i = 0; i < a.length; i++) ca[a.charAt(i)] = (ca[a.charAt(i)] || 0) + 1;
    for (i = 0; i < b.length; i++) cb[b.charAt(i)] = (cb[b.charAt(i)] || 0) + 1;
    for (var k in cb) { if (ca[k]) common += Math.min(ca[k], cb[k]); }
    return common / Math.max(a.length, b.length);
  }

  /* 「01 - HOTEL CALIFORNIA」这类带轨号前缀的标题 */
  function cleanTitle(t) {
    return String(t || '').replace(/^\s*(?:\[\d+\]|\d{1,3})\s*[-._、)]\s*/, '');
  }

  /* 去掉 ()/[]/【】 及内容，并清掉结尾的 (1)(2) 计数 */
  function stripBrackets(t) {
    t = String(t || '').replace(/[\(\[（【{].*?[\)\]）】}]/g, ' ');
    t = t.replace(/\s*[\(\[（【]\d+[\)\]）】]\s*$/, '');
    return t.replace(/\s+/g, ' ').trim();
  }

  /* 优先「标题命中 + 歌手命中 + 时长吻合」，避免抓到翻唱 / 伴奏 */
  function scoreHit(h, title, artist, duration) {
    var s = 0;
    if (title) s += shareRatio(title, h.title) * 1.0;
    if (artist) s += shareRatio(artist, h.artist) * 0.6;
    if (duration > 0 && h.interval > 0) {
      var d = Math.abs(h.interval - duration);
      if (d <= 3) s += 1.2;
      else if (d <= 8) s += 0.4;
      else if (d <= 25) s += 0.1;
    }
    var low = (h.title + ' ' + h.artist).toLowerCase();
    if (/伴奏|remix|instrumental|纯音乐|off vocal/.test(low)) s -= 0.8;
    if (/伴奏|纯音乐|instrumental|off vocal/.test(String(h.title).toLowerCase())) s -= 99;
    return s;
  }

  function pickBest(hits, title, artist, duration) {
    var best = null, bestScore = -99;
    for (var i = 0; i < hits.length; i++) {
      if (!hits[i]) continue;
      var s = scoreHit(hits[i], title, artist, duration);
      if (s > bestScore) { bestScore = s; best = hits[i]; }
    }
    return best ? { hit: best, score: bestScore } : null;
  }

  var MIN_SCORE = 0.8;
  var LYRIC_TTL = 30 * 60 * 1000;
  var _lyricCache = {};

  function cacheTrim(obj, max) {
    var keys = Object.keys(obj);
    if (keys.length <= (max || 120)) return;
    keys.sort(function (a, b) { return ((obj[a] && obj[a].ts) || 0) - ((obj[b] && obj[b].ts) || 0); });
    for (var i = 0; i < (keys.length >> 1); i++) delete obj[keys[i]];
  }

  /* 多轮放宽：raw → 清轨号 → 去括号 → 只按标题 */
  function findLyric(title, artist, duration) {
    var rounds = [
      { tag: 'raw', t: title, a: artist },
      { tag: 'cleantitle', t: cleanTitle(title), a: artist },
      { tag: 'nobracket', t: stripBrackets(title), a: artist },
      { tag: 'titleonly', t: title, a: '' }
    ];
    var err0 = _netErr;
    function runRound(i) {
      if (i >= rounds.length) {
        return { ok: false, lrc: '', note: 'no-match', transient: _netErr > err0 };
      }
      var r = rounds[i];
      var kw = (r.t + (r.a ? ' ' + r.a : '')).trim();
      if (!kw) return runRound(i + 1);
      if (i > 0 && r.t && rounds[0].t && normKey(r.t) === normKey(rounds[0].t) &&
          normKey(r.a) === normKey(rounds[0].a)) {
        return runRound(i + 1);          // 与本轮之前完全相同的关键词不重复打接口
      }
      return search(kw, 1, 10).then(function (d) {
        // 被限流就别再往下试了：后面每一轮都要等冷却，白让用户等几十秒。
        // 标记 transient，避免把这次"没问成"缓存成"这首歌没歌词"
        if (d && d.limited) {
          return { ok: false, lrc: '', note: 'limited', transient: true };
        }
        if (!d || !d.ok) return runRound(i + 1);            // 这一轮打不通 → 下一轮
        var best = pickBest(d.songs || [], title, artist, duration);
        if (!best || best.score < MIN_SCORE) return runRound(i + 1);
        return lyricById(best.hit.id).then(function (lrc) {
          if (!lrc) return { ok: false, lrc: '', note: 'no-lyric', id: best.hit.id, transient: false };
          return { ok: true, lrc: lrc, id: best.hit.id, title: best.hit.title,
                   singer: best.hit.artist, score: best.score, note: r.tag, transient: false };
        });
      });
    }
    return runRound(0);
  }

  /* 按「标题 + 歌手 + 时长」匹配歌词（本地没有 .lrc 时的联网兜底）。
     命中与**权威的未命中**都进 30 分钟缓存；网络失败不进缓存，
     否则一次抖动会让这首歌半小时内一直显示「暂无歌词」。 */
  function lyric(title, artist, duration) {
    title = String(title || '').trim();
    artist = String(artist || '').trim();
    duration = duration | 0;
    if (!title) return Promise.resolve({ ok: false, lrc: '', note: 'no-title' });
    var key = normKey(title) + '|' + normKey(artist) + '|' + duration;
    var hit = _lyricCache[key];
    if (hit && (Date.now() - hit.ts) < LYRIC_TTL) {
      var r0 = hit.r;
      return Promise.resolve({ ok: r0.ok, lrc: r0.lrc, id: r0.id, title: r0.title,
                               singer: r0.singer, score: r0.score, note: r0.note, cached: true });
    }
    return findLyric(title, artist, duration).then(function (r) {
      if (!r.transient) {
        _lyricCache[key] = { ts: Date.now(), r: r };
        cacheTrim(_lyricCache, 200);
      }
      return r;
    });
  }

  /* 按 id 取词（带缓存）—— 已知歌曲 id 时优先走这条：比「标题 + 歌手」
     模糊匹配准，不会张冠李戴。上游回「没有歌词」时退回模糊匹配
     （有些歌只有别的版本才有词，模糊匹配可能捞到同曲的另一份）。 */
  function lyricForId(id, title, artist, duration) {
    if (!id) return lyric(title, artist, duration);
    var key = 'id:' + id;
    var hit = _lyricCache[key];
    if (hit && (Date.now() - hit.ts) < LYRIC_TTL) {
      return Promise.resolve({ ok: hit.r.ok, lrc: hit.r.lrc, id: id,
                               note: hit.r.note, cached: true });
    }
    return lyricById(id).then(function (lrc) {
      if (!lrc) return lyric(title, artist, duration);
      var r = { ok: true, lrc: lrc, id: id, note: 'byid', transient: false };
      _lyricCache[key] = { ts: Date.now(), r: r };
      cacheTrim(_lyricCache, 200);
      return r;
    }, function () {
      return lyric(title, artist, duration);
    });
  }

  /* 在线曲目专用：能从直链反查出 id 就按 id 精确取词，反查不到再退回模糊匹配 */
  function lyricForTrack(url, title, artist, duration) {
    var meta = metaFromUrl(url);
    if (!meta || !meta.id) return lyric(title, artist, duration);
    return lyricForId(meta.id, title, artist, duration);
  }

  function lyricCacheClear() { _lyricCache = {}; return true; }

  /* ------------------------------------------------------------
   * 歌单（公开歌单 / 榜单免 Cookie 直接读全曲目）
   * ---------------------------------------------------------- */
  function parsePlaylistId(s) {
    s = String(s || '').trim();
    if (!s) return 0;
    var m = /[?&#]id=(\d+)/.exec(s);
    if (m) return Number(m[1]);
    m = /playlist\/(\d+)/.exec(s);
    if (m) return Number(m[1]);
    return /^\d+$/.test(s) ? Number(s) : 0;
  }

  function playlist(idOrLink) {
    var id = parsePlaylistId(idOrLink);
    if (!id) return Promise.resolve({ ok: false, error: '看不是歌单 ID 或链接' });
    return getJson('/api/v6/playlist/detail?id=' + id + '&n=1000&s=8', { ms: 20000, tag: 'playlist' })
      .then(function (j) {
        if (j.code === 406) { _limitedUntil = Date.now() + LIMIT_COOLDOWN; return { ok: false, error: rateLimitErr().message }; }
        var pl = j && j.playlist;
        if (!pl) {
          return { ok: false, error: j && j.code === 404 ? '歌单不存在或已删除'
                   : ('读歌单失败（code=' + (j && j.code) + '）—— 私密/自建歌单需要先设置 Cookie 登录') };
        }
        var tracks = normalizeList(pl.tracks || []);
        return { ok: true, id: id, name: pl.name || '', cover: pl.coverImgUrl || '',
                 total: pl.trackCount || tracks.length, tracks: tracks };
      }, function (e) {
        return { ok: false, error: (e && e.message) || '读歌单失败' };
      });
  }

  /* 文本导入：按「歌名 - 歌手」逐条搜一个最佳命中（宁缺勿错） */
  function matchSong(title, artist) {
    var kw = (title + (artist ? ' ' + artist : '')).trim();
    if (!kw) return Promise.resolve(null);
    return search(kw, 1, 10).then(function (d) {
      if (!d || !d.ok) return null;
      var best = pickBest(d.songs || [], title, artist, 0);
      if (!best || best.score < MIN_SCORE) return null;
      return best.hit;
    });
  }

  /* ------------------------------------------------------------
   * 封面
   * ---------------------------------------------------------- */
  function coverUrl(picUrl, size) {
    picUrl = String(picUrl || '').trim();
    if (!picUrl) return '';
    var u = picUrl.replace(/^http:/i, 'https:');
    if (size === false) return u;
    var s = size || 500;
    return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'param=' + s + 'y' + s;
  }

  /* 封面下载（异步宿主 HTTP + 会话缓存）：artwork-resolver 的封面兜底从这里取图。
     必须异步（同步会把主线程冻住整个下载时长）、必须缓存（每次重绘都重下会冻）。
     失败降级返回 CDN 原始 URL，<img> 仍能显示，只是取色会因 CORS 失败。 */
  var coverCache = Object.create(null);            // picUrl -> dataURL | 原始 URL | ''
  var coverPending = Object.create(null);
  var COVER_CACHE_MAX = 30;

  function coverDataUrl(picUrl) {
    picUrl = String(picUrl || '').trim();
    if (!picUrl) return Promise.resolve('');
    var url = coverUrl(picUrl);
    if (coverCache[url] !== undefined) return Promise.resolve(coverCache[url]);
    if (coverPending[url]) return coverPending[url];

    var p = hostHttp({
      url: url, responseType: 'binary',
      headers: { 'User-Agent': UA, Referer: SITE + '/' },
      ms: 10000, tag: 'cover'
    }).then(function (r) {
      var ct = 'image/jpeg';
      var h = r.headers || {};
      var ctKey = h['content-type'] || h['Content-Type'];
      if (ctKey) ct = String(ctKey).split(';')[0];
      if (r.status >= 200 && r.status < 300 && r.body) return 'data:' + ct + ';base64,' + r.body;
      return url;
    }, function () {
      return url;
    }).then(function (v) {
      delete coverPending[url];
      coverCache[url] = v;
      var keys = Object.keys(coverCache);
      if (keys.length > COVER_CACHE_MAX) {
        for (var i = 0; i < (keys.length >> 1); i++) delete coverCache[keys[i]];
      }
      return v;
    }).catch(function () {
      delete coverPending[url];
      return url;
    });
    coverPending[url] = p;
    return p;
  }

  /* 播放路径 → 封面：先从直链反查曲目，再取图 */
  function coverDataUrlForTrack(trackPath) {
    var meta = metaFromUrl(trackPath);
    if (!meta || !meta.picUrl) return Promise.resolve('');
    return coverDataUrl(meta.picUrl);
  }

  function coverCacheClear() {
    coverCache = Object.create(null);
    coverPending = Object.create(null);
    return true;
  }

  /* ------------------------------------------------------------
   * 自检：桥接依赖第三方接口，先跑一遍把"哪个环节断了"说清楚
   * ------------------------------------------------------------
   * 随页面加载跑一次（一次搜索 + 一次解析 + 一次取词），结果进 console，
   * UI 首屏也会读它来显示状态。放进 sessionStorage：一次会话只跑一遍。
   * ---------------------------------------------------------- */
  var _selfcheck = { state: 'idle', at: 0, steps: {}, ms: 0 };
  var SELFTEST_KEY = 'cm.netease.selfcheck';

  function selfcheck(force) {
    if (_selfcheck.state === 'running') return Promise.resolve(_selfcheck);
    if (!force) {
      try {
        var cached = sessionStorage.getItem(SELFTEST_KEY);
        if (cached) { _selfcheck = JSON.parse(cached); return Promise.resolve(_selfcheck); }
      } catch (e) {}
    }
    _selfcheck = { state: 'running', at: Date.now(), steps: {}, ms: 0 };
    var t0 = Date.now();
    var probe = null;
    _selfcheck.steps.login = hasLogin() ? 'on' : 'off';
    return search('晴天', 1, 3).then(function (d) {
      _selfcheck.steps.search = d && d.ok ? ('ok(' + (d.songs || []).length + ')') : ('fail:' + ((d && d.error) || '?'));
      probe = d && d.songs && d.songs[0];
      if (!probe) return null;
      return resolveStream(probe.id, 'lossless').then(function (rv) {
        _selfcheck.steps.resolve = 'ok(' + (LEVEL_LABEL[rv.level] || rv.level || '?') + ')';
      }, function (e) {
        _selfcheck.steps.resolve = 'fail:' + ((e && e.message) || '?');
      });
    }).then(function () {
      if (!probe) return null;
      return lyricById(probe.id).then(function (lrc) {
        _selfcheck.steps.lyric = lrc ? 'ok' : 'none';
      }, function (e) {
        _selfcheck.steps.lyric = 'fail:' + ((e && e.message) || '?');
      });
    }).then(function () {
      _selfcheck.ms = Date.now() - t0;
      _selfcheck.state = (_selfcheck.steps.search || '').indexOf('ok') === 0 ? 'ok' : 'fail';
      try { sessionStorage.setItem(SELFTEST_KEY, JSON.stringify(_selfcheck)); } catch (e) {}
      if (typeof console !== 'undefined' && console.log) {
        console.log('[NeteaseBridge] 自检', _selfcheck.state, _selfcheck.ms + 'ms',
                    _selfcheck.steps, 'quality=' + getQuality(), 'cookie=' + (hasLogin() ? 'yes' : 'no'));
      }
      return _selfcheck;
    }, function (e) {
      _selfcheck.ms = Date.now() - t0;
      _selfcheck.state = 'fail';
      _selfcheck.steps.error = (e && e.message) || '?';
      try { sessionStorage.setItem(SELFTEST_KEY, JSON.stringify(_selfcheck)); } catch (e2) {}
      return _selfcheck;
    });
  }

  function selfcheckState() { return _selfcheck; }

  /* ------------------------------------------------------------
   * 配置 / 诊断 / 导出
   * ---------------------------------------------------------- */
  function config() {
    return {
      version: VERSION,
      hasCookie: hasLogin(),
      quality: getQuality(),
      selfcheck: _selfcheck.state
    };
  }

  function bridgeInfo() {
    return {
      version: VERSION,
      hasLogin: hasLogin(),
      cookieKeys: parseCookieInput(getCookie()).split(';').map(function (s) { return s.split('=')[0].trim(); }).filter(Boolean),
      quality: getQuality(),
      urlMeta: Object.keys(urlMetaMap()).length,
      lyricCache: Object.keys(_lyricCache).length,
      coverCache: Object.keys(coverCache).length,
      limitedFor: Math.max(0, Math.round((_limitedUntil - Date.now()) / 1000)) + 's',
      inflight: inflightCount(),
      netErrors: _netErr,
      selfcheck: _selfcheck
    };
  }

  window.NeteaseBridge = {
    version: VERSION,
    config: config,
    setQuality: setQuality, getQuality: getQuality,
    getCookie: getCookie, setCookie: setCookie, clearCookie: clearCookie,
    hasLogin: hasLogin,
    account: account, vipInfo: vipInfo,
    search: search,
    resolveStream: resolveStream,
    resolveMany: resolveMany,
    lyric: lyric, lyricForTrack: lyricForTrack, lyricForId: lyricForId, lyricById: lyricById,
    lyricCacheClear: lyricCacheClear,
    matchSong: matchSong,
    playlist: playlist, parsePlaylistId: parsePlaylistId,
    coverUrl: coverUrl,
    coverDataUrl: coverDataUrl, coverDataUrlForTrack: coverDataUrlForTrack,
    coverCacheClear: coverCacheClear,
    metaFromUrl: metaFromUrl, isNeteaseUrl: isNeteaseUrl,
    selfcheck: selfcheck, selfcheckState: selfcheckState,
    netErrors: netErrs,
    bridgeInfo: bridgeInfo
  };

  /* 页面加载后跑一次自检（会话内只跑一次）：第三方接口哪天变了，
     状态栏与 console 能立刻指出是哪一段断了，而不是"搜不到东西"。 */
  if (typeof setTimeout === 'function') setTimeout(function () { selfcheck(false); }, 1800);
})();
