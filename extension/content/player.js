// Runs in the isolated content-script world. In the current design we don't
// inject our own player UI — the user wants the original Seznam TTS player to be
// the only thing visible. This script's only job is to detect clicks on the
// original play button and open a "fast-forward window" so intercept.js
// (MAIN world) silently skips any preroll ads playing on the page's video
// elements until the article-length stream starts.

(() => {
  const TAG = '[AAS player]';
  const TTS_BTN_SELECTOR = '[data-dot="atm-tts-play-btn"]';

  // Forward the user's preferred MP3 quality to intercept.js (used only by the
  // VMD-response diagnostic logger / future download feature).
  chrome.storage.sync.get({ quality: 'high' }, ({ quality }) => {
    document.documentElement.dataset.aasQuality = quality;
  });

  // Listen on document with capture: true so we see the click even when React
  // attaches its own listener at the document level.
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest(TTS_BTN_SELECTOR)) {
      console.info(TAG, 'TTS button clicked → opening fast-forward window');
      document.dispatchEvent(
        new CustomEvent('aas:tts-clicked', { detail: { until: Date.now() + 60000 } })
      );
    }
  }, { capture: true });
})();
