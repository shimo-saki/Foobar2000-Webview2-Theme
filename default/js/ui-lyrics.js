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
  // 健壮解码：base64 raw bytes → detectEncoding + TextDecoder
  CM.decodeTextBytes = function(b64, fileKey) {
    var raw = atob(b64);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    var result = CM.lyric.decodeBytes(bytes, fileKey);
    return result.text;
  };

  CM._renderLyrics = function(r, lyricsText) {
    if (!r || r.success === false || !r.available || !lyricsText) {
      CM.renderLyricsEmpty('暂无歌词');
      return;
    }
    // 以"路径+长度+头部"为 key 缓存解析结果：切回已播过的曲目时免去重新解析
    var parsed = CM.parseLRCCached(
      CM.makeLRCCacheKey(r.sourcePath || (CM.currentTrack && CM.trackPath(CM.currentTrack)), lyricsText),
      lyricsText
    );
    // 只要解析出时间戳即按同步歌词渲染，不依赖插件 synced 判定
    // （带 [ti:]/[ar:]/[offset:] 等元数据标签的文件可能被插件误判为不同步）
    if (parsed.length) {
      CM.currentLyrics = parsed;
      CM.renderSyncedLyrics(parsed);
    } else {
      CM.renderPlainLyrics(lyricsText, parsed);
    }
  };

  CM._lyricLoadId = 0;
  CM.loadLyrics = function() {
    CM.currentLyrics = [];
    CM.activeLyricIndex = -1;
    if (!CM.currentTrack) { CM.renderLyricsEmpty('暂无歌词'); return; }
    els.lyricsScroll.innerHTML = CM.loadingHTML('歌词加载中...');
    var path = CM.trackPath(CM.currentTrack);
    var fileKey = path ? (path.length + '|' + path.slice(-32)) : '';
    var loadId = ++CM._lyricLoadId;
    CM.api('lyrics.get', path ? { path: path } : {}).then(function(r) {
      if (loadId !== CM._lyricLoadId) return;
      // 文件源歌词：用 file.read 读取原始字节，自行编码探测
      if (r && r.available && r.source === 'file' && r.sourcePath) {
        CM.api('file.read', { path: r.sourcePath, encoding: 'binary' }).then(function(fr) {
          if (loadId !== CM._lyricLoadId) return;
          if (fr && fr.content) {
            CM._renderLyrics(r, CM.decodeTextBytes(fr.content, fileKey));
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
            CM._renderLyrics({ available: true, source: 'file', sourcePath: lrcPath }, CM.decodeTextBytes(fr.content, fileKey));
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

  CM.renderLyricsEmpty = function(text) {
    els.lyricsScroll.innerHTML =
      '<div class="lyrics-empty">' + CM.icons.note + '<span>' + esc(text) + '</span></div>';
  };

  // 通用歌词 HTML 生成（主歌词面板 + 沉浸式共用）
  CM._renderLyricHTML = function(lines, lineClass, topPadPct) {
    var parts = ['<div style="height:' + topPadPct + '%"></div>'];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      parts.push('<div class="' + lineClass + (line.words ? ' has-words' : '') + '" data-idx="' + i + '" data-time="' + line.time + '">');
      if (line.words) {
        for (var w = 0; w < line.words.length; w++) {
          parts.push('<span class="lyric-word" data-time="' + line.words[w].time + '">' + esc(line.words[w].text) + '</span>');
        }
      } else {
        parts.push(esc(line.text));
      }
      parts.push('</div>');
    }
    parts.push('<div style="height:40%"></div>');
    return parts.join('');
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
})();
