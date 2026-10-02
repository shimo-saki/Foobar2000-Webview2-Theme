import { BackgroundRender, LyricPlayer, MeshGradientRenderer } from '@applemusic-like-lyrics/core';
import { CM } from 'core';
import { fb } from 'foo-webview-sdk';
const { els } = CM;

const player = CM.player = new LyricPlayer();
els.lyricsScroll.replaceChildren(player.getElement());
player.setCurrentTime(0);
player.update(0);

let lastFrameTime = 0;
function loop(timestamp) {
  const delta = timestamp - (lastFrameTime || timestamp);
  lastFrameTime = timestamp;

  player.setCurrentTime(CM.state.position * 1000);
  player.update(delta);

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

player.addEventListener("line-click", event => {
  const time = event.line.getLine().startTime;
  fb.player.seek(time / 1000);
  player.setCurrentTime(time, true);
});

CM.showDynamicBackground = function (show, dom = els.rightPanel) {
  if (show) {
    CM.background ??= BackgroundRender.new(MeshGradientRenderer);
    dom.appendChild(CM.background.getElement());
    CM.loadCurrentArtwork();
  } else {
    CM.background?.dispose();
    CM.background = null;
  }

  els.app.classList.toggle('dynamic', show);
  CM.setSettings('background', show);
};
