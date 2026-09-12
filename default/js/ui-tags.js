/* ============================================
 * CloudMusic ui-tags.js — 标签编辑器
 * 单曲/批量标签编辑 / 封面查看·更换·移除
 * ============================================ */

(function() {
  'use strict';
  var CM = window.CloudMusic;
  var els = CM.els, state = CM.state, esc = CM.escHtml;

  /* ============================================
   * 标签编辑器（单曲 + 批量）
   * ============================================ */
  // 标签字段定义：SDK 键名 → 中文标签
  var TAG_FIELDS = [
    { key: 'TITLE', label: '标题' },
    { key: 'ARTIST', label: '艺术家' },
    { key: 'ALBUM', label: '专辑' },
    { key: 'ALBUM ARTIST', label: '专辑艺术家' },
    { key: 'GENRE', label: '流派' },
    { key: 'DATE', label: '年份' },
    { key: 'TRACKNUMBER', label: '音轨号' },
    { key: 'DISCNUMBER', label: 'CD号' },
    { key: 'COMPOSER', label: '作曲' },
    { key: 'COMMENT', label: '备注' }
  ];

  // 标签编辑器内部状态
  var _tagCtx = null; // { mode: 'single'|'batch', tracks: [], original: {} }

  CM.showTagEditor = function(track) {
    const path = CM.trackPath(track);
    if (!path) { return CM.showToast('无法编辑', '未获取到文件路径', 'error') }

    _tagCtx = { mode: 'single', tracks: [track], path };
    els.tagEditorTitle.textContent = '编辑标签';
    els.tagEditorTrack.textContent = `${CM.trackName(track)} — ${path}`;
    els.tagEditorHint.textContent = '正在读取标签...';

    // 立即打开编辑器，显示加载态
    els.tagEditorBody.innerHTML = `
      <div style="text-align:center;padding:32px;color:var(--text-3);font-size:13px">
        <div class="spinner" style="margin:0 auto 10px"></div>正在读取标签...
      </div>`;
    els.tagEditorOverlay.classList.add('open');

    // 读取元数据（扁平格式，大写键名）
    CM.api('metadata.readByPath', { path }).then(r => {
      if (!_tagCtx || _tagCtx.mode !== 'single') return; // 已关闭或切换
      if (!r || r.success === false) {
        CM.showToast('读取失败', '无法读取文件标签', 'error');
        CM.hideTagEditor();
        return;
      }
      _tagCtx.original = r;
      _renderTagFields(false, r);
      _renderTagCover(path);
      els.tagEditorHint.textContent = '修改后点击保存写入文件';
    });
  };

  CM.showBatchTagEditor = function(tracks) {
    if (!tracks || tracks.length < 2) return;
    _tagCtx = { mode: 'batch', tracks };

    const { length } = tracks;
    let names = tracks.slice(0, 3).map(CM.trackName).join('、');
    if (length > 3) names += ` 等${length}首`;

    els.tagEditorTitle.textContent = `批量编辑标签（${length}首）`;
    els.tagEditorTrack.textContent = names;
    els.tagEditorHint.textContent = '勾选要批量修改的字段，未勾选的字段保持原值';

    _renderTagFields(true, {});

    // 批量模式隐藏封面区
    const coverSec = els.tagEditorBody.querySelector('.tag-cover-section');
    if (coverSec) coverSec.style.display = 'none';

    els.tagEditorOverlay.classList.add('open');
  };

  CM.hideTagEditor = function() {
    els.tagEditorOverlay.classList.remove('open');
    _tagCtx = null;
  };

  // 渲染标签输入字段
  function _renderTagFields(isBatch, tags) {
    const coverHTML = isBatch ? '' : `
      <div class="tag-cover-section" id="tagCoverSection">
        <div class="tag-cover-preview" id="tagCoverPreview">${CM.icons.note}</div>
        <div class="tag-cover-actions">
          <button class="tag-btn" id="tagCoverReplace">更换封面</button>
          <button class="tag-btn danger" id="tagCoverRemove">移除封面</button>
        </div>
      </div>`;

    const fieldsHTML = TAG_FIELDS.map(f =>
      isBatch
        ? `<div class="tag-field batch">
            <input type="checkbox" class="tag-field-check" data-field="${f.key}">
            <label class="tag-field-label">${f.label}</label>
            <input type="text" class="tag-field-input" data-field="${f.key}" placeholder="保持原值" disabled>
          </div>`
        : `<div class="tag-field">
            <label class="tag-field-label">${f.label}</label>
            <input type="text" class="tag-field-input" data-field="${f.key}" value="${esc(tags[f.key] ?? '')}">
          </div>`
    ).join('');

    els.tagEditorBody.innerHTML = coverHTML + fieldsHTML;

    // 批量模式：checkbox 启用/禁用对应输入框
    if (!isBatch) return;
    els.tagEditorBody.querySelectorAll('.tag-field-check').forEach(cb =>
      cb.addEventListener('change', () => {
        const input = els.tagEditorBody.querySelector(`.tag-field-input[data-field="${cb.dataset.field}"]`);
        if (input) input.disabled = !cb.checked;
      })
    );
  }

  // 渲染封面预览
  function _renderTagCover(path) {
    CM.api('artwork.getForTrack', { path, type: 'front' }).then(r => {
      if (!r || r.success === false || !r.dataUrl) return;
      const preview = CM.$('tagCoverPreview');
      if (preview) preview.innerHTML = `<img src="${r.dataUrl}" alt="">`;
    });
  }

  // 保存标签
  CM._saveTagEditor = function() {
    if (!_tagCtx) return;
    (_tagCtx.mode === 'single' ? _saveSingleTags : _saveBatchTags)();
  };

  const _TAG_TO_TRACK = {
    TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', 'ALBUM ARTIST': 'albumArtist',
    GENRE: 'genre', DATE: 'date', TRACKNUMBER: 'trackNumber', DISCNUMBER: 'discNumber',
  };
  const _NUMERIC_TRACK_KEYS = new Set(['trackNumber', 'discNumber']);

  function _saveSingleTags() {
    const path = _tagCtx.path;
    const original = _tagCtx.original || {};
    const tags = {};

    for (const f of TAG_FIELDS) {
      const input = els.tagEditorBody.querySelector(`.tag-field-input[data-field="${f.key}"]`);
      if (!input) continue;
      const newVal = input.value.trim();
      const oldVal = original[f.key] ?? '';
      if (newVal !== oldVal) tags[f.key] = newVal || null; // 空值设为 null 以清除标签
    }

    if (!Object.keys(tags).length) {
      CM.showToast('无变更', '没有检测到修改的标签', null);
      CM.hideTagEditor();
      return;
    }

    els.tagEditorHint.textContent = '正在写入...';
    CM.api('metadata.write', { path, tags }).then(r => {
      if (!r || r.success === false) {
        CM.showToast('写入失败', '标签写入出错', 'error');
        els.tagEditorHint.textContent = '写入失败，请重试';
        return;
      }
      CM.showToast('标签已保存', CM.trackName(_tagCtx.tracks[0]), 'success');

      // 更新本地缓存
      const track = _tagCtx.tracks[0];
      if (track) {
        for (const [tagKey, trackKey] of Object.entries(_TAG_TO_TRACK)) {
          if (tags[tagKey] == null) continue;
          track[trackKey] = _NUMERIC_TRACK_KEYS.has(trackKey)
            ? parseInt(tags[tagKey], 10) || 0
            : tags[tagKey];
        }
        CM.renderTrackTable();
      }
      CM.hideTagEditor();
    });
  }

  function _saveBatchTags() {
    const tags = {};

    for (const f of TAG_FIELDS) {
      const cb = els.tagEditorBody.querySelector(`.tag-field-check[data-field="${f.key}"]`);
      if (!cb?.checked) continue;
      const input = els.tagEditorBody.querySelector(`.tag-field-input[data-field="${f.key}"]`);
      if (!input) continue;
      tags[f.key] = input.value.trim() || null;
    }

    if (!Object.keys(tags).length) return CM.showToast('未选择字段', '请勾选要批量修改的标签字段', 'error');
    els.tagEditorHint.textContent = '正在批量写入...';

    const items = _tagCtx.tracks
      .map(track => (track && CM.trackPath(track) ? { path: CM.trackPath(track), tags } : null))
      .filter(Boolean);

    CM.api('metadata.writeBatch', { items }).then(r => {
      if (!r || r.success === false) {
        CM.showToast('批量写入失败', '标签写入出错', 'error');
        els.tagEditorHint.textContent = '写入失败，请重试';
        return;
      }

      const success = r.successCount || 0, fail = r.failCount || 0;
      if (fail > 0) {
        CM.showToast('部分成功', `${success}首成功，${fail}首失败`, 'error');
      } else {
        CM.showToast('批量保存成功', `${success}首曲目标签已更新`, 'success');
      }

      // 更新本地缓存
      for (const track of _tagCtx.tracks) {
        if (!track) continue;
        for (const [tagKey, trackKey] of Object.entries(_TAG_TO_TRACK)) {
          if (tags[tagKey] == null) continue;
          track[trackKey] = _NUMERIC_TRACK_KEYS.has(trackKey)
            ? parseInt(tags[tagKey], 10) || 0
            : tags[tagKey];
        }
      }
      CM.renderTrackTable();
      CM.hideTagEditor();
    });
  }

  // 封面管理：更换封面
  CM._replaceCover = function() {
    if (!_tagCtx || _tagCtx.mode !== 'single') return;
    els.tagCoverFile.click();
  };

  // 封面管理：移除封面
  CM._removeCover = () => {
    if (!_tagCtx || _tagCtx.mode !== 'single') return;
    const { path } = _tagCtx;

    CM.showModal({ title: '移除封面', desc: '确定要移除这首曲目的嵌入封面吗？', okText: '移除', danger: true }).then(ok => {
      if (!ok) return;
      return CM.api('metadata.removeEmbeddedArt', { path, removeAll: true }).then(r => {
        if (r && r.success !== false) {
          CM.showToast('封面已移除', null, 'success');
          const preview = CM.$('tagCoverPreview');
          if (preview) preview.innerHTML = CM.icons.note;
        } else {
          CM.showToast('移除失败', '该格式可能不支持嵌入封面操作', 'error');
        }
      });
    });
  };

  // 文件选择回调：读取 Base64 并嵌入封面
  CM._onCoverFileSelected = function() {
    if (!_tagCtx || _tagCtx.mode !== 'single') return;
    const file = els.tagCoverFile.files[0];
    if (!file) return;
    els.tagCoverFile.value = ''; // 重置以便重复选择同一文件

    const { path } = _tagCtx;
    const reader = new FileReader();
    reader.onload = ({ target }) => {
      const { result: dataUrl } = target;
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1); // 去掉 data:image/...;base64, 前缀
      CM.api('metadata.embedArtwork', { path, imageData: base64, type: 'front' }).then(r => {
        if (r && r.success !== false) {
          CM.showToast('封面已更新', null, 'success');
          const preview = CM.$('tagCoverPreview');
          if (preview) preview.innerHTML = `<img src="${dataUrl}" alt="">`;
        } else {
          CM.showToast('嵌入失败', '该格式可能不支持嵌入封面', 'error');
        }
      });
    };
    reader.readAsDataURL(file);
  };
})();
