/* ============================================
 * CloudMusic ui-queue.js — 播放队列抽屉
 * 队列渲染（签名去重） / 指针拖拽调序 / 清空重建
 * ============================================ */

(function () {
  'use strict';
  const CM = window.CloudMusic,
    els = CM.els, state = CM.state, esc = CM.escHtml;
  let _queueRebuilding = false;

  /* ============================================
   * 播放队列抽屉
   * ============================================ */
  CM.refreshQueueBadge = function () {
    if (_queueRebuilding) return; // 排序重建期间跳过，完成后统一刷新
    fb.queue.getCount().then(r => {
      if (_queueRebuilding) return;
      const n = CM.respCount(r);
      els.queueBadge.textContent = n > 99 ? '99+' : n;
      els.queueBadge.classList.toggle('hidden', n <= 0);
      els.queueCount.textContent = n ? `${n} 首` : '';
    });
  };

  // 队列抽屉顶部"正在播放"卡片：展示当前曲目（不属于队列，不参与拖拽排序/删除）
  CM._renderQueueNow = function () {
    const box = els.queueNow;
    if (!box) return;

    const t = CM.currentTrack;
    if (!t) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }

    const path = CM.trackPath(t);
    box.innerHTML =
      `<div class="queue-now-art ph">${CM.icons.note}</div>
      <div class="queue-now-info">
        <div class="queue-now-label"><span class="eq-bars"><i></i><i></i><i></i></span>正在播放</div>
        <div class="queue-now-title">${esc(CM.trackName(t))}</div>
        <div class="queue-now-artist">${esc(CM.trackArtist(t))}</div>
      </div>`;
    box.classList.remove('hidden');

    // 无路径曲目不取封面；抽屉关闭时省一次请求（打开时 renderQueue 会补渲染）
    if (!path || !state.queueOpen) return;

    // 封面小图；响应到达时校验曲目未变更，避免切歌竞态贴错封面
    fb.artwork.getFb2kUrl('front', { maxSize: 120 }).then(r => {
      if (!r?.dataUrl || r.available === false) return;
      if (CM.trackPath(CM.currentTrack) !== path) return;
      const art = box.$('.queue-now-art');
      if (art) {
        art.style.backgroundImage = `url("${r.dataUrl}")`;
        art.classList.remove('ph');
        art.innerHTML = '';
      }
    });
  };

  CM.renderQueue = function () {
    // 队列重建（排序提交）期间宿主会连续广播 queueChanged，此时渲染会读到中间态，跳过
    if (_queueRebuilding) return;
    // 拖拽进行中禁止重渲染：记下 pending 标记，拖拽结束时统一补渲染
    if (_qDragIndex >= 0) { CM._queueRefreshPending = true; return; }
    CM._renderQueueNow();

    // 已有内容时延迟 150ms 才显示 loading：queue.get 通常即时返回，避免每次事件都闪一下转圈；
    // 首次（无缓存）立即 loading，保证空抽屉的视觉反馈
    let loadingShown = false;
    const cancelLoading = CM.delayedLoading(() => {
      loadingShown = true;
      els.queueList.innerHTML = CM.loadingHTML('');
    }, CM._queueItems ? 150 : 0);

    fb.queue.get().then(r => {
      cancelLoading();
      if (_queueRebuilding) return;
      if (_qDragIndex >= 0) { CM._queueRefreshPending = true; return; } // 取数期间用户又开始了拖拽

      const items = r?.items || r?.queue || r?.tracks || [];
      CM._queueItems = items; // 缓存完整队列（拖拽排序时据此生成新顺序）
      els.queueCount.textContent = items.length ? `${items.length} 首` : '';

      if (!items.length) {
        CM._queueSig = '';
        els.queueList.innerHTML = `<div class="queue-empty">
          ${CM.icons.queue}
          <div class="queue-empty-title">播放队列为空</div>
          <div class="queue-empty-sub">右键曲目选择「下一首播放」加入队列</div>
        </div>`;
        return;
      }

      // 队列即"待播列表"（正在播放的曲目出队即播，不会出现在列表中）
      // 队列 > 1 项时启用拖拽调序
      const canDrag = items.length > 1;

      // 预转义曲目字段，避免循环内重复调用 esc()
      const escItems = items.map(it => {
        const t = it.track || it;
        return { name: esc(CM.trackName(t)), artist: esc(CM.trackArtist(t)) };
      });

      // 内容签名未变则跳过重渲染（queueChanged 事件频繁但内容未必变化；签名含全部渲染输入）
      // 例外：loading 已显示时内容被转圈替换，必须走完整渲染恢复列表
      const sig = `${canDrag}|${escItems.map(t => `${t.name}|${t.artist}`).join('\n')}`;
      if (sig === CM._queueSig && !loadingShown) return;
      CM._queueSig = sig;

      const grip = canDrag ? `<span class="queue-grip" title="拖拽调整顺序">${CM.icons.grip}</span>` : '';
      els.queueList.innerHTML = escItems.map((track, i) =>
        `<div class="queue-item${canDrag ? ' can-drag' : ''}" data-i="${i}">
          ${grip}
          <span class="queue-item-idx">${i + 1}</span>
          <div class="queue-item-info">
            <div class="queue-item-title">${track.name}</div>
            <div class="queue-item-artist">${track.artist}</div>
          </div>
          <button class="queue-item-del" title="移出队列">${CM.icons.cancel}</button>
        </div>`
      ).join('');
      ensureQueueDelegation();
    });
  };

  // 队列项事件委托（一次性绑定在 queueList 上）
  let _qPointerDrag = null, // { index, startX, startY, active } 进行中的指针拖拽会话
    _qDragIndex = -1,   // 拖拽激活项索引（用于抑制拖拽期间的队列重渲染）
    _qDropTarget = null; // { el, before } 插入指示位置
  function _qClearIndicator() {
    if (_qDropTarget) {
      _qDropTarget.el.classList.remove('drop-before', 'drop-after');
      _qDropTarget = null;
    }
  }
  // 按纵坐标计算落点：目标行上半 → 插到该行之前，否则插到最后
  function _queueDropTargetAt(clientY) {
    const items = [...els.queueList.$$('.queue-item')];
    if (!items.length) return null;

    const el = items.find(el => {
      const { top, height } = el.getBoundingClientRect();
      return clientY < top + height / 2;
    });
    return el ? { el, before: true } : { el: items.at(-1), before: false };
  }
  // 拖拽范围限制：指示线与提交仅在指针位于队列列表区域内时生效
  function _qInList(clientX, clientY) {
    const { left, right, top, bottom } = els.queueList.getBoundingClientRect();
    return clientX >= left && clientX <= right && clientY >= top && clientY <= bottom;
  }
  // 结束一次拖拽的统一清理 + 补做拖拽期间被延迟的队列渲染
  function _qFinishDrag() {
    _qClearIndicator();
    _qPointerDrag = null;
    _qDragIndex = -1;
    document.body.classList.remove('is-reordering');
    els.queueList.$$('.queue-item.dragging').forEach(el => el.classList.remove('dragging'));

    if (CM._queueRefreshPending) {
      CM._queueRefreshPending = false;
      CM.renderQueue();
    }
  }
  function ensureQueueDelegation() {
    CM.runOnce('queueDelegation', () => {
      els.queueList.addEventListener('click', e => {
        const btn = e.target.closest('.queue-item-del');
        if (!btn) return;

        e.stopPropagation();
        const idx = parseInt(btn.closest('.queue-item').dataset.i, 10);
        if (isNaN(idx)) return;

        fb.queue.remove(idx).then(() => {
          CM.renderQueue();
          CM.refreshQueueBadge();
        });
      });
      // ---- 拖拽调整队列顺序（指针事件实现，不走 HTML5 DnD）----
      // 宿主持有本窗口的原生放置目标（v1.12.0 起 dnd 改为主机原生观察）：页面内
      // HTML5 拖拽的 dragover/drop 不会回投到页面，且宿主对非文件拖拽返回"禁止"光标，
      // 因此队列调序用 pointerdown/move/up 自行实现，拖拽范围与提交都由页面控制。
      // 宿主队列 API 无任意移动接口（仅 moveToTop），故排序走 清空+按新顺序重建，
      // 重建期间 _queueRebuilding 抑制 queueChanged 引发的中间态渲染（见 renderQueue）。
      els.queueList.addEventListener('pointerdown', e => {
        if (e.button !== 0 || e.pointerType === 'touch') return; // 触屏保留列表滚动
        if (_queueRebuilding || _qPointerDrag) return;
        if (e.target.closest?.('.queue-item-del')) return;       // 删除按钮不发起拖拽

        const qit = e.target.closest?.('.queue-item.can-drag');
        const idx = parseInt(qit?.dataset.i, 10);
        if (isNaN(idx) || !CM._queueItems || CM._queueItems.length < 2) return;

        e.preventDefault();
        // 指针捕获：保证移出窗口后仍能收到 move/up，松手必有着落
        try { els.queueList.setPointerCapture(e.pointerId); } catch { }

        _qPointerDrag = { index: idx, startX: e.clientX, startY: e.clientY, active: false };
      });
      els.queueList.addEventListener('pointermove', e => {
        const drag = _qPointerDrag;
        if (!drag) return;

        if (!drag.active) {
          // 小位移视为点击，越过阈值才进入拖拽态
          if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) < 4) return;
          drag.active = true;
          _qDragIndex = drag.index;
          els.queueList.$(`.queue-item[data-i="${drag.index}"]`)?.classList.add('dragging');
          document.body.classList.add('is-reordering');
        }

        if (!_qInList(e.clientX, e.clientY)) return _qClearIndicator();

        // 指针靠近列表上下边缘时自动滚动
        const rect = els.queueList.getBoundingClientRect();
        if (e.clientY < rect.top + 24) els.queueList.scrollTop -= 8;
        else if (e.clientY > rect.bottom - 24) els.queueList.scrollTop += 8;

        const t = _queueDropTargetAt(e.clientY);
        if (!t) return;
        if (_qDropTarget && _qDropTarget.el === t.el && _qDropTarget.before === t.before) return;

        _qClearIndicator();
        _qDropTarget = t;
        t.el.classList.add(t.before ? 'drop-before' : 'drop-after');
      });
      // 提交：落点按释放坐标现算；在队列范围外松手视为取消
      els.queueList.addEventListener('pointerup', e => {
        const drag = _qPointerDrag;
        if (!drag) return;

        const t = drag.active && _qInList(e.clientX, e.clientY) ? _queueDropTargetAt(e.clientY) : null;
        _qFinishDrag();

        const targetIdx = t && parseInt(t.el.dataset.i, 10);
        if (isNaN(targetIdx)) return;

        // 插入位置（原索引空间）：before → 目标行之前；否则目标行之后
        CM._queueMoveTo(drag.index, t.before ? targetIdx : targetIdx + 1);
      });
      els.queueList.addEventListener('pointercancel', () => _qFinishDrag());
      // Esc 取消进行中的拖拽（捕获阶段优先于全局 Esc 关闭队列抽屉）
      document.addEventListener('keydown', e => {
        if (e.key !== 'Escape' || !_qPointerDrag || !_qPointerDrag.active) return;
        e.stopPropagation();
        _qFinishDrag();
      }, true);
      window.addEventListener('blur', () => { if (_qPointerDrag) _qFinishDrag(); });
    });
  }

  // 单项移动：from（原索引）移动到 pos（原索引空间的插入点，0..n）→ 生成置换并重建队列
  CM._queueMoveTo = function (from, pos) {
    const n = (CM._queueItems || []).length;
    if (from < 0 || from >= n) return;

    pos = Math.max(0, Math.min(n, pos));
    const rest = Array.from({ length: n }, (_, i) => i).filter(i => i !== from);
    const at = Math.max(0, Math.min(rest.length, pos - (from < pos ? 1 : 0)));

    CM.reorderQueue([...rest.slice(0, at), from, ...rest.slice(at)]);
  };

  // 按新顺序重建播放队列（SDK 无任意移动接口）：快照 → clear → 按来源分组依次重新入队
  // newOrder[i] = 新位置上原条目的索引；来源信息（歌单引用 / 路径）保持原样
  _queueRebuilding = false;
  CM._queueItems = [];
  CM.reorderQueue = async function (newOrder) {
    const items = CM._queueItems || [];
    const n = items.length;
    if (!n || newOrder.length !== n || _queueRebuilding) return;
    if (newOrder.every((v, i) => v === i)) return; // 原地拖拽，不做任何事

    // 歌单引用元数据（兼容裸条目与 {track:...} 包装两种形态），无引用返回 null
    const playlistRef = it =>
      [it, it?.track].find(c =>
        typeof c?.playlist === 'number' && c.playlist >= 0 &&
        typeof c?.playlistItem === 'number' && c.playlistItem >= 0
      ) ?? null;

    const readd = async it => {
      const ref = playlistRef(it);
      if (ref) return fb.queue.add({ playlist: ref.playlist, tracks: [ref.playlistItem] });
      const tt = it.track || it;
      const pp = tt.absolutePath || tt.path || '';
      return pp ? fb.queue.addPaths([pp]) : null;
    };

    _queueRebuilding = true;
    try {
      const clearRes = await fb.queue.clear();
      if (clearRes?.success === false) {
        CM.showToast('调整失败', clearRes.error || '无法清空队列', 'error');
        return null;
      }

      let failCount = 0;
      for (const it of newOrder.map(i => items[i])) {
        const res = await readd(it);
        if (!res || res.success === false) failCount++;
      }

      if (failCount > 0) CM.showToast('队列顺序已调整', `${failCount} 首曲目重新入队失败`, 'error');
      else CM.showToast('已调整队列顺序', null, 'success');
      return true;
    } catch {
      return CM.showToast('调整失败', '队列重建中断，请重试', 'error');
    } finally {
      _queueRebuilding = false;
      CM.renderQueue();
      CM.refreshQueueBadge();
    }
  };

  CM.toggleQueue = function (open) {
    state.queueOpen = open !== undefined ? open : !state.queueOpen;
    els.queueDrawer.classList.toggle('open', state.queueOpen);
    if (state.queueOpen) CM.renderQueue();
  };
})();
