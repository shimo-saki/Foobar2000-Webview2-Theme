/* ============================================
 * CloudMusic lyric-core.js — 编码检测 + 模块化歌词解析
 * 挂载到 CM.lyric 子命名空间
 * 加载顺序: core.js → lyric-core.js → ui.js
 * ============================================ */

(function() {
  'use strict';
  var CM = window.CloudMusic;
  var lyric = CM.lyric = {};
  lyric.lastVerdict = 'none';   // 上次解析的双语判定结果，供歌词面板右键菜单显示

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
      // 主行判定：同一时刻的第一行（文件里的自然顺序）为主，之后皆为副行。
      // 原实现用了"逐字行优先 / 含假名行优先 / 最后一行优先"三重启发式，
      // 在翻译写在前面的双语歌词中会把译文当主行，且隔行错位的中日歌词无法
      // 改善配对 —— 不如一个简单一致的可预测规则。
      var main = ms[0], subs = [];
      for (var j = 1; j < ms.length; j++) {
        var t = lineText(ms[j]);
        if (t) subs.push(t);
      }
      main.subs = subs;
      out.push(main);
    }
    return out;
  }

  /* ============================================
   * 双语配对协议归一："译文延后一行"
   *
   * 同刻归组只对"同刻协议"的双语歌词成立：
   *     同刻协议   [00:10.00]原文 / [00:10.00]译文
   *     延后协议   [00:10.00]原文 / [00:12.00]译文 / [00:12.00]下一句原文
   * 后者（TME / QQ 音乐等来源的常见写法）把译文写在**下一句原文**的时间戳上。
   * 若按同刻归组，"上一句的译文"会与"下一句原文"配成一组（译文当主行），首句原文
   * 完全落单；实测本地 582 个歌词文件中 195 个属于这种协议（同刻协议约 39 个）。
   *
   * 两种协议在结构上互为相位平移（把每组两行的角色对调即得另一种），因此任何局部
   * 特征（含不含假名、谁长谁短、有无逐字标记、谁写在前面）都无法区分 —— 判定只能
   * 依赖两个整体事实：
   *   1) 相位：主体首行的时间戳在另一语言侧没有同刻行（延后协议下首句原文必然落单）；
   *   2) 关系式：每条译文行的时间戳 == 紧随其后的原文行的时间戳。
   * 实测两种协议的匹配率高度双峰（延后协议 ≈100%、同刻协议 ≈0%），阈值不敏感。
   * 任一条件不成立就一行都不改：部分翻译、多行同刻、两侧同脚本、自相矛盾的文件
   * 一律维持现状。归一动作只是把译文时间戳回移一格，主行判定仍交给 groupSameTime
   * 的"首行即主行"规则，不重新引入任何"哪行才是主行"的猜测。
   * ============================================ */

  var _BI_MIN_MATCH = 0.90;    // 关系式匹配率阈值（两协议实测 0% / 100%，阈值不敏感）
  var _BI_MIN_SIDE = 3;        // 每侧最少行数
  var _BI_MIN_COVER = 0.85;    // 两个脚本族合计占比门槛
  var _BI_TOL_MS = 10;         // 时间戳相等容差

  // 片头信息行（只用于判定，不影响显示）：制作人员 / 版权声明 / 占位符 / 曲名行
  // 简繁两种写法都要覆盖：漏掉一条（如繁体「詞：」）就会让信息行充任"主体首行"，
  // 相位判反 → 把同刻协议的文件按延后协议改写。实测这正是本地 冬の花.lrc 出错的原因。
  var _BI_CREDIT_RE = /^[^:：\n]{0,10}(?:作词|作詞|作曲|编曲|編曲|制作|製作|监制|監製|混音|母带|母帶|录音|錄音|吉他|贝斯|贝絲|鼓|键盘|鍵盤|和声|和聲|出品|发行|發行|策划|策劃|统筹|統籌|翻译|翻譯|校对|校對|配唱|合声|合聲|词|詞|曲|OP|SP|ISRC|A&R)[^:：\n]{0,8}[:：]/;
  var _BI_NOTICE_RE = /著作权|翻译作品|未经许可|以下歌词翻译|Lyrics by|Composed by|Produced by|Written by|Arranged by|Mixed by|Mastered by|Music by|Words by/;
  var _BI_PLACEHOLDER_RE = /^[\s\-—–·…,，.。、/\\|*]+$/;
  var _BI_TITLE_RE = /^.{0,45}\s[-–]\s.{0,45}$/;
  var _BI_CREDIT_MAX_LEN = 40;

  // 判定用信息行：先做便宜的前置过滤再上正则。制作信息那两条长正则只在
  // "短行且带冒号"（词：/編曲：/OP：…）上跑，普通歌词行直接跳过。
  // _BI_CREDIT_RE 自身要求结尾有冒号，故前置条件与它等价、不改判定结果。
  function _isCreditLine(text, idx) {
    if (text.length <= _BI_CREDIT_MAX_LEN &&
        (text.indexOf(':') >= 0 || text.indexOf('：') >= 0) &&
        _BI_CREDIT_RE.test(text)) return true;
    if (_BI_NOTICE_RE.test(text)) return true;
    return _BI_PLACEHOLDER_RE.test(text) || (idx < 3 && _BI_TITLE_RE.test(text));
  }

  /* 脚本族：判定用的粗分类。不写死"中文 vs 非中文"——取占比最高的两个族作为"两侧"，
   * 使中日、中韩、英日、英韩、俄中等任意两种文字的组合都成立。
   * 每行只算一次，结果存进 _bilingualBody 的 fam 数组供全流程复用：
   * 分侧、找同刻组、关系式、回移都要用它，重复计算会把一个 150 行文件的
   * 分类次数从 1 次放大到 4~5 次。 */
  function _lineFamily(s) {
    var han = 0, kana = 0, hangul = 0, latin = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0x3040 && c <= 0x30FF) kana++;
      else if ((c >= 0xAC00 && c <= 0xD7AF) || (c >= 0x1100 && c <= 0x11FF)) hangul++;
      else if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF) || (c >= 0xF900 && c <= 0xFAFF)) han++;
      else if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || (c >= 0xC0 && c <= 0x24F)) latin++;
    }
    if (kana) return 'J';                       // 假名：日文决定性标记
    if (hangul) return 'G';                     // 谚文：韩文决定性标记
    if (han && latin / (han + latin) < 0.6) return 'H';
    if (latin) return 'L';
    if (han) return 'H';
    return 'O';
  }

  /* 判定用主体：剔除信息行（不影响显示，只是不参与判定），并顺便算出
   *   - text[i]：该行的纯文本（去信息行判定已经算过，后面不再重复取）
   *   - fam[i] ：该行的脚本族（分侧/找同刻组/关系式/回移全部复用，不再重复分类）
   * 单趟完成，后面的分析全部只做数组查表。
   * 注意：这里不再重复检测"是否存在重复时间戳" —— 那是调用方 _hasSameTimePair 的
   * 结论（没有同刻组就不会走到这里），整条判定链路只检测一次。 */
  function _bilingualBody(lines) {
    var body = [], text = [], fam = [], i, t;
    for (i = 0; i < lines.length; i++) {
      t = lineText(lines[i]);
      if (!t || _isCreditLine(t, i)) continue;
      body.push(lines[i]);
      text.push(t);
      fam.push(_lineFamily(t));
    }
    return { lines: body, text: text, fam: fam };
  }

  /* 译文挂回它的原文（= 该译文之前最近的一条原文行）。side 为按下标取侧的查询函数。
   * 两类"漏网行"在这里补上（实测语料 13 个文件、全是改善，其中 7 个抽查逐条核对）：
   *   1) 非译文的第三族行（英文原词、英文副标题、韩文原词…）也参与 lastOrig 推进。
   *      旧逻辑只认主族原文，于是"英文原文行 → 它的中文译文"里的译文会挂到更早的一句
   *      日文原文上（God Knows....lrc：日文行同时挂走两条中文译文）。
   *   2) 第三族行中"其实是译文"的（中英混排，如「无比炽热 Like a Bloody Stone」：
   *      拉丁占比高被分到 L 族）按位置特征回移：与下一行同刻、脚本族不同、文字不同，
   *      且下一行属于原文侧。旧逻辑完全跳过它们，那一组就变成 3 行、主行还是上一句译文。 */
  function _shiftBack(body, from, side, origSide, fam, text, origFam) {
    var lastOrig = null;
    for (var i = from; i < body.length; i++) {
      var s = side(i);
      var isTrans = (s === 1 - origSide);
      if (s < 0) {
        var nx = body[i + 1];
        if (nx && Math.abs(nx.time - body[i].time) <= _BI_TOL_MS &&
            fam[i] !== fam[i + 1] && text[i] !== text[i + 1] &&
            (!origFam || fam[i + 1] === origFam)) isTrans = true;
      }
      if (!isTrans) { lastOrig = body[i]; continue; }
      if (!lastOrig) continue;
      body[i].time = lastOrig.time;
      body[i].startTime = lastOrig.time;
      if (body[i].words && body[i].words.length) body[i].words[0].startTime = lastOrig.time;
    }
  }

  /* 主判据：按脚本分侧 + 关系式。返回 'delay'（已归一）| 'same'（确认同刻，不改写）| 'unknown'
   * body/fam 由 _bilingualBody 一次算好，这里只做数组查表，不再重复分类字符串。 */
  function normalizeBilingualLayout(body, fam, text) {
    if (body.length < _BI_MIN_SIDE * 2) return 'unknown';
    // 两侧 = 占比最高的两个脚本族
    var i, count = {};
    for (i = 0; i < body.length; i++) count[fam[i]] = (count[fam[i]] || 0) + 1;
    var fams = Object.keys(count).sort(function(a, b) { return count[b] - count[a]; });
    if (fams.length < 2) return 'unknown';
    if ((count[fams[0]] + count[fams[1]]) / body.length < _BI_MIN_COVER) return 'unknown';
    var famA = fams[0], famB = fams[1];
    var side = function(i) {
      var f = fam[i];
      return f === famA ? 0 : f === famB ? 1 : -1;   // -1：不属于两个主族（不参与判定）
    };
    // 相位锚点：首个"跨语言同刻组"R = [a, b]（同刻且两侧脚本族不同），
    // 关键信息就在它与紧邻其前的那条歌词行 p 的关系上：
    //   p 与 b 同侧 → R 形如「上一句的译文 + 本句原文」→ 延后协议（p 是原文，a 是它的译文）
    //   p 与 a 同侧 → R 形如「本句原文 + 本句译文」→ 同刻协议
    //   R 之前没有歌词行（只有信息行/占位行）→ 同刻协议
    // 同刻协议一律不改。
    var runA = -1;
    for (i = 0; i + 1 < body.length; i++) {
      if (Math.abs(body[i].time - body[i + 1].time) <= _BI_TOL_MS) {
        var s0 = side(i), s1 = side(i + 1);
        if (s0 >= 0 && s1 >= 0 && s0 !== s1) { runA = i; break; }
      }
    }
    if (runA < 0) return 'unknown';       // 没有"跨语言同刻组" → 判不出（两侧语言不明或同一语言）
    if (runA === 0) return 'same';        // 主体首行就是游程首行（之前只有信息行）→ 同刻协议
    var pSide = side(runA - 1), aSide = side(runA), bSide = side(runA + 1);
    if (pSide !== bSide) {
      // p 与游程首行同侧 → R 形如「本句原文 + 本句译文」→ 确认同刻；否则（p 不属于主族）判不出
      return pSide === aSide ? 'same' : 'unknown';
    }
    var first = runA - 1;
    var origSide = bSide;
    // 关系式：每条译文行的时间戳 == 紧随其后的原文行的时间戳。
    // "紧随其后的原文行"用一次反向扫描预先算出（原实现每行内层再扫一遍，最坏 O(n²)）
    var nextOrig = new Array(body.length), nx = -1;
    for (i = body.length - 1; i >= first; i--) {
      nextOrig[i] = nx;
      if (side(i) === origSide) nx = i;
    }
    var total = 0, matched = 0;
    for (i = first; i < body.length; i++) {
      if (side(i) !== 1 - origSide) continue;
      total++;
      var nxt = nextOrig[i];
      if (nxt < 0) { if (i === body.length - 1) matched++; continue; }   // 末句译文无后继原文
      if (Math.abs(body[i].time - body[nxt].time) <= _BI_TOL_MS) matched++;
    }
    if (total < _BI_MIN_SIDE) return 'unknown';
    if (matched / total < _BI_MIN_MATCH) return 'unknown';
    _shiftBack(body, first, side, origSide, fam, text, origSide === 0 ? famA : famB);
    return 'delay';
  }

  /* 兜底判据：位置相位
   *
   * 日文歌词里大量"整行全汉字"的写法（如 aLIEz）会让全汉字日文行与中文行同族、
   * 两侧分不开，上面的主判据失效。此时改用位置相位：延后协议的相邻两组是
   * "…译文/原文 … 译文/原文…" 交错，按扁平顺序两两成组后其特征是
   *    每对第二行的时间戳 == 下一对第一行的时间戳
   * 而同刻协议（相位对齐时）每对两行时间戳相等。两种协议实测得分 ≈100% 与 0%。
   *
   * 注意：位置相位本身是二义的（相位错开一格时同刻协议也会呈现同样的"错位"形状，
   * 例如 ねぇねぇねぇ.lrc），所以必须先过相位门：主体首行的时间戳在主体内唯一
   * —— 这是延后协议的必然结果（首句原文的译文写在下一句原文的时间上，故首行落单），
   * 同刻协议的主体首行必然与它的译文同刻。该门与脚本分类无关，故对全汉字日文行同样有效。
   */
  function normalizeByPhase(body) {
    if (body.length < _BI_MIN_SIDE * 2) return 'unknown';
    // 相位门：主体首行落单
    var i;
    for (i = 1; i < body.length; i++) {
      if (Math.abs(body[i].time - body[0].time) <= _BI_TOL_MS) return 'unknown';
    }
    var pairs = Math.floor(body.length / 2), lag = 0, k;
    for (k = 0; k < pairs; k++) {
      var u = body[k * 2], v = body[k * 2 + 1];
      if (Math.abs(u.time - v.time) <= _BI_TOL_MS) continue;      // 同刻 → 非延后特征
      if (k * 2 + 2 < body.length) {
        if (Math.abs(v.time - body[k * 2 + 2].time) <= _BI_TOL_MS) lag++;
      } else lag++;                                               // 末对：译文挂到最后
    }
    if (lag / pairs < _BI_MIN_MATCH) return 'unknown';
    for (k = 0; k < pairs; k++) {
      var a = body[k * 2], b = body[k * 2 + 1];
      b.time = a.time;
      b.startTime = a.time;
      if (b.words && b.words.length) b.words[0].startTime = a.time;
    }
    return 'delay';
  }


  /* 强制"译文延后一行"
   *
   * 用户在歌词面板右键选择该模式时使用：不做任何判定，直接按延后协议的形态改写
   * —— 每个同刻组 [a, b] 视作「上一句的译文 + 本句原文」，把 a 挂回上一条原文的时间。
   * 用于判定判不出来的文件（例如日文歌词里夹未翻译的英文原词，两侧无法分侧的
   * King Gnu-AIZO 这类）。仍保留两条最小护栏：两侧脚本族相同的组不改（那是同一语言
   * 的两行，不构成译文对），以及组内两行文字相同的组不改（纯重复行）。
   */
  function _forceDelayShift(body, text, fam) {
    var lastOrig = null, hit = 0, i;
    for (i = 0; i < body.length; i++) {
      var l = body[i], nx = body[i + 1];
      if (nx && Math.abs(l.time - nx.time) <= _BI_TOL_MS) {
        var fa = fam[i], fb = fam[i + 1];
        if (lastOrig && text[i] !== text[i + 1] && (fa === 'O' || fb === 'O' || fa !== fb)) {
          l.time = lastOrig.time;
          l.startTime = lastOrig.time;
          if (l.words && l.words.length) l.words[0].startTime = lastOrig.time;
          hit++;
        }
        lastOrig = nx;      // 组的第二行是"本句原文"
        i++;
      } else {
        lastOrig = l;       // 落单行按原文处理（未翻译的原文/背景和声等）
      }
    }
    return hit > 0;
  }

  /* 归一入口：mode = 'auto' | 'same'（不改写） | 'offset'（强制延后）
   * 同时把判定结果写进 lyric.lastVerdict，供歌词面板右键菜单显示当前识别状态。 */
  /* 是否存在"重复时间戳"（同刻组）。lines 此时已按时间升序，只需与相邻行比较。
   * 这是整个双语判定的总开关：只有同刻组才可能有对齐问题，单语言/纯文本歌词
   * 直接在这里返回，不再构建主体、不做脚本分类、不跑正则 —— 判定开销归零。 */
  function _hasSameTimePair(lines) {
    for (var i = 0; i + 1 < lines.length; i++) {
      if (lines[i + 1].time - lines[i].time <= _BI_TOL_MS) return true;
    }
    return false;
  }

  /* 归一入口：mode = 'auto' | 'same'（不改写） | 'offset'（强制延后）
   * 同时把判定结果写进 lyric.lastVerdict（'none'/'delay'/'same'/'unknown'），
   * 供歌词面板右键菜单显示识别状态、并决定是否显示"翻译对齐方式"这一项。 */
  function normalizeBilingual(lines, mode) {
    lyric.lastVerdict = 'none';
    if (!_hasSameTimePair(lines)) return false;   // 无同刻组 → 没有对齐问题
    if (mode === 'same') { lyric.lastVerdict = 'same'; return false; }
    var b = _bilingualBody(lines), body = b.lines;
    if (mode === 'offset') {
      if (_forceDelayShift(body, b.text, b.fam)) { lyric.lastVerdict = 'delay'; return true; }
      lyric.lastVerdict = 'unknown';
      return false;
    }
    var v = normalizeBilingualLayout(body, b.fam, b.text);
    // 兜底判据只在主判据"判不出"时使用：主判据已确认同刻的文件不再被它推翻
    // （两者相位门不同，若都生效会出现"结论由弱判据决定"的不自洽）
    if (v === 'unknown' && normalizeByPhase(body) === 'delay') v = 'delay';
    lyric.lastVerdict = v;
    return v === 'delay';
  }

  // 标准 LRC 解析
  lyric.parseLRC = function(lrc, mode) {
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
    // 计算 endTime（取下一行 startTime；在归一之前做，保持原文行拿到真实的下一句时间）
    for (var k = 0; k < lines.length - 1; k++) {
      lines[k].endTime = lines[k+1].startTime;
      if (lines[k].words && lines[k].words.length) lines[k].words[0].endTime = lines[k+1].startTime;
    }
    // 双语协议归一（译文延后一行 → 同刻）：mode 由歌词面板按文件记忆，默认自动判定。
    // 归一会把译文时间戳回移一格挂回原文，数组因此可能不再按时间升序 —— 必须稳定重排：
    // 渲染层高亮用二分查找"最后一条 time <= pos"的行，依赖组时间非递减，不重排会出现
    // "后一组的时间早于前一组"（实测本地 11 个文件），高亮与滚动会跳错行。
    // 稳定排序保证同刻时"原文在前、译文在后"的相对次序不变（主行仍是原文）。
    if (normalizeBilingual(lines, mode || lyric.bilingualMode || 'auto')) {
      lines.sort(function(a, b) { return a.time - b.time; });
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
  lyric.parse = function(text, fmt, mode) {
    if (!text) return [];
    text = String(text);
    // 每次解析先清判定结果：逐字（ESLyric）与纯文本歌词不走双语判定，
    // 不清会让菜单/缓存残留上一首的识别状态
    lyric.lastVerdict = 'none';
    if (fmt) {
      if (fmt === 'eslrc') return lyric.parseESLRC(text);
      if (fmt === 'lrc') return lyric.parseLRC(text, mode);
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
    var lrc = lyric.parseLRC(text, mode);
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