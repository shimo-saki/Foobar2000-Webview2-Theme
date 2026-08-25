/* ============================================
 * CloudMusic netmusic.js — 网络音乐（音乐源）
 * 音源管理（多源互备）+ 协议解析 + 搜索 + 播放/队列 + 下载
 * 音源由用户自己提供，主题只负责解析与调用播放/保存
 * ============================================ */
(function() {
  'use strict';
  var CM = window.CloudMusic;
  var esc = CM.escHtml;
  var enc = encodeURIComponent;

  var NET_KEY = 'netSources';
  var WHITELIST_PREFIX = ['%music%', '%profile%', '${music_path}', '$music'];

  function el(id) { return document.getElementById(id); }
  function sources() { return Array.isArray(CM.settings[NET_KEY]) ? CM.settings[NET_KEY] : []; }

  /* ============================================
   * 通用二进制/文本 HTTP 请求（同步模式，逐请求拿最终响应）
   * ============================================ */
  function httpGet(url, timeout) {
    return CM.api('http.get', { url: url, async: false, timeout: timeout || 12000 }).then(function(r) {
      if (!r || r.success === false) return null;
      if (r.status != null && (r.status < 200 || r.status >= 300)) return null;
      return r;
    });
  }
  function httpPost(url, body, timeout) {
    return CM.api('http.post', { url: url, body: body || {}, async: false, timeout: timeout || 12000 }).then(function(r) {
      if (!r || r.success === false) return null;
      if (r.status != null && (r.status < 200 || r.status >= 300)) return null;
      return r;
    });
  }

  /* ============================================
   * 协议适配器：search → 归一化歌曲[]（不可达返回 null，可达无结果返回 []）
   *             playUrl → 播放直链(字符串)或 null
   *             lyric   → LRC 文本
   * ============================================ */
  function normSong(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var id = raw.id != null ? raw.id : (raw.songmid || raw.hash || raw.songId || raw.mid);
    if (id == null) return null;
    var title = raw.name || raw.title || raw.songname || raw.songName || '未知';
    var arRaw = raw.artist || raw.singer || raw.singers || (raw.ar && raw.ar.map(function(a) { return a && a.name; })) || (raw.artists && raw.artists.map(function(a) { return a && a.name; }));
    var artist = Array.isArray(arRaw) ? arRaw.filter(Boolean).join(' / ') : (arRaw || '未知艺术家');
    var album = raw.album || raw.albumname || (raw.al && raw.al.name) || (raw.album && raw.album.name) || '';
    var dt = +raw.dt || +raw.duration || +raw.interval || 0;
    var durSec = dt >= 100000 ? Math.round(dt / 1000) : Math.round(dt);
    var art = raw.picUrl || raw.pic || raw.albumPic || (raw.al && raw.al.picUrl) || (raw.album && raw.album.picUrl) || '';
    return { sourceId: null, id: id, title: title, artist: artist, album: album, duration: durSec, art: art };
  }

  function pickSongList(body) {
    var src = body ? (body.data || body) : null;
    var arr = null;
    if (Array.isArray(body)) arr = body;
    else if (!src) return null;
    else if (Array.isArray(src)) arr = src;
    else if (Array.isArray(src.list)) arr = src.list;
    else if (Array.isArray(src.songs)) arr = src.songs;
    else if (body.result && Array.isArray(body.result.songs)) arr = body.result.songs;
    else if (Array.isArray(body.songs)) arr = body.songs;
    if (!arr || !arr.length) return null;
    return arr.map(normSong).filter(Boolean);
  }

  var ADAPTERS = {
    lx: {
      label: 'LX Music API（lx-music-api-server）',
      search: function(base, kw, limit) {
        return httpGet(base + '/search?keywords=' + enc(kw) + '&limit=' + (limit || 30), 12000).then(function(r) {
          if (!r) return null;
          try { var list = pickSongList(JSON.parse(r.body)); return list || []; } catch (e) { return null; }
        });
      },
      playUrl: function(base, song) {
        return httpPost(base + '/song/url', { id: song.id, br: 320000 }, 15000).then(function(r) {
          if (!r) return null;
          try {
            var d = JSON.parse(r.body), data = d && d.data;
            return (data && typeof data === 'object') ? (data.url || (data[0] && data[0].url)) : null;
          } catch (e) { return null; }
        });
      },
      lyric: function(base, song) {
        return httpPost(base + '/song/lyric', { id: song.id }, 12000).then(function(r) {
          if (!r) return '';
          try { var d = JSON.parse(r.body), x = d && d.data; return (x && (x.lrc || x.lyrics)) || ''; } catch (e) { return ''; }
        });
      }
    },
    netease: {
      label: '网易云（NeteaseCloudMusicApi）',
      search: function(base, kw, limit) {
        return httpGet(base + '/search?keywords=' + enc(kw) + '&limit=' + (limit || 30), 12000).then(function(r) {
          if (!r) return null;
          try { var list = pickSongList(JSON.parse(r.body)); return (list && list.length) ? list : []; } catch (e) { return null; }
        });
      },
      playUrl: function(base, song) {
        return httpGet(base + '/song/url?id=' + song.id + '&br=320000', 15000).then(function(r) {
          if (!r) return null;
          try { var d = JSON.parse(r.body), arr = d && d.data, u = arr && arr[0] && (arr[0].url || arr[0].src); return u || null; } catch (e) { return null; }
        });
      },
      lyric: function(base, song) {
        return httpGet(base + '/lyric?id=' + song.id, 12000).then(function(r) {
          if (!r) return '';
          try { var d = JSON.parse(r.body); return (d && d.lrc && d.lrc.lyric) || ''; } catch (e) { return ''; }
        });
      }
    }
  };

  function stripBase(u) { return (u || '').replace(/\/+$/, ''); }
  function srcAdp(src) { return ADAPTERS[src.protocol] || ADAPTERS.lx; }

  /* ============================================
   * 音源选择/辅助
   * ============================================ */
  var netSourceSelect = el('netSourceSelect');
  var netSearchInput = el('netSearchInput');
  var netResults = el('netResults');
  var netGuide = el('netGuide');
  var netBody = el('netBody');
  var netOfflineBanner = el('netOfflineBanner');

  function enabledSources() {
    return sources().filter(function(s) { return s.enabled !== false; });
  }
  function pickSources() {
    var all = enabledSources();
    var sel = netSourceSelect && (netSourceSelect.value || 'auto');
    if (sel && sel !== 'auto') all = all.filter(function(s) { return s.id === sel; });
    return all.sort(function(a, b) { return (a.priority || 0) - (b.priority || 0); });
  }
  function buildSourceSelect() {
    if (!netSourceSelect) return;
    var enabled = enabledSources();
    var html = '<option value="auto">全部音源（按优先级自动切）</option>';
    enabled.forEach(function(s, i) {
      html += '<option value="' + esc(s.id) + '">' + esc(s.name || ('音源' + (i + 1))) + ' · ' + esc(ADAPTERS[s.protocol] ? ADAPTERS[s.protocol].label : s.protocol) + '</option>';
    });
    if (!enabled.length) html = '<option value="auto">（暂无可用音源）</option>';
    var cur = CM.settings.netLastSourceId;
    netSourceSelect.innerHTML = html;
    if (cur && enabled.some(function(s) { return s.id === cur; })) netSourceSelect.value = cur;
  }
  netSourceSelect.addEventListener('change', function() {
    CM.settings.netLastSourceId = netSourceSelect.value === 'auto' ? '' : netSourceSelect.value;
    CM.saveSettings();
  });

  function updateGuide() {
    var has = enabledSources().length > 0;
    if (netGuide) netGuide.style.display = has ? 'none' : '';
    if (netBody) netBody.classList.toggle('no-source', !has);
    if (netResults) netResults.style.display = has ? '' : 'none';
  }

  /* ============================================
   * 可复用弹窗
   * ============================================ */
  function openDialog(opts) {
    return new Promise(function(resolve) {
      if (!opts) return resolve(null);
      var ov = document.createElement('div');
      ov.className = 'net-dlg-overlay';
      ov.innerHTML =
        '<div class="net-dlg">' +
        '<div class="net-dlg-head"><div class="net-dlg-title"></div><button class="net-dlg-x"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>' +
        '<div class="net-dlg-body"></div>' +
        '<div class="net-dlg-foot">' +
        (opts.cancelLabel !== null ? '<button class="modal-btn ghost net-dlg-cancel"></button>' : '') +
        '<button class="modal-btn ' + (opts.danger ? 'danger' : 'primary') + ' net-dlg-ok"></button>' +
        '</div>' +
        '</div>';
      var q = function(s) { return ov.querySelector(s); };
      q('.net-dlg-title').textContent = opts.title || '';
      var body = q('.net-dlg-body');
      body.innerHTML = opts.body || '';
      q('.net-dlg-ok').textContent = opts.okLabel || '确定';
      if (opts.cancelLabel !== null) q('.net-dlg-cancel').textContent = opts.cancelLabel || '取消';
      document.body.appendChild(ov);
      requestAnimationFrame(function() { ov.classList.add('open'); });
      var done = false;
      function close(res) {
        if (res === false || done) return; // false = 校验失败，保持打开
        done = true;
        ov.classList.remove('open');
        setTimeout(function() { ov.remove(); }, 180);
        resolve(res);
      }
      q('.net-dlg-ok').addEventListener('click', function() { close(opts.onOk ? opts.onOk(body) : true); });
      var cb = q('.net-dlg-cancel');
      if (cb) cb.addEventListener('click', function() { close(null); });
      q('.net-dlg-x').addEventListener('click', function() { close(null); });
      ov.addEventListener('mousedown', function(e) { if (e.target === ov) close(null); });
      if (opts.onReady) opts.onReady(body);
      var firstInput = body.querySelector('input');
      if (firstInput) setTimeout(function() { firstInput.focus(); }, 80);
    });
  }
  function field(label, inner) {
    return '<label class="net-field"><span class="net-field-label">' + label + '</span>' + inner + '</label>';
  }

  if (el('netManageBtn')) {
    el('netManageBtn').addEventListener('click', openManageDialog);
    el('netAddFirstBtn').addEventListener('click', function() { openSourceDialog(null); });
  }

  /* ============================================
   * 音乐源管理面板
   * ============================================ */
  function openManageDialog() {
    openDialog({
      title: '音乐源管理',
      cancelLabel: null,
      okLabel: '关闭',
      body: '<div class="net-mgmt"></div>',
      onReady: renderManage
    });
  }
  function renderManage(body) {
    var box = body.querySelector('.net-mgmt');
    if (!box) return;
    var list = sources();
    var html = '';
    if (!list.length) {
      html = '<div class="empty-illustration">' + CM.icons.note + '<span>尚未添加音乐源</span></div>';
    } else {
      html = '<div class="net-mgmt-list">';
      list.forEach(function(s) {
        var defaultMark = s.default ? '<span class="net-mgmt-badge primary">默认</span>' : '';
        var onMark = s.enabled === false ? '<span class="net-mgmt-badge off">已停用</span>' : '<span class="net-mgmt-badge">启用</span>';
        html +=
          '<div class="net-mgmt-item" data-id="' + esc(s.id) + '">' +
          '<div class="net-mgmt-info">' +
          '<div class="net-mgmt-name">' + esc(s.name || '未命名') + ' ' + defaultMark + onMark + '</div>' +
          '<div class="net-mgmt-meta">' + esc(ADAPTERS[s.protocol] ? ADAPTERS[s.protocol].label : s.protocol) + ' · ' + esc(s.baseUrl || '') + '</div>' +
          '</div>' +
          '<div class="net-mgmt-ops">' +
          (s.default ? '' : '<button class="net-ghost" data-op="default" title="设为默认">默认</button>') +
          '<button class="net-ghost" data-op="toggle" title="启用/停用">' + (s.enabled === false ? '启用' : '停用') + '</button>' +
          '<button class="net-ghost" data-op="test" title="测试连接">测试</button>' +
          '<button class="net-ghost" data-op="edit" title="编辑">编辑</button>' +
          '<button class="net-ghost danger" data-op="del" title="删除">删除</button>' +
          '</div>' +
          '</div>';
      });
      html += '</div>';
    }
    html += '<div class="net-mgmt-foot">' +
      '<button class="modal-btn ghost" id="mgmtAdd">+ 添加音乐源</button>' +
      '<button class="modal-btn ghost" id="mgmtDir">下载目录设置</button>' +
      '</div>';
    box.innerHTML = html;

    box.onclick = function(e) {
      var btn = e.target.closest('[data-op]');
      if (btn) {
        var id = btn.closest('.net-mgmt-item').dataset.id;
        var src = sources().find(function(s) { return s.id === id; });
        if (!src) return;
        applySourceOp(btn.dataset.op, src, body);
      } else if (el('mgmtAdd') === btnTgt(e, 'mgmtAdd')) {
        openSourceDialog(null).then(renderManage.bind(null, body));
      } else if (el('mgmtDir') === btnTgt(e, 'mgmtDir')) {
        openDownloadDirDialog().then(renderManage.bind(null, body));
      }
    };
    function btnTgt(e, id) { return e.target.closest('#' + id) ? el(id) : null; }
  }

  function applySourceOp(op, src, body) {
    var list = sources();
    if (op === 'toggle') { src.enabled = src.enabled === false ? true : false; }
    else if (op === 'default') {
      list.forEach(function(s) { s.default = (s.id === src.id); });
    } else if (op === 'del') {
      openDialog({
        title: '删除音乐源', okLabel: '删除', danger: true,
        body: '<div class="net-dlg-text">确定删除音乐源「' + esc(src.name) + '」吗？</div>',
        onOk: function() { return true; }
      }).then(function(ok) {
        if (ok === true) {
          CM.settings[NET_KEY] = list.filter(function(s) { return s.id !== src.id; });
          CM.saveSettings(); buildSourceSelect(); updateSourceDefault(); renderManage(body);
        }
      });
      return;
    } else if (op === 'edit') {
      openSourceDialog(src).then(function(saved) { if (saved) { CM.saveSettings(); buildSourceSelect(); updateSourceDefault(); renderManage(body); } });
      return;
    } else if (op === 'test') {
      testSource(src).then(function(res) { CM.showToast(res.ok ? '连接正常' : '连接失败', res.msg, res.ok ? 'success' : 'error'); });
      return;
    }
    CM.saveSettings(); buildSourceSelect(); updateSourceDefault(); renderManage(body);
  }

  function updateSourceDefault() {
    var list = sources(), hasD = list.some(function(s) { return s.default; });
    if (!hasD && list.length) list[0].default = true;
    // 默认源优先
    list.sort(function(a, b) { return ((a.default ? 0 : 1) - (b.default ? 0 : 1)); });
    list.forEach(function(s, i) { s.priority = i; });
    CM.saveSettings();
  }

  function testSource(src) {
    return srcAdp(src).search(stripBase(src.baseUrl), '测试', 1).then(function(list) {
      if (list === null) return { ok: false, msg: '无法连接到该地址，请检查 URL 或网络/内网设置' };
      return { ok: true, msg: '已连上，返回 ' + list.length + ' 条结果' };
    });
  }

  /* ============================================
   * 添加/编辑音源弹窗
   * ============================================ */
  function openSourceDialog(src) {
    var isEdit = !!src;
    var protoOpts = '';
    for (var k in ADAPTERS) protoOpts += '<option value="' + k + '"' + (src && src.protocol === k ? ' selected' : '') + '>' + esc(ADAPTERS[k].label) + '</option>';
    var body =
      field('名称', '<input class="net-input" id="sName" placeholder="如：我的网易云" value="' + esc(src && src.name || '') + '"/>') +
      field('协议类型', '<select class="net-input" id="sProto">' + protoOpts + '</select>') +
      field('接口地址', '<input class="net-input" id="sBase" placeholder="协议://主机:端口（如 http://127.0.0.1:3000）" value="' + esc(src && src.baseUrl || '') + '"/>') +
      '<label class="net-switch"><input type="checkbox" id="sEnabled"' + (src === null || src.enabled !== false ? ' checked' : '') + '/><span>启用此音源</span></label>' +
      '<div class="net-hint">地址须填写完整的 http/https 前缀。若音源运行在本机或内网，需在 foobar 高级设置「Tools → WebView UI → HTTP Security」开启 Allow Internal Network。</div>';
    return openDialog({
      title: isEdit ? '编辑音乐源' : '添加音乐源',
      body: body,
      okLabel: isEdit ? '保存' : '添加',
      onOk: function(b) {
        var name = b.querySelector('#sName').value.trim();
        var protocol = b.querySelector('#sProto').value;
        var baseUrl = stripBase(b.querySelector('#sBase').value.trim());
        var enabled = b.querySelector('#sEnabled').checked;
        if (!name) { CM.showToast('请填写名称', null, 'error'); return false; }
        if (!/^https?:\/\//i.test(baseUrl)) { CM.showToast('接口地址须以 http:// 或 https:// 开头', null, 'error'); return false; }
        var list = sources();
        if (!isEdit) {
          var nb = { id: 's' + Date.now().toString(36), name: name, protocol: protocol, baseUrl: baseUrl, enabled: enabled, default: false, priority: list.length };
          list.push(nb);
        } else {
          src.name = name; src.protocol = protocol; src.baseUrl = baseUrl; src.enabled = enabled;
        }
        CM.settings[NET_KEY] = list;
        CM.saveSettings(); buildSourceSelect(); updateSourceDefault(); updateGuide();
        return true;
      }
    });
  }

  /* ============================================
   * 下载目录设置
   * ============================================ */
  function validateDownloadDir(dir) {
    dir = (dir || '').trim();
    if (!dir) return { valid: false, dir: dir, msg: '下载目录不能为空' };
    var ok = WHITELIST_PREFIX.some(function(p) { return dir === p || dir.indexOf(p + '\\') === 0 || dir.indexOf(p + '/') === 0; });
    if (!ok) return { valid: false, dir: dir, msg: '下载目录必须在 %music% 或 %profile% 之下（受主题安全策略限制），请调整' };
    return { valid: true, dir: dir, msg: '' };
  }
  function openDownloadDirDialog() {
    return openDialog({
      title: '下载目录设置',
      body:
        field('保存到', '<input class="net-input" id="dDir" placeholder="%music%\\网络音乐" value="' + esc(CM.settings.netDownloadDir || '') + '"/>') +
        '<div class="net-hint">下载后会自动执行媒体库刷新。可选 %music%（媒体库）或 %profile%（配置目录）前缀。</div>',
      okLabel: '保存',
      onOk: function(b) {
        var dir = b.querySelector('#dDir').value.trim();
        var v = validateDownloadDir(dir);
        if (!v.valid) { CM.showToast(v.msg, null, 'error'); return false; }
        CM.settings.netDownloadDir = v.dir;
        CM.saveSettings();
        return true;
      }
    });
  }

  /* ============================================
   * 离线提示
   * ============================================ */
  var RISK_HTML =
    '<div class="net-risk">' +
    '<b>网络音乐使用风险告知</b>' +
    '<ul>' +
    '<li>您所配置的音乐源通常来自各平台公开接口的聚合解析，<b>存在版权风险</b>，仅供个人技术尝试，严禁商用或对外传播，下载后请及时清理。</li>' +
    '<li>请在音乐源地址中<b>只填接口地址</b>，切勿把需要登录的账号密码填入主题。</li>' +
    '<li>第三方音源可能失效、限流或封 IP，主源失败会自动切换备用音源；全部不可用时将明确提示。</li>' +
    '<li>下载所得文件之合法性与来源由您所配置的音源服务方承担，主题仅做解析、播放与保存。</li>' +
    '</ul></div>';

  var OFFLINE_STEPS =
    '<div class="net-steps">' +
    '<b>网络不可用，请按以下步骤开通：</b>' +
    '<ol>' +
    '<li>检查系统网络：点击任务栏右下角的 Wi‑Fi / 以太网图标，连接一个可用网络。</li>' +
    '<li>确认防火墙 / 代理未拦截 foobar2000 与 WebView2 的联网访问。</li>' +
    '<li>若音乐源在本机或内网：foobar2000 高级设置 <b>Preferences → Advanced → Tools → WebView UI → HTTP Security</b> 开启 <b>Allow Internal Network</b>，并把地址加入 Allowed / Blocked Hosts。</li>' +
    '<li>在「音乐源管理」中点击「测试」查看 HTTP 状态与耗时。</li>' +
    '<li>仍失败则确认音源服务端已启动、地址可访问、公网解析节点未失效。</li>' +
    '</ol>' +
    '<div class="net-hint">说明：foobar 没有系统联网状态 API，此处是通过一次网络请求间接判断网络是否可达，仅作辅助提示，并非绝对判定。</div>' +
    '</div>';

  var canary = 'https://www.gstatic.com/generate_204';
  function probeNetwork() {
    return httpGet(canary + '?_=' + Date.now(), 8000).then(function(r) { return !!r; });
  }
  function showOfflineBanner(reachable) {
    if (!netOfflineBanner) return;
    netOfflineBanner.classList.remove('hidden');
    el('netBannerIcon').innerHTML = reachable ? CM.icons.error : CM.icons.error;
    el('netBannerTitle').textContent = reachable ? '音源不可达' : '网络不可用';
    el('netBannerSub').textContent = reachable
      ? '已启用内网访问时请检查音源服务端是否启动、地址与端口是否正确，或切换到可用备源'
      : '请先连接网络，再使用网络搜索功能';
    el('netBannerHelp').textContent = '查看开通网络步骤';
  }
  function hideBanner() { if (netOfflineBanner) netOfflineBanner.classList.add('hidden'); }
  function bindBannerHelp() {
    if (el('netBannerHelp').dataset.bound) return;
    el('netBannerHelp').dataset.bound = '1';
    el('netBannerHelp').addEventListener('click', function() {
      openDialog({ title: '开通网络 / 音源指南', cancelLabel: null, okLabel: '知道了', body: OFFLINE_STEPS });
    });
  }

  /* ============================================
   * 搜索结果渲染与交互
   * ============================================ */
  var lastSongs = [];
  function renderEmpty(text) {
    netResults.innerHTML = CM.emptyHTML(text);
    netResults.style.display = '';
  }
  function renderResults(list, src) {
    lastSongs = list;
    var parts = [];
    list.forEach(function(s, i) {
      var art = s.art ? ' class="net-item-art has"' : ' class="net-item-art ph"';
      var artStyle = s.art ? ' style="background-image:url(\'' + s.art.replace(/'/g, '%27') + '\')"' : '';
      parts.push(
        '<div class="net-item" data-i="' + i + '">' +
        '<div' + art + artStyle + '>' + (s.art ? '' : CM.icons.note) + '</div>' +
        '<div class="net-item-info">' +
        '<div class="net-item-title">' + esc(s.title) + '</div>' +
        '<div class="net-item-sub">' + esc(s.artist) + (s.album ? ' · ' + esc(s.album) : '') + '</div>' +
        '</div>' +
        '<span class="net-item-src">' + esc(src.name || '') + '</span>' +
        '<span class="net-item-dur">' + CM.formatTime(s.duration) + '</span>' +
        '<div class="net-item-actions">' +
        '<button class="net-act" data-act="play" title="播放">' + CM.icons.play + '</button>' +
        '<button class="net-act" data-act="queue" title="加入队列">' + CM.icons.queue + '</button>' +
        '<button class="net-act" data-act="dl" title="下载">' + CM.icons.download + '</button>' +
        '</div>' +
        '</div>'
      );
    });
    netResults.innerHTML = parts.join('');
    netResults.style.display = '';
  }

  netResults.addEventListener('click', function(e) {
    var item = e.target.closest('.net-item');
    if (!item) return;
    var song = lastSongs[+item.dataset.i];
    if (!song) return;
    var act = (e.target.closest('.net-act') || {}).dataset && e.target.closest('.net-act').dataset.act;
    if (act === 'play') playSong(song, item);
    else if (act === 'queue') queueSong(song, item);
    else if (act === 'dl') downloadSong(song, item);
  });

  function setRowBusy(item, busy) {
    if (item) item.classList.toggle('busy', !!busy);
  }

  function resolvePlayUrl(song) {
    var src = enabledSources().find(function(s) { return s.id === song.sourceId; });
    if (!src) return Promise.resolve(null);
    return srcAdp(src).playUrl(stripBase(src.baseUrl), song);
  }

  function playSong(song, item) {
    setRowBusy(item, true);
    resolvePlayUrl(song).then(function(url) {
      setRowBusy(item, false);
      if (!url) { CM.showToast('获取播放地址失败', '该音源可能失效或无直链', 'error'); return; }
      CM.api('playback.playPaths', { paths: [url], startIndex: 0, replace: false }).then(function(r) {
        if (r && r.success) { CM.showToast('正在播放', song.title, 'success'); }
        else {
          // 回退：加入播放队列再切到该曲
          CM.api('queue.addPaths', { paths: [url] }).then(function(qr) {
            if (qr && qr.success) CM.showToast('已加入队列', song.title);
            else CM.showToast('播放失败', '无法播放该网络地址', 'error');
          });
        }
      });
    });
  }
  function queueSong(song, item) {
    setRowBusy(item, true);
    resolvePlayUrl(song).then(function(url) {
      setRowBusy(item, false);
      if (!url) { CM.showToast('获取播放地址失败', null, 'error'); return; }
      CM.api('queue.addPaths', { paths: [url] }).then(function(r) {
        if (r && r.success) CM.showToast('已加入播放队列', song.title, 'success');
        else CM.showToast('加入队列失败', null, 'error');
      });
    });
  }

  /* ============================================
   * 下载
   * ============================================ */
  function sanitizeName(n) {
    n = String(n || '').replace(/[\\/:*?"<>|\s]+/g, ' ').trim();
    return n.slice(0, 80) || '网络歌曲';
  }
  function extOf(url) {
    var m = /\.([a-z0-9]{2,5})(\?|#|$)/i.exec(url || '');
    var e = m ? m[1].toLowerCase() : '';
    return /^(m4a|mp3|flac|ogg|wav|aac|opus|ape|wma|alac)$/.test(e) ? e : 'mp3';
  }
  function ensureRisk() {
    if (CM.settings.netRiskAccepted) return Promise.resolve(true);
    return openDialog({
      title: '风险确认',
      body: RISK_HTML,
      okLabel: '我已知晓，继续',
      onOk: function() { return true; }
    }).then(function(v) {
      if (v === true) { CM.settings.netRiskAccepted = true; CM.saveSettings(); }
      return v === true;
    });
  }
  function downloadSong(song, item) {
    ensureRisk().then(function(ok) {
      if (!ok) return;
      setRowBusy(item, true);
      CM.showToast('正在获取下载地址', song.title);
      resolvePlayUrl(song).then(function(url) {
        if (!url) { setRowBusy(item, false); CM.showToast('下载失败', '该音源无可用直链', 'error'); return; }
        var v = validateDownloadDir(CM.settings.netDownloadDir);
        if (!v.valid) {
          setRowBusy(item, false);
          CM.showToast(v.msg, null, 'error');
          openDownloadDirDialog();
          return;
        }
        var saveTo = v.dir + '\\' + sanitizeName(song.title + ' - ' + song.artist) + '.' + extOf(url);
        CM.showToast('正在下载', saveTo);
        CM.api('http.download', { url: url, saveTo: saveTo, async: false, timeout: 120000 }).then(function(r) {
          setRowBusy(item, false);
          if (r && r.success && r.bytesWritten > 0) {
            CM.showToast('下载完成', saveTo, 'success');
            CM.api('library.refresh').then(function() {
              if (CM.state && CM.state.currentTab === 'library' && CM.renderLibrary) CM.renderLibrary();
            });
          } else {
            CM.showToast('下载失败', '无法写入该目录或文件过大（SDK 单文件上限约 500MB）', 'error');
          }
        });
      });
    });
  }

  /* ============================================
   * 搜索主流程
   * ============================================ */
  var searchSeq = 0;
  function doSearch(kw) {
    kw = (kw || '').trim();
    if (!kw) return;
    var seq = ++searchSeq;
    var list = pickSources();
    if (!list.length) { updateGuide(); return; }
    hideBanner();
    netResults.innerHTML = CM.loadingHTML('正在搜索…');
    netResults.style.display = '';
    netGuide.style.display = 'none';

    function attempt(i) {
      if (i >= list.length) {
        probeNetwork().then(function(online) {
          renderEmpty(online ? '未找到相关结果，或当前音源未返回结果' : '网络不可用，无法搜索');
          if (!online) showOfflineBanner(false);
        });
        return;
      }
      var src = list[i];
      srcAdp(src).search(stripBase(src.baseUrl), kw, 30).then(function(resList) {
        if (seq !== searchSeq) return;
        if (resList && resList.length) {
          resList.forEach(function(s) { s.sourceId = src.id; s.sourceName = src.name; });
          renderResults(resList, src);
        } else {
          attempt(i + 1);
        }
      });
    }
    attempt(0);
  }

  var debouncedSearch = CM.debounce(function() { doSearch(netSearchInput.value); }, 350);
  netSearchInput.addEventListener('input', debouncedSearch);
  netSearchInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') doSearch(netSearchInput.value); });

  /* ============================================
   * Tab 展示回调（由 ui.js switchTab 调用）
   * ============================================ */
  CM.onNetTabShow = function() {
    buildSourceSelect();
    updateGuide();
    bindBannerHelp();
  };

  // 首次进入且无任何源时，自动弹出添加音源引导
  CM.initNetMusic = function() {
    CM.onNetTabShow();
    if (!sources().length) {
      setTimeout(function() { if (CM.state.currentTab === 'netsearch') openSourceDialog(null); }, 250);
    }
  };
})();