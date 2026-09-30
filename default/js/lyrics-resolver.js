/* ============================================
 * CloudMusic lyrics-resolver.js v2 — 歌词「实时匹配」
 *
 * 为什么改版（2026-09-15）：
 *   1) 要的是播放时【实时匹配】，不是预先下载 .lrc 再读文件；
 *   2) 整轨 FLAC + CUE 的专辑不要被"展开成分轨"来处理。
 *   这两点其实是一体的：整轨 + cue 里每首歌的标题/歌手，只有播放时才由宿主解析出来
 *   （播放项是 xxx.cue|subsong:N）。预先展开成文件既笨重又会留下一堆假分轨，
 *   把匹配挪到播放时，就没有这个矛盾了。
 *
 * 2026-09-29：联网匹配改为调用**页内桥接** QQBridge.lyric()（js/qqmusic-core.js），
 *   QQ 音乐的搜索 + 取词全部走宿主原生 HTTP 客户端（无 CORS），随主题页加载，
 *   无本地进程 —— 随 foobar 启动而在、关闭而消。
 *
 * 数据流（本地优先）：
 *   CM.loadLyrics()
 *     -> 本地「音频同名 .lrc」/「%profile%\lyrics 歌词库」命中？直接渲染
 *        （用户自己的歌词 —— 多半用 tools/lrc-normalizer.html 精修过双语配对与
 *          时间轴，优先级最高；读文件也更快、离线可用）
 *     -> 本地没有 -> 内存缓存 -> QQBridge.lyric(title, artist, duration)
 *          （多轮放宽搜索 + 打分 + 取词，见 qqmusic-core.js）
 *     -> 匹配失败 / 模块未加载 -> 「暂无歌词」
 *
 * 本地只认「音频同名 .lrc」与「%profile%\lyrics\」歌词库，**不再**按
 * 「专辑目录\艺术家 - 标题.lrc」去找 —— 那正是"整轨被判成多首分轨"留下的痕迹。
 * （整轨 CUE 的分轨本来就没有同名文件，这类会自然落到联网匹配。）
 *
 * 加载位置：index.html 里紧接 ui-lyrics.js（本模块接管 CM.loadLyrics）。
 *          依赖 js/qqmusic-core.js（须先于本文件加载）。
 * ============================================ */

(function () {
  'use strict';

  var CM = window.CloudMusic;
  if (!CM || typeof CM.api !== 'function' || !CM.els) return;

  var BS = String.fromCharCode(92);          // 反斜杠，避免踩转义
  var PLACEHOLDER_ARTIST = '未知艺术家';
  var PLACEHOLDER_TITLE = '未知曲目';

  /* ============================================
   * 小工具
   * ============================================ */
  function dirOf(p) {
    var i = String(p).lastIndexOf(BS);
    return i > 0 ? String(p).slice(0, i) : '';
  }
  function baseOf(p) {
    var i = String(p).lastIndexOf(BS);
    return i >= 0 ? String(p).slice(i + 1) : String(p);
  }
  function stripExt(s) { return String(s).replace(/\.\w+$/, ''); }
  function safe(s) {
    return String(s == null ? '' : s).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  }
  function uniq(arr) {
    var seen = {}, out = [];
    for (var i = 0; i < arr.length; i++) {
      if (!arr[i] || seen[arr[i]]) continue;
      seen[arr[i]] = 1;
      out.push(arr[i]);
    }
    return out;
  }

  /* ============================================
   * 本会话内存缓存：同一首歌来回切不重复联网
   * （服务端也有 30 分钟缓存，这里省掉的是一次网络往返）
   * ============================================ */
  var memo = {}, memoN = 0, MEMO_MAX = 200;
  function memoKey(title, artist, dur) {
    return (title + '\u0001' + artist + '\u0001' + (dur | 0));
  }
  function memoPut(k, v) {
    if (!k) return;
    if (!(k in memo) && memoN >= MEMO_MAX) {
      // 淘汰一半：条数直接由 Object.keys 现算，不再单独维护计数
      // （计数与实际条目一旦不同步，上限就形同虚设）
      var keys = Object.keys(memo);
      for (var i = 0; i < (keys.length >> 1); i++) delete memo[keys[i]];
      memoN = Object.keys(memo).length;
    }
    if (!(k in memo)) memoN++;
    memo[k] = v;
  }
  function memoDel(k) {
    if (k && (k in memo)) { delete memo[k]; memoN = Math.max(0, memoN - 1); }
  }

  /* ============================================
   * profile 路径（core.js 里共享，取一次就缓存）
   * _prof 是本模块的同步镜像：localCandidates 是同步的，等不起 promise
   * ============================================ */
  var _prof = '';
  function profilePath() {
    if (_prof) return Promise.resolve(_prof);
    return CM.profilePath().then(function (p) { _prof = p || ''; return _prof; });
  }

  /* ============================================
   * 本地兜底候选（只认同名 / 歌词库，不认"分轨式"命名）
   * ============================================ */
  function localCandidates(path, artist, title) {
    var list = [];
    if (path && !CM.isUrlPath(path)) {
      var dir = dirOf(path), stem = stripExt(baseOf(path));
      if (dir && stem) list.push(dir + BS + stem + '.lrc');   // 音频同名，宿主原生规则
    }
    var prof = _prof || '';
    if (prof) {
      var dirs = [prof + BS + 'lyrics', prof + BS + 'eslyric-data' + BS + 'lyrics'];
      for (var d = 0; d < dirs.length; d++) {
        if (artist && title) list.push(dirs[d] + BS + safe(artist) + ' - ' + safe(title) + '.lrc');
        if (title) list.push(dirs[d] + BS + safe(title) + '.lrc');
      }
    }
    return uniq(list);
  }

  function readFirst(cands, loadId, onHit, onMiss) {
    var i = 0;
    function step() {
      if (loadId !== CM._lyricLoadId) return;
      if (i >= cands.length) { onMiss(); return; }
      var p = cands[i++];
      CM.api('file.read', { path: p, encoding: 'binary' }).then(function (fr) {
        if (loadId !== CM._lyricLoadId) return;
        if (fr && fr.success !== false && fr.content &&
            String(fr.content).replace(/\s/g, '').length > 0) {
          var text = CM.decodeTextBytes(fr.content);
          if (text && text.trim()) { onHit(p, text); return; }
        }
        step();
      }).catch(function () { step(); });
    }
    step();
  }

  /* ============================================
   * 实时匹配（页内调用 QQBridge，无网络 fetch；模块缺失时安静降级）
   * ============================================ */
  function fetchOnline(title, artist, duration) {
    if (!window.QQBridge) {
      return Promise.reject(new Error('qqmusic-core.js 未加载'));
    }
    return QQBridge.lyric(title, artist, duration);
  }

  /* ============================================
   * 诊断信息（DevTools 里 CM.lyricStatus() 看最近一次匹配）
   * ============================================ */
  var lastStatus = { title: '', artist: '', state: 'idle', from: '', note: '' };

  /* ============================================
   * 接管 CM.loadLyrics
   * ============================================ */
  CM.loadLyrics = function () {
    CM.currentLyrics = [];
    CM.activeLyricIndex = -1;
    if (!CM.currentTrack) { CM.renderLyricsEmpty('暂无播放曲目'); return; }

    var track = CM.currentTrack;
    var path = CM.trackPath ? CM.trackPath(track) : (track.path || '');
    var title = CM.trackName ? CM.trackName(track) : (track.title || '');
    var artist = CM.trackArtist ? CM.trackArtist(track) : (track.artist || '');
    // ui.updateTrackInfo 已把 duration 写进 state，这里 track 字段优先
    var duration = track.duration || track.length || CM.state.duration || 0;
    var loadId = ++CM._lyricLoadId;

    var titleOk = !!title && title !== PLACEHOLDER_TITLE;
    var artistOk = !!artist && artist !== PLACEHOLDER_ARTIST;
    var mKey = titleOk ? memoKey(title, artistOk ? artist : '', duration) : '';

    function render(srcTag, text, from) {
      if (loadId !== CM._lyricLoadId) return;
      lastStatus = { title: title, artist: artist, state: 'hit', from: from, note: '' };
      // srcTag 传 ''：让 _renderLyrics 回落到「音频路径」做配对模式的记忆键。
      // 不能用 'memo://'/'online://' 这类虚拟路径 —— 同一份歌词经网络命中和内存缓存
      // 命中会拿到不同的键，用户手动指定的对齐方式会在缓存命中时悄悄失效；
      // 且右键「打开所在文件夹」会拿着假路径去 showInExplorer，静默无操作。
      CM._renderLyrics({ available: true, source: from, sourcePath: srcTag }, text);
    }

    function empty(msg) {
      if (loadId !== CM._lyricLoadId) return;
      CM.renderLyricsEmpty(msg);
    }

    /* 联网匹配：内存缓存 → QQBridge.lyric()。
       缓存只服务这条路 —— 本地文件每次现读，改了立刻生效。 */
    function tryOnline() {
      if (!titleOk) { empty('无法识别曲目信息'); return; }
      if (mKey && memo[mKey]) { render('', memo[mKey], 'memo'); return; }
      fetchOnline(title, artistOk ? artist : '', duration).then(function (r) {
        if (loadId !== CM._lyricLoadId) return;
        if (r && r.ok && r.lrc) {
          memoPut(mKey, r.lrc);
          render('', r.lrc, 'online');
          return;
        }
        lastStatus = { title: title, artist: artist, state: 'miss',
                       from: '', note: (r && r.note) || 'no-match' };
        empty('暂无歌词');
      }).catch(function (e) {
        if (loadId !== CM._lyricLoadId) return;
        // 匹配失败要说清楚 —— 否则用户只看到「暂无歌词」，不知道是哪里出了问题
        lastStatus = { title: title, artist: artist, state: 'match-error', from: '',
                       note: (e && e.message) || 'unreachable' };
        empty('暂无歌词（在线匹配失败）');
      });
    }

    CM.els.lyricsScroll.innerHTML = CM.loadingHTML('歌词匹配中...');

    /* 本地优先：
       同名 .lrc / 歌词库是「用户自己的」歌词 —— 多半用 tools/lrc-normalizer.html
       精修过双语配对与时间轴，也可能整轨 CUE 就是照它对齐的；联网结果再"全"也不该
       把它盖掉（旧版是联网优先，本地只在离线时兜底，等于让精修白做）。
       本地的读文件也更快、不依赖桥接服务；本地确实没有时再联网匹配。 */
    profilePath().then(function () {
      if (loadId !== CM._lyricLoadId) return;
      var cands = localCandidates(path, artistOk ? artist : '', titleOk ? title : '');
      readFirst(cands, loadId, function (p, text) {
        render(p, text, 'file');
      }, function () {
        if (loadId !== CM._lyricLoadId) return;
        lastStatus = { title: title, artist: artist, state: 'local-miss', from: '', note: '' };
        tryOnline();
      });
    });
  };

  /* ============================================
   * 调试 / 手动刷新
   * ============================================ */
  CM.lyricCandidates = function () {
    return localCandidates(
      CM.trackPath ? CM.trackPath(CM.currentTrack) : '',
      CM.trackArtist ? CM.trackArtist(CM.currentTrack) : '',
      CM.trackName ? CM.trackName(CM.currentTrack) : '');
  };

  CM.lyricStatus = function () { return lastStatus; };

  // 强制重新匹配当前曲目（跳过内存缓存与在线匹配缓存）
  CM.lyricReload = function () {
    var t = CM.currentTrack;
    if (!t) return;
    memoDel(memoKey(CM.trackName(t), CM.trackArtist(t), t.duration || t.length || 0));
    // 在线匹配的命中/未命中同样要作废：只清本模块的 memo，
    // 上一次的「暂无歌词」会被 QQBridge 自己的 30 分钟缓存又送回同一个结果
    if (window.QQBridge && QQBridge.lyricCacheClear) QQBridge.lyricCacheClear();
    CM.loadLyrics();
  };
})();
