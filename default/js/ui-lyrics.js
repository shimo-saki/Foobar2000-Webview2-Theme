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
      // 以"歌词对应歌曲的路径"为 key 缓存解析结果：切回已播过的曲目时免去重新解析
      const parsed = CM.parseLRCCached(r.path, r.lyrics);
      CM.currentLyrics = parsed;
      CM.player.setLyricLines(parsed);
    });
  };

  // parseLRC 缓存：同一曲目重复解析（切换歌词视图/重新进入）时直接命中。
  const lrcCache = new Map();
  const MAX_CACHE_SIZE = 50;
  const EMPTY_LYRIC = [{ startTime: 0, endTime: Infinity, words: [{ startTime: 0, endTime: Infinity, word: '暂无歌词' }] }];
  CM.parseLRCCached = function (key, lrcText) {
    if (!lrcText) return EMPTY_LYRIC;
    if (lrcCache.has(key)) return lrcCache.get(key);

    const parsed = CM.parseLRC(lrcText);
    lrcCache.set(key, parsed);

    if (lrcCache.size > MAX_CACHE_SIZE) lrcCache.delete(lrcCache.keys().next().value);
    return parsed;
  };

  CM.changePlayerState = function (state) {
    CM.player?.[state === "playing" ? "resume" : "pause"]();
    if (state === 'stopped') CM.player.setLyricLines(EMPTY_LYRIC);
  }

  /* ============================================
   * 歌词面板显隐
   * ============================================ */
  CM.setLyricsVisible = function(visible) {
    CM.state.lyricsVisible = CM.settings.lyricsVisible = visible;
    CM.saveSettings();
    els.btnLyricsToggle.classList.toggle('active', visible);
    els.app.classList.toggle('lyrics-hidden', !visible);
  };

  els.lyricsScroll.addEventListener('contextmenu', e => {
    e.preventDefault();
    const hidden = !CM.checkComponent('foo_uie_eslyric');
    const items = [
      {
        label: '重载歌词…', icon: CM.icons.refresh,
        action: () => { lrcCache.delete(CM.trackPath(CM.currentTrack)); CM.loadLyrics();}},
      {
        label: '编辑歌词', icon: CM.icons.edit, hidden,
        action: async () => await fb2k.invoke('discovery.executeMainMenuCommand', await CM.getGuid('编辑歌词')),
      },
      { divider: true, hidden },
      {
        label: '搜索歌词…', icon: CM.icons.search, hidden,
        action: async () => await fb2k.invoke('discovery.executeMainMenuCommand', await CM.getGuid('搜索歌词')),
      },
    ];
    CM.showCtxMenu(e.clientX, e.clientY, items);
  });
})();
