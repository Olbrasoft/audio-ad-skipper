// Audio Add Skipper — bookmarklet distribution
//
// For users on Google Chrome for Android (and anywhere else where extensions
// and userscript managers aren't available). Tap the bookmark once per
// article page, before tapping Seznam's TTS play button.
//
// Behavior is identical to extension/ and userscript/ — see CLAUDE.md for the
// architecture rationale and the load-bearing 60-second skip heuristic.
//
// Unlike the userscript, the bookmarklet runs AFTER the page has loaded
// (when the user taps it from Chrome's bookmark suggestions) rather than at
// document-start. That's fine because Seznam's player only invokes
// HTMLMediaElement.play() in response to the user clicking the TTS button,
// which happens after the bookmarklet has installed its hook.
//
// To install: copy the single-line javascript:... URL from
// audio-ad-skipper.bookmarklet.min.txt in this directory, then paste it
// into the URL field of a bookmark in Chrome (Chrome blocks `javascript:`
// from being typed directly into the address bar, so it must be saved as a
// bookmark and triggered via the bookmark menu / address-bar autocomplete).

void (() => {
  if (window.__aasInstalled) {
    alert('Audio Add Skipper is already running on this page.');
    return;
  }
  window.__aasInstalled = true;

  const TAG = '[AAS]';
  const TTS_BTN = '[data-dot="atm-tts-play-btn"]';
  const AD_MAX = 60;
  const POST_WIN = 30000;

  let fastForwardUntil = 0;
  let articleStarted = false;
  let articleEl = null;

  function reopenForAdBreak(reason) {
    articleStarted = false;
    fastForwardUntil = Math.max(fastForwardUntil, Date.now() + POST_WIN);
    console.info(TAG, `article ${reason} — fast-forward window reopened`);
  }

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest(TTS_BTN)) {
      console.info(TAG, 'TTS button clicked → opening fast-forward window');
      fastForwardUntil = Math.max(fastForwardUntil, Date.now() + 60000);
      articleStarted = false;
    }
  }, { capture: true });

  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (this.classList.contains('aas-audio')) return origPlay.apply(this, arguments);
    if (articleStarted || Date.now() > fastForwardUntil) return origPlay.apply(this, arguments);

    const el = this;
    el.muted = true;

    const decide = () => {
      if (articleStarted) return;
      const d = el.duration;
      if (!d || isNaN(d) || d === Infinity) return;

      if (d > AD_MAX) {
        console.info(TAG, `article reached (${d.toFixed(1)}s) — unmuting`);
        el.muted = false;
        articleStarted = true;
        fastForwardUntil = 0;
        if (articleEl !== el) {
          articleEl = el;
          el.addEventListener('pause', () => reopenForAdBreak('paused'));
          el.addEventListener('ended', () => reopenForAdBreak('ended'));
        }
        el.removeEventListener('loadedmetadata', decide);
        el.removeEventListener('durationchange', decide);
      } else if (el.currentTime < d - 0.3) {
        const phase = !articleEl ? 'preroll' : articleEl.ended ? 'post-roll' : 'mid-roll';
        console.info(TAG, `fast-forwarding ${phase} ad (${d.toFixed(1)}s)`);
        try { el.currentTime = d - 0.05; } catch {}
      }
    };

    if (el.duration) decide();
    el.addEventListener('loadedmetadata', decide);
    el.addEventListener('durationchange', decide);

    return origPlay.apply(this, arguments);
  };

  alert('Audio Add Skipper armed — tap the Seznam play button to start.');
})();
