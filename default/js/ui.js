/* ============================================
 * CloudMusic ui.js — 渲染层
 * Toast / 标题栏 / Tab / 歌词 / 播放列表 / 发现页
 * 媒体库 / 搜索 / 队列抽屉 / 右键菜单 / 模态框
 * ============================================ */
(function() {
  'use strict';
  var CM = window.CloudMusic;
  var els = CM.els, state = CM.state, esc = CM.escHtml;

  /* ============================================
   * Toast
   * ============================================ */
  CM.showToast = function(title, sub, type) {
    var toast = document.createElement('div');
    toast.className = 'toast';
    var icon = type === 'success' ? CM.icons.check : type === 'error' ? CM.icons.error : CM.icons.note;
    toast.innerHTML =
      '<div class="toast-icon ' + (type || '') + '">' + icon + '</div>' +
      '<div class="toast-info"><div class="toast-title">' + esc(title) + '</div>' +
      (sub ? '<div class="toast-sub">' + esc(sub) + '</div>' : '') + '</div>';
    els.toastContainer.appendChild(toast);
    setTimeout(function() {
      toast.classList.add('removing');
      setTimeout(function() { toast.remove(); }, 320);
    }, 2600);
  };

  /* ============================================
   * 通用 HTML 片段
   * ============================================ */
  CM.loadingHTML = function(text, extraStyle) {
    return '<div class="loading-spinner"' + (extraStyle ? ' style="' + extraStyle + '"' : '') +
      '><div class="spinner"></div><span>' + (text || '加载中...') + '</span></div>';
  };
  CM.emptyHTML = function(text, icon, extraStyle) {
    return '<div class="empty-illustration"' + (extraStyle ? ' style="' + extraStyle + '"' : '') + '>' +
      (icon || CM.icons.note) + '<span>' + esc(text || '暂无内容') + '</span></div>';
  };
  CM.trackPaths = function(tracks) {
    return tracks.map(function(t) { return CM.trackPath(t); }).filter(Boolean);
  };
  // 从 API 响应中提取曲目数组（兼容 tracks/items 两种字段名）
  CM.respTracks = function(r) {
    return (r && (r.tracks || r.items)) || [];
  };
  // 从 API 响应中提取计数值（兼容 count/total 两种字段名）
  CM.respCount = function(r) {
    return (r && (r.count != null ? r.count : r.total)) || 0;
  };

  // 通用：替换播放列表并原子播放（多处复用：playAlbum / renderLibraryDrill / renderLibraryTracks）
  CM.playAllTracks = function(tracks, title, onDone) {
    var paths = CM.trackPaths(tracks);
    if (!paths.length) { CM.showToast('无法播放', '未找到有效文件路径', 'error'); if (onDone) onDone(false); return; }
    // 先停掉 JIT 无痕试听，避免与正常播放同时输出（两首一起播）
    CM.stopPreviewIfActive().then(function() {
      // 若当前活动歌单是锁定/自动歌单，replace 会被宿主拒绝（"playlist is lock"），先切到可写歌单
      CM.ensureWritableActivePlaylist().then(function(idx) {
        if (idx < 0) { CM.showToast('播放失败', '没有可写入的播放列表', 'error'); if (onDone) onDone(false); return; }
        CM.api('playlist.replaceAllAndPlay', { paths: paths, playIndex: 0, autoPlay: true, stop: true }).then(function(res) {
          var ok = res && res.success !== false;
          if (ok) {
            if (!onDone) CM.showToast('开始播放', (title || '全部') + ' · ' + paths.length + ' 首', 'success');
          } else {
            CM.showToast('播放失败', res && res.error ? res.error : '未知错误', 'error');
          }
          if (onDone) onDone(ok);
        });
      });
    });
  };

  // 确保存在一个可写活动歌单：当前活动歌单被锁定/不可写时，复用或新建专用歌单并设为活动，返回其索引
  CM.ensureWritableActivePlaylist = function() {
    var TEMP = 'CloudMusic 播放';
    return CM.api('playlist.getActive').then(function(active) {
      if (active && active.found && !active.isLocked && !active.isAutoplaylist) return active.index;
      return CM.api('playlist.getAll').then(function(r) {
        var pls = (r && Array.isArray(r)) ? r : [];
        var reused = pls.find(function(p) { return p && p.name === TEMP && !p.isLocked && !p.isAutoplaylist; });
        var pPromise = reused
          ? Promise.resolve(reused.index)
          : CM.api('playlist.create', { name: TEMP }).then(function(r2) {
              var idx = r2 && (r2.index != null ? r2.index : r2.playlist);
              return idx != null ? idx : -1;
            });
        return pPromise.then(function(idx) {
          if (idx < 0) return -1;
          return CM.api('playlist.setActive', { playlist: idx }).then(function() { return idx; });
        });
      });
    });
  };

  // 若正处于 JIT 无痕试听，则静默停止并复位状态；否则直接完成
  CM.stopPreviewIfActive = function() {
    if (!CM.state.previewActive) return Promise.resolve();
    return CM.api('jitQueue.stop').then(function(r) {
      if (r && r.success !== false) CM.state.previewActive = false;
    });
  };

  // 通用：提取曲目路径并弹出"添加到歌单"菜单
  CM.addToPlaylistMenu = function(tracks, x, y) {
    var paths = CM.trackPaths(tracks);
    if (!paths.length) { CM.showToast('无可添加曲目', null, 'error'); return; }
    CM.showAddToPlaylistMenu(x, y, paths);
  };

  /* ============================================
   * 模态框（Promise 化）
   * resolve: 输入模式返回字符串 / 确认模式返回 true；取消返回 null
   * ============================================ */
  var modalResolve = null;
  CM.showModal = function(opts) {
    return new Promise(function(resolve) {
      modalResolve = resolve;
      els.modalTitle.textContent = opts.title || '';
      els.modalDesc.textContent = opts.desc || '';
      els.modalDesc.style.display = opts.desc ? '' : 'none';
      var hasInput = opts.input !== undefined;
      els.modalInput.style.display = hasInput ? '' : 'none';
      els.modalInput.value = hasInput ? (opts.input || '') : '';
      els.modalOk.textContent = opts.okText || '确定';
      els.modalOk.className = 'modal-btn ' + (opts.danger ? 'danger' : 'primary');
      els.modalMask.classList.add('open');
      if (hasInput) setTimeout(function() { els.modalInput.focus(); els.modalInput.select(); }, 80);
    });
  };
  CM.closeModal = function(result) {
    els.modalMask.classList.remove('open');
    if (modalResolve) { modalResolve(result); modalResolve = null; }
  };
  els.modalOk.addEventListener('click', function() {
    var hasInput = els.modalInput.style.display !== 'none';
    CM.closeModal(hasInput ? els.modalInput.value.trim() : true);
  });
  els.modalCancel.addEventListener('click', function() { CM.closeModal(null); });
  els.modalMask.addEventListener('mousedown', function(e) {
    if (e.target === els.modalMask) CM.closeModal(null);
  });
  els.modalInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') CM.closeModal(els.modalInput.value.trim());
    if (e.key === 'Escape') CM.closeModal(null);
  });

  /* ============================================
   * 右键菜单
   * items: [{label, icon?, html?, danger?, checked?, action?} | {divider:true} | {label:..., isLabel:true}]
   * ============================================ */
  // 事件委托：一次性绑定在 ctxMenu 上，避免每次 showCtxMenu 都逐项 addEventListener
  var _ctxMenuDelegated = false;
  var _ctxMenuItems = null; // 当前菜单项引用（供委托回调使用）
  function ensureCtxMenuDelegation() {
    if (_ctxMenuDelegated) return;
    _ctxMenuDelegated = true;
    els.ctxMenu.addEventListener('click', function(e) {
      var el = e.target.closest('.ctx-item');
      if (!el || !_ctxMenuItems) return;
      e.stopPropagation();
      CM.hideCtxMenu();
      var item = _ctxMenuItems[parseInt(el.dataset.idx, 10)];
      if (item && item.action) item.action();
    });
  }
  var _ctxHideTimer = null; // hideCtxMenu 的隐藏定时器：showCtxMenu 时须清除，否则嵌套菜单会被延迟隐藏（添加到歌单闪退）
  // 菜单贴近视口边缘时自动翻转定位 + 限制高度可滚动，确保任何触发点都不会让菜单底部/顶部组件超出视口被遮挡
  CM.showCtxMenu = function(x, y, items) {
    if (_ctxHideTimer) { clearTimeout(_ctxHideTimer); _ctxHideTimer = null; }
    ensureCtxMenuDelegation();
    _ctxMenuItems = items;
    var menu = els.ctxMenu;
    // 构建 HTML 字符串一次性写入，避免逐项 createElement + appendChild
    var html = '';
    items.forEach(function(item, i) {
      if (item.divider) { html += '<div class="ctx-divider"></div>'; return; }
      if (item.isLabel) { html += '<div class="ctx-label">' + esc(item.label) + '</div>'; return; }
      html += '<div class="ctx-item' + (item.danger ? ' danger' : '') + (item.checked ? ' checked' : '') + '" data-idx="' + i + '">' +
        (item.icon || '') + (item.html || '<span>' + esc(item.label) + '</span>') + '</div>';
    });
    menu.innerHTML = html;
    menu.classList.remove('hidden', 'removing');
    menu.style.left = '0px'; menu.style.top = '0px';
    // 高度限制随视口自适应，超长内容始终可滚动到达
    var GAP = 8;
    var maxH = Math.max(180, Math.min(window.innerHeight - GAP, 480));
    menu.style.maxHeight = maxH + 'px';
    var rect = menu.getBoundingClientRect();
    var mw = rect.width, mh = rect.height;
    // 水平：默认在 x 右侧展开；放不下则贴右缘
    var left = (x + mw + GAP <= window.innerWidth) ? x : Math.max(GAP, window.innerWidth - mw - GAP);
    // 垂直：默认在 y 下方展开；放不下则向上翻转（菜单整体落在触发点上方，编入视口内）
    var top;
    if (y + mh + GAP <= window.innerHeight) top = y;
    else top = Math.max(GAP, Math.min(y - mh - GAP, window.innerHeight - mh - GAP));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  };
  CM.hideCtxMenu = function() {
    var menu = els.ctxMenu;
    if (menu.classList.contains('hidden')) return;
    menu.classList.add('removing');
    if (_ctxHideTimer) clearTimeout(_ctxHideTimer);
    _ctxHideTimer = setTimeout(function() { _ctxHideTimer = null; menu.classList.add('hidden'); menu.classList.remove('removing'); }, 110);
  };
  document.addEventListener('mousedown', function(e) {
    if (!els.ctxMenu.contains(e.target)) CM.hideCtxMenu();
  });
  window.addEventListener('blur', function() { CM.hideCtxMenu(); });

  /* ============================================
   * 标题栏（窗口控制按钮）
   * ============================================ */
  CM.initTitlebar = function() {
    els.titlebarControls.innerHTML =
      '<button class="caption-btn" id="capMin" title="最小化"><svg viewBox="0 0 12 12"><line x1="1" y1="6" x2="11" y2="6"/></svg></button>' +
      '<button class="caption-btn" id="capMax" title="最大化/还原">' +
        '<svg viewBox="0 0 12 12" class="icon-max"><rect x="1.5" y="1.5" width="9" height="9" rx="1"/></svg>' +
        '<svg viewBox="0 0 12 12" class="icon-restore"><rect x="1.5" y="3.5" width="7" height="7" rx="1"/><path d="M3.5 3.5v-2h7v7h-2"/></svg>' +
      '</button>' +
      '<button class="caption-btn close" id="capClose" title="关闭"><svg viewBox="0 0 12 12"><line x1="1.5" y1="1.5" x2="10.5" y2="10.5"/><line x1="10.5" y1="1.5" x2="1.5" y2="10.5"/></svg></button>';
    CM.$('capMin').addEventListener('click', function() { CM.api('window.minimize'); });
    CM.$('capMax').addEventListener('click', function() { CM.api('window.toggleMaximize'); });
    CM.$('capClose').addEventListener('click', function() { CM.api('window.close'); });
    els.titlebarDrag.addEventListener('mousedown', function(e) {
      if (e.button === 0) CM.api('window.startDrag');
    });
    els.titlebarDrag.addEventListener('dblclick', function() { CM.api('window.toggleMaximize'); });
    CM.updateMaxIcon();
    fb.on('window:stateChanged', function() {
      CM.updateMaxIcon();
    });
  };
  CM.updateMaxIcon = function() {
    CM.api('window.isMaximized').then(function(r) {
      var btn = CM.$('capMax');
      if (btn && r) btn.classList.toggle('is-max', !!r.maximized || r.isMaximized === true || r.result === true);
    });
  };

  /* ============================================
   * Tab 切换
   * ============================================ */
  var TAB_IDS = { discover: 'tabDiscover', playlist: 'tabPlaylist', library: 'tabLibrary', search: 'tabSearch' };
  // 缓存 Tab 相关 DOM（静态元素，无需每次 switchTab 都查询）
  var _tabNavItems, _tabMainTabs, _tabContents;
  CM.switchTab = function(tab) {
    if (!TAB_IDS[tab]) return;
    state.currentTab = tab;
    CM.settings.tab = tab;
    CM.saveSettings();
    if (!_tabNavItems) _tabNavItems = document.querySelectorAll('.nav-item[data-tab]');
    if (!_tabMainTabs) _tabMainTabs = document.querySelectorAll('.main-tab[data-tab]');
    if (!_tabContents) _tabContents = document.querySelectorAll('.tab-content');
    _tabNavItems.forEach(function(el) { el.classList.toggle('active', el.dataset.tab === tab); });
    _tabMainTabs.forEach(function(el) { el.classList.toggle('active', el.dataset.tab === tab); });
    _tabContents.forEach(function(el) { el.classList.toggle('active', el.id === TAB_IDS[tab]); });
    if (tab === 'playlist' && state.currentPlaylistIndex >= 0) CM.renderPlaylistView(state.currentPlaylistIndex);
    if (tab === 'library') CM.renderLibrary();
    if (tab === 'search') setTimeout(function() { els.searchInput.focus(); }, 60);
  };

  /* ============================================
   * 底栏图标状态
   * ============================================ */
  CM.updatePlayPauseIcon = function(isPlaying) {
    els.iconPlay.style.display = isPlaying ? 'none' : '';
    els.iconPause.style.display = isPlaying ? '' : 'none';
  };

  var ORDER_ICONS = null; // 延迟初始化（els 尚未就绪）
  CM.updateOrderIcon = function() {
    if (!ORDER_ICONS) ORDER_ICONS = { seq: els.iconOrderSeq, loop: els.iconOrderLoop, one: els.iconOrderOne, shuffle: els.iconOrderShuffle };
    var order = CM.ORDERS[CM.orderIndexOf(state.order)];
    for (var icon in ORDER_ICONS) ORDER_ICONS[icon].style.display = order.icon === icon ? '' : 'none';
    els.btnOrder.title = '播放顺序：' + order.name;
    els.btnOrder.classList.toggle('active', order.id !== 0);
  };

  CM.updateVolumeIcon = function() {
    var v = state.muted ? 0 : state.volume;
    var svg;
    if (v <= 0) {
      svg = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>';
    } else if (v < 50) {
      svg = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>';
    } else {
      svg = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>';
    }
    els.volIcon.innerHTML = svg;
    els.volSlider.value = state.muted ? 0 : state.volume;
    els.volSlider.style.setProperty('--vol-pct', (state.muted ? 0 : state.volume) + '%');
  };

  // 通用进度条更新（主进度条 + 沉浸式进度条共用）
  CM._updateSeekBar = function(bar, curLabel, totalLabel, cssVar, seekingFlag) {
    if (state[seekingFlag]) return;
    var pct = state.duration > 0 ? (state.position / state.duration) : 0;
    bar.value = Math.round(pct * 1000);
    bar.style.setProperty(cssVar, (pct * 100).toFixed(2) + '%');
    curLabel.textContent = CM.formatTime(state.position);
    totalLabel.textContent = CM.formatTime(state.duration);
  };

  CM.updateSeekUI = function() {
    CM._updateSeekBar(els.seekBar, els.seekCurrent, els.seekTotal, '--seek-pct', 'seeking');
  };

  CM.updateStopAfterIcon = function() {
    els.btnStopAfter.classList.toggle('active', state.stopAfterCurrent);
  };

  /* ============================================
   * 当前曲目信息 + 封面 + 取色
   * ============================================ */
  var DEFAULT_TRACK_COVER = 'static/img/no_cover.png';
  CM.setArtwork = function(url) {
    var next = (typeof url === 'string' && url.trim()) ? url.trim() : DEFAULT_TRACK_COVER;
    // 真实封面加载失败时回退占位图，避免无封面时闪空
    if (next !== DEFAULT_TRACK_COVER) {
      var onErr = function() {
        els.bottomArt.onerror = null;
        els.lyricsArt.onerror = null;
        if (els.npArtwork) els.npArtwork.onerror = null;
        if (els.bottomArt.getAttribute('src') !== DEFAULT_TRACK_COVER) els.bottomArt.src = DEFAULT_TRACK_COVER;
        if (els.lyricsArt.getAttribute('src') !== DEFAULT_TRACK_COVER) els.lyricsArt.src = DEFAULT_TRACK_COVER;
        if (els.npArtwork && els.npArtwork.getAttribute('src') !== DEFAULT_TRACK_COVER) els.npArtwork.src = DEFAULT_TRACK_COVER;
      };
      els.bottomArt.onerror = onErr;
      els.lyricsArt.onerror = onErr;
      if (els.npArtwork) els.npArtwork.onerror = onErr;
    } else {
      els.bottomArt.onerror = null;
      els.lyricsArt.onerror = null;
      if (els.npArtwork) els.npArtwork.onerror = null;
    }
    if (els.bottomArt.getAttribute('src') !== next) els.bottomArt.src = next;
    if (els.lyricsArt.getAttribute('src') !== next) els.lyricsArt.src = next;
    if (els.npArtwork && els.npArtwork.getAttribute('src') !== next) els.npArtwork.src = next;
    els.lyricsBlurBg.style.backgroundImage = 'url("' + next + '")';
    CM.extractColorFromImage(next);
  };

  CM.updateTrackInfo = function(track) {
    CM.currentTrack = track || null;
    var name = track ? CM.trackName(track) : '未在播放';
    var artist = track ? CM.trackArtist(track) : '--';
    els.bottomTitle.textContent = name;
    els.bottomTitle.title = name;
    els.bottomArtist.textContent = artist;
    els.lyricsTrackTitle.textContent = name;
    els.lyricsTrackArtist.textContent = artist;
    if (track && track.duration) state.duration = track.duration;
    document.title = track ? (name + ' - ' + artist) : 'CloudMusic';
  };

  CM.loadCurrentArtwork = function() {
    CM.api('artwork.getFb2kUrl', { type: 'front', maxSize: 600 }).then(function(r) {
      // 宿主响应无 success 字段：{available, dataUrl, type}
      if (r && r.dataUrl && r.available !== false) CM.setArtwork(r.dataUrl);
      else CM.setArtwork(null);
    });
  };

  // 更新“喜欢”按钮（rating >= 4 视为喜欢）
  CM.refreshLikeState = function() {
    var path = CM.trackPath(CM.currentTrack);
    if (!path) { els.likeBtn.classList.remove('liked'); return; }
    CM.api('rating.get', { path: path }).then(function(r) {
      var rt = r && r.success !== false ? (r.rating || 0) : 0;
      CM.currentRating = rt;
      els.likeBtn.classList.toggle('liked', rt >= 4);
    });
  };

  /* ============================================
   * 歌词
   * ============================================ */
  // 歌词文本健壮解码：base64 原始字节 → BOM 探测 → 严格 UTF-8 → 多编码专有码位评分
  // 评分辅助：对某个遗留编码解码后，依据"语言专有码位"(假名/谚文)加权、U+FFFD/控制符扣分，返回合理性分。
  CM._scoreEnc = function(bytes, enc) {
    var txt, i, c, n, score = 0;
    try { txt = new TextDecoder(enc).decode(bytes); } catch (e) { return -1e9; }
    n = txt.length;
    for (i = 0; i < n; i++) {
      c = txt.charCodeAt(i);
      if (c === 0xFFFD) { score -= 50; continue; }
      if (c < 0x20 && c !== 0x0A && c !== 0x0D && c !== 0x09) { score -= 20; continue; }
      // 大片平/片假名：GB18030/Big5 的中文字节几乎不产出这些码位，是 Shift_JIS 的可靠信号，
      // 中日混排假名占比很低时也能判准。注意：半角片假名(FF65-FF9F)与谚文(AC00-D7A3)
      // 会被中文 GBK 字节反射出来，绝不能用强信号（否则中文被误判日/韩），统一按基础分。
      if ((c >= 0x3040 && c <= 0x30FF) || (c >= 0x31F0 && c <= 0x31FF)) score += 8;
      else score += 1;
    }
    return score;
  };

  CM.decodeTextBytes = function(b64) {
    var raw = atob(b64);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF)
      return new TextDecoder('utf-8').decode(bytes.subarray(3));
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE)
      return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF)
      return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    // 无 BOM 的 UTF-16 启发探测：ASCII 字符在双字节编码中高字节恒为 0，
    // 若奇数位（LE）或偶数位（BE）的 0x00 占比超过 1/3，判定为 UTF-16。
    if (bytes.length >= 4) {
      var nullOdd = 0, nullEven = 0;
      for (var zi = 0; zi < bytes.length; zi += 2) { if (bytes[zi] === 0) nullEven++; }
      for (var zo = 1; zo < bytes.length; zo += 2) { if (bytes[zo] === 0) nullOdd++; }
      var half = bytes.length / 2;
      if (nullOdd > half * 0.35) return new TextDecoder('utf-16le').decode(bytes);
      if (nullEven > half * 0.35) return new TextDecoder('utf-16be').decode(bytes);
    }
    // 严格 UTF-8（含纯 ASCII）
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) {
      // —— 多字节遗留编码，采用"大片假名信号 + 中文优先"评分制 ——
      // 仅大片平/片假名作为日文硬判定（中文不会映射到这些码位），避免原"首个无 U+FFFD 即返"
      // 让 GB18030 把日文假名吞成中文乱码；候选并列时分不服，按中文优先顺序裁决。
      var CAND = ['gb18030', 'big5', 'shift_jis', 'euc-kr'];
      var best = '', bestScore = -1e9;
      for (var bi = 0; bi < CAND.length; bi++) {
        var sc = CM._scoreEnc(bytes, CAND[bi]);
        if (sc > bestScore) { bestScore = sc; best = CAND[bi]; }
      }
      // 负分说明全部候选都是垃圾（多为二进制/非文本），退回 Latin-1 保底显示
      if (bestScore < 0) return new TextDecoder('iso-8859-1').decode(bytes);
      return new TextDecoder(best).decode(bytes);
    }
  };

  CM._renderLyrics = function(r, lyricsText) {
    if (!r || r.success === false || !r.available || !lyricsText) {
      CM.renderLyricsEmpty('暂无歌词');
      return;
    }
    var parsed = CM.parseLRC(lyricsText);
    // 只要解析出时间戳即按同步歌词渲染，不依赖插件 synced 判定
    // （带 [ti:]/[ar:]/[offset:] 等元数据标签的文件可能被插件误判为不同步）
    if (parsed.length) {
      CM.currentLyrics = parsed;
      CM.renderSyncedLyrics(parsed);
    } else {
      CM.renderPlainLyrics(lyricsText, parsed);
    }
  };

  CM.loadLyrics = function() {
    CM.currentLyrics = [];
    CM.activeLyricIndex = -1;
    if (!CM.currentTrack) { CM.renderLyricsEmpty('暂无歌词'); return; }
    els.lyricsScroll.innerHTML = CM.loadingHTML('歌词加载中...');
    var path = CM.trackPath(CM.currentTrack);
    CM.api('lyrics.get', path ? { path: path } : {}).then(function(r) {
      // 外部文件歌词：优先用 file.read 读取原始字节并做编码探测，
      // 修复插件只认 UTF-8/16-BOM 导致 ANSI(GBK) 歌词乱码的问题。
      // 文件在白名单外（如与音频同目录）不可读时，回退插件解码结果（UTF-8/16 仍正常）。
      if (r && r.available && r.source === 'file' && r.sourcePath) {
        CM.api('file.read', { path: r.sourcePath, encoding: 'binary' }).then(function(fr) {
          CM._renderLyrics(r, fr && fr.success && fr.content ? CM.decodeTextBytes(fr.content) : r.lyrics);
        });
        return;
      }
      CM._renderLyrics(r, r.lyrics);
    });
  };

  CM.renderLyricsEmpty = function(text) {
    els.lyricsScroll.innerHTML =
      '<div class="lyrics-empty">' + CM.icons.note + '<span>' + esc(text) + '</span></div>';
  };

  // 通用歌词 HTML 生成（主歌词面板 + 沉浸式共用）
  CM._renderLyricHTML = function(lines, lineClass, topPadPct) {
    var html = '<div style="height:' + topPadPct + '%"></div>';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      html += '<div class="' + lineClass + (line.words ? ' has-words' : '') + '" data-idx="' + i + '" data-time="' + line.time + '">';
      if (line.words) {
        for (var w = 0; w < line.words.length; w++) {
          html += '<span class="lyric-word" data-time="' + line.words[w].time + '">' + esc(line.words[w].text) + '</span>';
        }
      } else {
        html += esc(line.text);
      }
      html += '</div>';
    }
    return html + '<div style="height:40%"></div>';
  };

  // 通用歌词点击跳转：事件委托（一次性绑定在容器上，避免逐行 addEventListener）
  var _lyricClickBound = {}; // 按容器缓存，避免重复绑定
  CM._bindLyricClicks = function(container, lineSelector) {
    if (_lyricClickBound[lineSelector]) return;
    _lyricClickBound[lineSelector] = true;
    container.addEventListener('click', function(e) {
      var el = e.target.closest(lineSelector);
      if (!el) return;
      var t = parseFloat(el.dataset.time);
      if (isFinite(t)) CM.api('playback.setPosition', { seconds: t });
    });
  };

  // 通用歌词高亮（主面板 + 沉浸式共用）
  // 缓存节点列表，避免每次 timeHighRes 事件都 querySelectorAll
  CM._lyricNodesCache = null;      // 主面板歌词节点
  CM._npLyricNodesCache = null;    // 沉浸式歌词节点
  CM._wordCache = null;            // 主面板逐字节点 { lineIdx: NodeList }
  CM._npWordCache = null;          // 沉浸式逐字节点
  CM._updateLyricHighlight = function(container, lineSelector, activeIdxField, force, pos, cacheKey, wordCacheKey) {
    var lines = CM.currentLyrics;
    if (!lines.length) return;
    // 二分查找最后一个 time <= pos 的行（行按时间升序），超长歌词（播客/长音频）下避免每帧从头线性扫描
    var idx = -1, lo = 0, hi = lines.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (lines[mid].time <= pos) { idx = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    var lineChanged = idx !== CM[activeIdxField];
    if (!lineChanged && !force) {
      CM._updateWordHighlight(container, idx, pos, wordCacheKey);
      return;
    }
    CM[activeIdxField] = idx;
    // 使用缓存节点（渲染时已缓存），避免每次都 querySelectorAll
    var nodes = cacheKey ? CM[cacheKey] : null;
    if (!nodes || nodes.length !== lines.length) {
      nodes = container.querySelectorAll(lineSelector);
      if (cacheKey) CM[cacheKey] = nodes;
    }
    for (var ni = 0; ni < nodes.length; ni++) {
      nodes[ni].classList.toggle('active', ni === idx);
    }
    CM._updateWordHighlight(container, idx, pos, wordCacheKey);
    if (idx >= 0 && nodes[idx]) {
      var target = nodes[idx];
      var top = target.offsetTop - container.clientHeight / 2 + target.clientHeight / 2;
      container.scrollTo({ top: top, behavior: force ? 'auto' : 'smooth' });
    }
  };

  CM.renderSyncedLyrics = function(lines) {
    els.lyricsScroll.innerHTML = CM._renderLyricHTML(lines, 'lyric-line', 34);
    CM._lyricNodesCache = null;
    CM._wordCache = null;
    CM._bindLyricClicks(els.lyricsScroll, '.lyric-line');
    CM.updateLyricHighlight(true);
  };

  CM.renderPlainLyrics = function(raw, parsed) {
    // 无时间轴：按行静态展示（若解析出文本行则用解析结果）
    var lines = parsed.length ? parsed.map(function(l) { return l.text; })
      : raw.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
    if (!lines.length) { CM.renderLyricsEmpty('暂无歌词'); return; }
    var html = '<div style="height:12px"></div>';
    lines.forEach(function(text) { html += '<div class="lyric-line">' + esc(text) + '</div>'; });
    html += '<div style="height:20px"></div>';
    els.lyricsScroll.innerHTML = html;
  };

  CM.updateLyricHighlight = function(force) {
    if (!state.lyricsVisible) return;
    CM._updateLyricHighlight(els.lyricsScroll, '.lyric-line', 'activeLyricIndex', force, state.position + 0.25, '_lyricNodesCache', '_wordCache');
  };

  // 逐字高亮：在活动行内标记已唱词（.sung）
  // 缓存每行的 .lyric-word NodeList，避免 30fps 每帧都 querySelector
  CM._updateWordHighlight = function(container, lineIdx, pos, wordCacheKey) {
    if (lineIdx < 0) return;
    var line = CM.currentLyrics[lineIdx];
    if (!line || !line.words) return;
    var wordEls;
    if (wordCacheKey) {
      if (!CM[wordCacheKey]) CM[wordCacheKey] = {};
      wordEls = CM[wordCacheKey][lineIdx];
      if (!wordEls) {
        var lineEl = container.querySelector('[data-idx="' + lineIdx + '"]');
        if (!lineEl) return;
        wordEls = lineEl.querySelectorAll('.lyric-word');
        CM[wordCacheKey][lineIdx] = wordEls;
      }
    } else {
      var lineEl0 = container.querySelector('[data-idx="' + lineIdx + '"]');
      if (!lineEl0) return;
      wordEls = lineEl0.querySelectorAll('.lyric-word');
    }
    for (var i = 0; i < wordEls.length; i++) {
      var t = parseFloat(wordEls[i].dataset.time);
      wordEls[i].classList.toggle('sung', t <= pos);
    }
  };

  /* ============================================
   * 侧栏歌单列表
   * ============================================ */
  // 侧栏歌单列表事件委托（一次性绑定，避免每次 loadPlaylists 都逐个 attach）
  var _playlistDelegated = false;
  function ensurePlaylistDelegation() {
    if (_playlistDelegated) return;
    _playlistDelegated = true;
    els.playlistList.addEventListener('click', function(e) {
      var el = e.target.closest('.pl-item');
      if (!el) return;
      CM.openPlaylist(parseInt(el.dataset.index, 10));
    });
    els.playlistList.addEventListener('contextmenu', function(e) {
      var el = e.target.closest('.pl-item');
      if (!el) return;
      e.preventDefault();
      CM.showPlaylistCtxMenu(e.clientX, e.clientY, parseInt(el.dataset.index, 10));
    });
  }

  CM.loadPlaylists = function() {
    return CM.api('playlist.getAll').then(function(r) {
      // 宿主直接返回数组 [{index,name,trackCount,isActive,isPlaying,...}]
      var lists = Array.isArray(r) ? r : ((r && r.playlists) || []);
      CM.playlists = lists;
      var parts = [];
      lists.forEach(function(pl, i) {
        var idx = pl.index !== undefined ? pl.index : i;
        parts.push(
          '<div class="pl-item' + (idx === state.currentPlaylistIndex ? ' active' : '') +
          (idx === state.playingPlaylistIndex ? ' playing' : '') + '" data-index="' + idx + '">' +
          CM.icons.note +
          '<span class="pl-item-name">' + esc(pl.name) + '</span>' +
          (pl.isAutoplaylist ? '<span class="pl-auto-badge">AUTO</span>' : '') +
          '<span class="pl-item-count">' + (pl.trackCount != null ? pl.trackCount : (pl.itemCount != null ? pl.itemCount : '')) + '</span>' +
          '</div>'
        );
      });
      els.playlistList.innerHTML = parts.length ? parts.join('') : '<div class="queue-empty" style="padding:24px">暂无歌单</div>';
      ensurePlaylistDelegation();
      return lists;
    });
  };

  // 网络地址 → 歌单（弹出输入框 → 校验 → addPathsAsync）
  CM.addUrlToPlaylist = function(playlistIdx) {
    CM.showModal({
      title: '添加网络地址',
      input: '',
      desc: '输入音频流或文件 URL（http:// 或 https://）',
      okText: '添加'
    }).then(function(url) {
      if (!url) return;
      if (!/^https?:\/\//i.test(url)) {
        CM.showToast('地址无效', '请以 http:// 或 https:// 开头', 'error');
        return;
      }
      CM._addPaths(playlistIdx, [url], '正在添加' + (url.length > 50 ? url.slice(0, 50) + '…' : url));
    });
  };

  // 本地文件 → 歌单（系统文件对话框）
  var AUDIO_FILTERS = [
    { name: '音频文件', extensions: ['mp3', 'flac', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'mp4', 'ape', 'wv', 'tta', 'ac3', 'dts', 'dsf', 'dff', 'aiff', 'au'] },
    { name: '播放列表', extensions: ['cue', 'm3u', 'm3u8', 'pls', 'xspf'] }
  ];
  CM.addFilesToPlaylist = function(playlistIdx) {
    CM.api('dialog.openFile', { title: '选择要添加的音频文件', multiple: true, filters: AUDIO_FILTERS }).then(function(r) {
      if (!r || r.canceled) return;
      var paths = (r.filePaths || []).filter(Boolean);
      if (paths.length) CM._addPaths(playlistIdx, paths, '正在添加 ' + paths.length + ' 个文件');
    });
  };

  // 本地文件夹 → 歌单（系统文件夹对话框）
  CM.addFolderToPlaylist = function(playlistIdx) {
    CM.api('dialog.openFolder', { title: '选择要添加的音乐文件夹' }).then(function(r) {
      if (!r || r.canceled || !r.folderPath) return;
      // 宿主 addPathsAsync 不会展开文件夹，会把它当单音轨加入导致"格式不支持"，
      // 这里复用 expandDroppedPaths 递归枚举文件夹内的音频文件后再添加。
      CM.expandDroppedPaths([r.folderPath]).then(function(paths) {
        if (!paths.length) return;
        CM._addPaths(playlistIdx, paths, '正在添加 ' + paths.length + ' 个文件');
      });
    });
  };

  // 统一路径添加（本地/文件夹/网络共用）
  CM._addPaths = function(playlistIdx, paths, okMsg) {
    var params = { paths: paths };
    if (playlistIdx !== undefined && playlistIdx >= 0) params.playlist = playlistIdx;
    CM.api('playlist.addPathsAsync', params).then(function(res) {
      if (res && res.success !== false) CM.showToast(okMsg, null, 'success');
      else CM.showToast('添加失败', res && res.error ? res.error : '路径可能无效', 'error');
    });
  };

  CM.showPlaylistCtxMenu = function(x, y, idx) {
    var pl = (CM.playlists || []).find(function(p) { return p.index === idx; }) || {};
    // 自动歌单/锁定歌单（如默认「媒体库」）不接受手动编辑：隐藏 添加/重命名/清空/删除
    var editable = !pl.isAutoplaylist && !pl.isLocked;
    var items = [
      { label: '播放', icon: CM.icons.play, action: function() {
        CM.api('playlist.playTrack', { playlist: idx, index: 0 });
      } }
    ];
    if (editable) {
      items.push({ isLabel: true, label: '添加到歌单' });
      items.push({ label: '添加本地文件', icon: CM.icons.folder, action: function() {
        CM.addFilesToPlaylist(idx);
      } });
      items.push({ label: '添加文件夹', icon: CM.icons.folder, action: function() {
        CM.addFolderToPlaylist(idx);
      } });
      items.push({ label: '添加网络地址', icon: CM.icons.plus, action: function() {
        CM.addUrlToPlaylist(idx);
      } });
      items.push({ label: '重命名', icon: CM.icons.edit, action: function() {
        CM.showModal({ title: '重命名歌单', input: pl.name || '', okText: '重命名' }).then(function(name) {
          if (!name) return;
          CM.api('playlist.rename', { playlist: idx, name: name }).then(function(r) {
            if (r && r.success) CM.showToast('已重命名', name, 'success');
          });
        });
      } });
      items.push({ divider: true });
      items.push({ label: '清空歌单', icon: CM.icons.trash, action: function() {
        CM.showModal({ title: '清空歌单', desc: '将移除「' + (pl.name || '') + '」中的全部曲目，此操作不可撤销。', okText: '清空', danger: true }).then(function(ok) {
          if (ok) CM.api('playlist.clear', { playlist: idx });
        });
      } });
      items.push({ label: '删除歌单', icon: CM.icons.trash, danger: true, action: function() {
        CM.showModal({ title: '删除歌单', desc: '确定删除「' + (pl.name || '') + '」吗？此操作不可撤销。', okText: '删除', danger: true }).then(function(ok) {
          if (ok) CM.api('playlist.remove', { playlist: idx });
        });
      } });
    } else {
      items.push({ isLabel: true, label: pl.isAutoplaylist ? '自动播放列表' : '锁定播放列表' });
    }
    CM.showCtxMenu(x, y, items);
  };

  /* ============================================
   * 播放列表详情（曲目表格）
   * ============================================ */
  CM.openPlaylist = function(idx) {
    state.currentPlaylistIndex = idx;
    state.sortKey = null;
    CM.switchTab('playlist'); // 进入播放列表标签会自行渲染该歌单
    CM.loadPlaylists();
  };

  CM.renderPlaylistView = function(idx) {
    var pl = (CM.playlists || []).find(function(p) { return p.index === idx; }) || {};
    els.playlistHeaderName.textContent = pl.name || '播放列表';
    els.playlistHeaderTag.textContent = pl.isAutoplaylist ? 'AUTOPLAYLIST' : 'PLAYLIST';
    // 记忆最近打开的歌单（按名称持久化，启动时据此自动恢复上次听歌的歌单）
    if (CM.settings.lastPlaylist !== (pl.name || '')) {
      CM.settings.lastPlaylist = pl.name || '';
      CM.saveSettings();
    }

    // 延迟加载指示器：API 快速返回（<150ms）时不闪烁，保留旧表格内容
    var loadingTimer = setTimeout(function() {
      els.trackTbody.innerHTML = '<tr><td colspan="6"><div class="table-loading"><div class="spinner"></div>加载中...</div></td></tr>';
    }, 150);

    CM.api('playlist.getTracks', { playlist: idx, start: 0, count: 5000 }).then(function(r) {
      clearTimeout(loadingTimer);
      if (!r || r.success === false) {
        els.trackTbody.innerHTML = '<tr><td colspan="6"><div class="table-error">加载失败</div></td></tr>';
        return;
      }
      var tracks = r.tracks || [];
      state.trackCache = tracks;
      state.playlistTracksTotal = r.total != null ? r.total : tracks.length;
      var totalDur = 0;
      tracks.forEach(function(t) { totalDur += t.duration || 0; });
      els.playlistHeaderMeta.textContent = state.playlistTracksTotal + ' 首曲目 · ' + CM.formatTime(totalDur);
      // 歌单封面取第一首歌
      if (tracks.length) {
        CM.api('artwork.getFb2kUrlByPath', { path: CM.trackPath(tracks[0]), type: 'front', maxSize: 300 }).then(function(ar) {
          if (ar && ar.dataUrl && ar.available !== false) {
            els.plCover.src = ar.dataUrl;
            els.plCover.style.display = '';
          }
        });
      }
      CM.renderTrackTable();
      // 预加载缺失元数据（foobar2000 延迟加载机制：异步添加文件时不立即读取标签）
      CM.preloadTrackMetadata(tracks);
    });
  };

  // 大写键名（readBatch）→ 小写键名（playlist.getTracks）映射
  var META_TAG_MAP = {
    ARTIST: 'artist', ALBUM: 'album', ALBUM_ARTIST: 'albumArtist',
    TITLE: 'title', GENRE: 'genre', DATE: 'date'
  };
  var META_INT_TAGS = { TRACKNUMBER: 'trackNumber', DISCNUMBER: 'discNumber' };

  // 批量预加载缺失元数据（foobar2000 延迟加载：异步添加文件时不立即读取标签）
  // 增量更新：无排序时只更新变化的行，避免全量重渲染闪烁；有排序时防抖重渲染
  var _metaRenderTimer = null;
  CM.preloadTrackMetadata = function(tracks) {
    if (!tracks || !tracks.length) return;
    var missing = [];
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      if (!t.artist && !t.album && !t.albumArtist) {
        var p = CM.trackPath(t);
        if (p) missing.push({ idx: i, path: p });
      }
    }
    if (!missing.length) return;

    var BATCH = 50;
    for (var b = 0; b < missing.length; b += BATCH) {
      (function(batch) {
        var paths = batch.map(function(m) { return m.path; });
        CM.api('metadata.readBatch', { paths: paths }).then(function(r) {
          if (!r || r.success === false || !r.results) return;
          var changedIdxs = [];
          r.results.forEach(function(res, ri) {
            if (!res.success || !res.tags) return;
            var t = state.trackCache[batch[ri].idx];
            if (!t) return;
            var tags = res.tags, changed = false;
            for (var up in META_TAG_MAP) {
              var lo = META_TAG_MAP[up];
              if (tags[up] && !t[lo]) { t[lo] = tags[up]; changed = true; }
            }
            for (var up in META_INT_TAGS) {
              var lo = META_INT_TAGS[up];
              if (tags[up] && t[lo] == null) { t[lo] = parseInt(tags[up], 10) || 0; changed = true; }
            }
            if (changed) changedIdxs.push(batch[ri].idx);
          });
          if (!changedIdxs.length) return;
          if (state.sortKey) {
            // 排序模式下防抖全量重渲染（多批合并为一次）
            clearTimeout(_metaRenderTimer);
            _metaRenderTimer = setTimeout(CM.renderTrackTable, 100);
          } else {
            CM._updateTrackRows(changedIdxs);
          }
        });
      })(missing.slice(b, b + BATCH));
    }
  };

  // 增量更新表格行（仅更新指定索引的单元格内容，不重建整个表格）
  CM._updateTrackRows = function(idxs) {
    idxs.forEach(function(idx) {
      var tr = els.trackTbody.querySelector('tr[data-index="' + idx + '"]');
      if (!tr) return;
      var t = state.trackCache[idx];
      if (!t) return;
      var cells = tr.children;
      // cells[0]=track-num, [1]=title, [2]=artist, [3]=album, [4]=duration, [5]=bitrate
      if (cells[1]) cells[1].textContent = CM.trackName(t);
      if (cells[2]) cells[2].textContent = CM.trackArtist(t);
      if (cells[3]) cells[3].textContent = t.album || '';
    });
  };

  // 播放列表表格事件委托（一次性绑定，避免每次渲染都逐行 attach N 个监听器）
  var _trackTableDelegated = false;
  var _sortHeaders = null; // 缓存排序表头单元格
  function ensureTrackTableDelegation() {
    if (_trackTableDelegated) return;
    _trackTableDelegated = true;
    els.trackTbody.addEventListener('click', function(e) {
      var tr = e.target.closest('tr[data-index]');
      if (!tr) return;
      var realIdx = parseInt(tr.dataset.index, 10);
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+click：批量多选
        if (state.batchSelected.has(realIdx)) {
          state.batchSelected.delete(realIdx);
          tr.classList.remove('batch-selected');
        } else {
          state.batchSelected.add(realIdx);
          tr.classList.add('batch-selected');
        }
        CM._updateBatchBar();
      } else {
        // 普通点击：清除多选，单选高亮
        if (state.batchSelected.size > 0) CM.clearBatchSelection();
        var sel = els.trackTbody.querySelector('tr.selected');
        if (sel) sel.classList.remove('selected');
        tr.classList.add('selected');
      }
    });
    els.trackTbody.addEventListener('dblclick', function(e) {
      var tr = e.target.closest('tr[data-index]');
      if (!tr) return;
      CM.api('playlist.playTrack', { playlist: state.currentPlaylistIndex, index: parseInt(tr.dataset.index, 10) });
    });
    els.trackTbody.addEventListener('contextmenu', function(e) {
      var tr = e.target.closest('tr[data-index]');
      if (!tr) return;
      e.preventDefault();
      var realIdx = parseInt(tr.dataset.index, 10);
      CM.showTrackCtxMenu(e.clientX, e.clientY, state.trackCache[realIdx], {
        playlist: state.currentPlaylistIndex, index: realIdx
      });
    });
  }

  CM.renderTrackTable = function() {
    CM._lastPlayingTr = null; // 清除旧引用（innerHTML 替换后旧 DOM 已分离）
    // 清除批量选择（表格重建后旧索引失效）
    if (state.batchSelected.size > 0) {
      state.batchSelected.clear();
      CM._updateBatchBar();
    }
    var tracks = state.trackCache.slice();
    // 客户端排序视图（不改动实际播放列表顺序）
    var viewIndex = tracks.map(function(_, i) { return i; });
    if (state.sortKey) {
      var key = state.sortKey, asc = state.sortAsc ? 1 : -1;
      viewIndex.sort(function(a, b) {
        var va = tracks[a][key], vb = tracks[b][key];
        if (key === 'duration' || key === 'bitrate') {
          return ((va || 0) - (vb || 0)) * asc;
        }
        return String(va || '').localeCompare(String(vb || ''), 'zh-CN') * asc;
      });
    }
    // 排序箭头（缓存表头单元格，避免每次渲染都 querySelectorAll）
    if (!_sortHeaders) _sortHeaders = els.trackTable.querySelectorAll('thead th[data-sort]');
    _sortHeaders.forEach(function(th) {
      var arrow = th.querySelector('.sort-arrow');
      if (th.dataset.sort === state.sortKey) {
        th.classList.add('sorted');
        arrow.textContent = state.sortAsc ? '▲' : '▼';
      } else {
        th.classList.remove('sorted');
        arrow.textContent = '';
      }
    });

    if (!tracks.length) {
      els.trackTbody.innerHTML = '<tr><td colspan="6"><div class="table-empty">这个歌单还没有曲目<br><span style="font-size:11.5px;opacity:0.7">拖放音频文件到窗口即可添加</span></div></td></tr>';
      return;
    }

    var isPlayingList = state.currentPlaylistIndex === state.playingPlaylistIndex;
    // 大列表用 array.push + join 代替字符串拼接，减少中间字符串对象分配
    var parts = [];
    viewIndex.forEach(function(realIdx, row) {
      var t = tracks[realIdx];
      var playing = isPlayingList && realIdx === state.playingTrackIndex;
      parts.push(
        '<tr class="' + (playing ? 'playing' : '') + '" data-index="' + realIdx + '">' +
        '<td class="track-num">' + (playing
          ? '<span class="eq-bars"><i></i><i></i><i></i></span>'
          : (row + 1)) + '</td>' +
        '<td class="track-title">' + esc(CM.trackName(t)) + '</td>' +
        '<td class="track-artist-cell">' + esc(CM.trackArtist(t)) + '</td>' +
        '<td class="track-artist-cell">' + esc(t.album || '') + '</td>' +
        '<td class="track-duration">' + CM.formatTime(t.duration) + '</td>' +
        '<td class="track-bitrate">' + (t.bitrate ? t.bitrate + 'k' : '') + '</td>' +
        '</tr>'
      );
    });
    els.trackTbody.innerHTML = parts.join('');
    // 登记本次渲染标记的播放行，供 refreshPlayingMarks 切换时清除，避免残留导致两行同时高亮
    CM._lastPlayingTr = null;
    if (isPlayingList) {
      var _pt = els.trackTbody.querySelector('tr.playing');
      if (_pt) CM._lastPlayingTr = _pt;
    }
    ensureTrackTableDelegation();
  };

  // 标记表格/发现页/搜索中的"正在播放"行
  // 只更新变化的行（旧播放行 → 恢复序号，新播放行 → 显示均衡器），避免全表扫描
  CM._lastPlayingTr = null;
  CM._lastPlayingDc = null; // 上一次标记为 playing 的 dc-track/search-result-item
  CM.refreshPlayingMarks = function() {
    var isPlayingList = state.currentPlaylistIndex === state.playingPlaylistIndex;
    // 清除旧的播放行
    if (CM._lastPlayingTr && CM._lastPlayingTr.parentNode) {
      CM._lastPlayingTr.classList.remove('playing');
      var oldNum = CM._lastPlayingTr.querySelector('.track-num');
      if (oldNum && oldNum.querySelector('.eq-bars')) {
        oldNum.textContent = String(CM._lastPlayingTr.sectionRowIndex + 1);
      }
      CM._lastPlayingTr = null;
    }
    // 设置新的播放行
    if (isPlayingList && state.playingTrackIndex >= 0) {
      var tr = els.trackTbody.querySelector('tr[data-index="' + state.playingTrackIndex + '"]');
      if (tr) {
        tr.classList.add('playing');
        var numCell = tr.querySelector('.track-num');
        if (numCell) numCell.innerHTML = '<span class="eq-bars"><i></i><i></i><i></i></span>';
        CM._lastPlayingTr = tr;
      }
    }
    // dc-track / search-result-item：只更新变化的元素，避免每次都全量扫描 mainContent
    var curPath = CM.trackPath(CM.currentTrack);
    // 清除旧的 playing 标记
    if (CM._lastPlayingDc && CM._lastPlayingDc.parentNode) {
      CM._lastPlayingDc.classList.remove('playing');
      CM._lastPlayingDc = null;
    }
    // 设置新的 playing 标记：逐项比较 dataset.path（属性选择器在下划线/引号等特殊路径下会失效）
    if (curPath) {
      var _nodes = els.mainContent.querySelectorAll('.dc-track, .search-result-item');
      for (var _ni = 0; _ni < _nodes.length; _ni++) {
        if (_nodes[_ni].dataset.path === curPath) {
          _nodes[_ni].classList.add('playing');
          CM._lastPlayingDc = _nodes[_ni];
          break;
        }
      }
    }
  };

  /* ============================================
   * 曲目右键菜单（通用）
   * track: 曲目对象；ctx: {playlist?, index?} 在播放列表内时可删除
   * ============================================ */
  CM.showTrackCtxMenu = function(x, y, track, ctx) {
    if (!track) return;
    var path = CM.trackPath(track);
    var items = [
      { label: '播放', icon: CM.icons.play, action: function() {
        if (ctx && ctx.playlist != null) {
          CM.stopPreviewIfActive().then(function() {
            CM.api('playlist.playTrack', { playlist: ctx.playlist, index: ctx.index });
          });
        } else {
          CM.playNow(path);
        }
      } },
      { label: '试听（不加入歌单）', action: function() {
        CM.previewTrack(track, path);
      } },
      { label: '下一首播放', icon: CM.icons.queue, action: function() {
        // queue.add 接受 tracks 数组（不是 index）
        var p = (ctx && ctx.playlist != null)
          ? CM.api('queue.add', { playlist: ctx.playlist, tracks: [ctx.index] })
          : CM.api('queue.addPaths', { paths: [path] });
        p.then(function(r) {
          if (r && r.success !== false) { CM.showToast('已加入播放队列', CM.trackName(track), 'success'); CM.refreshQueueBadge(); }
        });
      } },
      { label: '添加到歌单', icon: CM.icons.plus, action: function() {
        CM.showAddToPlaylistMenu(x, y, [path]);
      } },
      { divider: true },
      { isLabel: true, label: '评分' }
    ];
    // 星级评分行
    for (var s = 5; s >= 1; s--) {
      (function(stars) {
        items.push({
          html: '<span class="ctx-stars">' + '★'.repeat(stars) + '<span style="opacity:0.25">' + '★'.repeat(5 - stars) + '</span></span>',
          action: function() {
            CM.api('rating.set', { path: path, rating: stars }).then(function(r) {
              if (r && r.success !== false) {
                CM.showToast('已评分 ' + stars + ' 星', CM.trackName(track), 'success');
                if (path === CM.trackPath(CM.currentTrack)) CM.refreshLikeState();
              } else {
                CM.showToast('评分失败', '需要安装 foo_playcount 组件', 'error');
              }
            });
          }
        });
      })(s);
    }
    items.push({ label: '清除评分', action: function() {
      CM.api('rating.set', { path: path, rating: 0 }).then(function() {
        if (path === CM.trackPath(CM.currentTrack)) CM.refreshLikeState();
      });
    } });
    if (CM.state.previewActive) {
      items.push({ divider: true });
      items.push({ label: '停止试听', danger: true, action: function() {
        CM.stopPreview();
      } });
    }
    items.push({ divider: true });
    items.push({ label: '在资源管理器中显示', icon: CM.icons.folder, action: function() {
      CM.api('shell.showInExplorer', { path: path });
    } });
    items.push({ label: '编辑标签', icon: CM.icons.tag, action: function() {
      CM.showTagEditor(track);
    } });
    items.push({ label: '在线获取标签', icon: CM.icons.download, action: function() {
      CM.fetchTagsOnline(path);
    } });
    // 批量编辑入口（有多选时显示）
    if (ctx && ctx.playlist != null && state.batchSelected.size >= 2) {
      items.push({ divider: true });
      items.push({ label: '批量编辑标签（' + state.batchSelected.size + '首）', icon: CM.icons.tag, action: function() {
        var tracks = [];
        state.batchSelected.forEach(function(idx) {
          if (state.trackCache[idx]) tracks.push(state.trackCache[idx]);
        });
        if (tracks.length >= 2) CM.showBatchTagEditor(tracks);
      } });
    }
    if (ctx && ctx.playlist != null) {
      items.push({ divider: true });
      items.push({ label: '从歌单中删除', icon: CM.icons.trash, danger: true, action: function() {
        CM.api('playlist.removeTracks', { playlist: ctx.playlist, items: [ctx.index] });
      } });
    }
    CM.showCtxMenu(x, y, items);
  };

  /* ============================================
   * JIT 无痕试听（不改变播放列表）
   * ============================================ */
  CM.previewTrack = function(track, path) {
    if (!path) { CM.showToast('无法试听', '未找到文件路径', 'error'); return; }
    if (!CM._previewBound) {
      CM._previewBound = true;
      fb.on('jitQueue:listExhausted', function() { CM.state.previewActive = false; });
      fb.on('jitQueue:error', function() { CM.state.previewActive = false; });
    }
    var title = CM.trackName(track);
    CM.api('jitQueue.playNow', { title: title, trackId: path, url: path }).then(function(r) {
      if (r && r.success !== false) {
        CM.state.previewActive = true;
        CM.showToast('正在试听', title, 'success');
      } else {
        CM.showToast('试听失败', r && r.error ? r.error : '当前曲目可能无法试听', 'error');
      }
    });
  };
  CM.stopPreview = function() {
    CM.api('jitQueue.stop').then(function(r) {
      if (r && r.success !== false) {
        CM.state.previewActive = false;
        CM.showToast('已停止试听');
      }
    });
  };

  /* ============================================
   * 添加到歌单 — 弹出歌单选择菜单
   * paths: 要添加的文件路径数组
   * ============================================ */
  CM.showAddToPlaylistMenu = function(x, y, paths) {
    if (!paths || !paths.length) return;
    // 优先复用已缓存的歌单列表（loadPlaylists 已缓存至 CM.playlists），
    // 避免每次打开菜单都发起 playlist.getAll 请求；缓存为空时回退到 API
    var renderMenu = function(lists) {
      var items = [{ isLabel: true, label: '添加 ' + paths.length + ' 首到歌单' }];
      if (lists.length) {
        lists.forEach(function(pl) {
          var idx = pl.index !== undefined ? pl.index : null;
          if (idx === null || pl.locked || pl.isAutoplaylist) return;
          var name = pl.name || '未命名';
          var count = pl.trackCount != null ? pl.trackCount : (pl.itemCount != null ? pl.itemCount : '');
          items.push({
            label: name + (count ? ' (' + count + ')' : ''),
            action: function() {
              CM.api('playlist.addPathsAsync', { playlist: idx, paths: paths }).then(function(res) {
                if (res && res.success !== false) {
                  CM.showToast('已添加', paths.length + ' 首到「' + name + '」', 'success');
                } else {
                  CM.showToast('添加失败', res && res.error ? res.error : '歌单可能被锁定', 'error');
                }
              });
            }
          });
        });
      }
      items.push({ divider: true });
      items.push({ label: '新建歌单并添加', icon: CM.icons.plus, action: function() {
        CM.showModal({ title: '新建歌单', input: '', okText: '创建并添加' }).then(function(name) {
          if (!name) return;
          CM.api('playlist.create', { name: name }).then(function(cr) {
            if (cr && cr.success !== false && cr.index != null) {
              CM.api('playlist.addPathsAsync', { playlist: cr.index, paths: paths }).then(function() {
                CM.showToast('已创建并添加', name + ' · ' + paths.length + ' 首', 'success');
              });
            } else {
              CM.showToast('创建失败', '无法创建歌单', 'error');
            }
          });
        });
      } });
      CM.showCtxMenu(x, y, items);
    };
    if (CM.playlists && CM.playlists.length) {
      renderMenu(CM.playlists);
    } else {
      CM.api('playlist.getAll').then(function(r) {
        renderMenu(Array.isArray(r) ? r : ((r && r.playlists) || []));
      });
    }
  };

  /* ============================================
   * 批量封面（fb2k:// URL）
   * container 内查找 [data-path] 的 .art-slot 元素并填充
   * ============================================ */
  // 批量填充封面：分批请求避免大批量超时（每批 50 个）
  CM.fillArtworkBatch = function(container, maxSize) {
    var slots = container.querySelectorAll('[data-art-path]');
    if (!slots.length) return;
    var CHUNK = 50;
    function fillBatch(start) {
      var end = Math.min(start + CHUNK, slots.length);
      if (start >= end) return;
      var batchSlots = [], paths = [];
      for (var i = start; i < end; i++) {
        var s = slots[i];
        // 跳过已有封面的 slot（加载更多重渲染时避免重复请求）
        // 注意：IMG.src 属性在未设置时返回页面基址 URL（truthy），需用 getAttribute 判断
        if (s.style.backgroundImage || (s.tagName === 'IMG' && s.getAttribute('src'))) continue;
        batchSlots.push(s);
        paths.push(s.dataset.artPath);
      }
      if (!paths.length) { fillBatch(end); return; }
      CM.api('artwork.getFb2kUrlByPathBatch', { paths: paths, type: 'front', maxSize: maxSize || 160 }).then(function(r) {
        if (r && r.artworks) {
          r.artworks.forEach(function(entry, i) {
            var el = batchSlots[i];
            if (!el || !entry) return;
            var url = entry.dataUrl || entry.url;
            if (entry.success !== false && url) {
              if (el.tagName === 'IMG') { el.src = url; el.classList.remove('ph'); el.innerHTML = ''; }
              else { el.style.backgroundImage = 'url("' + url + '")'; el.innerHTML = ''; }
            }
          });
        }
        fillBatch(end);
      });
    }
    fillBatch(0);
  };

  /* ============================================
   * 发现页
   * ============================================ */
  CM.renderDiscover = function() {
    var d = new Date();
    var week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    els.heroDate.textContent = d.getFullYear() + ' / ' + (d.getMonth() + 1) + ' / ' + d.getDate() + ' ' + week[d.getDay()];
    CM.renderDiscoverAlbums();
    CM.renderDiscoverRecent();
    CM.renderDiscoverRandom();
  };

  CM.renderDiscoverAlbums = function() {
    els.discoverAlbums.innerHTML = CM.loadingHTML('加载中...', 'grid-column:1/-1');
    // 不传 includeCover 避免阻塞 UI（getAlbums+cover 耗时 1000ms+）；改用 fillArtworkBatch 懒加载
    CM.api('library.getAlbums', { limit: 200 }).then(function(r) {
      if (!r || r.success === false) {
        els.discoverAlbums.innerHTML = '<div class="section-error" style="grid-column:1/-1">' + CM.icons.error + '<span>媒体库不可用</span></div>';
        return;
      }
      var albums = r.albums || [];
      if (!albums.length) {
        els.discoverAlbums.innerHTML = CM.emptyHTML('媒体库为空，请在 foobar2000 中添加音乐文件夹', null, 'grid-column:1/-1');
        return;
      }
      // Fisher-Yates 洗牌取前12
      for (var i = albums.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = albums[i]; albums[i] = albums[j]; albums[j] = tmp;
      }
      albums = albums.slice(0, 12);
      var parts = [];
      albums.forEach(function(al) {
        parts.push(CM._renderAlbumCard(al));
      });
      els.discoverAlbums.innerHTML = parts.join('');
      // 异步批量加载封面（不阻塞 UI）：先取每张专辑首曲路径，再批量请求封面
      CM._loadAlbumCovers(els.discoverAlbums, albums, 320);
      CM._bindAlbumCards(els.discoverAlbums);
    });
  };

  // 专辑卡片渲染（复用：发现页 + 媒体库全部专辑）
  // 不含封面数据；封面通过 _loadAlbumCovers 异步批量加载
  CM._renderAlbumCard = function(al) {
    return '<div class="album-card fade-in" data-album="' + esc(al.name || al.album || '') + '" data-artist="' + esc(al.artist || al.albumArtist || '') + '">' +
      '<div class="album-card-art">' +
      '<div class="art-placeholder">' + CM.icons.note + '</div>' +
      '<div class="album-card-play">' + CM.icons.play + '</div>' +
      '</div>' +
      '<div class="album-card-name">' + esc(al.name || al.album || '未知专辑') + '</div>' +
      '<div class="album-card-artist">' + esc(al.artist || al.albumArtist || '未知艺术家') + '</div>' +
      '</div>';
  };

  // 主内容区统一事件委托（专辑卡片 / dc-track / 搜索结果）
  // 一次性绑定在 els.mainContent 上，所有子元素动态渲染后自动生效
  var _mainContentDelegated = false;
  function ensureMainContentDelegation() {
    if (_mainContentDelegated) return;
    _mainContentDelegated = true;
    // 专辑卡片：播放按钮 + 点击进详情
    els.mainContent.addEventListener('click', function(e) {
      var playBtn = e.target.closest('.album-card-play');
      if (playBtn) {
        e.stopPropagation();
        var card = playBtn.closest('.album-card');
        if (card) CM.playAlbum(card.dataset.album, card.dataset.artist);
        return;
      }
      var card = e.target.closest('.album-card');
      if (card) CM.openLibraryAlbum(card.dataset.album, card.dataset.artist);
    });
    // dc-track / search-result-item：双击播放 + 右键菜单
    els.mainContent.addEventListener('dblclick', function(e) {
      var el = e.target.closest('.dc-track[data-path], .search-result-item[data-path]');
      if (!el) return;
      CM.playNow(el.dataset.path);
    });
    els.mainContent.addEventListener('contextmenu', function(e) {
      var el = e.target.closest('.dc-track[data-path], .search-result-item[data-path]');
      if (!el) return;
      e.preventDefault();
      // 从 DOM 构造最小 track 对象（showTrackCtxMenu 只需 path + title）
      var path = el.dataset.path;
      var titleEl = el.querySelector('.dc-track-title, .search-result-title');
      CM.showTrackCtxMenu(e.clientX, e.clientY, { absolutePath: path, title: titleEl ? titleEl.textContent : '' });
    });
  }

  // 专辑卡片事件委托（实际由 ensureMainContentDelegation 统一处理，保留空函数兼容旧调用）
  CM._bindAlbumCards = function(container) {
    ensureMainContentDelegation();
  };

  // 批量加载专辑封面：对每张专辑取首曲路径，再批量请求封面
  // 分批处理（每批24张），避免一次性发起过多 API 调用
  CM._loadAlbumCovers = function(container, albums, maxSize) {
    if (!albums || !albums.length) return;
    var cards = container.querySelectorAll('.album-card');
    if (!cards.length) return;
    var CHUNK = 24;
    function processChunk(start) {
      var slice = albums.slice(start, start + CHUNK);
      if (!slice.length) return;
      var promises = slice.map(function(al, i) {
        var name = al.name || al.album || '';
        var artist = al.artist || al.albumArtist || undefined;
        if (!name) return Promise.resolve(null);
        return CM.api('library.getAlbumTracks', { album: name, artist: artist, limit: 1 }).then(function(r) {
          if (!r) return null;
          var tracks = CM.respTracks(r);
          if (!tracks.length) return null;
          return { index: start + i, path: CM.trackPath(tracks[0]) };
        });
      });
      Promise.all(promises).then(function(results) {
        // 仅保留有 path 的结果，保证 valid 与 paths 一一对应（修复封面错位）
        var valid = [];
        results.forEach(function(v) { if (v && v.path) valid.push(v); });
        if (!valid.length) { processChunk(start + CHUNK); return; }
        var paths = valid.map(function(v) { return v.path; });
        CM.api('artwork.getFb2kUrlByPathBatch', { paths: paths, type: 'front', maxSize: maxSize || 320 }).then(function(r) {
          if (r && r.artworks) {
            r.artworks.forEach(function(entry, i) {
              if (!entry || !valid[i]) return;
              var card = cards[valid[i].index];
              if (!card) return;
              var url = entry.dataUrl || entry.url;
              var artEl = card.querySelector('.art-placeholder');
              if (entry.success !== false && url && artEl) {
                artEl.style.backgroundImage = 'url("' + url + '")';
                artEl.innerHTML = '';
              }
            });
          }
          processChunk(start + CHUNK);
        });
      });
    }
    processChunk(0);
  };

  CM.playAlbum = function(album, artist) {
    CM.showToast('正在加载', '正在获取专辑「' + album + '」...', null);
    CM.api('library.getAlbumTracks', { album: album, artist: artist || undefined }).then(function(r) {
      var tracks = CM.respTracks(r);
      if (!tracks.length) { CM.showToast('无法播放', '未找到专辑曲目', 'error'); return; }
      CM.playAllTracks(tracks, '专辑 ' + album);
    });
  };

  // 打开专辑详情视图（媒体库下钻）
  CM.openLibraryAlbum = function(album, artist) {
    CM.openLibraryDetail('album', { album: album, artist: artist });
  };

  // 通用媒体库下钻导航（切换到媒体库标签页并设置视图）
  CM.openLibraryDetail = function(view, arg) {
    // 进入下钻详情前保存列表滚动位置，返回时恢复
    state.libScrollTop = els.libraryDetail.scrollTop;
    state.libraryView = view;
    state.libraryArg = arg;
    if (state.currentTab === 'library') {
      CM.renderLibrary();
    } else {
      CM.switchTab('library'); // switchTab 内部会调用 renderLibrary()
    }
  };

  /* 单曲即时播放：加入队列顶部并播放下一首（队列消费模型，不修改歌单）
   * 队列为空时直接 add+next；非空时 add 到末尾再 moveToTop，保证双击曲目立即播放 */
  CM.playNow = function(path) {
    if (!path) return;
    // 先停掉 JIT 无痕试听，避免与正常播放同时输出（两首一起播）
    CM.stopPreviewIfActive().then(function() {
      CM.api('queue.getCount').then(function(r) {
        var insertIdx = CM.respCount(r);
        CM.api('queue.addPaths', { paths: [path] }).then(function(r) {
          if (!r || r.success === false) {
            CM.api('playback.playPath', { path: path });
            return;
          }
          if (insertIdx > 0) {
            // 队列非空：将新曲目移到队首，再播放下一首
            CM.api('queue.moveToTop', { index: insertIdx }).then(function() {
              CM.api('playback.next');
            });
          } else {
            // 队列为空：新曲目已在队首
            CM.api('playback.next');
          }
        });
      });
    });
  };

  CM.renderTrackRows = function(container, tracks, emptyText, startIdx) {
    if (!tracks.length) {
      container.innerHTML = CM.emptyHTML(emptyText);
      return;
    }
    startIdx = startIdx || 0;
    var curPath = CM.trackPath(CM.currentTrack);
    var parts = [];
    tracks.forEach(function(t, i) {
      var p = CM.trackPath(t);
      parts.push(
        '<div class="dc-track fade-in' + (curPath && p === curPath ? ' playing' : '') + '" data-path="' + esc(p) + '" data-i="' + (startIdx + i) + '">' +
        '<span class="dc-track-idx">' + (startIdx + i + 1) + '</span>' +
        '<div class="dc-track-art ph" data-art-path="' + esc(p) + '">' + CM.icons.note + '</div>' +
        '<div class="dc-track-info">' +
        '<div class="dc-track-title">' + esc(CM.trackName(t)) + '</div>' +
        '<div class="dc-track-sub">' + esc(CM.trackArtist(t)) + (t.album ? ' · ' + esc(t.album) : '') + '</div>' +
        '</div>' +
        '<span class="dc-track-dur">' + CM.formatTime(t.duration) + '</span>' +
        '</div>'
      );
    });
    container.innerHTML = parts.join('');
    // 登记本次渲染标记的播放行，供 refreshPlayingMarks 切换时清除（避免旧行残留高亮）
    if (curPath) {
      var _dc = container.querySelector('.dc-track.playing');
      if (_dc) CM._lastPlayingDc = _dc;
    }
    CM.fillArtworkBatch(container, 120);
    ensureMainContentDelegation(); // 事件由 mainContent 统一委托
  };

  CM.renderDiscoverRecent = function() {
    els.discoverRecent.innerHTML = CM.loadingHTML();
    CM.api('library.getRecentlyAdded', { limit: 8 }).then(function(r) {
      CM.renderTrackRows(els.discoverRecent, (r && r.tracks) || [], '暂无最近添加的曲目');
    });
  };

  CM.renderDiscoverRandom = function() {
    els.discoverRandom.innerHTML = CM.loadingHTML();
    CM.api('library.getRandomTracks', { count: 10 }).then(function(r) {
      CM.renderTrackRows(els.discoverRandom, (r && r.tracks) || [], '媒体库为空');
    });
  };

  // 每日推荐：随机 30 首，原子替换播放列表并播放
  CM.playDaily = function() {
    els.btnPlayDaily.disabled = true;
    els.btnPlayDaily.querySelector('span').textContent = '加载中...';
    CM.api('library.getRandomTracks', { count: 30 }).then(function(r) {
      var tracks = (r && r.tracks) || [];
      if (!tracks.length) { CM.showToast('媒体库为空', '请先在 foobar2000 中配置媒体库', 'error'); resetBtn(); return; }
      CM.playAllTracks(tracks, '每日推荐', function(ok) {
        resetBtn();
        if (ok) CM.showToast('每日推荐', '已加载 ' + tracks.length + ' 首并开始播放', 'success');
      });
    });
    function resetBtn() {
      els.btnPlayDaily.disabled = false;
      els.btnPlayDaily.querySelector('span').textContent = '播放全部';
    }
  };

  /* ============================================
   * 媒体库
   * ============================================ */
  var LIB_NODES = [
    { id: 'stats', name: '概览', icon: CM.icons.info },
    { id: 'tracks', name: '歌曲', icon: '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>' },
    { id: 'artists', name: '艺术家', icon: '<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' },
    { id: 'albums', name: '专辑', icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>' },
    { id: 'genres', name: '流派', icon: '<svg viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>' },
    { id: 'folders', name: '文件夹', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>' }
  ];

  // 媒体库树节点缓存 + 事件委托（避免每次 renderLibrary 都 querySelectorAll + 逐节点绑事件）
  var _libTreeNodes = null;
  var _libTreeDelegated = false;
  CM.renderLibrary = function() {
    if (!_libTreeNodes) {
      var html = '';
      LIB_NODES.forEach(function(n) {
        html += '<div class="tree-node' + (state.libraryView === n.id ? ' active' : '') + '" data-view="' + n.id + '">' + n.icon + '<span>' + n.name + '</span></div>';
      });
      els.libraryTree.innerHTML = html;
      _libTreeNodes = els.libraryTree.querySelectorAll('.tree-node');
    }
    // 事件委托：一次性绑定在 libraryTree 上
    if (!_libTreeDelegated) {
      _libTreeDelegated = true;
      els.libraryTree.addEventListener('click', function(e) {
        var el = e.target.closest('.tree-node');
        if (!el) return;
        state.libraryView = el.dataset.view;
        state.libraryArg = null;
        CM.renderLibrary();
      });
    }
    // 后续切换只更新 active 状态，无需 querySelectorAll
    _libTreeNodes.forEach(function(el) {
      var v = state.libraryView === 'folder' ? 'folders' : state.libraryView;
      el.classList.toggle('active', el.dataset.view === v);
    });
    var view = state.libraryView;
    if (view === 'stats') CM.renderLibraryStats();
    else if (view === 'tracks') CM.renderLibraryTracks();
    else if (view === 'artists') CM.renderLibraryArtists();
    else if (view === 'albums') CM.renderLibraryAlbums();
    else if (view === 'genres') CM.renderLibraryGenres();
    else if (view === 'artist') CM.renderLibraryArtistDetail(state.libraryArg);
    else if (view === 'album') CM.renderLibraryAlbumDetail(state.libraryArg);
    else if (view === 'genre') CM.renderLibraryGenreDetail(state.libraryArg);
    else if (view === 'folders') CM.renderLibraryFolders();
    else if (view === 'folder') CM.renderLibraryFolder(state.libraryArg);
  };

  CM.libLoading = function() {
    els.libraryDetail.innerHTML = CM.loadingHTML();
  };
  // 延迟加载指示器：API 快速返回（<150ms）时不闪烁，保留旧内容
  // 返回一个 cancel 函数，在 API 回调中调用以取消转圈
  CM.libLoadingDelayed = function() {
    var timer = setTimeout(function() {
      els.libraryDetail.innerHTML = CM.loadingHTML();
    }, 150);
    return function() { clearTimeout(timer); };
  };
  // 内容淡入：同步 reflow 模式，避免 innerHTML 后内容先以 opacity:1 渲染再变透明导致的闪烁
  // 原理：add(lib-transparent) 瞬间隐藏 → reflow 记录状态 → remove 触发 transition
  CM.libFadeIn = function() {
    var el = els.libraryDetail;
    el.classList.add('lib-transparent');
    void el.offsetHeight; // 强制 reflow，确保浏览器记录 opacity:0
    el.classList.remove('lib-transparent'); // 恢复，触发 0.2s transition
  };
  CM.libError = function(retry) {
    els.libraryDetail.innerHTML = '<div class="section-error">' + CM.icons.error + '<span>加载失败，媒体库可能未就绪</span><button class="retry-btn">重试</button></div>';
    var btn = els.libraryDetail.querySelector('.retry-btn');
    if (btn && retry) btn.addEventListener('click', retry);
  };
  // 从下钻详情返回列表时恢复滚动位置（专辑/艺术家/流派网格通用）
  CM._restoreLibScroll = function() {
    if (state.libScrollRestore) {
      state.libScrollRestore = false;
      els.libraryDetail.scrollTop = state.libScrollTop || 0;
    }
  };

  CM.renderLibraryStats = function() {
    var cancelLoading = CM.libLoadingDelayed();
    CM.api('library.getStats').then(function(r) {
      cancelLoading();
      if (!r || r.success === false) { CM.libError(CM.renderLibraryStats); return; }
      var durText = '';
      var totalSec = r.totalDuration || 0;
      if (totalSec >= 3600) durText = (totalSec / 3600).toFixed(1) + ' 小时';
      else durText = Math.round(totalSec / 60) + ' 分钟';
      els.libraryDetail.innerHTML =
        '<div class="library-stats">' +
        '<div class="stat-card"><div class="stat-value">' + (r.totalTracks || 0) + '</div><div class="stat-label">曲目</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + (r.totalAlbums || 0) + '</div><div class="stat-label">专辑</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + (r.totalArtists || 0) + '</div><div class="stat-label">艺术家</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + durText + '</div><div class="stat-label">总时长</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + CM.formatSize(r.totalSize) + '</div><div class="stat-label">总大小</div></div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:12px;margin:18px 0 14px">' +
        '<div class="library-section-title" style="margin:0">最近添加</div>' +
        '<button class="pl-btn" id="libAddAllBtn" style="margin-left:auto">' +
        '<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>添加全部到歌单</span></button>' +
        '</div>' +
        '<div class="dc-tracklist" id="libRecentRows"></div>';
      CM.libFadeIn();
      var addAllBtn = CM.$('libAddAllBtn');
      if (addAllBtn) {
        var resetAddAllBtn = function() {
          addAllBtn.disabled = false;
          addAllBtn.querySelector('span').textContent = '添加全部到歌单';
        };
        addAllBtn.addEventListener('click', function(e) {
          addAllBtn.disabled = true;
          addAllBtn.querySelector('span').textContent = '加载曲目中...';
          CM.api('library.getCount').then(function(cr) {
            if (!cr) { resetAddAllBtn(); CM.showToast('加载失败', null, 'error'); return; }
            var total = (cr.count != null ? cr.count : cr.total) || 0;
            if (!total) { resetAddAllBtn(); CM.showToast('媒体库为空', null, 'error'); return; }
            var pageSize = 2000, collected = [], pos = 0;
            function fetchPage() {
              CM.api('library.getAll', { start: pos, count: Math.min(pageSize, total - pos) }).then(function(pr) {
                if (!pr) { resetAddAllBtn(); CM.showToast('加载失败', null, 'error'); return; }
                var batch = CM.respTracks(pr);
                collected = collected.concat(batch);
                pos += batch.length;
                if (pos < total && batch.length > 0) { fetchPage(); return; }
                resetAddAllBtn();
                var paths = CM.trackPaths(collected);
                if (!paths.length) { CM.showToast('未找到曲目路径', null, 'error'); return; }
                CM.showAddToPlaylistMenu(e.clientX, e.clientY, paths);
              });
            }
            fetchPage();
          });
        });
      }
      CM.api('library.getRecentlyAdded', { limit: 10 }).then(function(rr) {
        var box = CM.$('libRecentRows');
        if (box) CM.renderTrackRows(box, (rr && rr.tracks) || [], '暂无曲目');
      });
    });
  };

  // 通用卡片网格渲染（艺术家 / 流派共用；传入 pageKey 则启用客户端分页）
  CM._renderLibraryGrid = function(apiMethod, apiParams, title, emptyText, cardRenderer, pageKey) {
    var cancelLoading = CM.libLoadingDelayed();
    CM.api(apiMethod, apiParams).then(function(r) {
      cancelLoading();
      if (!r || r.success === false) { CM.libError(function() { CM._renderLibraryGrid(apiMethod, apiParams, title, emptyText, cardRenderer, pageKey); }); return; }
      var items = r.items || r.artists || r.genres || [];
      if (!items.length) { els.libraryDetail.innerHTML = CM.emptyHTML(emptyText); return; }
      if (pageKey) {
        els.libraryDetail.innerHTML = CM._pagerBarHtml('libGrid', title, items.length) + '<div class="artist-grid" id="libGridRows"></div>';
        CM._bindPager('libGrid', items.length, pageKey, function(start, size) {
          var box = CM.$('libGridRows');
          if (!box) return;
          var parts = [];
          items.slice(start, start + size).forEach(function(a) {
            var name = typeof a === 'string' ? a : (a.name || a.artist || a.genre || '');
            var count = typeof a === 'object' ? (a.trackCount || a.count || '') : '';
            if (!name) return;
            parts.push(cardRenderer(name, count));
          });
          box.innerHTML = parts.join('');
        });
      } else {
        var parts = ['<div class="library-section-title" style="margin-top:0">' + title + '（' + items.length + '）</div><div class="artist-grid">'];
        items.forEach(function(a) {
          var name = typeof a === 'string' ? a : (a.name || a.artist || a.genre || '');
          var count = typeof a === 'object' ? (a.trackCount || a.count || '') : '';
          if (!name) return;
          parts.push(cardRenderer(name, count));
        });
        parts.push('</div>');
        els.libraryDetail.innerHTML = parts.join('');
      }
      CM.libFadeIn();
      CM._restoreLibScroll();
    });
  };

  // 媒体库详情区事件委托（艺术家/流派卡片点击，一次性绑定避免每次渲染都逐卡 attach）
  var _libDetailDelegated = false;
  function ensureLibDetailDelegation() {
    if (_libDetailDelegated) return;
    _libDetailDelegated = true;
    els.libraryDetail.addEventListener('click', function(e) {
      var card = e.target.closest('.artist-card');
      if (!card) return;
      if (card.dataset.artist) CM.openLibraryDetail('artist', card.dataset.artist);
      else if (card.dataset.genre) CM.openLibraryDetail('genre', card.dataset.genre);
    });
  }

  CM.renderLibraryArtists = function() {
    ensureLibDetailDelegation();
    CM._renderLibraryGrid('library.getArtists', { limit: 1000000 }, '全部艺术家', '媒体库为空',
      function(name, count) {
        return '<div class="artist-card" data-artist="' + esc(name) + '">' +
          '<div class="artist-avatar">' + esc(name.charAt(0).toUpperCase()) + '</div>' +
          '<div class="artist-name">' + esc(name) + '</div>' +
          (count ? '<div class="artist-meta">' + count + ' 首曲目</div>' : '') +
          '</div>';
      },
      'artists'
    );
  };

  // 全部歌曲视图：自动分页加载全部曲目
  CM.renderLibraryTracks = function() {
    state.libraryBack = 'stats';
    var cancelLoading = CM.libLoadingDelayed();
    CM.api('library.getCount').then(function(cr) {
      var total = CM.respCount(cr);
      if (!total) { cancelLoading(); els.libraryDetail.innerHTML = CM.emptyHTML('媒体库为空'); return; }
      var PAGE = 500;
      var all = [];
      var offset = 0;
      var loadPage = function() {
        CM.api('library.getAll', { start: offset, count: Math.min(PAGE, total - offset) }).then(function(r) {
          if (!r || r.success === false) {
            cancelLoading();
            if (!all.length) CM.libError(CM.renderLibraryTracks);
            return;
          }
          var batch = CM.respTracks(r);
          all = all.concat(batch);
          offset += batch.length;
          if (batch.length > 0 && offset < total) {
            loadPage();
          } else {
            cancelLoading();
            CM.renderLibraryDrill('全部歌曲', total + ' 首曲目', all, { pageSizes: LIB_PAGE_SIZES, pageKey: 'songTracks' });
            CM.libFadeIn();
            // 追加"刷新媒体库"按钮
            var btnBar = CM.$('libAddToPlBtn');
            var btnParent = btnBar ? btnBar.parentElement : null;
            if (btnParent) {
              var refBtn = document.createElement('button');
              refBtn.className = 'pl-btn';
              refBtn.innerHTML = CM.icons.refresh + '<span>刷新媒体库</span>';
              btnParent.insertBefore(refBtn, btnParent.firstChild);
              refBtn.addEventListener('click', function() {
                refBtn.disabled = true;
                refBtn.querySelector('span').textContent = '扫描中...';
                CM.api('library.refresh').then(function(res) {
                  if (res && res.success !== false) {
                    CM.showToast('媒体库已刷新', '正在重新加载歌曲列表', 'success');
                    CM.renderLibraryTracks();
                  } else {
                    CM.showToast('刷新失败', null, 'error');
                    refBtn.disabled = false;
                    refBtn.querySelector('span').textContent = '刷新媒体库';
                  }
                });
              });
            }
          }
        });
      };
      loadPage();
    });
  };

  /* 媒体库客户端分页（专辑/艺术家/流派共用）：全量拉取后按页渲染，页尺寸可切、页码记忆 */
  var LIB_PAGE_SIZES = [50, 100, 300, 500];
  CM._libPageSize = function() {
    var n = parseInt(state.libPageSize, 10) || 50;
    return LIB_PAGE_SIZES.indexOf(n) >= 0 ? n : 50;
  };
  // 媒体库浮动分页栏（sticky 吸顶）：标题+数量徽标 + 每页尺寸 + 上一页/页码/下一页
  CM._pagerBarHtml = function(prefix, title, total) {
    var pageSize = CM._libPageSize();
    var sizeOpts = LIB_PAGE_SIZES.map(function(n) {
      return '<option value="' + n + '"' + (n === pageSize ? ' selected' : '') + '>' + n + '</option>';
    }).join('');
    var head = title
      ? '<div class="lib-page-title">' + esc(title) + '</div>' +
        '<span class="lib-page-count">' + total + '</span>'
      : '';
    return '<div class="lib-pager">' + head +
      '<div class="lib-pager-controls">' +
      '<span class="lib-page-label">每页</span>' +
      '<select class="lib-page-size" id="' + prefix + 'PageSize">' + sizeOpts + '</select>' +
      '<div class="lib-page-nav">' +
      '<button class="lib-page-btn" id="' + prefix + 'Prev" type="button">' +
      '<svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg><span>上一页</span></button>' +
      '<span class="lib-page-info" id="' + prefix + 'PageInfo"></span>' +
      '<button class="lib-page-btn" id="' + prefix + 'Next" type="button">' +
      '<span>下一页</span><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></button>' +
      '</div></div></div>';
  };
  CM._bindPager = function(prefix, total, pageKey, onPage) {
    if (!state.libPages) state.libPages = {};
    var pageSize = CM._libPageSize();
    var page = state.libPages[pageKey] || 1;
    var renderPage = function(scrollTop) {
      var totalPages = Math.max(1, Math.ceil((total || 0) / pageSize));
      if (page > totalPages) page = totalPages;
      if (page < 1) page = 1;
      state.libPages[pageKey] = page;
      state.libPageSize = pageSize;
      var start = (page - 1) * pageSize;
      onPage(start, pageSize, page, totalPages);
      var info = CM.$(prefix + 'PageInfo');
      if (info) info.textContent = page + ' / ' + totalPages;
      var prev = CM.$(prefix + 'Prev');
      var next = CM.$(prefix + 'Next');
      if (prev) prev.disabled = page <= 1;
      if (next) next.disabled = page >= totalPages;
      if (scrollTop) els.libraryDetail.scrollTop = 0;
    };
    var sizeEl = CM.$(prefix + 'PageSize');
    if (sizeEl) {
      sizeEl.addEventListener('change', function() {
        pageSize = parseInt(sizeEl.value, 10) || LIB_PAGE_SIZES[0];
        page = 1;
        renderPage(true);
      });
    }
    var prevBtn = CM.$(prefix + 'Prev');
    var nextBtn = CM.$(prefix + 'Next');
    if (prevBtn) prevBtn.addEventListener('click', function() { if (page > 1) { page--; renderPage(true); } });
    if (nextBtn) nextBtn.addEventListener('click', function() {
      if (page < Math.ceil(total / pageSize)) { page++; renderPage(true); }
    });
    renderPage(false);
  };

  CM.renderLibraryAlbums = function() {
    var cancelLoading = CM.libLoadingDelayed();
    // 全量拉取专辑（解除 limit:200 上限），客户端分页渲染
    CM.api('library.getAlbums', { limit: 1000000 }).then(function(r) {
      cancelLoading();
      if (!r || r.success === false) { CM.libError(CM.renderLibraryAlbums); return; }
      var albums = r.albums || [];
      if (!albums.length) { els.libraryDetail.innerHTML = CM.emptyHTML('媒体库为空'); return; }
      els.libraryDetail.innerHTML = CM._pagerBarHtml('libAlbum', '全部专辑', albums.length) +
        '<div class="album-grid" id="libAlbumRows"></div>';
      CM._bindPager('libAlbum', albums.length, 'albums', function(start, size) {
        var box = CM.$('libAlbumRows');
        if (!box) return;
        var slice = albums.slice(start, start + size);
        var parts = [];
        slice.forEach(function(al) { parts.push(CM._renderAlbumCard(al)); });
        box.innerHTML = parts.join('');
        // 异步批量加载封面：并行获取每张专辑首曲路径，再批量请求封面
        CM._loadAlbumCovers(box, slice, 320);
        CM._bindAlbumCards(box);
      });
      CM.libFadeIn();
      CM._restoreLibScroll();
    });
  };

  CM.renderLibraryGenres = function() {
    ensureLibDetailDelegation();
    CM._renderLibraryGrid('library.getGenres', { limit: 1000000 }, '全部流派', '暂无流派信息',
      function(name, count) {
        return '<div class="artist-card" data-genre="' + esc(name) + '">' +
          '<div class="artist-avatar">♪</div>' +
          '<div class="artist-name">' + esc(name) + '</div>' +
          (count ? '<div class="artist-meta">' + count + ' 首曲目</div>' : '') +
          '</div>';
      },
      'genres'
    );
  };

  // 文件夹图标（与左侧树节点保持一致）
  var FOLDER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';

  // 文件夹卡片渲染（根目录 + 子目录共用）
  // root 结构: { id, displayName, absolutePath, trackCount }
  // dir 结构:  { pathId, displayName/name, trackCount }（rootId 由调用方 parentRootId 传入）
  CM._renderFolderCard = function(folder, parentRootId) {
    var name = folder.displayName || folder.name || folder.title || folder.path || '未命名文件夹';
    var rootId = '';
    var pathId = '';
    var isRoot = folder.pathId === undefined && folder.id !== undefined;
    if (isRoot) {
      rootId = folder.id || folder.rootId || '';
      pathId = '';
    } else {
      rootId = parentRootId || folder.rootId || '';
      pathId = folder.pathId || folder.path_id || '';
    }
    var sub = folder.absolutePath || folder.path || folder.relativePath || '';
    var count = folder.trackCount || folder.count || 0;
    return '<div class="artist-card folder-card" data-root-id="' + esc(rootId) + '" data-path-id="' + esc(pathId) + '" data-folder-name="' + esc(name) + '">' +
      '<div class="artist-avatar">' + FOLDER_ICON + '</div>' +
      '<div class="artist-name">' + esc(name) + '</div>' +
      (sub ? '<div class="artist-meta">' + esc(sub) + '</div>' : '') +
      '</div>';
  };

  CM._pushFolderTrail = function(rootId, pathId, name) {
    rootId = rootId || '';
    pathId = pathId || '';
    var trail = (state.libFolderTrail || []).slice();
    var idx = -1;
    for (var i = 0; i < trail.length; i++) {
      if (trail[i].rootId === rootId && (trail[i].pathId || '') === pathId) {
        idx = i;
        break;
      }
    }
    if (idx >= 0) {
      if (name) trail[idx].name = name;
      state.libFolderTrail = trail.slice(0, idx + 1);
      return;
    }
    if (trail.length && trail[0].rootId !== rootId) trail = [];
    var last = trail[trail.length - 1];
    var isChild = !trail.length || (last && last.rootId === rootId && (
      !(last.pathId || '') ? !!pathId : pathId.indexOf(last.pathId + '/') === 0
    ));
    if (!isChild) {
      var rootName = (trail[0] && trail[0].name) || (!pathId ? name : '') || '根目录';
      trail = [{ rootId: rootId, pathId: '', name: rootName }];
      if (pathId) {
        var acc = [];
        pathId.split('/').filter(Boolean).forEach(function(part, n, arr) {
          acc.push(part);
          trail.push({
            rootId: rootId,
            pathId: acc.join('/'),
            name: n === arr.length - 1 ? (name || part) : part
          });
        });
      }
      state.libFolderTrail = trail;
      return;
    }
    trail.push({
      rootId: rootId,
      pathId: pathId,
      name: name || (pathId.split('/').pop()) || '文件夹'
    });
    state.libFolderTrail = trail;
  };

  CM._folderCrumbHtml = function() {
    var trail = state.libFolderTrail || [];
    var parts = ['<span class="lib-crumb" data-crumb="0" style="cursor:pointer">文件夹</span>'];
    trail.forEach(function(item, i) {
      var isLast = i === trail.length - 1;
      parts.push('<span style="opacity:0.4;margin:0 6px">/</span>');
      if (isLast) {
        parts.push('<span style="color:var(--text-1)">' + esc(item.name || '') + '</span>');
      } else {
        parts.push('<span class="lib-crumb" data-crumb="' + (i + 1) + '" style="cursor:pointer">' + esc(item.name || '') + '</span>');
      }
    });
    return parts.join('');
  };

  CM._goFolderCrumb = function(index) {
    if (index <= 0) {
      state.libraryView = 'folders';
      state.libraryArg = null;
      state.libFolderTrail = [];
      state.libScrollRestore = true;
      CM.renderLibrary();
      return;
    }
    var trail = state.libFolderTrail || [];
    var target = trail[index - 1];
    if (!target) return;
    state.libFolderTrail = trail.slice(0, index);
    CM.openLibraryDetail('folder', { rootId: target.rootId, pathId: target.pathId || '' });
  };

  CM._folderGoBack = function() {
    var trail = state.libFolderTrail || [];
    CM._goFolderCrumb(trail.length <= 1 ? 0 : trail.length - 1);
  };

  CM._openLibraryFolder = function(rootId, pathId, name) {
    CM._pushFolderTrail(rootId, pathId, name);
    CM.openLibraryDetail('folder', { rootId: rootId || '', pathId: pathId || '' });
  };

  var _folderDelegated = false;
  function ensureFolderDelegation() {
    if (_folderDelegated) return;
    _folderDelegated = true;
    els.libraryDetail.addEventListener('click', function(e) {
      var crumb = e.target.closest('.lib-crumb');
      if (crumb) {
        CM._goFolderCrumb(parseInt(crumb.dataset.crumb, 10) || 0);
        return;
      }
      var card = e.target.closest('.folder-card');
      if (!card) return;
      CM._openLibraryFolder(card.dataset.rootId, card.dataset.pathId, card.dataset.folderName);
    });
  }

  // 文件夹视图：列出媒体库根目录
  CM.renderLibraryFolders = function() {
    ensureFolderDelegation();
    state.libraryBack = 'stats';
    var cancelLoading = CM.libLoadingDelayed();
    CM.api('library.getRoots').then(function(r) {
      cancelLoading();
      if (!r || r.success === false) { CM.libError(CM.renderLibraryFolders); return; }
      var roots = r.roots || r.items || r.directories || [];
      if (!roots.length) { els.libraryDetail.innerHTML = CM.emptyHTML('媒体库未配置文件夹'); return; }
      var parts = ['<div class="library-section-title" style="margin-top:0">媒体库文件夹（' + roots.length + '）</div><div class="artist-grid">'];
      roots.forEach(function(root) {
        parts.push(CM._renderFolderCard(root));
      });
      parts.push('</div>');
      els.libraryDetail.innerHTML = parts.join('');
      CM.libFadeIn();
      CM._restoreLibScroll();
    });
  };

  // 文件夹详情：面包屑导航 + 子文件夹网格 + 分页曲目 + 播放全部/添加到歌单
  CM.renderLibraryFolder = function(arg) {
    ensureFolderDelegation();
    arg = arg || {};
    var rootId = arg.rootId || '';
    var pathId = arg.pathId || '';
    if (!state.libFolderTrail || !state.libFolderTrail.length) {
      CM._pushFolderTrail(rootId, pathId, pathId ? pathId.split('/').pop() : '');
    }
    state.libraryBack = 'folders';
    var cancelLoading = CM.libLoadingDelayed();
    CM.api('library.browseTree', { rootId: rootId, pathId: pathId, includeFiles: true, recursiveFiles: false }).then(function(r) {
      cancelLoading();
      if (!r || r.success === false) { CM.libError(function() { CM.renderLibraryFolder(arg); }); return; }
      var dirs = r.directories || r.dirs || [];
      var files = r.files || r.tracks || [];
      var trail = state.libFolderTrail || [];
      var title = (trail.length && trail[trail.length - 1].name) || (pathId ? pathId.split('/').pop() : '文件夹');
      if (!dirs.length && !files.length) {
        els.libraryDetail.innerHTML =
          '<div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">' +
          '<button class="retry-btn" id="libBackBtn">← 返回</button>' +
          '<div><div class="library-section-title" style="margin:0">' + CM._folderCrumbHtml() + '</div></div></div>' +
          CM.emptyHTML('此文件夹为空');
        CM.$('libBackBtn').addEventListener('click', CM._folderGoBack);
        return;
      }
      var folderKey = rootId + '::' + pathId;
      if (state.libFolderKey !== folderKey) {
        state.libFolderKey = folderKey;
        if (!state.libPages) state.libPages = {};
        state.libPages.folder = 1;
      }
      var extraHtml = '';
      if (dirs.length) {
        extraHtml = '<div class="library-section-title">子文件夹（' + dirs.length + '）</div><div class="artist-grid">';
        dirs.forEach(function(d) {
          extraHtml += CM._renderFolderCard(d, rootId);
        });
        extraHtml += '</div>';
      }
      var stats = dirs.length + ' 个子文件夹 · ' + files.length + ' 首曲目';
      if (files.length) {
        CM.renderLibraryDrill(title, stats, files, {
          extraHtml: extraHtml,
          pageSizes: LIB_PAGE_SIZES,
          pageKey: 'folder',
          onBack: CM._folderGoBack,
          titleHtml: CM._folderCrumbHtml()
        });
      } else {
        els.libraryDetail.innerHTML =
          '<div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">' +
          '<button class="retry-btn" id="libBackBtn">← 返回</button>' +
          '<div><div class="library-section-title" style="margin:0">' + CM._folderCrumbHtml() + '</div>' +
          '<div style="font-size:11.5px;color:var(--text-3);margin-top:2px">' + stats + '</div></div></div>' +
          extraHtml;
        CM.$('libBackBtn').addEventListener('click', CM._folderGoBack);
      }
      CM.libFadeIn();
    });
  };

  // 下钻详情通用：标题 + 播放全部 + 添加到歌单 + 曲目行
  // opts.extraHtml: 标题与曲目之间的附加内容（如子文件夹网格）
  // opts.pageSizes: 启用曲目分页；播放全部/添加到歌单始终使用完整 tracks
  // opts.pageKey: 分页页码缓存键；opts.onBack: 自定义返回；opts.titleHtml: 自定义标题（如面包屑）
  CM.renderLibraryDrill = function(title, subtitle, tracks, opts) {
    opts = opts || {};
    var paged = !!(opts.pageSizes && opts.pageSizes.length);
    var extraHtml = opts.extraHtml || '';
    var titleInner = opts.titleHtml || esc(title);
    var html =
      '<div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">' +
      '<button class="retry-btn" id="libBackBtn">← 返回</button>' +
      '<div><div class="library-section-title" style="margin:0">' + titleInner + '</div>' +
      (subtitle ? '<div style="font-size:11.5px;color:var(--text-3);margin-top:2px">' + esc(subtitle) + '</div>' : '') +
      '</div>' +
      '<div style="margin-left:auto;display:flex;gap:8px">' +
      '<button class="pl-btn pl-btn-primary" id="libPlayAllBtn">' +
      CM.icons.play + '<span>播放全部</span></button>' +
      '<button class="pl-btn" id="libAddToPlBtn">' +
      CM.icons.plus + '<span>添加到歌单</span></button>' +
      '</div>' +
      '</div>' +
      extraHtml +
      (paged ? CM._pagerBarHtml('libDrill', (typeof title === 'string' ? title : '曲目'), tracks.length) : '') +
      '<div class="dc-tracklist" id="libDrillRows"></div>';
    els.libraryDetail.innerHTML = html;
    CM.$('libBackBtn').addEventListener('click', function() {
      if (opts.onBack) { opts.onBack(); return; }
      state.libraryView = state.libraryBack || 'artists';
      state.libraryArg = null;
      state.libScrollRestore = true; // 返回列表时恢复滚动位置
      CM.renderLibrary();
    });
    CM.$('libPlayAllBtn').addEventListener('click', function() {
      CM.playAllTracks(tracks, title);
    });
    CM.$('libAddToPlBtn').addEventListener('click', function(e) {
      CM.addToPlaylistMenu(tracks, e.clientX, e.clientY);
    });
    if (paged) {
      CM._bindPager('libDrill', tracks.length, opts.pageKey || 'drill', function(start, size) {
        CM.renderTrackRows(CM.$('libDrillRows'), tracks.slice(start, start + size), '未找到曲目', start);
      });
    } else {
      CM.renderTrackRows(CM.$('libDrillRows'), tracks, '未找到曲目');
    }
  };

  // 通用下钻详情：设置 backView → loading → API → drill 渲染
  CM._renderLibraryDetail = function(backView, apiMethod, apiParams, title, subtitleBuilder, retryFn) {
    state.libraryBack = backView;
    var cancelLoading = CM.libLoadingDelayed();
    CM.api(apiMethod, apiParams).then(function(r) {
      cancelLoading();
      if (!r || r.success === false) { CM.libError(retryFn); return; }
      var tracks = CM.respTracks(r);
      CM.renderLibraryDrill(title, subtitleBuilder(tracks), tracks);
      CM.libFadeIn();
    });
  };

  CM.renderLibraryArtistDetail = function(artist) {
    CM._renderLibraryDetail('artists', 'library.getArtistTracks', { artist: artist, limit: 500 },
      artist, function(tracks) { return tracks.length + ' 首曲目'; },
      function() { CM.renderLibraryArtistDetail(artist); });
  };

  CM.renderLibraryAlbumDetail = function(arg) {
    if (!arg) { state.libraryView = 'albums'; CM.renderLibrary(); return; }
    CM._renderLibraryDetail('albums', 'library.getAlbumTracks', { album: arg.album, artist: arg.artist || undefined },
      arg.album, function(tracks) { return (arg.artist ? arg.artist + ' · ' : '') + tracks.length + ' 首曲目'; },
      function() { CM.renderLibraryAlbumDetail(arg); });
  };

  CM.renderLibraryGenreDetail = function(genre) {
    CM._renderLibraryDetail('genres', 'library.search', { query: 'genre HAS "' + genre + '"', limit: 500 },
      genre, function(tracks) { return tracks.length + ' 首曲目'; },
      function() { CM.renderLibraryGenreDetail(genre); });
  };

  /* ============================================
   * 搜索
   * ============================================ */
  CM.doSearch = function(query) {
    query = (query || '').trim();
    if (!query) {
      els.searchResults.innerHTML =
        CM.emptyHTML('输入关键词搜索媒体库', '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>');
      return;
    }
    els.searchResults.innerHTML = CM.loadingHTML('搜索中...');
    CM.api('library.search', { query: query, limit: 200 }).then(function(r) {
      if (!r || r.success === false) {
        els.searchResults.innerHTML = '<div class="section-error">' + CM.icons.error + '<span>搜索失败，媒体库可能未就绪</span></div>';
        return;
      }
      var tracks = CM.respTracks(r);
      if (!tracks.length) {
        els.searchResults.innerHTML = '<div class="search-empty">没有找到与「' + esc(query) + '」相关的结果</div>';
        return;
      }
      var curPath = CM.trackPath(CM.currentTrack);
      state.searchTracks = tracks;
      var total = r.total != null ? r.total : tracks.length;
      var parts = [
        '<div style="display:flex;align-items:center;gap:12px;margin:4px 0 14px">' +
        '<div class="library-section-title" style="margin:0">共 ' + total + ' 条结果</div>' +
        '<button class="pl-btn" id="searchAddAllBtn" style="margin-left:auto">' +
        '<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>添加全部到歌单</span></button>' +
        '</div>'
      ];
      tracks.forEach(function(t, i) {
        var p = CM.trackPath(t);
        parts.push(
          '<div class="search-result-item fade-in' + (curPath && p === curPath ? ' playing' : '') + '" data-path="' + esc(p) + '" data-i="' + i + '">' +
          '<div class="search-result-art" data-art-path="' + esc(p) + '">' + CM.icons.note + '</div>' +
          '<div class="search-result-info">' +
          '<div class="search-result-title">' + esc(CM.trackName(t)) + '</div>' +
          '<div class="search-result-sub">' + esc(CM.trackArtist(t)) + (t.album ? ' · ' + esc(t.album) : '') + '</div>' +
          '</div>' +
          '<span class="search-result-dur">' + CM.formatTime(t.duration) + '</span>' +
          '</div>'
        );
      });
      els.searchResults.innerHTML = parts.join('');
      CM.fillArtworkBatch(els.searchResults, 120);
      var addAllBtn = els.searchResults.querySelector('#searchAddAllBtn');
      if (addAllBtn) {
        addAllBtn.addEventListener('click', function(e) {
          CM.addToPlaylistMenu(tracks, e.clientX, e.clientY);
        });
      }
      ensureMainContentDelegation(); // 搜索结果事件由 mainContent 统一委托
    });
  };

  /* ============================================
   * 播放队列抽屉
   * ============================================ */
  CM.refreshQueueBadge = function() {
    CM.api('queue.getCount').then(function(r) {
      var n = CM.respCount(r);
      els.queueBadge.textContent = n > 99 ? '99+' : n;
      els.queueBadge.classList.toggle('hidden', n <= 0);
      els.queueCount.textContent = n ? n + ' 首' : '';
    });
  };

  // 获取当前播放曲目的路径，用于判断队列中哪首正在播放
  CM._getNowPlayingPath = function() {
    return CM.trackPath(CM.currentTrack);
  };

  // 判断队列项的播放状态: 'playing' | 'played' | 'unplayed'
  // playingIdx 由调用方预计算，避免每个 item 都遍历全部 items
  CM._queueItemState = function(item, index, playingIdx, nowPlayingPath) {
    var itemPath = item.absolutePath || item.path || '';
    if (itemPath && nowPlayingPath && itemPath === nowPlayingPath) return 'playing';
    if (playingIdx >= 0) {
      if (index < playingIdx) return 'played';
      if (index > playingIdx) return 'unplayed';
      return 'playing';
    }
    // 无法确定当前播放位置时，第一项可能是"下一首"
    return index === 0 ? 'playing' : 'unplayed';
  };

  CM.renderQueue = function() {
    els.queueList.innerHTML = CM.loadingHTML('');
    CM.api('queue.get').then(function(r) {
      var items = (r && (r.items || r.queue || r.tracks)) || [];
      els.queueCount.textContent = items.length ? items.length + ' 首' : '';
      if (!items.length) {
        els.queueList.innerHTML = '<div class="queue-empty">播放队列为空<br><span style="font-size:11px;opacity:0.7">右键曲目选择「下一首播放」加入队列</span></div>';
        return;
      }
      var nowPlaying = CM._getNowPlayingPath();
      // 预计算 playingIdx，避免 _queueItemState 对每个 item 都遍历全部 items (O(n²) → O(n))
      var playingIdx = -1;
      for (var pi = 0; pi < items.length; pi++) {
        var pt = items[pi].track || items[pi];
        var pp = pt.absolutePath || pt.path || '';
        if (pp && nowPlaying && pp === nowPlaying) { playingIdx = pi; break; }
      }
      var parts = [];
      items.forEach(function(it, i) {
        var t = it.track || it;
        var qState = CM._queueItemState(t, i, playingIdx, nowPlaying);
        var statusIcon = qState === 'playing' ? '▶' : qState === 'played' ? '✓' : '';
        parts.push(
          '<div class="queue-item' + (qState === 'playing' ? ' playing' : '') + (qState === 'played' ? ' played' : '') + '" data-i="' + i + '">' +
          '<span class="queue-item-status">' + statusIcon + '</span>' +
          '<span class="queue-item-idx">' + (i + 1) + '</span>' +
          '<div class="queue-item-info">' +
          '<div class="queue-item-title">' + esc(CM.trackName(t)) + '</div>' +
          '<div class="queue-item-artist">' + esc(CM.trackArtist(t)) + '</div>' +
          '</div>' +
          '<button class="queue-item-del" title="移出队列"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
          '</div>'
        );
      });
      els.queueList.innerHTML = parts.join('');
      ensureQueueDelegation();
    });
  };

  // 队列项事件委托（一次性绑定在 queueList 上）
  var _queueDelegated = false;
  function ensureQueueDelegation() {
    if (_queueDelegated) return;
    _queueDelegated = true;
    els.queueList.addEventListener('click', function(e) {
      var btn = e.target.closest('.queue-item-del');
      if (!btn) return;
      e.stopPropagation();
      var idx = parseInt(btn.closest('.queue-item').dataset.i, 10);
      if (isNaN(idx)) return;
      CM.api('queue.remove', { index: idx }).then(function() {
        CM.renderQueue();
        CM.refreshQueueBadge();
      });
    });
  }

  CM.toggleQueue = function(open) {
    state.queueOpen = open !== undefined ? open : !state.queueOpen;
    els.queueDrawer.classList.toggle('open', state.queueOpen);
    if (state.queueOpen) CM.renderQueue();
  };

  /* ============================================
   * 歌词面板显隐
   * ============================================ */
  CM.setLyricsVisible = function(visible) {
    state.lyricsVisible = visible;
    CM.settings.lyricsVisible = visible;
    CM.saveSettings();
    els.app.classList.toggle('lyrics-hidden', !visible);
    els.btnLyricsToggle.classList.toggle('active', visible);
    if (visible) setTimeout(function() { CM.updateLyricHighlight(true); }, 380);
  };

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
      if (state.lyricsVisible) CM.setLyricsVisible(false);
    } else {
      els.npOverlay.classList.remove('open');
      document.body.style.overflow = '';
      // 恢复歌词面板
      if (!state.lyricsVisible) CM.setLyricsVisible(true);
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
    CM._updateLyricHighlight(els.npLyrics, '.np-lyric-line', 'npActiveLyricIndex', force, state.position + 0.25, '_npLyricNodesCache', '_npWordCache');
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

  /* ============================================
   * 标签编辑器（单曲 + 批量）
   * ============================================ */
  // 标签字段定义：SDK 键名 → 中文标签
  var TAG_FIELDS = [
    { key: 'TITLE', label: '标题' },
    { key: 'ARTIST', label: '艺术家' },
    { key: 'ALBUM', label: '专辑' },
    { key: 'ALBUM ARTIST', label: '专辑艺术家' },
    { key: 'GENRE', label: '流派' },
    { key: 'DATE', label: '年份' },
    { key: 'TRACKNUMBER', label: '音轨号' },
    { key: 'DISCNUMBER', label: 'CD号' },
    { key: 'COMPOSER', label: '作曲' },
    { key: 'COMMENT', label: '备注' }
  ];

  // 标签编辑器内部状态
  var _tagCtx = null; // { mode: 'single'|'batch', tracks: [], original: {} }

  CM.showTagEditor = function(track) {
    var path = CM.trackPath(track);
    if (!path) { CM.showToast('无法编辑', '未获取到文件路径', 'error'); return; }
    _tagCtx = { mode: 'single', tracks: [track], path: path };
    els.tagEditorTitle.textContent = '编辑标签';
    els.tagEditorTrack.textContent = CM.trackName(track) + ' — ' + path;
    els.tagEditorHint.textContent = '正在读取标签...';
    // 立即打开编辑器，显示加载态
    els.tagEditorBody.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-3);font-size:13px"><div class="spinner" style="margin:0 auto 10px"></div>正在读取标签...</div>';
    els.tagEditorOverlay.classList.add('open');
    // 读取元数据（扁平格式，大写键名）
    CM.api('metadata.readByPath', { path: path }).then(function(r) {
      if (!_tagCtx || _tagCtx.mode !== 'single') return; // 已关闭或切换
      if (!r || r.success === false) {
        CM.showToast('读取失败', '无法读取文件标签', 'error');
        CM.hideTagEditor();
        return;
      }
      _tagCtx.original = r;
      _renderTagFields(false, r);
      _renderTagCover(path);
      els.tagEditorHint.textContent = '修改后点击保存写入文件';
    });
  };

  CM.showBatchTagEditor = function(tracks) {
    if (!tracks || tracks.length < 2) return;
    _tagCtx = { mode: 'batch', tracks: tracks };
    els.tagEditorTitle.textContent = '批量编辑标签（' + tracks.length + '首）';
    // 显示前3首曲目名 + 省略
    var names = tracks.slice(0, 3).map(CM.trackName).join('、');
    if (tracks.length > 3) names += ' 等' + tracks.length + '首';
    els.tagEditorTrack.textContent = names;
    els.tagEditorHint.textContent = '勾选要批量修改的字段，未勾选的字段保持原值';
    _renderTagFields(true, {});
    // 批量模式隐藏封面区
    var coverSec = els.tagEditorBody.querySelector('.tag-cover-section');
    if (coverSec) coverSec.style.display = 'none';
    els.tagEditorOverlay.classList.add('open');
  };

  CM.hideTagEditor = function() {
    els.tagEditorOverlay.classList.remove('open');
    _tagCtx = null;
  };

  // 渲染标签输入字段
  function _renderTagFields(isBatch, tags) {
    var parts = [];
    if (!isBatch) {
      // 单曲模式：显示封面区
      parts.push('<div class="tag-cover-section" id="tagCoverSection">' +
        '<div class="tag-cover-preview" id="tagCoverPreview"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>' +
        '<div class="tag-cover-actions">' +
        '<button class="tag-btn" id="tagCoverReplace">更换封面</button>' +
        '<button class="tag-btn danger" id="tagCoverRemove">移除封面</button>' +
        '</div></div>');
    }
    TAG_FIELDS.forEach(function(f) {
      var val = tags[f.key] || '';
      if (isBatch) {
        parts.push('<div class="tag-field batch">' +
          '<input type="checkbox" class="tag-field-check" data-field="' + f.key + '">' +
          '<label class="tag-field-label">' + f.label + '</label>' +
          '<input type="text" class="tag-field-input" data-field="' + f.key + '" placeholder="保持原值" disabled>' +
          '</div>');
      } else {
        parts.push('<div class="tag-field">' +
          '<label class="tag-field-label">' + f.label + '</label>' +
          '<input type="text" class="tag-field-input" data-field="' + f.key + '" value="' + esc(val) + '">' +
          '</div>');
      }
    });
    els.tagEditorBody.innerHTML = parts.join('');
    // 批量模式：checkbox 启用/禁用对应输入框
    if (isBatch) {
      els.tagEditorBody.querySelectorAll('.tag-field-check').forEach(function(cb) {
        cb.addEventListener('change', function() {
          var input = els.tagEditorBody.querySelector('.tag-field-input[data-field="' + cb.dataset.field + '"]');
          if (input) input.disabled = !cb.checked;
        });
      });
    }
  }

  // 渲染封面预览
  function _renderTagCover(path) {
    CM.api('artwork.getForTrack', { path: path, type: 'front' }).then(function(r) {
      if (r && r.success !== false && r.dataUrl) {
        var preview = CM.$('tagCoverPreview');
        if (preview) preview.innerHTML = '<img src="' + r.dataUrl + '" alt="">';
      }
    });
  }

  // 保存标签
  CM._saveTagEditor = function() {
    if (!_tagCtx) return;
    if (_tagCtx.mode === 'single') {
      _saveSingleTags();
    } else {
      _saveBatchTags();
    }
  };

  function _saveSingleTags() {
    var path = _tagCtx.path;
    var tags = {};
    var changed = false;
    TAG_FIELDS.forEach(function(f) {
      var input = els.tagEditorBody.querySelector('.tag-field-input[data-field="' + f.key + '"]');
      if (!input) return;
      var newVal = input.value.trim();
      var oldVal = (_tagCtx.original && _tagCtx.original[f.key]) || '';
      if (newVal !== oldVal) {
        tags[f.key] = newVal || null; // 空值设为 null 以清除标签
        changed = true;
      }
    });
    if (!changed) { CM.showToast('无变更', '没有检测到修改的标签', null); CM.hideTagEditor(); return; }
    els.tagEditorHint.textContent = '正在写入...';
    CM.api('metadata.write', { path: path, tags: tags }).then(function(r) {
      if (!r || r.success === false) {
        CM.showToast('写入失败', '标签写入出错', 'error');
        els.tagEditorHint.textContent = '写入失败，请重试';
        return;
      }
      CM.showToast('标签已保存', CM.trackName(_tagCtx.tracks[0]), 'success');
      // 更新本地缓存
      var track = _tagCtx.tracks[0];
      if (track) {
        if (tags.TITLE != null) track.title = tags.TITLE;
        if (tags.ARTIST != null) track.artist = tags.ARTIST;
        if (tags.ALBUM != null) track.album = tags.ALBUM;
        if (tags.ALBUM_ARTIST != null) track.albumArtist = tags.ALBUM_ARTIST;
        if (tags.GENRE != null) track.genre = tags.GENRE;
        if (tags.DATE != null) track.date = tags.DATE;
        if (tags.TRACKNUMBER != null) track.trackNumber = parseInt(tags.TRACKNUMBER, 10) || 0;
        if (tags.DISCNUMBER != null) track.discNumber = parseInt(tags.DISCNUMBER, 10) || 0;
        CM.renderTrackTable();
      }
      CM.hideTagEditor();
    });
  }

  function _saveBatchTags() {
    var tags = {};
    var hasChecked = false;
    TAG_FIELDS.forEach(function(f) {
      var cb = els.tagEditorBody.querySelector('.tag-field-check[data-field="' + f.key + '"]');
      if (!cb || !cb.checked) return;
      var input = els.tagEditorBody.querySelector('.tag-field-input[data-field="' + f.key + '"]');
      if (!input) return;
      tags[f.key] = input.value.trim() || null;
      hasChecked = true;
    });
    if (!hasChecked) { CM.showToast('未选择字段', '请勾选要批量修改的标签字段', 'error'); return; }
    els.tagEditorHint.textContent = '正在批量写入...';
    var items = _tagCtx.tracks.map(function(t) {
      var p = CM.trackPath(t);
      return p ? { path: p, tags: tags } : null;
    }).filter(Boolean);
    CM.api('metadata.writeBatch', { items: items }).then(function(r) {
      if (!r || r.success === false) {
        CM.showToast('批量写入失败', '标签写入出错', 'error');
        els.tagEditorHint.textContent = '写入失败，请重试';
        return;
      }
      var ok = r.successCount || 0, fail = r.failCount || 0;
      if (fail > 0) {
        CM.showToast('部分成功', ok + '首成功，' + fail + '首失败', 'error');
      } else {
        CM.showToast('批量保存成功', ok + '首曲目标签已更新', 'success');
      }
      // 更新本地缓存
      _tagCtx.tracks.forEach(function(track) {
        if (!track) return;
        if (tags.TITLE != null) track.title = tags.TITLE;
        if (tags.ARTIST != null) track.artist = tags.ARTIST;
        if (tags.ALBUM != null) track.album = tags.ALBUM;
        if (tags.ALBUM_ARTIST != null) track.albumArtist = tags.ALBUM_ARTIST;
        if (tags.GENRE != null) track.genre = tags.GENRE;
        if (tags.DATE != null) track.date = tags.DATE;
      });
      CM.renderTrackTable();
      CM.hideTagEditor();
    });
  }

  // 封面管理：更换封面
  CM._replaceCover = function() {
    if (!_tagCtx || _tagCtx.mode !== 'single') return;
    els.tagCoverFile.click();
  };

  // 封面管理：移除封面
  CM._removeCover = function() {
    if (!_tagCtx || _tagCtx.mode !== 'single') return;
    var path = _tagCtx.path;
    CM.showModal({
      title: '移除封面',
      desc: '确定要移除这首曲目的嵌入封面吗？',
      okText: '移除',
      danger: true
    }).then(function(result) {
      if (!result) return;
      CM.api('metadata.removeEmbeddedArt', { path: path, removeAll: true }).then(function(r) {
        if (r && r.success !== false) {
          CM.showToast('封面已移除', null, 'success');
          var preview = CM.$('tagCoverPreview');
          if (preview) preview.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
        } else {
          CM.showToast('移除失败', '该格式可能不支持嵌入封面操作', 'error');
        }
      });
    });
  };

  // 文件选择回调：读取 Base64 并嵌入封面
  CM._onCoverFileSelected = function() {
    if (!_tagCtx || _tagCtx.mode !== 'single') return;
    var file = els.tagCoverFile.files[0];
    if (!file) return;
    els.tagCoverFile.value = ''; // 重置以便重复选择同一文件
    var path = _tagCtx.path;
    var reader = new FileReader();
    reader.onload = function(e) {
      var dataUrl = e.target.result;
      var base64 = dataUrl.slice(dataUrl.indexOf(',') + 1); // 去掉 data:image/...;base64, 前缀
      CM.api('metadata.embedArtwork', { path: path, imageData: base64, type: 'front' }).then(function(r) {
        if (r && r.success !== false) {
          CM.showToast('封面已更新', null, 'success');
          var preview = CM.$('tagCoverPreview');
          if (preview) preview.innerHTML = '<img src="' + dataUrl + '" alt="">';
        } else {
          CM.showToast('嵌入失败', '该格式可能不支持嵌入封面', 'error');
        }
      });
    };
    reader.readAsDataURL(file);
  };

  /* ============================================
   * 批量选择（Ctrl+click 多选）
   * ============================================ */
  CM.clearBatchSelection = function() {
    state.batchSelected.clear();
    els.trackTbody.querySelectorAll('tr.batch-selected').forEach(function(tr) {
      tr.classList.remove('batch-selected');
    });
    CM._updateBatchBar();
  };

  CM._updateBatchBar = function() {
    var count = state.batchSelected.size;
    if (count >= 2) {
      els.batchBarCount.textContent = count;
      els.batchBar.classList.remove('hidden');
    } else {
      els.batchBar.classList.add('hidden');
    }
  };

  // 批量编辑入口（从 batch bar 触发）
  CM._batchEditFromBar = function() {
    if (state.batchSelected.size < 2) return;
    var tracks = [];
    state.batchSelected.forEach(function(idx) {
      if (state.trackCache[idx]) tracks.push(state.trackCache[idx]);
    });
    if (tracks.length >= 2) CM.showBatchTagEditor(tracks);
  };
})();
