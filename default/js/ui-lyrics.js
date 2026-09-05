/* ============================================
 * CloudMusic ui-lyrics.js — 歌词
 * 多编码解码 / LRC 解析结果渲染 / 同步高亮 / 逐字高亮
 * 主歌词面板显隐（右栏开合动画）
 * ============================================ */

(function() {
  'use strict';
  var CM = window.CloudMusic;
  var els = CM.els, state = CM.state;

  CM._lyricLoadId = 0;
  CM.loadLyrics = function() {
    CM.currentLyrics = [];
    if (!CM.currentTrack) return;
    var path = CM.trackPath(CM.currentTrack);
    var loadId = ++CM._lyricLoadId;
    CM.api('lyrics.get', path ? { path } : {}).then(function(r) {
      if (loadId !== CM._lyricLoadId) return; // 已被更新的切歌请求取代
      CM._renderLyrics(r);
    });
  };

  CM._renderLyrics = function(r) {
    // 以"歌词对应歌曲的路径"为 key 缓存解析结果：切回已播过的曲目时免去重新解析
    var parsed = CM.parseLRCCached(r.path, r.lyrics);
    CM.currentLyrics = parsed;
    [CM.player, CM.npPlayer].forEach(p => p?.setLyricLines(parsed));
  };

  // parseLRC 缓存：同一曲目重复解析（切换歌词视图/重新进入）时直接命中。
  const lrcCache = new Map();
  CM.parseLRCCached = function (key, lrcText) {
    if (!lrcText) return [{ startTime: 0, endTime: Infinity, words: [{ startTime: 0, endTime: Infinity, word: '暂无歌词' }] }];
    if (lrcCache.has(key)) return lrcCache.get(key);

    const parsed = CM.parseLRC(lrcText);
    lrcCache.set(key, parsed);

    if (lrcCache.size > 8) lrcCache.delete(lrcCache.keys().next().value);
    return parsed;
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
    CM.player[visible ? 'resume' : 'pause']();
    CM.activePlayer = visible ? CM.player : null;
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
  };
})();
