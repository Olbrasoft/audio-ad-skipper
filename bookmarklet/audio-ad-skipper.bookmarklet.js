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
  const DECIDER = Symbol('aasDecider');
  const LAST_AD_SKIP = Symbol('aasLastAdSkip');

  let fastForwardUntil = 0;
  let listeningActive = false;
  let articleEl = null;
  let lastAdLog = { key: '', until: 0 };

  function reopenForAdBreak(reason) {
    fastForwardUntil = Math.max(fastForwardUntil, Date.now() + POST_WIN);
    console.info(TAG, `article ${reason} — fast-forward window reopened`);
  }

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest(TTS_BTN)) {
      console.info(TAG, 'TTS button clicked → opening fast-forward window');
      fastForwardUntil = Math.max(fastForwardUntil, Date.now() + 60000);
      listeningActive = false;
    }
  }, { capture: true });

  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (this.classList.contains('aas-audio')) return origPlay.apply(this, arguments);
    if (!listeningActive && Date.now() > fastForwardUntil) return origPlay.apply(this, arguments);

    const el = this;
    el.muted = true;

    if (!el[DECIDER]) {
      el[DECIDER] = () => {
        decideMedia(el);
      };
      el.addEventListener('loadedmetadata', el[DECIDER]);
      el.addEventListener('durationchange', el[DECIDER]);
      el.addEventListener('playing', el[DECIDER]);
    }
    el[DECIDER]();

    return origPlay.apply(this, arguments);
  };

  function decideMedia(el) {
    if (!listeningActive && Date.now() > fastForwardUntil) return;

    const d = el.duration;
    if (!d || isNaN(d) || d === Infinity) return;

    if (d > AD_MAX) {
      if (articleEl !== el || el.muted) {
        console.info(TAG, `article reached (${d.toFixed(1)}s) — unmuting`);
      }
      el.muted = false;
      listeningActive = true;
      fastForwardUntil = 0;
      if (articleEl !== el) {
        articleEl = el;
        el.addEventListener('pause', () => reopenForAdBreak('paused'));
        el.addEventListener('ended', () => reopenForAdBreak('ended'));
      }
    } else if (el.currentTime < d - 0.3) {
      const skipKey = d.toFixed(1);
      if (el[LAST_AD_SKIP]?.key === skipKey && Date.now() < el[LAST_AD_SKIP].until) {
        el.muted = true;
        forceSkipAd(el, d);
        return;
      }
      el[LAST_AD_SKIP] = { key: skipKey, until: Date.now() + 10000 };
      const phase = !articleEl ? 'preroll' : articleEl.ended ? 'post-roll' : 'mid-roll';
      const logKey = `${phase}|${skipKey}`;
      if (lastAdLog.key !== logKey || Date.now() > lastAdLog.until) {
        console.info(TAG, `fast-forwarding ${phase} ad (${d.toFixed(1)}s)`);
        lastAdLog = { key: logKey, until: Date.now() + 10000 };
      }
      el.muted = true;
      forceSkipAd(el, d);
      fastForwardUntil = Math.max(fastForwardUntil, Date.now() + POST_WIN);
    }
  }

  function forceSkipAd(el, duration) {
    const seekNearEnd = () => {
      if (el.currentTime >= duration - 0.3) return;
      try { el.currentTime = duration - 0.05; } catch {}
    };
    seekNearEnd();
    setTimeout(seekNearEnd, 50);
    setTimeout(seekNearEnd, 250);
    setTimeout(seekNearEnd, 750);
  }

  alert('Audio Add Skipper armed — tap the Seznam play button to start.');
})();
