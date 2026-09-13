/* ============================================
 * CloudMusic ui-discover.js — 发现页与搜索
 * 每日推荐 / 随机专辑 / 最近添加 / 随机曲目
 * 媒体库搜索页
 * ============================================ */

(function () {
  'use strict';
  const CM = window.CloudMusic;
  const els = CM.els, state = CM.state, esc = CM.escHtml;

  /* ============================================
   * 发现页
   * ============================================ */
  const WEEK_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  CM.renderDiscover = function () {
    const d = new Date();
    els.heroDate.textContent = `${d.getFullYear()} / ${d.getMonth() + 1} / ${d.getDate()} ${WEEK_DAYS[d.getDay()]}`;
    CM.renderDiscoverAlbums();
    CM.renderDiscoverRecent();
    CM.renderDiscoverRandom();
  };

  CM.renderDiscoverAlbums = function () {
    els.discoverAlbums.innerHTML = CM.loadingHTML('加载中...', 'grid-column:1/-1');
    // 不传 includeCover 避免阻塞 UI（getAlbums+cover 耗时 1000ms+）；改用 fillArtworkBatch 懒加载
    CM.api('library.getAlbums', { limit: 200 }).then(r => {
      const showError = html => els.discoverAlbums.innerHTML = html;

      if (!r) return showError(`<div class="section-error" style="grid-column:1/-1">${CM.icons.error}<span>媒体库不可用</span></div>`);

      let albums = r.albums || [];
      if (!albums.length) return showError(CM.emptyHTML('媒体库为空，请在 foobar2000 中添加音乐文件夹', null, 'grid-column:1/-1'));

      // Fisher-Yates 洗牌取前 12
      for (let i = albums.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [albums[i], albums[j]] = [albums[j], albums[i]];
      }
      albums = albums.slice(0, 12);

      els.discoverAlbums.innerHTML = albums.map(al => CM._renderAlbumCard(al)).join('');

      // 异步批量加载封面（不阻塞 UI）：先取每张专辑首曲路径，再批量请求封面
      CM._loadAlbumCovers(els.discoverAlbums, albums, 320);
      CM._ensureMainContentDelegation();
    });
  };

  CM.renderDiscoverRecent = function () {
    els.discoverRecent.innerHTML = CM.loadingHTML();
    CM.api('library.getRecentlyAdded', { limit: 8 }).then(r => {
      CM.renderTrackRows(els.discoverRecent, CM.respTracks(r), '暂无最近添加的曲目');
    });
  };

  CM.renderDiscoverRandom = function () {
    els.discoverRandom.innerHTML = CM.loadingHTML();
    CM.api('library.getRandomTracks', { count: 10 })
      .then(r => CM.renderTrackRows(els.discoverRandom, CM.respTracks(r), '媒体库为空'));
  };

  // 每日推荐：随机 30 首，原子替换播放列表并播放
  CM.playDaily = function () {
    const resetBtn = CM.setBtnLoading(els.btnPlayDaily, '加载中...');
    CM.api('library.getRandomTracks', { count: 30 }).then(r => {
      const tracks = CM.respTracks(r);
      if (!tracks.length) { CM.showToast('媒体库为空', '请先在 foobar2000 中配置媒体库', 'error'); resetBtn(); return; }
      CM.playAllTracks(tracks, '每日推荐', ok => {
        resetBtn();
        if (ok) CM.showToast('每日推荐', `已加载 ${tracks.length} 首并开始播放`, 'success');
      });
    });
  };

  /* ============================================
   * 搜索
   * ============================================ */
  CM.doSearch = function (query) {
    query = (query || '').trim();
    if (!query) {
      els.searchResults.innerHTML = CM.emptyHTML('输入关键词搜索媒体库', '<span class="icon" style="font-size:48px;color:var(--text-3);"></span>');
      return;
    }
    els.searchResults.innerHTML = CM.loadingHTML('搜索中...');
    CM.api('library.search', { query, limit: 200 }).then(r => {
      if (!r || r.success === false) {
        els.searchResults.innerHTML = `<div class="section-error">${CM.icons.error}<span>搜索失败，媒体库可能未就绪</span></div>`;
        return;
      }
      const tracks = CM.respTracks(r);
      if (!tracks.length) {
        els.searchResults.innerHTML = `<div class="search-empty">没有找到与「${esc(query)}」相关的结果</div>`;
        return;
      }
      const curPath = CM.trackPath(CM.currentTrack);
      state.searchTracks = tracks;
      const total = r.total ?? tracks.length;
      const header = `<div style="display:flex;align-items:center;gap:12px;margin:4px 0 14px">
        <div class="library-section-title" style="margin:0">共 ${total} 条结果</div>
        <button class="pl-btn" id="searchAddAllBtn" style="margin-left:auto">${CM.icons.plus}<span>添加全部到歌单</span></button>
      </div>`;

      const items = tracks.map((track, i) => {
        const title = esc(CM.trackName(track));
        const artist = CM.trackArtist(track);
        const album = esc(track.album || '');
        const path = esc(CM.trackPath(track));
        const sub = artist + (album ? ` · ${album}` : '');

        return `<div class="search-result-item fade-in${path === curPath ? ' playing' : ''}" data-path="${path}" data-i="${i}" data-title="${title}" data-artist="${artist}" data-album="${album}">
          <div class="search-result-art" data-art-path="${path}">${CM.icons.note}</div>
          <div class="search-result-info">
            <div class="search-result-title">${title}</div>
            <div class="search-result-sub">${sub}</div>
          </div>
          <span class="search-result-dur">${CM.formatTime(track.duration)}</span>
        </div>`;
      });

      els.searchResults.innerHTML = header + items.join('');
      CM.fillArtworkBatch(els.searchResults, 120);
      els.searchResults.querySelector('#searchAddAllBtn')
        ?.addEventListener('click', e => CM.addToPlaylistMenu(tracks, e.clientX, e.clientY));
      CM._ensureMainContentDelegation(); // 搜索结果事件由 mainContent 统一委托
    });
  };
})();
