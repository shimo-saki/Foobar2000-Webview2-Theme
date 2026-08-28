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
    var loadId = ++CM._lyricLoadId;
    CM.api('lyrics.get', path ? { path: path } : {}).then(function(r) {
      if (loadId !== CM._lyricLoadId) return; // 已被更新的切歌请求取代
      // 外部文件歌词：优先用 file.read 读取原始字节并做编码探测，
      // 修复插件只认 UTF-8/16-BOM 导致 ANSI(GBK) 歌词乱码的问题。
      // 文件在白名单外（如与音频同目录）不可读时，回退插件解码结果（UTF-8/16 仍正常）。
      if (r && r.available && r.source === 'file' && r.sourcePath) {
        CM.api('file.read', { path: r.sourcePath, encoding: 'binary' }).then(function(fr) {
          if (loadId !== CM._lyricLoadId) return;
          CM._renderLyrics(r, fr && fr.success && fr.content ? CM.decodeTextBytes(fr.content) : r.lyrics);
        });
        return;
      }
      CM._renderLyrics(r, r && r.lyrics);
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
      if (isFinite(t)) {
        CM.api('playback.setPosition', { seconds: t });
        // 点击跳转时重置 index，避免时间回退时不会高亮当前行
        // el.dataset.idx - 1 避免点击翻译行而不会高亮歌词行
        CM.activeLyricIndex = CM.npActiveLyricIndex = el.dataset.idx - 1;
      };
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
    // 修复歌词存在翻译时，高亮翻译行的 bug
    // 使用当前播放行索引，避免每次都从头查找
    let idx = CM[activeIdxField], transIdx = idx;
    for (let i = Math.max(0, idx); i < lines.length && lines[i].time <= pos; i++) {
      if (idx == -1 || lines[i].time > lines[idx].time) {
        idx = transIdx = i;
      } else if (lines[i].time === lines[idx].time) {
        transIdx = i;
      }
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
    nodes.forEach((node, i) => node.classList.toggle('active', i === idx || i === transIdx));
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
