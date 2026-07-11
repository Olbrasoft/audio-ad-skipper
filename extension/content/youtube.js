// Runs on YouTube watch pages. YouTube exposes ad playback through player
// state classes on #movie_player, so this module stays separate from the
// Seznam TTS duration heuristic in intercept.js.

(() => {
  const TAG = '[AAS YouTube]';
  const PLAYER_SELECTOR = '#movie_player';
  const SKIP_SELECTOR = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-overlay-close-button'
  ].join(',');
  const CHECK_INTERVAL_MS = 250;
  const MIN_VISIBLE_SIZE = 100;
  const SEEK_PAD_SECONDS = 0.05;

  const touchedVideos = new WeakMap();
  let wasInAd = false;

  console.info(TAG, 'installed at', location.href);

  function getPlayer() {
    return document.querySelector(PLAYER_SELECTOR);
  }

  function isAdShowing(player) {
    return !!player && (
      player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting')
    );
  }

  function isVisibleElement(el) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width >= MIN_VISIBLE_SIZE &&
      rect.height >= MIN_VISIBLE_SIZE &&
      style.display !== 'none' &&
      style.visibility !== 'hidden';
  }

  function findVisibleAdVideo() {
    return Array.from(document.querySelectorAll('video')).find(isVisibleElement);
  }

  function findVisibleSkipButton() {
    return Array.from(document.querySelectorAll(SKIP_SELECTOR)).find((button) => (
      isVisibleElement(button) && !button.disabled
    ));
  }

  function rememberVideoState(video) {
    if (touchedVideos.has(video)) return;
    touchedVideos.set(video, {
      muted: video.muted,
      playbackRate: video.playbackRate
    });
  }

  function restoreVideoState(video) {
    const state = touchedVideos.get(video);
    if (!state) return;
    video.muted = state.muted;
    video.playbackRate = state.playbackRate;
    touchedVideos.delete(video);
  }

  function skipAd(player) {
    const button = findVisibleSkipButton();
    if (button) {
      button.click();
    }

    const video = findVisibleAdVideo();
    if (!video) return;

    rememberVideoState(video);
    video.muted = true;

    if (video.playbackRate < 16) {
      video.playbackRate = 16;
    }

    if (Number.isFinite(video.duration) &&
      video.duration > 0 &&
      video.currentTime < video.duration - 0.3) {
      try {
        video.currentTime = Math.max(0, video.duration - SEEK_PAD_SECONDS);
        console.info(TAG, `fast-forwarding YouTube ad (${video.duration.toFixed(1)}s)`);
      } catch {}
    }

    if (video.paused) {
      try { player?.playVideo?.(); } catch {}
      video.play().catch(() => {});
    }
  }

  function tick() {
    const player = getPlayer();
    if (isAdShowing(player)) {
      wasInAd = true;
      skipAd(player);
      return;
    }

    if (!wasInAd) return;
    wasInAd = false;
    for (const video of document.querySelectorAll('video')) {
      restoreVideoState(video);
    }
  }

  setInterval(tick, CHECK_INTERVAL_MS);
  tick();
})();
