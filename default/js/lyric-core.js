/* ============================================
 * CloudMusic lyric-core.js — 编码检测 + 模块化歌词解析
 * 挂载到 CM.lyric 子命名空间
 * 加载顺序: core.js → lyric-core.js → ui.js
 * ============================================ */
(function () {
  'use strict';
  const CM = window.CloudMusic;

  // parseLRC 缓存：同一曲目重复解析（切换歌词视图/重新进入）时直接命中。
  const lrcCache = new Map();
  const MAX_CACHE_SIZE = 50, MAX_LRC_TIMESTAMP = 59999999; // LRC 时间戳可表示的最大值，即 999:59.999
  const EMPTY_LYRIC = [{ startTime: 0, endTime: MAX_LRC_TIMESTAMP, words: [{ startTime: 0, endTime: MAX_LRC_TIMESTAMP, word: '暂无歌词' }] }];

  function setLyrics(lyrics) {
    CM.currentLyrics = lyrics;
    CM.player.setLyricLines(lyrics);
  }

  let _lyricLoadId = 0;
  CM.loadLyrics = function (useCache = true) {
    CM.currentLyrics = [];
    if (!CM.currentTrack) return setLyrics(EMPTY_LYRIC);
    const path = CM.trackPath(CM.currentTrack);

    // 命中缓存 切回已播过的曲目时免去重新请求与解析
    if (useCache && lrcCache.has(path)) return setLyrics(lrcCache.get(path));

    const loadId = ++_lyricLoadId;
    CM.api('lyrics.get', { path }).then(r => {
      if (loadId !== _lyricLoadId) return; // 已被新的切歌请求取代
      if (!r?.lyrics) return setLyrics(EMPTY_LYRIC); // 没有歌词

      const parsed = window.AMLL_LYRIC.parseLrcLike(r.lyrics).lines.reduce((acc, line) => {
        const prev = acc.at(-1);

        if (prev?.startTime === line.startTime) prev.translatedLyric = line.words[0]?.word ?? '';
        else acc.push(line);

        return acc;
      }, []);

      lrcCache.set(path, parsed);
      if (lrcCache.size > MAX_CACHE_SIZE) lrcCache.delete(lrcCache.keys().next().value);
      setLyrics(parsed);
    });
  };
})();
