/* ============================================
 * CloudMusic ui-lyrics.js — 歌词
 * 多编码解码 / LRC 解析结果渲染 / 同步高亮 / 逐字高亮
 * 主歌词面板显隐（右栏开合动画）
 * ============================================ */

(function() {
  'use strict';
  var CM = window.CloudMusic;
  var els = CM.els, state = CM.state, esc = CM.escHtml;

  /* ============================================
   * 歌词
   * ============================================ */
  // 健壮解码：base64 raw bytes → 编码探测 + TextDecoder
  CM.decodeTextBytes = function(b64) {
    var raw = atob(b64);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return CM.lyric.decodeBytes(bytes).text;
  };

  CM._renderLyrics = function(r, lyricsText) {
    if (!r || r.success === false || !r.available || !lyricsText) {
      // 清掉旧歌词：沉浸页与主面板共用 currentLyrics，否则会停留在上一首
      CM.currentLyrics = [];
      CM._lyricsSynced = false;
      CM.renderLyricsEmpty('暂无歌词');
      return;
    }
    // 双语配对模式按"歌词来源路径"记忆（右键菜单可改）；路径同时用于"打开所在文件夹"
    var srcPath = r.sourcePath || (CM.currentTrack && CM.trackPath(CM.currentTrack)) || '';
    CM.lyricSourcePath = srcPath;
    var mode = CM.lyricModeFor(srcPath);
    // 以"路径+模式+长度+头部"为 key 缓存解析结果：切回已播过的曲目时免去重新解析
    var parsed = CM.parseLRCCached(
      CM.makeLRCCacheKey(srcPath, lyricsText, mode),
      lyricsText, mode
    );
    // 只有解析出时间戳才按同步歌词渲染/高亮。整首无时间轴的纯文本歌词若走同步分支，
    // 高亮的二分查找会把 null 当作 0 而永远命中最后一行 —— 表现为末行固定高亮、
    // 面板被滚到底部、点击任意行都无法跳转。
    // 纯文本仍放入 currentLyrics（沉浸页据此显示歌词正文），仅关闭时间轴高亮。
    var timed = false;
    for (var i = 0; i < parsed.length; i++) {
      if (parsed[i].time != null) { timed = true; break; }
    }
    CM.currentLyrics = parsed;
    CM._lyricsSynced = timed;
    if (timed) CM.renderSyncedLyrics(parsed);
    else CM.renderPlainLyrics(lyricsText, parsed);
    CM._syncNpLyrics();
  };

  CM._lyricLoadId = 0;
  CM._lyricsSynced = false;   // 当前歌词是否带时间轴（纯文本时不做时间高亮）
  CM.lyricSourcePath = '';    // 当前歌词来源路径（右键菜单：模式记忆键 + 打开所在文件夹）
  CM.loadLyrics = function() {
    CM.currentLyrics = [];
    CM._lyricsSynced = false;
    CM.activeLyricIndex = -1;
    if (!CM.currentTrack) { CM.renderLyricsEmpty('暂无歌词'); return; }
    els.lyricsScroll.innerHTML = CM.loadingHTML('歌词加载中...');
    var path = CM.trackPath(CM.currentTrack);
    CM.lyricSourcePath = path || CM.lyricSourcePath;
    var loadId = ++CM._lyricLoadId;
    CM.api('lyrics.get', path ? { path: path } : {}).then(function(r) {
      if (loadId !== CM._lyricLoadId) return;
      // 文件源歌词：用 file.read 读取原始字节，自行编码探测
      if (r && r.available && r.source === 'file' && r.sourcePath) {
        CM.api('file.read', { path: r.sourcePath, encoding: 'binary' }).then(function(fr) {
          if (loadId !== CM._lyricLoadId) return;
          if (fr && fr.content) {
            CM._renderLyrics(r, CM.decodeTextBytes(fr.content));
          } else {
            CM._renderLyrics(r, r.lyrics);
          }
        }).catch(function() {
          CM._renderLyrics(r, r && r.lyrics);
        });
        return;
      }
      // 非文件源（内嵌/在线）：直接用插件解码结果
      if (r && r.available) {
        CM._renderLyrics(r, r && r.lyrics);
        return;
      }
      // lyrics.get 失败 → 从音频路径推导 LRC 路径，自行读取
      if (path) {
        var lrcPath = path.replace(/\.\w+$/i, '.lrc');
        CM.api('file.read', { path: lrcPath, encoding: 'binary' }).then(function(fr) {
          if (loadId !== CM._lyricLoadId) return;
          if (fr && fr.content) {
            CM._renderLyrics({ available: true, source: 'file', sourcePath: lrcPath }, CM.decodeTextBytes(fr.content));
          } else {
            CM.renderLyricsEmpty('暂无歌词');
          }
        }).catch(function() {
          CM.renderLyricsEmpty('暂无歌词');
        });
        return;
      }
      CM.renderLyricsEmpty('暂无歌词');
    });
  };

  CM.renderLyricsEmpty = function(text, keepNp) {
    els.lyricsScroll.innerHTML =
      '<div class="lyrics-empty">' + CM.icons.note + '<span>' + esc(text) + '</span></div>';
    // 空态一并清掉判定结果：否则切到没有歌词的曲目后，右键菜单仍会显示上一个文件的
    // 「翻译对齐方式 / 识别为：X」，像是这首歌识别出来的
    CM.lyric.lastVerdict = 'none';
    if (!keepNp) CM._syncNpLyrics();
  };

  // 沉浸式页与主面板共用 CM.currentLyrics：歌词异步到达（可能晚于沉浸页打开或
  // 晚于 onTrackChanged 里 200ms 的延迟重绘）时必须重绘，否则沉浸页会一直停在
  // 打开瞬间的空态「暂无歌词」，直到下次手动打开沉浸页。
  CM._syncNpLyrics = function() {
    if (state.npOpen && typeof CM.renderNpLyrics === 'function') CM.renderNpLyrics();
  };

  // 通用歌词 HTML 生成（主歌词面板 + 沉浸式共用）
  // 同一时刻的多行（翻译/音译）由解析层归为一组：主行照常渲染，副行以 .lyric-sub
  // 依次附在同一容器内，整组共享 active 高亮与滚动定位，任何一行都不会被丢弃。
  // wrapClass：可选，把整段歌词包进一个包裹层 —— 沉浸式用它实现"整块歌词像贴在一面
  // 斜墙上"的 3D 透视（旋转挂在包裹层、不挂在滚动容器上，故滚动/居中/遮罩全不受影响）。
  CM._renderLyricHTML = function(lines, lineClass, topPadPct, wrapClass) {
    var parts = ['<div style="height:' + topPadPct + '%"></div>'];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      parts.push('<div class="' + lineClass + (line.words ? ' has-words' : '') +
        (line.subs && line.subs.length ? ' has-subs' : '') +
        '" data-idx="' + i + '" data-time="' + line.time + '">');
      if (line.words) {
        for (var w = 0; w < line.words.length; w++) {
          parts.push('<span class="lyric-word" data-time="' + line.words[w].time + '">' + esc(line.words[w].text) + '</span>');
        }
      } else {
        parts.push(esc(line.text));
      }
      if (line.subs) {
        for (var s = 0; s < line.subs.length; s++) {
          parts.push('<div class="lyric-sub">' + esc(line.subs[s]) + '</div>');
        }
      }
      parts.push('</div>');
    }
    parts.push('<div style="height:40%"></div>');
    var html = parts.join('');
    return wrapClass ? '<div class="' + wrapClass + '">' + html + '</div>' : html;
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
    // 纯文本歌词（无时间轴）不做时间高亮：lines[i].time 为 null，
    // 二分查找会把 null 当 0 而恒命中最后一行
    if (!CM._lyricsSynced || !lines.length) return;
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
    // 无时间轴：按行静态展示（若解析出文本行则用解析结果）。
    // 同时清掉同步渲染的节点缓存，避免纯文本模式下残留上一首的节点引用。
    CM._lyricNodesCache = null;
    CM._wordCache = null;
    var lines = parsed.length ? parsed.map(function(l) { return l.text; })
      : raw.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
    if (!lines.length) { CM.renderLyricsEmpty('暂无歌词'); return; }
    var parts = ['<div style="height:12px"></div>'];
    lines.forEach(function(text) { parts.push('<div class="lyric-line">' + esc(text) + '</div>'); });
    parts.push('<div style="height:20px"></div>');
    els.lyricsScroll.innerHTML = parts.join('');
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
   * 歌词面板显隐
   * ============================================ */
  var _rpAnimTimer = null;
  // 解冻主内容（恢复自适应宽度）
  function _unfreezeMain() {
    var tab = els.mainBody.querySelector('.tab-content[data-rp-frozen]');
    if (tab) { tab.style.width = ''; tab.style.right = ''; delete tab.dataset.rpFrozen; }
  }
  CM.setLyricsVisible = function(visible, instant) {
    state.lyricsVisible = visible;
    CM.settings.lyricsVisible = visible;
    CM.saveSettings();
    els.btnLyricsToggle.classList.toggle('active', visible);
    // 平滑开合且零卡顿的"冻结"方案（详见下方非对称冻结注释）：
    //   列轨道 0.26s 动画驱动 320px 固定宽面板平移进出（内部零重排、模糊背景零重绘），
    //   主内容冻结在像素宽度使动画期间零重排，全程每方向只有一次重排且时机自然。
    if (_rpAnimTimer) { clearTimeout(_rpAnimTimer); _rpAnimTimer = null; _unfreezeMain(); }
    var tab = els.mainBody.querySelector('.tab-content.active');
    if (instant || !tab) {
      els.app.classList.toggle('lyrics-hidden', !visible);
    } else {
      var rightW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--right-w'), 10) || 320;
      var cur = els.mainBody.clientWidth;
      // 对称冻结在"目标宽度"（两方向均把唯一一次重排放置在动画起点，被面板滑动掩盖）：
      //   显示：内容立刻重排变窄让位，面板滑入右侧空条；终点容器宽=冻结宽，解冻零变化。
      //   隐藏：内容立刻重排变宽（右侧 320px 被裁剪的部分恰好被尚未离开的面板遮住），
      //        面板滑出时逐像素显露已是最终布局的内容；终点同样零跳变。
      var target = visible ? cur - rightW : cur + rightW;
      tab.style.width = Math.max(0, target) + 'px';
      tab.style.right = 'auto'; // 左锚定，右侧被裁剪/展开的部分由滑动中的面板遮盖
      tab.dataset.rpFrozen = '1';
      els.app.classList.toggle('lyrics-hidden', !visible);
      _rpAnimTimer = setTimeout(function() {
        _rpAnimTimer = null;
        _unfreezeMain();
      }, 300); // > 0.26s CSS 动画
    }
    if (visible) setTimeout(function() { CM.updateLyricHighlight(true); }, 300);
  };

  /* ============================================
   * 歌词面板右键菜单
   *
   * 双语配对协议在真实歌词里没有统一规范（同刻 / 译文晚一行，还有部分翻译、
   * 未翻译原词夹在中间等混合形态），自动判据不可能全覆盖。这里给用户一条权限：
   * 按文件（歌词来源路径）指定配对方式，另外放上几个常用操作。
   * 文案用日常说法：同刻 = 译文跟原文同时；延后 = 译文晚一行。
   * ============================================ */
  // 三种对齐方式：自动识别 / 标准双语（译文与原文同刻）/ 兼容旧版（译文写在下一句时间上）
  var _MODE_LABEL = { auto: '自动识别', same: '标准双语', offset: '兼容旧版' };
  function _verdictText() {
    switch (CM.lyric.lastVerdict) {
      case 'delay': return '兼容旧版';
      case 'same': return '标准双语';
      case 'none': return '没有双语行';
      default: return '没认出来';
    }
  }

  CM.showLyricMenu = function(x, y) {
    var path = CM.lyricSourcePath || '';
    var cur = CM.lyricModeFor(path);
    // 只有存在"重复时间戳"（同一时刻多行）才可能有对齐问题：单语言、纯文本、
    // 逐字（ESLyric）歌词的 lastVerdict 为 'none'。此时不显示这一项，
    // 但若该文件已被手动指定过方式，仍显示（否则用户无法改回自动）
    var hasAlign = CM.lyric.lastVerdict !== 'none' || cur !== 'auto';
    function apply(mode) { CM.setLyricMode(path, mode); CM.loadLyrics(); }
    var items = [{ label: '歌词', isLabel: true }];
    if (hasAlign) {
      items.push({ label: '翻译对齐方式：' + (_MODE_LABEL[cur] || _MODE_LABEL.auto), submenu: [
        { label: '自动识别：', desc: '自动判断歌词格式', checked: cur === 'auto', action: function() { apply('auto'); } },
        { label: '标准双语：', desc: '原词和翻译在同一时间戳', checked: cur === 'same', action: function() { apply('same'); } },
        { label: '兼容旧版：', desc: '翻译在下一时间戳', checked: cur === 'offset', action: function() { apply('offset'); } }
      ] });
      // 手动指定时父项已写明方式，再报"自动识别结果"反而绕；只在使用自动时给出识别结果
      if (cur === 'auto') items.push({ label: '识别为：' + _verdictText(), isLabel: true });
    }
    items.push({ divider: true },
      { label: '刷新歌词', action: function() { CM.loadLyrics(); } },
      { label: '复制歌词', disabled: !CM.currentLyrics.length, action: function() { CM.copyLyrics(); } },
      { label: '打开所在文件夹', disabled: !path, action: function() { CM.api('shell.showInExplorer', { path: path }); } });
    CM.showCtxMenu(x, y, items);
  };

  // 复制歌词为纯文本（主行与副行各占一行），便于分享
  CM.copyLyrics = function() {
    var ls = CM.currentLyrics || [];
    if (!ls.length) return;
    var out = [], i, s;
    for (i = 0; i < ls.length; i++) {
      if (ls[i].text) out.push(ls[i].text);
      if (ls[i].subs) for (s = 0; s < ls[i].subs.length; s++) out.push(ls[i].subs[s]);
    }
    var txt = out.join('\n');
    function done() { CM.showToast('已复制歌词', ls.length + ' 行', 'success'); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); }
      catch (e) { CM.showToast('复制失败', '', 'error'); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done).catch(fallback);
    } else fallback();
  };

  CM.runOnce('lyricPanelMenu', function() {
    var bind = function(el) {
      if (!el) return;
      el.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        CM.showLyricMenu(e.clientX, e.clientY);
      });
    };
    bind(els.rightPanel);   // 右侧歌词面板
    bind(els.npLyrics);     // 沉浸式页面的歌词区
  });
})();
