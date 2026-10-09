/* ============================================
 * CloudMusic ui-settings.js — 设置与工具页
 *
 * 定位：把「低频但要有」的东西从底栏「更多」菜单里搬出来。
 * 菜单只留当下要用、点一下就要生效的入口（小窗 / 桌面歌词 / 沉浸 / 音频三件套 /
 * 主菜单 / 刷新），其余一次性或排障类（foobar 工具、诊断、帮助、
 * 默认形态、重置几何…）全收在这一页，避免把一个 popover 塞成二十行加三层子菜单。
 *
 * 页面内容是脚本生成的（不是 index.html 里的静态标记）：分区与行的状态要跟
 * CM.settings / 宿主回包实时对上，写在同一处才不容易对不上号。
 * ============================================ */
(function() {
  'use strict';
  var CM = window.CloudMusic;
  var built = false;

  function on(v) { return v ? '开' : '关'; }

  function esc(s) { return CM.escHtml(String(s == null ? '' : s)); }

  // 一行开关：data-act="toggle:<键>"，状态由 sync() 回填（class 'on' + note）
  function rowSwitch(id, label, sub, note) {
    return '<div class="set-row">' +
      '<div class="set-row-main"><div class="set-row-label">' + label + '</div>' +
      (sub ? '<div class="set-row-sub">' + sub + '</div>' : '') + '</div>' +
      '<div class="set-right">' +
      (note ? '<span class="set-note" id="' + id + 'Note">' + note + '</span>' : '') +
      '<button class="set-switch" id="' + id + '" role="switch" aria-checked="false" data-act="toggle:' + id + '">' +
      '<span class="set-knob"></span></button>' +
      '</div></div>';
  }

  // 一行按钮
  function rowButton(label, sub, btnText, act, btnId) {
    return '<div class="set-row">' +
      '<div class="set-row-main"><div class="set-row-label">' + label + '</div>' +
      (sub ? '<div class="set-row-sub">' + sub + '</div>' : '') + '</div>' +
      '<button class="set-btn" ' + (btnId ? 'id="' + btnId + '" ' : '') + 'data-act="' + act + '">' + btnText + '</button>' +
      '</div>';
  }

  // 一行分段选择：data-act="<act>" data-v="<值>"
  function rowSeg(label, sub, act, items, hostId) {
    var s = '<div class="set-row"><div class="set-row-main"><div class="set-row-label">' + label + '</div>' +
      (sub ? '<div class="set-row-sub">' + sub + '</div>' : '') + '</div><div class="set-seg" ' +
      (hostId ? 'id="' + hostId + '" ' : '') + 'data-act="' + act + '">';
    for (var i = 0; i < items.length; i++) {
      s += '<button class="set-seg-btn" data-v="' + items[i][0] + '" data-act="' + act + '">' + items[i][1] + '</button>';
    }
    return s + '</div></div>';
  }

  function build() {
    if (built) return;
    var el = CM.$('tabSettings');
    if (!el) return;
    built = true;

    var srcs = (CM.lyricSources && CM.lyricSources.sources) || [];
    var srcHtml = '';
    for (var i = 0; i < srcs.length; i++) {
      srcHtml += '<button class="set-chip" data-act="src" data-v="' + esc(srcs[i].id) + '">' + esc(srcs[i].label) + '</button>';
    }

    el.innerHTML =
      '<div class="set-page">' +
      '<div class="set-head"><div class="set-title">设置与工具</div>' +
      '<div class="set-head-sub">底栏「更多」只留常用入口；低频项与排障工具都在这里</div></div>' +

      '<div class="set-group"><div class="set-group-title">外观与可视化</div>' +
      rowSwitch('setVisualizer', '迷你频谱', '底栏那条频谱开关（沉浸页的频谱不受它影响）', '开') +
      rowSwitch('setTilt3d', '歌词 3D 倾斜', '沉浸页把整块歌词贴成一面斜墙', '关') +
      rowSeg('频谱显示方式', '沉浸页那条频谱的档位，也可直接点频谱循环切换', 'spectrum',
        [['bars', '频谱条'], ['field', '声场'], ['waterfall', '瀑布图'], ['oscillo', '示波器'], ['vector', '矢量示波器']], 'setSpectrum') +
      '</div>' +

      '<div class="set-group"><div class="set-group-title">歌词</div>' +
      '<div class="set-row"><div class="set-row-main"><div class="set-row-label">在线歌词源</div>' +
      '<div class="set-row-sub">本地同名 .lrc / 歌词库永远优先；匹配不到时才联网问这些源</div></div>' +
      '<div class="set-chips" id="setLyricSrc">' + srcHtml + '</div></div>' +
      rowButton('搜索歌词…', '列出各来源的候选，挑一条应用（按文件记住）', '打开候选列表', 'lyricSearch') +
      '</div>' +

      '<div class="set-group"><div class="set-group-title">播放与队列</div>' +
      rowSeg('播放历史条数', '「上一首」回溯用的时间线（插队队列上方的「播放历史」按钮里），超出后淘汰最早的记录', 'historymax',
        [[10, '10 条'], [20, '20 条'], [50, '50 条'], [100, '100 条']], 'setHistoryMax') +
      '</div>' +

      '<div class="set-group"><div class="set-group-title">窗口与小窗</div>' +
      rowSeg('默认小窗形态', '「更多 → 迷你播放器 / 歌词窗」与下次开窗都用它', 'popupmode',
        [['mini', '迷你播放器'], ['lyrics', '歌词窗']], 'setPopupMode') +
      rowButton('打开小窗', '当前默认形态', '打开', 'openPopup') +
      rowButton('重置小窗位置与尺寸', '会忘掉拖过的位置与大小，下次开窗用默认值', '重置', 'resetGeom') +
      rowSwitch('setTray', '常驻托盘', '托盘菜单的播放控制由组件原生执行，页面挂起也能用', '关') +
      '</div>' +

      '<div class="set-group"><div class="set-group-title">foobar2000 工具</div>' +
      rowButton('主菜单', '用主题的样式打开 foobar 的完整主菜单（全部命令）', '打开', 'mainMenu') +
      rowButton('首选项', '打开 foobar2000 的设置窗口', '打开', 'prefs') +
      rowButton('控制台', '查看组件与主题的输出日志（排障用）', '打开', 'console') +
      rowButton('刷新媒体库缓存', '媒体库有新增文件但没出现时用', '刷新', 'rescan') +
      rowButton('高级首选项搜索', 'foobar 的高级首选项是 GUID 树、只能按 GUID 读写 —— 这里按「显示名」搜出条目与当前值（只读，结果可复制）', '搜索', 'advPref') +
      '</div>' +

      '<div class="set-group"><div class="set-group-title">关于与帮助</div>' +
      '<div class="set-row"><div class="set-row-main"><div class="set-row-label">CloudMusic 主题</div>' +
      '<div class="set-row-sub" id="setAboutVer"></div></div>' +
      '<button class="set-btn" data-act="about">关于 / 诊断</button></div>' +
      rowButton('复制诊断报告', '主题版本、宿主版本、能力表、最近失败的调用 —— 反馈时贴这一份就够', '复制', 'copyReport') +
      rowButton('使用帮助', '功能指南与更新日志（guide.html）', '打开', 'help') +
      '<div class="set-row"><div class="set-row-main"><div class="set-row-label">页面来源</div>' +
      '<div class="set-row-sub" id="setSource">读取中…</div></div></div>' +
      '</div>' +

      '</div>';

    bind(el);
    CM.syncSettingsState();
  }

  function toggleSwitch(btn, onState) {
    btn.classList.toggle('on', !!onState);
    btn.setAttribute('aria-checked', onState ? 'true' : 'false');
  }
  function setNote(id, text) {
    var el = CM.$(id);
    if (el) el.textContent = text == null ? '' : text;
  }
  function segActive(hostId, val) {
    var host = CM.$(hostId);
    if (!host) return;
    var btns = host.querySelectorAll('.set-seg-btn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i].dataset.v === val);
  }

  /* ---------- 状态同步（每次进入本页 / 每次改动后调用） ---------- */
  CM.syncSettingsState = function() {
    if (!built) return;
    // 外观与可视化
    toggleSwitch(CM.$('setVisualizer'), CM.state.visualizerActive);
    setNote('setVisualizerNote', on(CM.state.visualizerActive));
    toggleSwitch(CM.$('setTilt3d'), !!CM.settings.tilt3d);
    setNote('setTilt3dNote', on(CM.settings.tilt3d));
    segActive('setSpectrum', (CM.spectrumMode && CM.spectrumMode.current()) || CM.settings.spectrumMode || 'bars');
    // 歌词源
    var map = CM.lyricSources ? CM.lyricSources.enabledMap() : {};
    var chips = CM.$('setLyricSrc');
    if (chips) {
      var list = chips.querySelectorAll('.set-chip');
      for (var i = 0; i < list.length; i++) list[i].classList.toggle('on', map[list[i].dataset.v] !== false);
    }
    // 小窗
    segActive('setPopupMode', CM.settings.popupMode === 'lyrics' ? 'lyrics' : 'mini');
    // 播放历史条数（上限可配；超出的记录在写入时淘汰）
    segActive('setHistoryMax', String(CM.history ? CM.history.max() : 20));
    // 托盘（旧宿主禁用并说明，而不是让用户点了没反应）
    var trayBtn = CM.$('setTray'), trayOk = !!(CM.tray && CM.tray.supported());
    if (trayBtn) {
      trayBtn.disabled = !trayOk;
      toggleSwitch(trayBtn, trayOk && CM.tray.isOn());
    }
    setNote('setTrayNote', trayOk ? on(CM.tray.isOn()) : '宿主不支持');
    // 版本与来源
    var caps = CM.caps || {}, ver = caps.version || {};
    var plug = ver.plugin;
    if (plug && typeof plug === 'object') plug = plug.version || plug.name;
    setNote('setAboutVer', '主题 v' + CM.VERSION +
      ' · foobar2000 ' + (ver.foobar2000 || caps.host || '未知') +
      ' · 组件 ' + (plug || caps.plugin || '未知'));
    if (CM._sourceText) setNote('setSource', CM._sourceText);
    else if (CM.caps && CM.caps.loadHostInfo) {
      CM.caps.loadHostInfo().then(function() { setNote('setSource', CM._sourceText || '未知'); });
    }
  };

  /* ---------- 交互（一个委托监听器，行是脚本生成的，逐行绑定容易漏） ---------- */
  function bind(root) {
    root.addEventListener('click', function(e) {
      var t = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!t || t.disabled) return;
      var act = t.dataset.act;
      if (act.indexOf('toggle:') === 0) return actToggle(act.slice(7));
      switch (act) {
        case 'spectrum':
          if (CM.spectrumMode) CM.spectrumMode.set(t.dataset.v);
          CM.syncSettingsState();
          break;
        case 'src': {
          var m = CM.lyricSources.enabledMap();
          m[t.dataset.v] = (m[t.dataset.v] === false);   // 取反（默认全开）
          CM.saveSettings();
          CM.syncSettingsState();
          break;
        }
        case 'lyricSearch': CM.openLyricSearch(); break;
        case 'popupmode':
          CM.settings.popupMode = (t.dataset.v === 'lyrics') ? 'lyrics' : 'mini';
          CM.saveSettings();
          CM.syncSettingsState();
          break;
        case 'historymax': {
          var n = parseInt(t.dataset.v, 10);
          if (!n) break;
          CM.settings.historyMax = n;
          CM.saveSettings();
          CM.history.save();   // 立刻按新上限裁剪并重绘
          CM.syncSettingsState();
          CM.showToast('播放历史上限已改为 ' + n + ' 条', null, 'success');
          break;
        }
        case 'openPopup': CM.openPopupWindow(CM.settings.popupMode === 'lyrics' ? 'lyrics' : 'mini'); break;
        case 'resetGeom':
          CM.settings.popupGeom = null;
          CM.saveSettings();
          CM.showToast('小窗位置已重置', '下次打开小窗用默认位置与尺寸', 'success');
          break;
        case 'mainMenu': CM.showMainMenu(); break;
        case 'prefs': CM.api('misc.showPreferences'); break;
        case 'console': CM.api('misc.showConsole'); break;
        case 'rescan':
          CM.api('library.refresh').then(function(r) {
            if (!r || r.success === false) { CM.showToast('刷新失败', (r && r.error) || null, 'error'); return; }
            CM.showToast('媒体库缓存已刷新', null, 'success');
          });
          break;
        case 'about': CM.showAbout(); break;
        case 'copyReport':
          CM.copyText(CM.diagReport()).then(function(ok) {
            CM.showToast(ok ? '诊断报告已复制' : '复制失败', ok ? '反馈时贴这一份即可' : '可以到「关于 / 诊断」里手动复制', ok ? 'success' : 'error');
          });
          break;
        case 'help': window.open('guide.html', '_blank'); break;
        case 'advPref': CM.searchAdvancedPrefs(); break;
      }
    });
  }

  function actToggle(key) {
    switch (key) {
      case 'setVisualizer':
        CM.setVisualizerActive(!CM.state.visualizerActive);
        CM.syncSettingsState();
        break;
      case 'setTilt3d':
        CM.toggleNpTilt();           // 内部会落盘 + 同步界面
        CM.syncSettingsState();
        break;
      case 'setTray':
        if (!CM.tray || !CM.tray.supported()) { CM.showToast('宿主不支持托盘', null, 'error'); return; }
        CM.tray.toggle().then(function() { CM.syncSettingsState(); });
        break;
    }
  }

  // 进入本页时渲染一次；之后每次进入只刷新状态（DOM 不重建，避免丢滚动位置）
  CM.renderSettings = function() {
    build();
    CM.syncSettingsState();
  };

  /* ============================================
   * 高级首选项：按「显示名」搜索（只读诊断）
   * ------------------------------------------------------------
   * foobar 的高级首选项是一棵 GUID 树 —— **只能按 guid 读写**，但树里每一项都带
   * 显示名（`config.getAdvancedConfig` 的 entries[].name/guid），而
   * `config.getAdvancedConfigValue({guid})` 还会连名字和当前值一起回。
   * 所以"按名字找一项，再拿 guid 读/写"是可行的 —— 这正是主题以前认为做不到、
   * 因而搁置了某些功能（例如想关掉 foobar 自带的播放错误提示）的那一步。
   * 这里只做**只读**搜索：遍历树 → 名字含关键词 → 逐条读值 → 列出来可复制。
   * ============================================ */
  var _advEntries = null;     // 扁平化缓存：{name, guid, path}
  CM.searchAdvancedPrefs = function() {
    CM.showModal({
      title: '搜索高级首选项',
      input: '',
      desc: '按显示名搜索 foobar 高级首选项（例如「错误」「弹窗」「歌词」），只读，不会修改任何设置',
      okText: '搜索'
    }).then(function (kw) {
      if (!kw) return;
      var key = kw.toLowerCase();
      var toast = CM.showToast('正在读取高级首选项…', '首次搜索需要遍历整棵树', null);
      loadAdvancedEntries().then(function (list) {
        var hits = [];
        for (var i = 0; i < list.length && hits.length < 40; i++) {
          if (list[i].name.toLowerCase().indexOf(key) >= 0) hits.push(list[i]);
        }
        if (!hits.length) {
          CM.showToast('没有匹配项', '换个关键词试试（高级首选项的名字是 foobar 自己的语言）', 'error');
          return;
        }
        // 逐条读当前值（只读；值可能是数字/字符串/布尔）
        var vals = hits.slice(0, 12);
        Promise.all(vals.map(function (h) {
          return CM.api('config.getAdvancedConfigValue', { guid: h.guid }).then(function (r) {
            h.value = r && (r.value !== undefined ? r.value : r.data && r.data.value);
            return h;
          }, function () { return h; });
        })).then(function (rows) {
          var items = [{ isLabel: true, label: '匹配 ' + hits.length + ' 项' + (hits.length > rows.length ? '（列出前 ' + rows.length + ' 项）' : '') }];
          rows.forEach(function (h) {
            items.push({ label: h.path ? h.path + ' › ' + h.name : h.name, desc: '值：' + fmtVal(h.value) + ' · ' + h.guid });
          });
          if (hits.length > rows.length) {
            items.push({ isLabel: true, label: '其余 ' + (hits.length - rows.length) + ' 项见「复制全部结果」' });
          }
          items.push({ divider: true });
          items.push({ label: '复制全部结果', icon: CM.icons.copy, action: function () {
            var L = ['== 高级首选项搜索：' + kw + ' =='];
            hits.forEach(function (h) {
              L.push((h.path ? h.path + ' › ' : '') + h.name + ' | ' + h.guid + ' | 值：' + fmtVal(h.value));
            });
            CM.copyText(L.join('\n')).then(function (ok) {
              CM.showToast(ok ? '结果已复制' : '复制失败', ok ? hits.length + ' 项（含 GUID 与当前值）' : null, ok ? 'success' : 'error');
            });
          } });
          var rect = CM.$('tabSettings') ? CM.$('tabSettings').getBoundingClientRect() : { left: 120, top: 120 };
          CM.showCtxMenu(rect.left + 40, rect.top + 120, items);
        });
      }, function (e) {
        CM.failToast(e, '读取高级首选项失败');
      });
    });
  };
  function fmtVal(v) {
    if (v === undefined || v === null) return '（未读取）';
    if (typeof v === 'boolean') return v ? '开' : '关';
    var s = String(v);
    return s.length > 60 ? s.slice(0, 60) + '…' : s;
  }
  // 遍历整棵高级首选项树（首次按需拉取 + 会话内缓存）。
  // 两种可能的回包形状都兼容：① 树是嵌套的（entries[].children）；② 一次只给一层
  // （子项要按 parentGuid 再取）—— 后者才逐分支展开，节点数与展开次数都设上限。
  function loadAdvancedEntries() {
    if (_advEntries) return Promise.resolve(_advEntries);
    var MAX_NODES = 4000, MAX_EXPAND = 400, DEPTH_MAX = 8;
    var out = [], seen = Object.create(null), expanded = 0, sawChildren = false;
    function push(entries, path, depth) {
      if (!entries || !entries.length || depth > DEPTH_MAX) return;
      for (var i = 0; i < entries.length && out.length < MAX_NODES; i++) {
        var e = entries[i] || {};
        if (!e.guid || seen[e.guid]) continue;
        seen[e.guid] = 1;
        out.push({ name: e.name || '', guid: e.guid, path: path });
        if (e.children && e.children.length) {
          sawChildren = true;
          push(e.children, (path ? path + ' › ' : '') + (e.name || ''), depth + 1);
        }
      }
    }
    return CM.api('config.getAdvancedConfig').then(function (r) {
      var root = (r && (r.entries || r.items)) || [];
      if (!root.length) throw new Error('宿主没有返回高级首选项树');
      push(root, '', 0);
      if (sawChildren || out.length >= 20) { _advEntries = out; return out; }   // 树已嵌套：一层就够
      // 只给了一层：拿每个节点当分支，按 parentGuid 串行展开（去重 + 上限）
      var queue = out.slice();
      return (function step() {
        if (!queue.length || expanded >= MAX_EXPAND || out.length >= MAX_NODES) return Promise.resolve();
        var node = queue.shift();
        expanded++;
        return CM.api('config.getAdvancedConfig', { parentGuid: node.guid }).then(function (rr) {
          var kids = (rr && (rr.entries || rr.items)) || [];
          var before = out.length;
          // 子项的路径 = 父项的完整路径链（扁平形状下逐层拼出来）
          push(kids, node.path ? node.path + ' › ' + node.name : node.name, 1);
          for (var i = before; i < out.length; i++) queue.push(out[i]);
          return step();
        }, function () { return step(); });
      })().then(function () { _advEntries = out; return out; });
    });
  }
})();
