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

  CM.parseLRC = function (lrcText) {
    if (lrcText.charCodeAt(0) === 0xFEFF) lrcText = lrcText.slice(1);

    const offsetMs = ['offset', 'ts'].reduce((sum, key) => {
      const m = new RegExp(`\\[${key}:([+-]?\\d+)\\]`, 'i').exec(lrcText);
      return sum + (m ? +m[1] : 0);
    }, 0);

    const clean = lrcText.replace(/\[(?:ti|ar|al|by|re|ve|length|au|la|language|offset|ts)\s*:\s*[^\]]*\]/gi, '');

    const result = [];
    const wordReg = /<([^>]*)>([^<]*)(?=<([^>]*)>)/g;

    for (const line of clean.split('\n')) {
      if (!line) continue;

      const time = /\[(\d+:\d+(?:\.\d+)?)\]/.exec(line)?.[1];
      let text = line.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!time || !text) continue;

      const startTime = parseClock(time);
      const prev = result.at(-1);

      if (prev?.startTime === startTime) {
        prev.translatedLyric = text;
        continue;
      }

      if (prev?.endTime === Infinity) {
        prev.endTime = prev.words[0].endTime = startTime;
      }

      let words = Array.from(text.matchAll(wordReg), ([, start, word, end]) => ({
        word, startTime: parseClock(start), endTime: parseClock(end)
      }));

      if (words.length) {
        if (words.at(-1).startTime < startTime - 0.05) {
          const shift = startTime - words[0].startTime;
          if (Math.abs(shift) > 0.05) {
            words.forEach(w => {
              w.startTime += shift;
              w.endTime += shift;
            });
          }
        }

        text = text.replace(/<[^>]*>/g, '').trim();
        result.push({ startTime, endTime: words.at(-1).endTime, text, words });
      } else {
        result.push({ startTime, endTime: Infinity, text, words: [{ startTime, endTime: Infinity, word: text }] });
      }
    }

    if (offsetMs) {
      const sec = offsetMs / 1000;
      result.forEach(item => {
        item.startTime += sec;
        item.endTime += sec;
        item.words?.forEach(w => {
          w.startTime += sec;
          w.endTime += sec;
        });
      });
    }
    return result.sort((a, b) => a.startTime - b.startTime);
  };

  // 把时间文本解析成毫秒，无效返回 null
  function parseClock(s) {
    // 匹配格式：(HH:)mm:ss([.|:]SSS)
    const match = s.match(/^(?:(\d{1,2}):)?([0-5]?\d):([0-5]?\d)(?:[:.](\d{1,3}))?$/);
    if (!match) return null;

    const [_, h, m, sec, ms] = match;
    const hours = +h || 0, minutes = +m,
      seconds = +sec, millis = +(ms || 0).padEnd(3, '0');

    return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000 + millis);
  }

})();
