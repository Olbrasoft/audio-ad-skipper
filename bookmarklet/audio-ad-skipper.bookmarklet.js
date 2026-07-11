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

  if (location.hostname === 'www.youtube.com') {
    installYouTubeAdSkipper();
    alert('Audio Add Skipper armed — YouTube ads will be fast-forwarded.');
    return;
  }

  const TAG = '[AAS]';
  const TTS_BTN = '[data-dot="atm-tts-play-btn"]';
  const AD_MAX = 60;
  const POST_WIN = 30000;

  let fastForwardUntil = 0;
  let articleStarted = false;
  let articleEl = null;

  function reopenForAdBreak(reason) {
    if (!articleStarted && Date.now() <= fastForwardUntil) return;
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
      articleEl = null;
    }
  }, { capture: true });

  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (this.classList.contains('aas-audio')) return origPlay.apply(this, arguments);

    const el = this;
    const inWindow = Date.now() <= fastForwardUntil;
    const isKnownArticle = articleEl === el;

    if (!articleStarted && !inWindow) return origPlay.apply(this, arguments);
    if (isKnownArticle && el.duration > AD_MAX) return origPlay.apply(this, arguments);

    el.muted = true;

    const decide = () => {
      const d = el.duration;
      if (!d || isNaN(d) || d === Infinity) return;

      if (d > AD_MAX) {
        if (articleEl && articleEl !== el && articleStarted) {
          console.info(TAG, `unrelated long media (${d.toFixed(1)}s) — releasing`);
          el.muted = false;
          el.removeEventListener('loadedmetadata', decide);
          el.removeEventListener('durationchange', decide);
          return;
        }
        console.info(TAG, `article reached (${d.toFixed(1)}s) — unmuting`);
        el.muted = false;
        articleStarted = true;
        fastForwardUntil = 0;
        if (articleEl !== el) {
          articleEl = el;
          el.addEventListener('pause', () => reopenForAdBreak('paused'));
          el.addEventListener('ended', () => reopenForAdBreak('ended'));
          el.addEventListener('emptied', () => reopenForAdBreak('emptied'));
        }
        el.removeEventListener('loadedmetadata', decide);
        el.removeEventListener('durationchange', decide);
      } else if (el.currentTime < d - 0.3) {
        const phase = !articleEl
          ? 'preroll'
          : isKnownArticle
            ? 'mid-roll (same element)'
            : articleEl.ended ? 'post-roll' : 'mid-roll';
        console.info(TAG, `fast-forwarding ${phase} ad (${d.toFixed(1)}s)`);
        fastForwardUntil = Math.max(fastForwardUntil, Date.now() + POST_WIN);
        try { el.currentTime = d - 0.05; } catch {}
      }
    };

    if (el.duration) decide();
    el.addEventListener('loadedmetadata', decide);
    el.addEventListener('durationchange', decide);

    return origPlay.apply(this, arguments);
  };

  alert('Audio Add Skipper armed — tap the Seznam play button to start.');

  function installYouTubeAdSkipper() {
    const TAG = '[AAS YouTube]';
    const SKIP = '.ytp-skip-ad-button,.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-ad-overlay-close-button';
    const touched = new WeakMap();
    let wasInAd = false;

    function player() {
      return document.querySelector('#movie_player');
    }

    function isAd(p) {
      return !!p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'));
    }

    function visible(el) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width >= 100 && r.height >= 100 && s.display !== 'none' && s.visibility !== 'hidden';
    }

    function visibleVideo() {
      return Array.from(document.querySelectorAll('video')).find(visible);
    }

    function visibleSkip() {
      return Array.from(document.querySelectorAll(SKIP)).find((b) => visible(b) && !b.disabled);
    }

    function remember(v) {
      if (touched.has(v)) return;
      touched.set(v, { muted: v.muted, playbackRate: v.playbackRate });
    }

    function restore(v) {
      const state = touched.get(v);
      if (!state) return;
      v.muted = state.muted;
      v.playbackRate = state.playbackRate;
      touched.delete(v);
    }

    function tick() {
      const p = player();
      if (!isAd(p)) {
        if (wasInAd) {
          wasInAd = false;
          document.querySelectorAll('video').forEach(restore);
        }
        return;
      }

      wasInAd = true;
      const button = visibleSkip();
      if (button) button.click();

      const v = visibleVideo();
      if (!v) return;
      remember(v);
      v.muted = true;
      if (v.playbackRate < 16) v.playbackRate = 16;
      if (Number.isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.3) {
        try {
          v.currentTime = Math.max(0, v.duration - 0.05);
          console.info(TAG, `fast-forwarding YouTube ad (${v.duration.toFixed(1)}s)`);
        } catch {}
      }
      if (v.paused) {
        try { p?.playVideo?.(); } catch {}
        v.play().catch(() => {});
      }
    }

    console.info(TAG, 'installed at', location.href);
    setInterval(tick, 250);
    tick();
  }
})();
