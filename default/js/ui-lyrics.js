/* ============================================
 * CloudMusic ui-lyrics.js — 歌词
 * 多编码解码 / LRC 解析结果渲染 / 同步高亮 / 逐字高亮
 * 主歌词面板显隐（右栏开合动画）
 * ============================================ */

import { CM } from 'core';
import { fb } from 'foo-webview-sdk';
const { els, icons, settings, state } = CM;

CM.changePlayerState = function (state) {
  CM.player?.[state === "playing" ? "resume" : "pause"]();
  if (state === 'stopped') CM.loadLyrics();
};

/* ============================================
 * 歌词面板显隐
 * ============================================ */
CM.setLyricsVisible = function (visible) {
  state.lyricsVisible = visible;
  CM.setSettings('lyricsVisible', visible);
  els.btnLyricsToggle.classList.toggle('active', visible);
  els.app.classList.toggle('lyrics-hidden', !visible);
};

function contextMenu(x, y) {
  const hidden = !CM.checkComponent('foo_uie_eslyric');
  const items = [
    {
      label: '重载歌词…', icon: icons.refresh,
      action: () => CM.loadLyrics(false)
    },
    {
      label: '编辑歌词', icon: icons.edit, hidden,
      action: () => CM.getGuid('编辑歌词')
        .then(({ guid, subGiud }) => fb.discovery.executeMainMenuCommand(guid, subGiud)),
    },
    { divider: true, hidden },
    {
      label: '搜索歌词…', icon: icons.search, hidden,
      action: () => CM.getGuid('搜索歌词')
        .then(({ guid, subGiud }) => fb.discovery.executeMainMenuCommand(guid, subGiud)),
    },
    {
      label: '显示ESLyric面板', icon: icons.window, hidden,
      action: () => CM.getGuid('ESLyric')
        .then(({ guid }) => fb.menu.runMainMenuCommand(guid))
    },
    { divider: true },
    {
      label: '使用动态背景', icon: icons.dynamic, checked: settings.background,
      action: () => CM.showDynamicBackground(!settings.background, state.npOpen ? els.npOverlay : els.rightPanel)
    }
  ];
  CM.showCtxMenu(x, y, items);
}

els.lyricsScroll.addEventListener('contextmenu', e => contextMenu(e.clientX, e.clientY));
els.npOverlay.addEventListener('contextmenu', e => contextMenu(e.clientX, e.clientY));
