import { LyricPlayer } from "https://cdn.jsdelivr.net/npm/@applemusic-like-lyrics/core/+esm";
const CM = window.CloudMusic;

const player = initLyricPlayer(".lyrics-scroll"),
    npPlayer = initLyricPlayer(".np-lyrics");
CM.player = player, CM.npPlayer = npPlayer;
CM.activePlayer = CM.state.lyricsVisible ? player : CM.state.npOpen ? npPlayer : null;

function initLyricPlayer(selector) {
  const container = document.querySelector(selector);
  const player = new LyricPlayer();
  player.setCurrentTime(0);
  player.update(0);
  container.replaceChildren(player.getElement());
  return player;
}

let lastFrameTime = 0;
function loop(timestamp) {
  const delta = timestamp - (lastFrameTime || timestamp);
  lastFrameTime = timestamp;

  CM.activePlayer?.setCurrentTime(CM.state.position * 1000);
  CM.activePlayer?.update(delta);

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

[player, npPlayer].forEach(p => {
  p.addEventListener("line-click", async (event) => {
    const time = event.line.getLine().startTime;
    await fb2k.invoke('playback.setPosition', { position: time / 1000 });
    p.setCurrentTime(time, true);
  });
});
