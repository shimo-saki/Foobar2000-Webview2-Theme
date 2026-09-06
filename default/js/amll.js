import { LyricPlayer } from "https://cdn.jsdelivr.net/npm/@applemusic-like-lyrics/core/+esm";
const CM = window.CloudMusic;

const container = document.querySelector('.lyrics-scroll');
const player = new LyricPlayer();
player.setCurrentTime(0);
player.update(0);
container.replaceChildren(player.getElement());
// document.querySelector('.np-lyrics').replaceChildren(player.getElement());
CM.player = player;

let lastFrameTime = 0;
function loop(timestamp) {
  const delta = timestamp - (lastFrameTime || timestamp);
  lastFrameTime = timestamp;

  player.setCurrentTime(CM.state.position * 1000);
  player.update(delta);

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

player.addEventListener("line-click", async (event) => {
  const time = event.line.getLine().startTime;
  await fb2k.invoke('playback.setPosition', { position: time / 1000 });
  player.setCurrentTime(time, true);
});
