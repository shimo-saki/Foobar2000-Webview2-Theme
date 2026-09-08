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
    var path = CM.trackPath(track);
    if (!path) { CM.showToast('无法编辑', '未获取到文件路径', 'error'); return; }
    _tagCtx = { mode: 'single', tracks: [track], path: path };
    els.tagEditorTitle.textContent = '编辑标签';
    els.tagEditorTrack.textContent = CM.trackName(track) + ' — ' + path;
    els.tagEditorHint.textContent = '正在读取标签...';
    // 立即打开编辑器，显示加载态
    els.tagEditorBody.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-3);font-size:13px"><div class="spinner" style="margin:0 auto 10px"></div>正在读取标签...</div>';
    els.tagEditorOverlay.classList.add('open');
    // 读取元数据（扁平格式，大写键名）
    CM.api('metadata.readByPath', { path: path }).then(function(r) {
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
    _tagCtx = { mode: 'batch', tracks: tracks };
    els.tagEditorTitle.textContent = '批量编辑标签（' + tracks.length + '首）';
    // 显示前3首曲目名 + 省略
    var names = tracks.slice(0, 3).map(CM.trackName).join('、');
    if (tracks.length > 3) names += ' 等' + tracks.length + '首';
    els.tagEditorTrack.textContent = names;
    els.tagEditorHint.textContent = '勾选要批量修改的字段，未勾选的字段保持原值';
    _renderTagFields(true, {});
    // 批量模式隐藏封面区
    var coverSec = els.tagEditorBody.querySelector('.tag-cover-section');
    if (coverSec) coverSec.style.display = 'none';
    els.tagEditorOverlay.classList.add('open');
  };

  CM.hideTagEditor = function() {
    els.tagEditorOverlay.classList.remove('open');
    _tagCtx = null;
  };

  // 渲染标签输入字段
  function _renderTagFields(isBatch, tags) {
    var parts = [];
    if (!isBatch) {
      // 单曲模式：显示封面区
      parts.push('<div class="tag-cover-section" id="tagCoverSection">' +
        '<div class="tag-cover-preview" id="tagCoverPreview"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>' +
        '<div class="tag-cover-actions">' +
        '<button class="tag-btn" id="tagCoverReplace">更换封面</button>' +
        '<button class="tag-btn danger" id="tagCoverRemove">移除封面</button>' +
        '</div></div>');
    }
    TAG_FIELDS.forEach(function(f) {
      var val = tags[f.key] || '';
      if (isBatch) {
        parts.push('<div class="tag-field batch">' +
          '<input type="checkbox" class="tag-field-check" data-field="' + f.key + '">' +
          '<label class="tag-field-label">' + f.label + '</label>' +
          '<input type="text" class="tag-field-input" data-field="' + f.key + '" placeholder="保持原值" disabled>' +
          '</div>');
      } else {
        parts.push('<div class="tag-field">' +
          '<label class="tag-field-label">' + f.label + '</label>' +
          '<input type="text" class="tag-field-input" data-field="' + f.key + '" value="' + esc(val) + '">' +
          '</div>');
      }
    });
    els.tagEditorBody.innerHTML = parts.join('');
    // 批量模式：checkbox 启用/禁用对应输入框
    if (isBatch) {
      els.tagEditorBody.querySelectorAll('.tag-field-check').forEach(function(cb) {
        cb.addEventListener('change', function() {
          var input = els.tagEditorBody.querySelector('.tag-field-input[data-field="' + cb.dataset.field + '"]');
          if (input) input.disabled = !cb.checked;
        });
      });
    }
  }

  // 渲染封面预览
  function _renderTagCover(path) {
    CM.api('artwork.getForTrack', { path: path, type: 'front' }).then(function(r) {
      if (r && r.success !== false && r.dataUrl) {
        var preview = CM.$('tagCoverPreview');
        if (preview) preview.innerHTML = '<img src="' + r.dataUrl + '" alt="">';
      }
    });
  }

  // 保存标签
  CM._saveTagEditor = function() {
    if (!_tagCtx) return;
    if (_tagCtx.mode === 'single') {
      _saveSingleTags();
    } else {
      _saveBatchTags();
    }
  };

  function _saveSingleTags() {
    var path = _tagCtx.path;
    var tags = {};
    var changed = false;
    TAG_FIELDS.forEach(function(f) {
      var input = els.tagEditorBody.querySelector('.tag-field-input[data-field="' + f.key + '"]');
      if (!input) return;
      var newVal = input.value.trim();
      var oldVal = (_tagCtx.original && _tagCtx.original[f.key]) || '';
      if (newVal !== oldVal) {
        tags[f.key] = newVal || null; // 空值设为 null 以清除标签
        changed = true;
      }
    });
    if (!changed) { CM.showToast('无变更', '没有检测到修改的标签', null); CM.hideTagEditor(); return; }
    els.tagEditorHint.textContent = '正在写入...';
    CM.api('metadata.write', { path: path, tags: tags }).then(function(r) {
      if (!r || r.success === false) {
        CM.showToast('写入失败', '标签写入出错', 'error');
        els.tagEditorHint.textContent = '写入失败，请重试';
        return;
      }
      CM.showToast('标签已保存', CM.trackName(_tagCtx.tracks[0]), 'success');
      // 更新本地缓存
      var track = _tagCtx.tracks[0];
      if (track) {
        if (tags.TITLE != null) track.title = tags.TITLE;
        if (tags.ARTIST != null) track.artist = tags.ARTIST;
        if (tags.ALBUM != null) track.album = tags.ALBUM;
        if (tags['ALBUM ARTIST'] != null) track.albumArtist = tags['ALBUM ARTIST'];
        if (tags.GENRE != null) track.genre = tags.GENRE;
        if (tags.DATE != null) track.date = tags.DATE;
        if (tags.TRACKNUMBER != null) track.trackNumber = parseInt(tags.TRACKNUMBER, 10) || 0;
        if (tags.DISCNUMBER != null) track.discNumber = parseInt(tags.DISCNUMBER, 10) || 0;
        CM.renderTrackTable();
      }
      CM.hideTagEditor();
    });
  }

  function _saveBatchTags() {
    var tags = {};
    var hasChecked = false;
    TAG_FIELDS.forEach(function(f) {
      var cb = els.tagEditorBody.querySelector('.tag-field-check[data-field="' + f.key + '"]');
      if (!cb || !cb.checked) return;
      var input = els.tagEditorBody.querySelector('.tag-field-input[data-field="' + f.key + '"]');
      if (!input) return;
      tags[f.key] = input.value.trim() || null;
      hasChecked = true;
    });
    if (!hasChecked) { CM.showToast('未选择字段', '请勾选要批量修改的标签字段', 'error'); return; }
    els.tagEditorHint.textContent = '正在批量写入...';
    var items = _tagCtx.tracks.map(function(t) {
      var p = CM.trackPath(t);
      return p ? { path: p, tags: tags } : null;
    }).filter(Boolean);
    CM.api('metadata.writeBatch', { items: items }).then(function(r) {
      if (!r || r.success === false) {
        CM.showToast('批量写入失败', '标签写入出错', 'error');
        els.tagEditorHint.textContent = '写入失败，请重试';
        return;
      }
      var ok = r.successCount || 0, fail = r.failCount || 0;
      if (fail > 0) {
        CM.showToast('部分成功', ok + '首成功，' + fail + '首失败', 'error');
      } else {
        CM.showToast('批量保存成功', ok + '首曲目标签已更新', 'success');
      }
      // 更新本地缓存
      _tagCtx.tracks.forEach(function(track) {
        if (!track) return;
        if (tags.TITLE != null) track.title = tags.TITLE;
        if (tags.ARTIST != null) track.artist = tags.ARTIST;
        if (tags.ALBUM != null) track.album = tags.ALBUM;
        if (tags['ALBUM ARTIST'] != null) track.albumArtist = tags['ALBUM ARTIST'];
        if (tags.GENRE != null) track.genre = tags.GENRE;
        if (tags.DATE != null) track.date = tags.DATE;
        if (tags.TRACKNUMBER != null) track.trackNumber = parseInt(tags.TRACKNUMBER, 10) || 0;
        if (tags.DISCNUMBER != null) track.discNumber = parseInt(tags.DISCNUMBER, 10) || 0;
      });
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
  CM._removeCover = function() {
    if (!_tagCtx || _tagCtx.mode !== 'single') return;
    var path = _tagCtx.path;
    CM.showModal({
      title: '移除封面',
      desc: '确定要移除这首曲目的嵌入封面吗？',
      okText: '移除',
      danger: true
    }).then(function(result) {
      if (!result) return;
      CM.api('metadata.removeEmbeddedArt', { path: path, removeAll: true }).then(function(r) {
        if (r && r.success !== false) {
          CM.showToast('封面已移除', null, 'success');
          var preview = CM.$('tagCoverPreview');
          if (preview) preview.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
        } else {
          CM.showToast('移除失败', '该格式可能不支持嵌入封面操作', 'error');
        }
      });
    });
  };

  // 文件选择回调：读取 Base64 并嵌入封面
  CM._onCoverFileSelected = function() {
    if (!_tagCtx || _tagCtx.mode !== 'single') return;
    var file = els.tagCoverFile.files[0];
    if (!file) return;
    els.tagCoverFile.value = ''; // 重置以便重复选择同一文件
    var path = _tagCtx.path;
    var reader = new FileReader();
    reader.onload = function(e) {
      var dataUrl = e.target.result;
      var base64 = dataUrl.slice(dataUrl.indexOf(',') + 1); // 去掉 data:image/...;base64, 前缀
      CM.api('metadata.embedArtwork', { path: path, imageData: base64, type: 'front' }).then(function(r) {
        if (r && r.success !== false) {
          CM.showToast('封面已更新', null, 'success');
          var preview = CM.$('tagCoverPreview');
          if (preview) preview.innerHTML = '<img src="' + dataUrl + '" alt="">';
        } else {
          CM.showToast('嵌入失败', '该格式可能不支持嵌入封面', 'error');
        }
      });
    };
    reader.readAsDataURL(file);
  };
})();
