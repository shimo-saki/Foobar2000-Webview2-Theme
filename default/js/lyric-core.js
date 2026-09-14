/* ============================================
 * CloudMusic lyric-core.js — 编码检测 + 模块化歌词解析
 * 挂载到 CM.lyric 子命名空间
 * 加载顺序: core.js → lyric-core.js → ui.js
 * ============================================ */

(function() {
  'use strict';
  var CM = window.CloudMusic;
  var lyric = CM.lyric = {};

  /* ============================================
   * 工具函数
   * ============================================ */

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // djb2 hash — 用于 fileKey
  function djb2(s) {
    var h = 5381, i = 0;
    while (i < s.length) { h = ((h << 5) + h + s.charCodeAt(i++)) | 0; }
    return (h >>> 0).toString(36);
  }

  // pairwise 迭代器: [0,1,2] → [0,1], [1,2]
  function pairwise(arr) {
    var out = [];
    for (var i = 0; i < arr.length - 1; i++) out.push([arr[i], arr[i+1]]);
    return out;
  }

  // 时间解析: "1:23.456" → 83000+456 = 83456 ms
  function parseTime(s) {
    var parts = s.split(':');
    var secs = 0;
    for (var i = 0; i < parts.length; i++) {
      secs = secs * 60 + parseFloat(parts[i]);
    }
    return Math.round(secs * 1000);
  }

  // 时间格式化: 83456 ms → "01:23.456"
  function formatTime(ms) {
    var t = Math.round(ms);
    var m = Math.floor(t / 60000);
    var s = Math.floor((t % 60000) / 1000);
    var x = t % 1000;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s + '.' +
      (x < 100 ? '0' : '') + (x < 10 ? '0' : '') + x;
  }

  /* ============================================
   * 第 8 层: 用户覆盖存储
   * ============================================ */

  function getUserChoice(fileKey) {
    if (!fileKey) return null;
    try {
      var raw = localStorage.getItem('lrc-enc-' + fileKey);
      if (raw) {
        var data = JSON.parse(raw);
        if (data && data.encoding) return { encoding: data.encoding, confidence: 1, source: 'user' };
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function saveUserChoice(fileKey, encoding) {
    if (!fileKey) return;
    try {
      localStorage.setItem('lrc-enc-' + fileKey, JSON.stringify({ encoding: encoding, ts: Date.now() }));
    } catch (e) { /* ignore */ }
  }

  /* ============================================
   * 第 0-4 层: 确定性路径
   * ============================================ */

  function fromBOM(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF)
      return { encoding: 'utf-8', confidence: 0.95, source: 'bom' };
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE)
      return { encoding: 'utf-16le', confidence: 0.95, source: 'bom' };
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF)
      return { encoding: 'utf-16be', confidence: 0.95, source: 'bom' };
    return null;
  }

  function sniffUTF16(bytes) {
    if (bytes.length < 8) return null;
    var limit = Math.min(bytes.length, 4096);
    var oddNul = 0, evenNul = 0;
    for (var i = 0; i < limit; i++) {
      if (bytes[i] === 0) {
        if (i & 1) oddNul++; else evenNul++;
      }
    }
    if (oddNul / limit > 0.20 && evenNul / limit < 0.05)
      return { encoding: 'utf-16le', confidence: 0.85, source: 'sniff-utf16' };
    if (evenNul / limit > 0.20 && oddNul / limit < 0.05)
      return { encoding: 'utf-16be', confidence: 0.85, source: 'sniff-utf16' };
    return null;
  }

  function isAllASCII(bytes) {
    for (var i = 0; i < bytes.length; i++) {
      if (bytes[i] >= 0x80) return false;
    }
    return true;
  }

  function isValidUTF8(bytes) {
    var i = 0;
    while (i < bytes.length) {
      var c = bytes[i];
      if (c < 0x80) { i++; continue; }
      if (c < 0xC2) return false;
      if (c < 0xE0) {
        if (i + 1 >= bytes.length || (bytes[i+1] & 0xC0) !== 0x80) return false;
        i += 2;
      } else if (c < 0xF0) {
        if (i + 2 >= bytes.length) return false;
        var c1 = bytes[i+1], c2 = bytes[i+2];
        if ((c1 & 0xC0) !== 0x80 || (c2 & 0xC0) !== 0x80) return false;
        if (c === 0xE0 && c1 < 0xA0) return false;
        if (c === 0xED && c1 >= 0xA0) return false;
        i += 3;
      } else if (c < 0xF5) {
        if (i + 3 >= bytes.length) return false;
        var d1 = bytes[i+1], d2 = bytes[i+2], d3 = bytes[i+3];
        if ((d1 & 0xC0) !== 0x80 || (d2 & 0xC0) !== 0x80 || (d3 & 0xC0) !== 0x80) return false;
        if (c === 0xF0 && d1 < 0x90) return false;
        if (c === 0xF4 && d1 >= 0x90) return false;
        i += 4;
      } else return false;
    }
    return true;
  }

  // 采样: 取前 maxLen 字节，按 \n 回退到行尾
  function sampleBytes(bytes, maxLen) {
    if (bytes.length <= maxLen) return bytes;
    var end = maxLen;
    while (end > 0 && bytes[end] !== 0x0A) end--;
    if (end === 0) end = maxLen; // 无换行就用原始截断
    return bytes.subarray(0, end);
  }

  /* ============================================
   * 第 5 层: 结构门控
   * ============================================ */

  var _CJK_MIN_MB_RATIO = 0.05;
  var _CJK_MIN_NON_ASCII = 2;
  var _CJK_DIVERSITY_MIN_NON_ASCII = 32;

  var ANALYZERS = {
    'shift_jis': function(data) {
      var leadC = 0, validC = 0, mb = 0, leads = {};
      var i = 0;
      while (i < data.length) {
        var b = data[i];
        if ((b >= 0x81 && b <= 0x9F) || (b >= 0xE0 && b <= 0xEF)) {
          leadC++;
          if (i + 1 < data.length) {
            var t = data[i+1];
            if ((t >= 0x40 && t <= 0x7E) || (t >= 0x80 && t <= 0xFC)) {
              validC++; leads[b] = 1; mb += (t > 0x7F) ? 2 : 1; i += 2; continue;
            }
          }
          i += 1;
        } else i += 1;
      }
      return [leadC > 0 ? validC / leadC : 0, mb, Object.keys(leads).length];
    },
    'cp932': function(data) {
      var leadC = 0, validC = 0, mb = 0, leads = {};
      var i = 0;
      while (i < data.length) {
        var b = data[i];
        if ((b >= 0x81 && b <= 0x9F) || (b >= 0xE0 && b <= 0xFC)) {
          leadC++;
          if (i + 1 < data.length) {
            var t = data[i+1];
            if ((t >= 0x40 && t <= 0x7E) || (t >= 0x80 && t <= 0xFC)) {
              validC++; leads[b] = 1; mb += (t > 0x7F) ? 2 : 1; i += 2; continue;
            }
          }
          i += 1;
        } else i += 1;
      }
      return [leadC > 0 ? validC / leadC : 0, mb, Object.keys(leads).length];
    },
    'euc-jp': function(data) {
      var leadC = 0, validC = 0, mb = 0, leads = {};
      var i = 0;
      while (i < data.length) {
        var b = data[i];
        if (b >= 0xA1 && b <= 0xFE) {
          leadC++;
          if (i + 1 < data.length) {
            var t = data[i+1];
            if (t >= 0xA1 && t <= 0xFE) {
              validC++; leads[b] = 1; mb += 2; i += 2; continue;
            }
          }
          i += 1;
        } else i += 1;
      }
      return [leadC > 0 ? validC / leadC : 0, mb, Object.keys(leads).length];
    },
    'euc-kr': function(data) {
      return ANALYZERS['euc-jp'](data); // 同样首尾字节范围
    },
    'cp949': function(data) {
      return ANALYZERS['euc-jp'](data);
    },
    'gb18030': function(data) {
      var leadC = 0, validC = 0, mb = 0, leads = {};
      var i = 0;
      while (i < data.length) {
        var b = data[i];
        if (b >= 0x81 && b <= 0xFE) {
          leadC++;
          // 2字节
          if (i + 1 < data.length) {
            var t = data[i+1];
            if (t >= 0x40 && t <= 0xFE && t !== 0x7F) {
              validC++; leads[b] = 1; mb += 2; i += 2;
              // 4字节 (GB18030): 0x81-0xFE / 0x30-0x39 / 0x81-0xFE / 0x30-0x39
              if (b >= 0x81 && b <= 0xFE && i + 1 < data.length && data[i] >= 0x30 && data[i] <= 0x39 &&
                  i + 2 < data.length && data[i+1] >= 0x81 && data[i+1] <= 0xFE &&
                  i + 3 < data.length && data[i+2] >= 0x30 && data[i+2] <= 0x39) {
                mb += 2; i += 3;
              }
              continue;
            }
          }
          i += 1;
        } else i += 1;
      }
      return [leadC > 0 ? validC / leadC : 0, mb, Object.keys(leads).length];
    },
    'big5': function(data) {
      var leadC = 0, validC = 0, mb = 0, leads = {};
      var i = 0;
      while (i < data.length) {
        var b = data[i];
        if (b >= 0xA1 && b <= 0xF9) {
          leadC++;
          if (i + 1 < data.length) {
            var t = data[i+1];
            if ((t >= 0x40 && t <= 0x7E) || (t >= 0xA1 && t <= 0xFE)) {
              validC++; leads[b] = 1; mb += 2; i += 2; continue;
            }
          }
          i += 1;
        } else i += 1;
      }
      return [leadC > 0 ? validC / leadC : 0, mb, Object.keys(leads).length];
    },
    'big5hkscs': function(data) {
      return ANALYZERS['big5'](data);
    }
  };

  function countNonAscii(data) {
    var n = 0;
    for (var i = 0; i < data.length; i++) { if (data[i] >= 0x80) n++; }
    return n;
  }

  function gateCandidates(data, candidates) {
    var nonAscii = countNonAscii(data);
    var gated = [];
    for (var ci = 0; ci < candidates.length; ci++) {
      var cand = candidates[ci];
      if (!cand.multibyte) { gated.push(cand); continue; }
      var analyzer = ANALYZERS[cand.label];
      if (!analyzer) { gated.push(cand); continue; }
      var res = analyzer(data);
      var pairRatio = res[0], mb = res[1], leadDiv = res[2];
      if (pairRatio < _CJK_MIN_MB_RATIO) continue;
      if (nonAscii < _CJK_MIN_NON_ASCII) continue;
      var coverageThreshold = (cand.lang === 'ja') ? 0.25 : 0.30;
      if (mb / nonAscii < coverageThreshold) continue;
      var diversityCheck = _CJK_DIVERSITY_MIN_NON_ASCII;
      if (nonAscii >= diversityCheck && leadDiv < 4) continue;
      gated.push(cand);
    }
    return gated;
  }

  /* ============================================
   * 第 6 层: 规则评分
   * ============================================ */

  // Unicode 字符分类
  function classify(str) {
    var st = {
      total: 0, han: 0, kana: 0, hangul: 0, thai: 0,
      punct: 0, latin: 0, cyrillic: 0, greek: 0, arabic: 0,
      ascii: 0, pua: 0, bad: 0, ctrl: 0, other: 0
    };
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      // surrogate pair → full codepoint
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        var d = str.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) {
          c = ((c - 0xD800) << 10) + (d - 0xDC00) + 0x10000; i++;
        }
      }
      st.total++;
      if (c < 0x80) {
        if (c === 0x09 || c === 0x0A || c === 0x0D || (c >= 0x20 && c <= 0x7E)) st.ascii++;
        else st.ctrl++;
      }
      else if (c >= 0x4E00 && c <= 0x9FFF) st.han++;
      else if (c >= 0x3400 && c <= 0x4DBF) st.han++;
      else if (c >= 0xF900 && c <= 0xFAFF) st.han++;
      else if (c >= 0x3040 && c <= 0x30FF) st.kana++;
      else if (c >= 0xAC00 && c <= 0xD7AF) st.hangul++;
      else if (c >= 0x1100 && c <= 0x11FF) st.hangul++;
      else if (c >= 0x0E00 && c <= 0x0E7F) st.thai++;
      else if (c >= 0x3000 && c <= 0x303F) st.punct++;
      else if (c >= 0xFF00 && c <= 0xFFEF) st.punct++;
      else if (c >= 0x2010 && c <= 0x203B) st.punct++;
      else if (c >= 0x0080 && c <= 0x024F) st.latin++;
      else if (c >= 0x0400 && c <= 0x04FF) st.cyrillic++;
      else if (c >= 0x0370 && c <= 0x03FF) st.greek++;
      else if (c >= 0x0600 && c <= 0x06FF) st.arabic++;
      else if (c >= 0xE000 && c <= 0xF8FF) st.pua++;
      else if (c === 0xFFFD) st.bad++;
      else st.other++;
    }
    return st;
  }

  // LRC 结构分
  function checkLRCStructure(text) {
    var lines = text.split(/\r?\n/);
    var totalLines = lines.length || 1;
    var bracketLines = 0, validLines = 0;
    var timeRe = /^\[(\d{1,2}):([0-5]\d)(?:\.(\d{1,3}))?\]/;
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(timeRe);
      if (m) {
        bracketLines++;
        var min = parseInt(m[1], 10);
        var sec = parseInt(m[2], 10);
        if (min <= 99 && sec <= 59) validLines++;
      }
    }
    if (bracketLines > 0 && validLines === 0) return -0.10;
    if (validLines / totalLines > 0.05) return 0.05;
    return 0;
  }

  // 评分
  function scoreCandidate(stats, cand, text) {
    var t = stats.total || 1;
    var good = stats.han + stats.kana + stats.hangul + stats.thai +
               stats.punct * 0.9 + stats.ascii * 0.45 + stats.latin * 0.5;
    var bad = stats.pua * 4 + stats.bad * 10 + stats.ctrl * 3 + stats.other * 1.5;
    var s = (good - bad) / t;

    // 语言画像
    var kanaR = stats.kana / t;
    var hangulR = stats.hangul / t;
    var hanR = stats.han / t;
    var thaiR = stats.thai / t;
    var latinR = stats.latin / t;
    var cjkR = hanR + kanaR + hangulR;
    var cjkThaiR = cjkR + thaiR;

    switch (cand.lang) {
      case 'zh':
        if (cand.label === 'gb18030') {
          if (stats.bad === 0 && stats.pua === 0 && stats.ctrl === 0) s += 0.05;
          if (hanR > 0.05) s += 0.05;
        } else {
          if (hanR > 0.05) s += 0.10;
          if (kanaR > 0.01) s -= 0.45;
          if (hangulR > 0.01) s -= 0.45;
        }
        break;
      case 'ja':
        if (stats.kana > 0) s += 0.20;
        if (kanaR > 0.02 && hanR > 0.02) s += 0.15;
        if (hangulR > 0.01) s -= 0.60;
        break;
      case 'ko':
        if (stats.hangul > 0) s += 0.25;
        if (kanaR > 0.01) s -= 0.60;
        break;
      case 'th':
        if (stats.thai > 0) s += 0.25;
        if (cjkR > 0.01) s -= 0.50;
        break;
      case 'latin':
        if (latinR > 0.10) s += 0.20;
        if (cjkThaiR > 0.05) s -= 0.50;
        break;
      case 'cyrillic':
        if (stats.cyrillic > 0) s += 0.20;
        if (cjkThaiR > 0.05) s -= 0.50;
        break;
      case 'arabic':
        if (stats.arabic > 0) s += 0.20;
        if (cjkThaiR > 0.05) s -= 0.50;
        break;
    }

    // LRC 结构分
    s += checkLRCStructure(text);

    // 混合语言加成
    var langCount = 0;
    if (stats.han > 0) langCount++;
    if (stats.kana > 0) langCount++;
    if (stats.hangul > 0) langCount++;
    if (stats.thai > 0) langCount++;
    if (stats.latin > 0) langCount++;
    if (langCount >= 2 && (cand.label === 'gb18030' || cand.label === 'utf-8'))
      s += 0.05;

    // 先验
    var PRIORS = {
      'gb18030': 0.04, 'big5': 0, 'big5hkscs': 0.01,
      'shift_jis': 0, 'cp932': 0.01, 'euc-jp': -0.02,
      'euc-kr': -0.01, 'cp949': 0,
      'windows-874': 0, 'windows-1252': -0.05,
      'iso-8859-1': -0.10, 'windows-1251': -0.10, 'windows-1256': -0.15
    };
    s += (PRIORS[cand.label] || 0);

    return s;
  }

  // fatal 解码
  function tryDecodeFatal(bytes, enc) {
    try { return new TextDecoder(enc, { fatal: true }).decode(bytes); }
    catch (e) { return null; }
  }

  /* ============================================
   * 第 7 层: 后处理
   * ============================================ */

  var SUPERSETS = { 'gbk': 'gb18030', 'gb2312': 'gb18030', 'shift_jis': 'cp932', 'euc-kr': 'cp949' };
  var _DEAD_HEAT = 1e-4;
  var _CONFUSION_BAND = 0.005;
  var _RARE_MARGIN = 0.02;

  // Unicode 类别投票
  var _CAT_PREF = {
    Lu:10,Ll:10,Lt:10, Lm:9,Lo:9, Nd:8,Nl:7,No:7,
    Pc:6,Pd:6,Ps:6,Pe:6,Pi:6,Pf:6,Po:6,
    Sc:5,Sm:5, Sk:4,So:4, Zs:3,Zl:3,Zp:3,
    Cf:2, Cc:1,Co:1, Cs:0,Cn:0, Mn:5,Mc:5,Me:5
  };
  var _IMPLAUSIBLE_LETTER = 2;
  var _DECISIVE_VOTE_MARGIN = 8;
  var _DECISIVE_MIN_EVENTS = 2;

  function unicodeVote(textA, textB) {
    var votesA = 0, votesB = 0, events = 0;
    var len = Math.min(textA.length, textB.length);
    for (var i = 0; i < len; i++) {
      var ca = textA.charCodeAt(i);
      var cb = textB.charCodeAt(i);
      // surrogate pairs
      if (ca >= 0xD800 && ca <= 0xDBFF && i + 1 < len) {
        var da = textA.charCodeAt(i + 1);
        if (da >= 0xDC00 && da <= 0xDFFF) ca = ((ca - 0xD800) << 10) + (da - 0xDC00) + 0x10000;
      }
      if (cb >= 0xD800 && cb <= 0xDBFF && i + 1 < len) {
        var db = textB.charCodeAt(i + 1);
        if (db >= 0xDC00 && db <= 0xDFFF) cb = ((cb - 0xD800) << 10) + (db - 0xDC00) + 0x10000;
      }
      if (ca === cb) continue;
      events++;
      var pa = prefForChar(ca, textA, i), pb = prefForChar(cb, textB, i);
      if (pa > pb) votesA++;
      else if (pb > pa) votesB++;
    }
    if (events < _DECISIVE_MIN_EVENTS || Math.abs(votesA - votesB) < _DECISIVE_VOTE_MARGIN)
      return 0;
    return votesA > votesB ? 1 : -1;
  }

  function prefForChar(c, text, idx) {
    var cat = unicodeCategory(c);
    var pref = _CAT_PREF[cat] || 0;
    // 词形规则: 字母左右都不是字母 → 降为 2
    var isLetter = (cat === 'Lu' || cat === 'Ll' || cat === 'Lt' || cat === 'Lm' || cat === 'Lo');
    if (isLetter) {
      var leftLetter = idx > 0 && isLetterCat(unicodeCategory(text.charCodeAt(idx - 1)));
      var rightLetter = idx + 1 < text.length && isLetterCat(unicodeCategory(text.charCodeAt(idx + 1)));
      if (!leftLetter && !rightLetter) pref = _IMPLAUSIBLE_LETTER;
      // 小写紧接大写
      if (rightLetter && cat === 'Ll') {
        var rc = text.charCodeAt(idx + 1);
        var rcat = unicodeCategory(rc);
        if (rcat === 'Lu') pref = _IMPLAUSIBLE_LETTER;
      }
    }
    return pref;
  }

  function isLetterCat(cat) {
    return cat === 'Lu' || cat === 'Ll' || cat === 'Lt' || cat === 'Lm' || cat === 'Lo';
  }

  function unicodeCategory(c) {
    // 简易 Unicode 分类 (覆盖 CJK 常用范围)
    if (c >= 0x4E00 && c <= 0x9FFF) return 'Lo'; // CJK
    if (c >= 0x3400 && c <= 0x4DBF) return 'Lo';
    if (c >= 0xAC00 && c <= 0xD7AF) return 'Lo'; // Hangul
    if (c >= 0x3040 && c <= 0x309F) return 'Lo'; // Hiragana
    if (c >= 0x30A0 && c <= 0x30FF) return 'Lo'; // Katakana
    if (c >= 0x0E00 && c <= 0x0E7F) return 'Lo'; // Thai
    if (c >= 0x0600 && c <= 0x06FF) return 'Lo'; // Arabic
    if ((c >= 0x41 && c <= 0x5A) || (c >= 0xC0 && c <= 0xD6) || (c >= 0xD8 && c <= 0xDE)) return 'Lu';
    if ((c >= 0x61 && c <= 0x7A) || (c >= 0xE0 && c <= 0xF6) || (c >= 0xF8 && c <= 0xFF)) return 'Ll';
    if (c >= 0x30 && c <= 0x39) return 'Nd';
    if (c === 0x20) return 'Zs';
    if (c < 0x20) return 'Cc';
    return 'Lo'; // 默认
  }

  function postprocess(scored) {
    if (scored.length === 0) return scored;
    // 排序
    scored.sort(function(a, b) { return b.score - a.score; });
    // 混淆组优先
    for (var i = 0; i < scored.length; i++) {
      var superSet = SUPERSETS[scored[i].label];
      if (superSet) {
        for (var j = 0; j < scored.length; j++) {
          if (scored[j].label === superSet && Math.abs(scored[i].score - scored[j].score) < _CONFUSION_BAND) {
            scored[i].score = scored[j].score - 0.001; // 降级，让 superset 胜出
          }
        }
      }
    }
    scored.sort(function(a, b) { return b.score - a.score; });
    // 平局用 Unicode 投票
    for (var k = 0; k < scored.length - 1; k++) {
      if (scored[k].score - scored[k+1].score <= _CONFUSION_BAND) {
        var vote = unicodeVote(scored[k].text, scored[k+1].text);
        if (vote < 0) { var tmp = scored[k]; scored[k] = scored[k+1]; scored[k+1] = tmp; }
      }
    }
    // 稀有语言降级
    var top = scored[0];
    for (var m = 1; m < scored.length; m++) {
      if (top.score - scored[m].score < _RARE_MARGIN && scored[m].confidence < 0.15) {
        // 如果第二名置信度极低，保持第一
        break;
      }
    }
    return scored;
  }

  /* ============================================
   * 候选池定义
   * ============================================ */

  var CANDIDATES = [
    { label: 'gb18030', lang: 'zh', multibyte: true, prior: 0.04 },
    { label: 'big5', lang: 'zh', multibyte: true, prior: 0 },
    { label: 'big5hkscs', lang: 'zh', multibyte: true, prior: 0.01 },
    { label: 'shift_jis', lang: 'ja', multibyte: true, prior: 0 },
    { label: 'cp932', lang: 'ja', multibyte: true, prior: 0.01 },
    { label: 'euc-jp', lang: 'ja', multibyte: true, prior: -0.02 },
    { label: 'euc-kr', lang: 'ko', multibyte: true, prior: -0.01 },
    { label: 'cp949', lang: 'ko', multibyte: true, prior: 0 },
    { label: 'windows-874', lang: 'th', multibyte: false, prior: 0 },
    { label: 'windows-1252', lang: 'latin', multibyte: false, prior: -0.05 },
    { label: 'iso-8859-1', lang: 'latin', multibyte: false, prior: -0.10 },
    { label: 'windows-1251', lang: 'cyrillic', multibyte: false, prior: -0.10 },
    { label: 'windows-1256', lang: 'arabic', multibyte: false, prior: -0.15 }
  ];

  /* ============================================
   * detectEncoding — 主入口
   * ============================================ */

  lyric.detectEncoding = function(bytes, fileKey) {
    // 用户选择优先
    var user = getUserChoice(fileKey);
    if (user) return user;

    // 第 0 层: 空
    if (!bytes || bytes.length === 0)
      return { encoding: 'utf-8', confidence: 1, source: 'empty' };

    // 采样
    var sampled = sampleBytes(bytes, 96 * 1024);

    // 第 1 层: BOM
    var bom = fromBOM(sampled);
    if (bom) return bom;

    // 第 2 层: UTF-16 嗅探
    var u16 = sniffUTF16(sampled);
    if (u16) return u16;

    // 第 3 层: 全 ASCII
    if (isAllASCII(sampled))
      return { encoding: 'utf-8', confidence: 1, source: 'all-ascii' };

    // 第 4 层: 严格 UTF-8
    if (isValidUTF8(sampled))
      return { encoding: 'utf-8', confidence: 0.98, source: 'strict-utf8' };

    // 第 5 层: 结构门控
    var gated = gateCandidates(sampled, CANDIDATES);

    // 第 6 层: 规则评分
    var scored = [];
    for (var i = 0; i < gated.length; i++) {
      var cand = gated[i];
      var text = tryDecodeFatal(sampled, cand.label);
      if (text === null) continue;
      var stats = classify(text);
      var chaos = (stats.bad * 10 + stats.pua * 4 + stats.ctrl * 3) / (stats.total || 1);
      if (chaos > 0.3) continue;
      var score = scoreCandidate(stats, cand, text);
      scored.push({ label: cand.label, score: score, text: text, stats: stats, lang: cand.lang });
    }

    // 全部淘汰 → 兜底
    if (scored.length === 0)
      return { encoding: 'gb18030', confidence: 0.2, needsUserChoice: true, source: 'fallback', candidates: [] };

    // 第 7 层: 后处理
    scored = postprocess(scored);
    var top = scored[0], second = scored[1];

    // 第 8 层: 置信度
    var gap = top.score - (second ? second.score : 0);
    var confidence = clamp(0.55 + gap * 0.9, 0.3, 0.98);
    var needsUserChoice = confidence < 0.60;

    // 低置信度记录
    if (confidence < 0.85) {
      console.warn('[lyric] low-confidence', { encoding: top.label, confidence: confidence,
        candidates: scored.slice(0, 5).map(function(c) { return { encoding: c.label, score: c.score }; }),
        fileHash: fileKey || '' });
    }

    return {
      encoding: top.label,
      confidence: confidence,
      needsUserChoice: needsUserChoice,
      source: 'scored',
      candidates: scored.slice(0, 5).map(function(c) { return { encoding: c.label, score: c.score }; })
    };
  };

  // 便捷: detect + decode
  lyric.decodeBytes = function(bytes, fileKey) {
    var result = lyric.detectEncoding(bytes, fileKey);
    var text = (new TextDecoder(result.encoding)).decode(bytes);
    // 记住用户选择（高置信度自动记住）
    if (!result.needsUserChoice && result.confidence >= 0.85 && fileKey) {
      saveUserChoice(fileKey, result.encoding);
    }
    return { text: text, encoding: result.encoding, confidence: result.confidence, needsUserChoice: result.needsUserChoice };
  };

  // 记录用户手动选择
  lyric.rememberChoice = function(fileKey, encoding) {
    saveUserChoice(fileKey, encoding);
  };

  /* ============================================
   * 解析器
   * ============================================ */

  function createLine(opt) {
    return {
      time: opt.time != null ? opt.time : null,
      text: opt.text || '',
      words: opt.words || null,
      startTime: opt.startTime || 0,
      endTime: opt.endTime || null,
      translatedLyric: opt.translatedLyric || null,
      romanLyric: opt.romanLyric || null,
      isBG: opt.isBG || false,
      isDuet: opt.isDuet || false
    };
  }

  function createWord(opt) {
    return {
      text: opt.text || '',
      time: opt.time || 0,
      startTime: opt.startTime || 0,
      endTime: opt.endTime || 0
    };
  }

  // 收集行内所有时间标签
  function _collectTags(line) {
    var out = [], re = /\[([^\]\[]+)\]/g, m;
    while ((m = re.exec(line)) !== null) {
      var t = parseTime(m[1]);
      if (!isNaN(t)) out.push({ time: t, start: m.index, end: m.index + m[0].length });
    }
    return out;
  }

  // 标准 LRC 解析
  lyric.parseLRC = function(lrc) {
    if (!lrc) return [];
    // BOM
    if (lrc.charCodeAt(0) === 0xFEFF) lrc = lrc.slice(1);
    // 全局偏移
    var offsetMs = 0;
    var mOff = /\[offset:([+-]?\d+)\]/i.exec(lrc);
    if (mOff) offsetMs += (parseInt(mOff[1], 10) || 0);
    var mTs = /\[ts:([+-]?\d+)\]/i.exec(lrc);
    if (mTs) offsetMs += (parseInt(mTs[1], 10) || 0);
    // 清理元标签
    var clean = lrc.replace(/\[(?:ti|ar|al|by|re|ve|length|au|la|language|offset|ts|ml|ver)\s*:\s*[^\]]*\]/gi, '');

    var rawLines = clean.split(/\r?\n/);
    var lines = [];

    for (var i = 0; i < rawLines.length; i++) {
      var raw = rawLines[i].trim();
      if (!raw) continue;
      var tags = _collectTags(raw);
      if (!tags.length) continue;
      // 提取纯文本
      var text = raw.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      // 背景和声检测
      var bgMatch = text.match(/^[(（](.+)[)）]$/);
      var isBG = !!bgMatch;
      if (bgMatch) text = bgMatch[1];

      for (var j = 0; j < tags.length; j++) {
        var t = tags[j].time + offsetMs;
        lines.push(createLine({
          time: t,
          text: text,
          startTime: t,
          endTime: null,
          words: [createWord({ text: text, time: t, startTime: t, endTime: t })],
          isBG: isBG
        }));
      }
    }
    // 排序
    lines.sort(function(a, b) { return a.time - b.time; });
    // 计算 endTime（取下一行 startTime）
    for (var k = 0; k < lines.length - 1; k++) {
      lines[k].endTime = lines[k+1].startTime;
      if (lines[k].words && lines[k].words.length) lines[k].words[0].endTime = lines[k+1].startTime;
    }
    return lines;
  };

  // ESLyric 逐字解析: [mm:ss.xx]词1[mm:ss.xx]词2...
  lyric.parseESLRC = function(eslrc) {
    if (!eslrc) return [];
    var rawLines = eslrc.split(/\r?\n/);
    var lines = [];
    for (var i = 0; i < rawLines.length; i++) {
      var raw = rawLines[i].trim();
      if (!raw) continue;
      var lineTimeRe = /^\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\]/;
      var lineMatch = raw.match(lineTimeRe);
      if (!lineMatch) continue;
      var lineStart = parseTime(lineMatch[1]);
      if (isNaN(lineStart)) continue;
      var rest = raw.slice(lineMatch[0].length).trim();
      if (!rest) continue;

      var words = [];
      var wordRe = /([^[\]]+)\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\]/g;
      var wm, prevTime = lineStart;
      while ((wm = wordRe.exec(rest)) !== null) {
        var wordText = wm[1].trim();
        var wordTime = parseTime(wm[2]);
        if (!wordText || isNaN(wordTime)) continue;
        words.push(createWord({
          text: wordText,
          time: prevTime,
          startTime: prevTime,
          endTime: wordTime
        }));
        prevTime = wordTime;
      }
      // 最后一个词之后可能还有文本
      var lastIdx = rest.lastIndexOf(']');
      if (lastIdx >= 0 && lastIdx + 1 < rest.length) {
        var tailText = rest.slice(lastIdx + 1).trim();
        if (tailText && words.length > 0) {
          var lastWord = words[words.length - 1];
          lastWord.text += tailText;
        }
      }
      if (words.length === 0) {
        // 没有逐字信息，按普通行处理
        words.push(createWord({
          text: rest.replace(/\[[^\]]*\]/g, '').trim(),
          time: lineStart, startTime: lineStart, endTime: lineStart
        }));
      }
      lines.push(createLine({ words: words, time: lineStart, startTime: lineStart, endTime: null }));
    }
    lines.sort(function(a, b) {
      var ta = a.words && a.words.length ? a.words[0].startTime : 0;
      var tb = b.words && b.words.length ? b.words[0].startTime : 0;
      return ta - tb;
    });
    for (var k = 0; k < lines.length - 1; k++) {
      var nextTime = lines[k+1].words && lines[k+1].words.length ? lines[k+1].words[0].startTime : lines[k].startTime;
      lines[k].endTime = nextTime;
    }
    return lines;
  };

  // 合并翻译/音译到主行
  function mergeTranslations(lines) {
    if (lines.length < 2) return lines;
    // 按 time 排序
    lines.sort(function(a, b) { return (a.time || 0) - (b.time || 0); });
    var result = [], i = 0;
    while (i < lines.length) {
      var group = [lines[i]];
      var j = i + 1;
      while (j < lines.length && Math.abs((lines[j].time || 0) - (group[0].time || 0)) <= 10) {
        group.push(lines[j]); j++;
      }
      if (group.length === 1) {
        result.push(group[0]);
      } else {
        var main = group[0];
        if (group[1]) main.translatedLyric = group[1].text;
        if (group[2]) main.romanLyric = group[2].text;
        // 超过 3 条忽略
        result.push(main);
      }
      i = j;
    }
    return result;
  }

  // 自动检测 + 解析
  lyric.parse = function(text, fmt) {
    if (!text) return [];
    text = String(text);
    if (fmt) {
      if (fmt === 'eslrc') return mergeTranslations(lyric.parseESLRC(text));
      if (fmt === 'lrc') return mergeTranslations(lyric.parseLRC(text));
    }
    // 自动检测
    if (/<\d{2}:\d{2}(?:\.\d{1,3})?>/.test(text)) return mergeTranslations(lyric.parseESLRC(text));
    if (/^\[\d{2}:\d{2}(?:\.\d{1,3})?\]/m.test(text)) return mergeTranslations(lyric.parseLRC(text));
    // 纯文本
    var plainLines = [];
    var raw = text.split(/\r?\n/);
    for (var i = 0; i < raw.length; i++) {
      var t = raw[i].trim();
      if (!t) continue;
      plainLines.push(createLine({ text: t, time: null, startTime: 0 }));
    }
    return plainLines;
  };

})();