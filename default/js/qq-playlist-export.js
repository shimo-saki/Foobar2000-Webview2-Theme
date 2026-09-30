/* ============================================================
 * QQ 音乐歌单导出（「导入歌单」面板「复制导出脚本」按钮的源码）
 * ------------------------------------------------------------
 * 本文件被主题页面加载时**只定义、不执行**（域名不匹配）；
 * 「复制导出脚本」按钮复制的就是这个函数的源码。
 *
 * 用户流程：点「复制导出脚本」→ 浏览器打开 y.qq.com 的歌单详情页
 * （地址形如 https://y.qq.com/n/ryqq_v2/playlist/<歌单ID>）→
 * F12 → 控制台(Console) → 粘贴回车 → 自动滚动加载全部曲目，
 * 「歌名 - 歌手」每行一首复制到剪贴板（同时下载 .txt 备份）→
 * 回主题「导入歌单」面板粘贴导入。
 *
 * 原理：歌单页 DOM 里就带着每首歌的名称与歌手，脚本只做
 * 滚动加载 + 文本抽取，不调用任何接口、不需要登录态。
 * ============================================================ */
window.qqPlaylistExport = async function () {
  'use strict';

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var sel = 'a[href*="songDetail/"], a[href*="/song/"]';

  /* ---- 自动滚动加载全部曲目（连续 6 轮数量不变视为到底） ---- */
  console.log('[歌单导出] 正在滚动加载曲目…');
  var prev = -1, stable = 0;
  for (var i = 0; i < 120 && stable < 6; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    document.querySelectorAll('div, section, main').forEach(function (el) {
      if (el.scrollHeight > el.clientHeight + 50) el.scrollTop = el.scrollHeight;
    });
    /* 有些列表靠「加载更多 / 展开」按钮追加内容，能点就点 */
    document.querySelectorAll('button, a, div[class*="more"], span[class*="more"]').forEach(function (el) {
      var t = (el.textContent || '').trim();
      if (t.length < 12 && /加载更多|展开全部|查看更多曲目|显示更多/.test(t)) el.click();
    });
    await sleep(500);
    var n = document.querySelectorAll(sel).length;
    if (n === prev) stable++; else { stable = 0; prev = n; }
  }

  /* ---- 抽取「歌名 - 歌手」 ---- */
  var seen = {}, lines = [];
  document.querySelectorAll(sel).forEach(function (a) {
    var mid = (a.getAttribute('href') || '').split('/').pop().split('?')[0];
    if (!mid || seen[mid]) return;
    seen[mid] = 1;
    var title = (a.textContent || '').replace(/\s+/g, ' ').trim();
    if (!title) return;
    var row = a.closest('li') || a.closest('tr') || a.parentElement.parentElement.parentElement;
    var rowText = row ? (row.textContent || '').replace(/\s+/g, ' ').trim() : '';
    /* 行文本形如：…播放添加到歌单分享孙一菲06:13找到自己 —— 歌手在「分享」和时长之间 */
    var m = rowText.match(/分享(.+?)(\d{1,2}:\d{2})/);
    var artist = m ? m[1].trim() : '';
    lines.push(artist ? title + ' - ' + artist : title);
  });

  if (!lines.length) {
    console.error('[歌单导出] 没抓到曲目 —— 请确认当前页面是歌单详情页，且曲目列表已经显示出来。');
    return;
  }
  /* 网页端可能只展示歌单的一部分（大歌单提示「下载客户端查看更多」） */
  if (/下载客户端|查看更多内容/.test(document.body.textContent || '')) {
    console.warn('[歌单导出] 页面出现「下载客户端」提示：网页可能只展示了歌单的一部分，' +
                 '本次抓到 ' + lines.length + ' 首，未必是歌单全部。');
  }

  var text = lines.join('\n');
  try { copy(text); console.log('[歌单导出] 已复制 ' + lines.length + ' 行到剪贴板。'); }
  catch (e) { console.log('[歌单导出] 剪贴板不可用，曲目清单如下：\n' + text); }

  try {
    var blob = new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (document.title.split('-')[0].trim() || 'qq-playlist') + '.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) { /* 下载失败不影响剪贴板结果 */ }

  console.log('[歌单导出] 共 ' + lines.length + ' 首：\n  ' + lines.slice(0, 5).join('\n  ') +
              (lines.length > 5 ? '\n  …' : '') +
              '\n[歌单导出] 回到主题「QQ 音乐 → 导入歌单」粘贴即可。');
};
/* 粘贴进 y.qq.com 的控制台时自动运行一次；本主题页面的域名不匹配、不会执行 */
if (/(^|\.)y\.qq\.com$/.test(String(location.hostname))) window.qqPlaylistExport();
