/* ============================================
 * CloudMusic playback-model.js — 双轨制播放模型
 * ------------------------------------------------------------
 * 中间列表 = 播放上下文 Context（活动播放列表）：决定默认播放顺序（顺序/随机/
 *   列表循环/单曲循环都由宿主 order 决定），双击才切换。
 * 右侧列表 = 插队队列 UpNext（foobar 原生播放队列）：全局、优先级最高、播完一首
 *   移除一首、播完回到 Context 当前游标继续。队列的"优先"与"播完自动移除"由宿主
 *   原生保证；本模块只把两条必须显式的地方做出来 ——「手动下一首」走队首、
 *   「切换上下文」清空插队队列。
 * 播放历史 = 事件栈 + cursor（localStorage，上限 20）：支撑「上一首」回溯，
 *   而不是"把过去推入顶部"。
 * ============================================ */
(function() {
  'use strict';
  var CM = window.CloudMusic;
  var state = CM.state;

  /* ============================================
   * 播放上下文 Context
   * ------------------------------------------------------------
   * 媒体库 / 发现页 / 搜索结果是「视图」，不是 foobar 歌单 —— 要让它们能当作
   * Context（这一首播完顺着列表继续），必须把当前视图映射进一个专用歌单。
   * 旧实现是"替换当前活动歌单"（replaceAllAndPlay）：活动歌单如果是用户自己的
   * 歌单，内容就被顶掉了。现在统一写进这个专用歌单，用户歌单绝不参与替换。
   * 命名沿用重构规范：_MediaLibraryContext_（侧栏不显示，见 ui-playlist.js）。
   * ============================================ */
  CM.CONTEXT_PLAYLIST = '_MediaLibraryContext_';
  CM.isContextPlaylist = function(row) {
    return !!(row && row.name === CM.CONTEXT_PLAYLIST);
  };
  // 不该出现在用户界面上的歌单（侧栏 / 「添加到歌单」菜单）：
  //   · `_MediaLibraryContext_` —— 本模块自己的"当前视图"容器；
  //   · `[WebView Queue]`       —— 宿主自己的影子歌单：queue.addPaths 默认把路径
  //     写进它（官方文档：追加到专用的 [WebView Queue] 播放列表，不存在则创建），
  //     它跟用户歌单一样可见可编辑，但内容只是"曾经按路径插过队的曲目"，交给用户管理没有意义。
  CM.INTERNAL_PLAYLISTS = { '_MediaLibraryContext_': 1, '[WebView Queue]': 1 };
  CM.isInternalPlaylist = function(row) {
    return !!(row && row.name && CM.INTERNAL_PLAYLISTS[row.name]);
  };
  CM._ctxPlaylistIndex = -1;  // 最近一次解析到的上下文歌单索引
  CM._ctxSynced = null;       // { sig } 最近一次同步的内容签名（同一视图重复播放时跳过重建）

  // 找/建上下文歌单：guid 优先（改名/挪位后仍认得），其次同名，都没有则新建。
  CM.ensureContextPlaylist = function() {
    var lists = CM.playlists || [];
    var row = null;
    if (CM.settings.contextGuid) {
      var gi = CM.playlistIndexByGuid(CM.settings.contextGuid);
      if (gi >= 0) row = CM.playlistRow(gi);
    }
    if (!row) {
      for (var i = 0; i < lists.length; i++) {
        if (CM.isContextPlaylist(lists[i]) && lists[i].index != null) { row = lists[i]; break; }
      }
    }
    if (row && row.index != null) {
      CM._ctxPlaylistIndex = row.index;
      if (row.guid && CM.settings.contextGuid !== row.guid) {
        CM.settings.contextGuid = row.guid;
        CM.saveSettings();
      }
      return Promise.resolve(row.index);
    }
    return CM.api('playlist.create', { name: CM.CONTEXT_PLAYLIST }).then(function(r) {
      if (!r || r.success === false) return -1;
      var idx = r.index != null ? r.index : r.playlist;
      if (idx == null || idx < 0) return -1;
      CM._ctxPlaylistIndex = idx;
      if (r.guid) { CM.settings.contextGuid = r.guid; CM.saveSettings(); }
      CM.loadPlaylists();   // 侧栏缓存要含它（隐藏只发生在渲染层，索引/guid 查找仍需要）
      return idx;
    });
  };

  // 视图签名：标题 + 长度 + 首尾路径（内容变了签名就变）
  function ctxSig(title, paths) {
    return (title || '') + '|' + paths.length + '|' + (paths[0] || '') + '|' + (paths[paths.length - 1] || '');
  }

  /* 播放一个「视图列表」（列表行双击 / 播放全部共用）：
     视图 → 上下文歌单（整体重建）→ 定位播放 → 清空插队队列。
     opts.queueClear === false 时不动插队队列；opts.onDone(ok) 回结果。 */
  CM.playContextList = function(tracks, startIndex, title, opts) {
    opts = opts || {};
    var paths = CM.trackPaths(tracks || []);
    if (!paths.length) {
      CM.showToast('无法播放', '未找到有效文件路径', 'error');
      if (opts.onDone) opts.onDone(false);
      return;
    }
    if (startIndex == null || startIndex < 0 || startIndex >= paths.length) startIndex = 0;
    var sig = ctxSig(title, paths);
    // 歌单被锁定 / 参数被拒等：按错误码给一句能照着做的话，不静默
    function finish(ok, resp) {
      if (!ok) {
        var code = resp && resp.code;
        var sub = (resp && resp.error) || CM.errText(code) || '宿主拒绝了这次播放请求';
        if (code === 'LOCKED') sub = '「' + CM.CONTEXT_PLAYLIST + '」被锁定，请在 foobar2000 中解锁后再试';
        CM.showToast('播放失败', sub, 'error');
        if (opts.onDone) opts.onDone(false);
        return;
      }
      CM._ctxSynced = { sig: sig, title: title || '' };
      if (opts.queueClear !== false) CM.clearUpNext();
      if (opts.onDone) opts.onDone(true);
    }
    CM.ensureContextPlaylist().then(function(idx) {
      if (idx == null || idx < 0) { finish(false, null); return; }
      function replaceAll() {
        CM.api('playlist.replaceAllAndPlay', {
          playlist: idx, paths: paths, playIndex: startIndex, autoPlay: true, stopFirst: true
        }).then(function(r) { finish(!(r && r.success === false), r); });
      }
      // 同一份视图、且上下文歌单已在活动位：只定位播放 ——
      // 避免"在同一列表里连点几首"每次都把歌单清空重填（播放列表会被反复重建）
      if (CM._ctxSynced && CM._ctxSynced.sig === sig) {
        CM.api('playlist.getActive').then(function(a) {
          var act = a && (a.index != null ? a.index : a.playlist);
          if (act === idx) {
            CM.api('playlist.playTrack', { playlist: idx, index: startIndex }).then(function(r) {
              finish(!(r && r.success === false), r);
            });
          } else {
            replaceAll();
          }
        }, replaceAll);
        return;
      }
      replaceAll();
    });
  };

  // 清空插队队列（切换上下文时调用；宿主清空只影响"待播"项，不会打断当前曲目）
  CM.clearUpNext = function() {
    return CM.api('queue.clear').then(function(r) {
      if (CM.refreshQueueBadge) CM.refreshQueueBadge();
      if (state.queueOpen && CM.renderQueue) CM.renderQueue();
      return !(r && r.success === false);
    });
  };

  /* 统一「播放这一行」入口（列表双击 / 右键「播放」）：
     · 歌单行（playlist + index）→ 该歌单就是 Context：切活动歌单 + 定位播放 + 清空插队队列
     · 视图行（tracks + index）  → 视图同步进上下文歌单 + 定位播放 + 清空插队队列
     · 裸路径（path）            → 游离曲：立即播放，不动任何歌单与队列 */
  CM.playRow = function(o) {
    o = o || {};
    if (o.playlist != null && o.index != null) {
      playPlaylistRow(o.playlist, o.index);
      return;
    }
    if (o.tracks && o.tracks.length) { CM.playContextList(o.tracks, o.index || 0, o.title); return; }
    CM.playNowPath(o.path);
  };

  // 歌单行播放：只在活动歌单不是它时才 setActive ——
  // setActive 会触发 playlist:activated → 整表重载，重载期间行级操作被守卫挡住
  // （表现为"点完一首马上双击/右键另一首没反应"），而且 playTrack 本身就会让该歌单成为活动歌单
  function playPlaylistRow(plIndex, rowIndex) {
    CM.api('playlist.getActive').then(function (a) {
      var act = a && (a.index != null ? a.index : a.playlist);
      if (act === plIndex) return null;
      return CM.apiOr('playlist.setActive', { playlist: plIndex });
    }).then(function () {
      return CM.apiOr('playlist.playTrack', { playlist: plIndex, index: rowIndex });
    }).then(function () {
      CM.clearUpNext();
    }, function (e) { CM.failToast(e, '播放失败'); });
  }

  /* 立即播放一个路径（游离曲）：把它作为**不带歌单坐标**的队列项插到队首，再让宿主立刻播它 ——
     队列里已有的插队项原样保留。用 `insertNext({paths})` 而不是 `addPaths`：后者的路径会先写进
     宿主的 `[WebView Queue]` 影子歌单、成为一个**带坐标**的队列项 —— 带坐标的队列项被播放时
     宿主会把播放上下文带到那张歌单（详见 ui-playlist.js 的 enqueueTrack 注释），播完就不会
     回到原来的清单了；裸路径项则只是"插播这一项"。
     不写任何用户歌单。 */
  CM.playNowPath = function(path) {
    if (!path) return Promise.resolve(false);
    return CM.api('queue.insertNext', { paths: [path], position: 0 }).then(function(ar) {
      // 入队失败、或被宿主静默跳过（超 2048 字符的 URL 只计入 invalidCount）：队列里没有这一条，
      // 后面的播放调用会播到别的曲目上去 —— 直接走 playPath
      if (!ar || ar.success === false || ar.invalidCount) {
        CM.api('playback.playPath', { path: path });
        return true;
      }
      // queue.playNow 是宿主内置的"立刻播这一条队列项"（播完照常出队）
      return CM.api('queue.playNow', { index: 0 }).then(function(p) {
        // 老宿主没有 queue.playNow：退回宿主 next —— 我们刚把这条插在队首，
        // 而 next() 会先消费队列（旧版 playNow 一直靠这个约定）
        if (!p || p.success === false) CM.api('playback.next');
        return true;
      });
    });
  };

  /* ============================================
   * 手动 上一首 / 下一首
   * ============================================ */

  /* 下一首：插队队列非空 → 显式播队首（不依赖"宿主 next() 是否先消费队列"的隐含约定）；
     队列空 → 交回宿主的 Context 下一首。 */
  CM.nextTrack = function() {
    CM.api('queue.getCount').then(function(r) {
      if (CM.respCount(r) <= 0) { CM.api('playback.next'); return; }
      CM.api('queue.playNow', { index: 0 }).then(function(p) {
        // 老宿主没有 queue.playNow：退回宿主 next（宿主同样会先消费队列）
        if (!p || p.success === false) CM.api('playback.next');
      });
    }, function() { CM.api('playback.next'); });
  };

  /* 上一首：优先回溯播放历史；历史里没有更早的不同曲目才交回 Context 上一首。 */
  CM.prevTrack = function() {
    if (CM.history && CM.history.prev()) return;
    CM.api('playback.previous');
  };

  /* ============================================
   * 播放历史（事件栈 + cursor）
   * ------------------------------------------------------------
   * 只记录"播放事件"：连续相同曲目去重（单曲循环不刷屏）；新的播放事件截断
   * cursor 之后的未来再追加（与浏览器后退/前进同构）。「上一首」= cursor 往前
   * 找第一首不同曲目并把它设为当前（不截断，未来保留）；从历史行点播 = 同样
   * 把 cursor 移过去。上限 20 条，localStorage 持久化（只有主窗口写）。
   * ============================================ */
  var HIST_KEY = 'cloudmusic-history-v1';
  CM.history = {
    DEFAULT_MAX: 20,
    MAX_LIMITS: [5, 200],
    items: [],
    cursor: -1,
    // 历史回溯/点播的目标路径集合：这些路径的 trackChanged 不写新事件。
    // 用集合而不是单个槽位：连点两次「上一首」时两条跳转链会在途重叠，
    // 后到的 trackChanged 不该被当成新的播放事件（否则历史被截断写乱）。
    // 值 = 登记时间，超过 _navTtl 未兑现就丢弃 —— 否则"跳转的曲目根本没能播起来"
    // （直链失效 / 宿主拒绝）会把该路径永久留在集合里，之后用户手动播同一首时
    // 那次播放就不会进历史。
    _navPaths: Object.create(null),
    _navTtl: 30000,
    _purgeNav: function(now) {
      var t = (now || Date.now()) - this._navTtl;
      var map = this._navPaths;
      for (var p in map) if (map[p] < t) delete map[p];
    },
    // 上限可配（设置页「播放历史条数」）；被改坏时回默认值
    max: function() {
      var n = parseInt(CM.settings.historyMax, 10);
      if (!n || isNaN(n)) n = this.DEFAULT_MAX;
      return Math.max(this.MAX_LIMITS[0], Math.min(this.MAX_LIMITS[1], n));
    },
    load: function() {
      var MAX = this.max();
      try {
        var raw = localStorage.getItem(HIST_KEY);
        if (!raw) return;
        var d = JSON.parse(raw);
        if (!d || Object.prototype.toString.call(d.items) !== '[object Array]') return;
        this.items = d.items.filter(function(it) { return it && it.path; }).slice(-MAX);
        var c = parseInt(d.cursor, 10);
        this.cursor = (c >= 0 && c < this.items.length) ? c : this.items.length - 1;
      } catch (e) { this.items = []; this.cursor = -1; }
    },
    save: function() {
      var MAX = this.max();
      if (this.items.length > MAX) {
        this.items = this.items.slice(this.items.length - MAX);
        this.cursor = this.items.length - 1;
      }
      try { localStorage.setItem(HIST_KEY, JSON.stringify({ items: this.items, cursor: this.cursor })); } catch (e) {}
      if (state.queueOpen && CM.renderHistory) CM.renderHistory();
    },
    clear: function() { this.items = []; this.cursor = -1; this._navPaths = Object.create(null); this.save(); },
    // 记录一次播放事件（app.js 的 playback:trackChanged 调用）
    note: function(track) {
      var path = CM.trackPath(track);
      if (!path) return;
      this._purgeNav();
      if (this._navPaths[path]) {
        // 本次换曲来自历史回溯/点播：cursor 已就位，不再写入也不截断（未来保留）
        delete this._navPaths[path];
        this.save();
        return;
      }
      if (this.cursor < this.items.length - 1) this.items = this.items.slice(0, this.cursor + 1);
      var last = this.items[this.items.length - 1];
      if (last && last.path === path) { this.cursor = this.items.length - 1; this.save(); return; }
      this.items.push({ path: path, title: CM.trackName(track), artist: CM.trackArtist(track), at: Date.now() });
      this.cursor = this.items.length - 1;
      this.save();
    },
    // 回溯：cursor 往前找第一首不同曲目并播放（找不到返回 false → 交回 Context 上一首）
    prev: function() {
      var curPath = CM.trackPath(CM.currentTrack);
      for (var i = this.cursor - 1; i >= 0; i--) {
        if (this.items[i].path !== curPath) return this.jump(i);
      }
      return false;
    },
    // 定位到历史第 i 条并播放（上一首回溯 / 历史行双击共用）
    jump: function(i) {
      var it = this.items[i];
      if (!it) return false;
      this._purgeNav();
      this._navPaths[it.path] = Date.now();
      this.cursor = i;
      this.save();
      CM.playNowPath(it.path);
      return true;
    }
  };

  /* 历史列表渲染（插队队列上方的可展开面板）
     ------------------------------------------------------------
     默认收起（`settings.historyOpen`），点标题行展开。展开后的列表**由旧到新向下排**：
     最下面一条紧贴"正在播放"卡片，整条抽屉自上而下就是「过去 → 现在 → 接下来」的时间线。
     行内双击 = 回到那一条（`jump`）。 */
  function fmtClock(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  CM.history.setOpen = function(open, persist) {
    var on = !!open;
    state.historyOpen = on;
    var toggle = CM.els.historyToggle;
    var region = CM.els.historyRegion;
    if (toggle) toggle.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (region) region.classList.toggle('open', on);
    if (persist !== false) { CM.settings.historyOpen = on; CM.saveSettings(); }
    if (on) CM.renderHistory();
  };
  CM.history.toggle = function() { CM.history.setOpen(!state.historyOpen); };
  CM.renderHistory = function() {
    var list = CM.els.historyList;
    if (!list) return;
    var h = CM.history;
    var esc = CM.escHtml;
    var n = h.items.length;
    var countEl = CM.els.historyCount;
    if (countEl) countEl.textContent = n ? n : '';
    var hint = CM.els.historyHint;
    var clearBtn = CM.els.historyClear;
    if (!n) {
      if (hint) hint.textContent = '暂无播放记录';
      if (clearBtn) clearBtn.hidden = true;
      list.innerHTML = '<div class="queue-hist-empty">播放过的曲目会按时间记在这里（连续同一首只记一条）</div>';
      return;
    }
    if (hint) hint.textContent = '共 ' + n + ' 条 · 上限 ' + h.max() + ' 条（由旧到新）';
    if (clearBtn) clearBtn.hidden = false;
    var parts = [];
    for (var i = 0; i < n; i++) {
      var it = h.items[i];
      parts.push(
        '<div class="queue-item queue-hist-item' + (i === h.cursor ? ' hist-cur' : '') + '" data-h="' + i + '" title="双击回到这一条">' +
        '<span class="queue-hist-num">' + (i + 1) + '</span>' +
        '<div class="queue-item-info">' +
        '<div class="queue-item-title">' + esc(it.title || it.path) + '</div>' +
        '<div class="queue-item-artist">' + esc(it.artist || '') + '</div>' +
        '</div>' +
        '<span class="queue-hist-time">' + fmtClock(it.at) + '</span>' +
        '</div>'
      );
    }
    list.innerHTML = parts.join('');
    // 展开状态下贴住底部：最新一条紧邻"正在播放"，往回滚才看到更早的
    if (state.historyOpen) list.scrollTop = list.scrollHeight;
    CM.runOnce('historyDelegation', function() {
      list.addEventListener('dblclick', function(e) {
        var row = e.target.closest('.queue-hist-item');
        if (!row) return;
        var i = parseInt(row.dataset.h, 10);
        if (!isNaN(i)) CM.history.jump(i);
      });
    });
  };

  // 启动挂 UI：读持久化状态、绑定展开按钮 / 清空按钮（只绑一次）
  CM.history.init = function() {
    CM.history.load();
    state.historyOpen = !!CM.settings.historyOpen;
    CM.runOnce('historyChrome', function() {
      var toggle = CM.els.historyToggle;
      if (toggle) toggle.addEventListener('click', function() { CM.history.toggle(); });
      var clearBtn = CM.els.historyClear;
      if (clearBtn) clearBtn.addEventListener('click', function() {
        CM.history.clear();
        CM.showToast('已清空播放历史');
      });
    });
    CM.history.setOpen(state.historyOpen, false);
  };
})();
