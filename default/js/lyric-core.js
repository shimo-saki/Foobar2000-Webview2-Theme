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

  // pairwise 迭代器: [0,1,2] → [0,1], [1,2]
  function pairwise(arr) {
    var out = [];
    for (var i = 0; i < arr.length - 1; i++) out.push([arr[i], arr[i+1]]);
    return out;
  }

  // 时间解析: "1:23.456" → 83000+456 = 83456 ms；"-00:01.900" → -1900 ms
  function parseTime(s) {
    s = String(s).trim();
    var neg = false;
    if (s.charAt(0) === '-') { neg = true; s = s.slice(1); }
    var parts = s.split(':');
    var secs = 0;
    for (var i = 0; i < parts.length; i++) {
      secs = secs * 60 + parseFloat(parts[i]);
    }
    var ms = Math.round(secs * 1000);
    return neg ? -ms : ms;
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

  // 采样: 取前 maxLen 字节，按 \n 回退到行尾；无换行时回退到非 UTF-8 续字节边界
  function sampleBytes(bytes, maxLen) {
    if (bytes.length <= maxLen) return bytes;
    var end = maxLen;
    while (end > 0 && bytes[end] !== 0x0A) end--;
    if (end > 0) return bytes.subarray(0, end);
    // 无换行：回退到非续字节 (0x80-0xBF 是 UTF-8/多字节续字节)
    end = maxLen;
    while (end > 0 && (bytes[end] & 0xC0) === 0x80) end--;
    return bytes.subarray(0, end || maxLen);
  }

  /* ============================================
   * 第 5 层: 结构门控
   * ============================================ */

  var _CJK_MIN_MB_RATIO = 0.05;
  var _CJK_MIN_NON_ASCII = 2;
  var _CJK_DIVERSITY_MIN_NON_ASCII = 32;

  var ANALYZERS = {
    // 字节范围按实际使用的解码器描述：WHATWG 的 shift_jis 即 windows-31j/cp932
    // （前导字节可到 0xFC），故这里用 cp932 的范围而非旧版 JIS 的范围。
    'shift_jis': function(data) {
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
      punct: 0, latin: 0, latinSym: 0, cyrillic: 0, greek: 0, arabic: 0,
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
      // 0x0080-0x024F 细分：C1 控制符（单字节编码去解 CJK 字节流时大量产生）与
      // Latin-1 符号都不是正常正文内容，旧实现把它们一律计入 latin"良字符"，
      // 使 windows-1252/874 这类"任何字节都有对应字符"的解码获得虚高基础分。
      else if (c >= 0x0080 && c <= 0x009F) st.ctrl++;
      else if (c >= 0x00A0 && c <= 0x00BF) st.latinSym++;
      else if (c === 0x00D7 || c === 0x00F7) st.latinSym++;
      else if (c >= 0x00C0 && c <= 0x024F) st.latin++;
      else if (c === 0x00AA || c === 0x00B5 || c === 0x00BA) st.latin++;
      else if (c >= 0x0250 && c <= 0x02FF) st.latinSym++;
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

  /* 脚本画像评分
   *
   * 旧实现按"脚本只要出现就加固定分"给分（ko/th/ru +0.25、ja +0.20、zh 仅 +0.05~0.10）。
   * LRC 文件以 ASCII 时间戳与英文为主，基础分被 ASCII 稀释后这些常数直接主导结果；
   * 而 GB2312 汉字的字节几乎全部落在谚文/泰文/西里尔的码位区间内，同一段字节流用
   * euc-kr / windows-874 / windows-1251 解码同样"干净"，于是中文歌词被系统性误判为
   * 谚文、泰文乱码（实测本地 582 个歌词文件中 75 个中招）。
   *
   * 现改为按"脚本纯度"给分，并且只对不可伪造的决定性标记给高权重：
   *   - 假名：GBK 字节按 shift_jis 解码不产生假名（实测 140 个非 UTF-8 文件均为 0%），
   *     故假名占比是判定日文的决定性证据；
   *   - 谚文纯度：GBK 字节按 euc-kr 解码是"谚文+汉字"混出（实测纯度 0.40~0.77），
   *     而真正的韩文歌词纯度接近 1，故以 0.85 为门槛；
   *   - 其余脚本（含中文）只给常规加成，单字节编码"同样能解释这段字节"时由
   *     干净加成与先验决定 —— gb18030 能无损解释全部字节流即获胜（中文为默认预期）。
   */
  var _SCRIPT_BONUS = 0.25;     // 常规脚本占优加成上限
  var _DECISIVE_BONUS = 0.45;   // 决定性标记（假名 / 谚文纯度）加成上限
  var _CLEAN_BONUS = 0.06;      // 解码零未定义字符的结构加成
  var _UNDEF_WEIGHT = 0.60;     // 未定义字符率惩罚权重
  var _CRED_MIN = 0.30;         // 常规脚本最低纯度
  var _KANA_MIN_SHARE = 0.10;   // 假名占非 ASCII 比例门槛
  var _KANA_FULL_SHARE = 0.40;  // 假名占比达到此值即给满加成
  var _HANGUL_MIN_PURITY = 0.85;// 谚文占 CJK 字符的纯度门槛

  // 未定义/不可信字符数（PUA、替换符、控制符、未归类字符、Latin-1 符号）
  function undefChars(stats) {
    return stats.pua + stats.bad + stats.ctrl + stats.other + stats.latinSym;
  }

  function scriptCred(n, all) {
    if (!all) return 0;
    var cred = n / all;
    if (cred < _CRED_MIN) return 0;
    return _SCRIPT_BONUS * cred * cred;
  }

  function scriptBias(stats, lang) {
    // all：参与"脚本纯度"分母的字符数。latinSym 计入分母：真实拉丁文本几乎不含
    // Latin-1 符号，而字节流被单字节编码误读时符号占比很高，借此拉低其纯度。
    var all = stats.han + stats.kana + stats.hangul + stats.thai +
              stats.latin + stats.latinSym + stats.cyrillic + stats.arabic + stats.greek;
    switch (lang) {
      // 中文纯度只在 CJK 三者之间衡量：GB18030 本身能编码西里尔/希腊/拉丁字母，
      // 含俄语转写的 GBK 歌词不应因为夹带西里尔字母而被判定为"不够中文"
      case 'zh': return scriptCred(stats.han, stats.han + stats.kana + stats.hangul);
      case 'th': return scriptCred(stats.thai, all);
      case 'latin': return scriptCred(stats.latin, all);
      case 'cyrillic': return scriptCred(stats.cyrillic, all);
      case 'arabic': return scriptCred(stats.arabic, all);
      case 'ja': {
        var kanaShare = stats.kana / Math.max(1, stats.total - stats.ascii);
        if (kanaShare < _KANA_MIN_SHARE) return 0;
        return _DECISIVE_BONUS * Math.min(1, kanaShare / _KANA_FULL_SHARE);
      }
      case 'ko': {
        var purity = stats.hangul / Math.max(1, stats.hangul + stats.han);
        if (purity < _HANGUL_MIN_PURITY) return 0;
        return _DECISIVE_BONUS * (purity - _HANGUL_MIN_PURITY) / (1 - _HANGUL_MIN_PURITY);
      }
    }
    return 0;
  }

  // 先验：gb18030 为默认预期（中文歌词占绝对多数），其余按"跨用户可解释性"递减
  var PRIORS = {
    'gb18030': 0.04, 'big5': 0, 'shift_jis': 0, 'euc-jp': -0.02,
    'euc-kr': -0.01, 'windows-874': 0, 'windows-1252': 0,
    'iso-8859-1': -0.05, 'windows-1251': -0.10, 'windows-1256': -0.15
  };

  // 评分
  function scoreCandidate(stats, cand, text) {
    var t = stats.total || 1;
    var nonAscii = Math.max(1, t - stats.ascii);
    var good = stats.han + stats.kana + stats.hangul + stats.thai +
               stats.punct * 0.9 + stats.ascii * 0.45 + stats.latin * 0.5 +
               stats.cyrillic + stats.greek + stats.arabic;
    var bad = stats.pua * 4 + stats.bad * 10 + stats.ctrl * 3 + stats.other * 1.5;
    var s = (good - bad) / t;

    // 未定义字符率：按非 ASCII 规模归一（否则被 ASCII 结构稀释），
    // 真实文本的正确解码不会产出 PUA / 替换符 / C1 控制符。
    var undef = undefChars(stats);
    s -= undef / nonAscii * _UNDEF_WEIGHT;

    // 脚本画像
    s += scriptBias(stats, cand.lang);

    // gb18030 完整解释：GB2312 文本的全部字节都能被 gb18030 无损解释；
    // 泰文/西里尔/拉丁等单字节文本按 gb18030 解码会留下未定义字符，以此区分。
    if (cand.label === 'gb18030' && undef === 0 && stats.han > 0) s += _CLEAN_BONUS;

    // 交叉脚本惩罚（结构性知识：如 Big5 的假名区会吞下 GBK 输入）
    var kanaR = stats.kana / t;
    var hangulR = stats.hangul / t;
    var cjkR = (stats.han + stats.kana + stats.hangul) / t;
    var cjkThaiR = cjkR + stats.thai / t;
    switch (cand.lang) {
      case 'zh':
        if (cand.label !== 'gb18030' && (kanaR > 0.01 || hangulR > 0.01)) s -= 0.45;
        break;
      case 'ja': if (hangulR > 0.01) s -= 0.60; break;
      case 'ko': if (kanaR > 0.01) s -= 0.60; break;
      case 'th': if (cjkR > 0.01) s -= 0.50; break;
      case 'latin': case 'cyrillic': case 'arabic':
        if (cjkThaiR > 0.05) s -= 0.50;
        break;
    }

    // LRC 结构分
    s += checkLRCStructure(text);

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

  var _CONFUSION_BAND = 0.005;

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
      var skipA = 0, skipB = 0;
      // surrogate pairs
      if (ca >= 0xD800 && ca <= 0xDBFF && i + 1 < len) {
        var da = textA.charCodeAt(i + 1);
        if (da >= 0xDC00 && da <= 0xDFFF) { ca = ((ca - 0xD800) << 10) + (da - 0xDC00) + 0x10000; skipA = 1; }
      }
      if (cb >= 0xD800 && cb <= 0xDBFF && i + 1 < len) {
        var db = textB.charCodeAt(i + 1);
        if (db >= 0xDC00 && db <= 0xDFFF) { cb = ((cb - 0xD800) << 10) + (db - 0xDC00) + 0x10000; skipB = 1; }
      }
      if (ca === cb) { i += Math.max(skipA, skipB); continue; }
      events++;
      var pa = prefForChar(ca, textA, i), pb = prefForChar(cb, textB, i);
      if (pa > pb) votesA++;
      else if (pb > pa) votesB++;
      i += Math.max(skipA, skipB);
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
    // 平局用 Unicode 投票
    for (var k = 0; k < scored.length - 1; k++) {
      if (scored[k].score - scored[k+1].score <= _CONFUSION_BAND) {
        var vote = unicodeVote(scored[k].text, scored[k+1].text);
        if (vote < 0) { var tmp = scored[k]; scored[k] = scored[k+1]; scored[k+1] = tmp; }
      }
    }
    return scored;
  }

  /* ============================================
   * 候选池定义
   *
   * label 必须同时是 WHATWG TextDecoder 合法标签，否则 tryDecodeFatal 会抛错被吞、
   * 候选被静默剔除（原列表里的 cp932 / big5hkscs / cp949 均非合法标签，因此
   * 第 7 层的 superset 降级逻辑从未生效过 —— 该逻辑已一并移除）。
   * 注意 WHATWG 的 shift_jis 即 windows-31j/cp932、euc-kr 即 windows-949/cp949、
   * big5 已含 HKSCS 扩展，三者本就是各自变体的超集解码器，无需重复列出。
   * ============================================ */

  var CANDIDATES = [
    { label: 'gb18030', lang: 'zh', multibyte: true, prior: 0.04 },
    { label: 'big5', lang: 'zh', multibyte: true, prior: 0 },
    { label: 'shift_jis', lang: 'ja', multibyte: true, prior: 0 },
    { label: 'euc-jp', lang: 'ja', multibyte: true, prior: -0.02 },
    { label: 'euc-kr', lang: 'ko', multibyte: true, prior: -0.01 },
    { label: 'windows-874', lang: 'th', multibyte: false, prior: 0 },
    { label: 'windows-1252', lang: 'latin', multibyte: false, prior: -0.05 },
    { label: 'iso-8859-1', lang: 'latin', multibyte: false, prior: -0.10 },
    { label: 'windows-1251', lang: 'cyrillic', multibyte: false, prior: -0.10 },
    { label: 'windows-1256', lang: 'arabic', multibyte: false, prior: -0.15 }
  ];

  /* ============================================
   * detectEncoding — 主入口
   * ============================================ */

  lyric.detectEncoding = function(bytes) {
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
      return { encoding: 'gb18030', confidence: 0.2, source: 'fallback' };

    // 第 7 层: 后处理
    scored = postprocess(scored);
    var top = scored[0], second = scored[1];

    // 第 8 层: 置信度
    var gap = top.score - (second ? second.score : 0);
    var confidence = clamp(0.55 + gap * 0.9, 0.3, 0.98);

    // 低置信度记录（仅诊断用）
    if (confidence < 0.85) {
      console.warn('[lyric] low-confidence', { encoding: top.label, confidence: confidence,
        candidates: scored.slice(0, 5).map(function(c) { return { encoding: c.label, score: c.score }; }) });
    }

    return { encoding: top.label, confidence: confidence, source: 'scored' };
  };

  // 便捷: detect + decode
  lyric.decodeBytes = function(bytes) {
    var result = lyric.detectEncoding(bytes);
    var text;
    try { text = (new TextDecoder(result.encoding)).decode(bytes); }
    catch (e) { text = (new TextDecoder('utf-8')).decode(bytes); result.encoding = 'utf-8'; }
    return { text: text, encoding: result.encoding, confidence: result.confidence };
  };

  /* ============================================
   * 解析器
   * ============================================ */

  function createLine(opt) {
    return {
      time: opt.time != null ? opt.time : null,
      text: opt.text || '',
      words: opt.words || null,
      subs: opt.subs || null,
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
      // 时间标签必须形如 mm:ss[.xx]（支持 h:mm:ss、负时间等变体）：括号里没有冒号的
      // 一律视为歌词正文里的方括号（如 [123]、[Chorus]），不当作时间戳
      if (!/^-?\s*\d{1,3}\s*:\s*\d/.test(m[1])) continue;
      var t = parseTime(m[1]);
      if (!isNaN(t)) out.push({ time: t, start: m.index, end: m.index + m[0].length });
    }
    return out;
  }

  /* 同刻多行（翻译 / 音译 / 多语言）
   *
   * 双语歌词的常见形态是同一时间戳下两行以上，例如
   *     [00:20.66]若你错过了我搭乘的那班列车
   *     [00:20.66]You will know that I am gone
   * 实测本地 582 个歌词文件中 178 个含同刻组（8692 组为两行）。这些行不能被过滤或
   * 合并丢弃（合并进 translatedLyric 而渲染层不读，等于翻译整段消失），也不应各占一行
   * —— 那样高亮二分只会命中其中一行，另一行永远不亮、滚动也偏。
   * 这里把它们归成一"组"：主行 + subs（副行文本），渲染层作为整体显示与高亮。
   */
  var _GROUP_TOLERANCE_MS = 10;   // 与"±10ms 归并"一致
  var _KANA_RE = /[\u3040-\u30FF]/;

  // 行的纯文本：逐字行的正文在 words 里，text 可能为空
  function lineText(line) {
    if (line.text) return line.text;
    if (!line.words) return '';
    var s = '';
    for (var i = 0; i < line.words.length; i++) s += line.words[i].text;
    return s;
  }

  function groupSameTime(lines) {
    if (lines.length < 2) return lines;
    var groups = [], cur = null;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (cur && l.time != null && cur.time != null &&
          Math.abs(l.time - cur.time) <= _GROUP_TOLERANCE_MS) {
        cur.members.push(l);
      } else {
        cur = { time: l.time, members: [l] };
        groups.push(cur);
      }
    }
    var out = [];
    for (var g = 0; g < groups.length; g++) {
      var ms = groups[g].members;
      if (ms.length === 1) { out.push(ms[0]); continue; }
      // 主行判定（依次尝试）：
      //   1) 唯一的逐字行 —— 逐字信息一定属于正在唱的那一行；
      //   2) 唯一的含假名行 —— 中日文混合时假名出现在日文原文上；
      //   3) 文件顺序里最后一行 —— 实测 8282 : 288 的双语歌词把翻译写在原文之前。
      var mainIdx = ms.length - 1, worded = -1, wordedCount = 0, kana = -1, kanaCount = 0;
      for (var k = 0; k < ms.length; k++) {
        if (ms[k].words && ms[k].words.length > 1) { worded = k; wordedCount++; }
        if (_KANA_RE.test(lineText(ms[k]))) { kana = k; kanaCount++; }
      }
      if (wordedCount === 1) mainIdx = worded;
      else if (kanaCount === 1) mainIdx = kana;
      var main = ms[mainIdx], subs = [];
      for (var j = 0; j < ms.length; j++) {
        if (j === mainIdx) continue;
        var t = lineText(ms[j]);
        if (t) subs.push(t);
      }
      main.subs = subs;
      out.push(main);
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
      // 提取纯文本（从原始 raw 反向移除时间戳，避免索引漂移）
      var text = raw;
      for (var tj = tags.length - 1; tj >= 0; tj--) {
        text = text.slice(0, tags[tj].start) + ' ' + text.slice(tags[tj].end);
      }
      text = text.replace(/\s+/g, ' ').trim();
      // 同时移除残留的元数据标签
      text = text.replace(/\[[a-z]+:[^\]]*\]/gi, '').replace(/\s+/g, ' ').trim();
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
    return groupSameTime(lines);
  };

  /* 逐字（卡拉OK）歌词
   *
   * 两种真实存在的写法都必须支持：
   *   <mm:ss.xx>  ESLyric 逐字格式，标记在词前：
   *               [00:00.00]<00:00.00>Let<00:00.04> <00:00.09>Me<00:00.13>
   *   [mm:ss.xx]  方括号变体，标记同样在词前： [00:12.34]word1[00:12.80]word2
   * 旧实现只认方括号，导致 <...> 格式的歌词把标记原样显示出来
   * （实测显示为「<03:23.23>直<03:23.43>到…」，几千个标记全进了正文）。
   */

  // 逐字标记：捕获组 1 为尖括号内时间，组 2 为方括号内时间
  var _WORD_TAG_RE = /<(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)>|\[(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)\]/g;
  // 是否含尖括号逐字标记
  var _HAS_ANGLE_WORD = /<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/;

  // 把一行拆成逐字词：标记之间的文本归属"上一个标记"的时间，末段文本归属最后一个标记
  function tokenizeWords(s, startTime) {
    var words = [], m, curTime = startTime, pos = 0;
    _WORD_TAG_RE.lastIndex = 0;
    while ((m = _WORD_TAG_RE.exec(s)) !== null) {
      var t = parseTime(m[1] || m[2]);
      if (isNaN(t)) continue;
      var chunk = s.slice(pos, m.index);
      if (chunk || words.length > 0) {
        words.push(createWord({ text: chunk, time: curTime, startTime: curTime, endTime: t }));
      }
      curTime = t;
      pos = m.index + m[0].length;
    }
    var tail = s.slice(pos);
    if (tail) {
      words.push(createWord({ text: tail, time: curTime, startTime: curTime, endTime: curTime }));
    }
    return words;
  }

  // ESLyric 逐字解析
  lyric.parseESLRC = function(eslrc) {
    if (!eslrc) return [];
    var rawLines = eslrc.split(/\r?\n/);
    var lines = [];
    for (var i = 0; i < rawLines.length; i++) {
      var raw = rawLines[i].trim();
      if (!raw) continue;
      // 行首时间标签；缺省时（少数文件只写逐字标记）退回用第一个逐字标记当行时间
      var lineMatch = raw.match(/^\[(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)\]/);
      var rest, lineStart;
      if (lineMatch) {
        lineStart = parseTime(lineMatch[1]);
        rest = raw.slice(lineMatch[0].length);
      } else {
        var headMark = raw.match(/^<(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)>/);
        if (!headMark) continue;
        lineStart = parseTime(headMark[1]);
        rest = raw;
      }
      if (isNaN(lineStart)) continue;
      rest = rest.trim();
      if (!rest) continue;

      var words = tokenizeWords(rest, lineStart);
      if (words.length === 0) {
        // 无逐字信息 → 去掉两种标记后按整行文本处理
        var plainText = rest.replace(_WORD_TAG_RE, '').replace(/\[[^\]]*\]/g, '').trim();
        if (!plainText) continue;
        words.push(createWord({
          text: plainText,
          time: lineStart, startTime: lineStart, endTime: lineStart
        }));
      }
      // 同时填 text：逐字行的正文在 words 里，但"同刻副行归组""纯文本渲染"等
      // 下游逻辑读的是 text，留空会让翻译行被当成空行丢掉
      var joined = '';
      for (var wi = 0; wi < words.length; wi++) joined += words[wi].text;
      lines.push(createLine({ text: joined, words: words, time: lineStart, startTime: lineStart, endTime: null }));
    }
    // 按 line.time 排序（渲染层的二分高亮用的就是该字段）；首词时间仅作次键。
    // 旧实现按首词时间排序，行内另有前置时间标签时二者可能不一致，导致行的
    // time 序列非升序、高亮跳错行。
    lines.sort(function(a, b) {
      if (a.time !== b.time) return a.time - b.time;
      var ta = a.words && a.words.length ? a.words[0].startTime : 0;
      var tb = b.words && b.words.length ? b.words[0].startTime : 0;
      return ta - tb;
    });
    for (var k = 0; k < lines.length - 1; k++) {
      var nextTime = lines[k+1].words && lines[k+1].words.length ? lines[k+1].words[0].startTime : lines[k].startTime;
      lines[k].endTime = nextTime;
    }
    return groupSameTime(lines);
  };

  // 自动检测 + 解析
  lyric.parse = function(text, fmt) {
    if (!text) return [];
    text = String(text);
    if (fmt) {
      if (fmt === 'eslrc') return lyric.parseESLRC(text);
      if (fmt === 'lrc') return lyric.parseLRC(text);
    }
    // 自动检测
    // 逐字（卡拉OK）歌词：ESLyric 的 <mm:ss.xx> 标记，或方括号变体 ]text[mm:ss
    // （后者必须匹配 ]text[mm:ss 模式，避免误把普通 LRC 的歌词字面括号当成时间标签）
    if (_HAS_ANGLE_WORD.test(text) || /\][^\[\]\n<]+\[\d{1,2}:\d{2}/.test(text)) {
      var es = lyric.parseESLRC(text);
      if (es.length) return es;
    }
    // 标准 LRC：直接尝试解析、有结果即采用。比逐条枚举标签写法更稳，
    // 可覆盖 [mm:ss]、[h:mm:ss]、[mm:ss.xx-N] 等真实变体（这些写法曾因
    // 行首正则不匹配而被整首当成纯文本，时间轴与逐行高亮全部丢失）。
    // 无任何时间标签时 parseLRC 返回空数组，不会与纯文本歌词混淆。
    var lrc = lyric.parseLRC(text);
    if (lrc.length) return lrc;
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