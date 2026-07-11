// Runs in MAIN world at document_start.
//
// Strategy: keep the original Seznam TTS player as the only visible UI. When the
// user clicks the original play button, silently fast-forward every ad in the
// playlist — preroll, mid-roll, and post-roll — so Seznam's player advances
// through the ads almost instantly and unmutes only on article-length streams.
//
// Heuristic for "is this an ad?": ad <video> elements have duration < 60s
// (typical preroll = 15-30s); the article TTS is always > 60s. We additionally
// scope this behavior to a time window opened by the TTS button click and
// re-opened when the article element pauses or ends, which is how mid-roll
// and post-roll ads are caught without false-positiving article-body videos
// played long after listening (issue #1).
//
// VMD response interception is kept for diagnostics — it logs the article MP3
// URL so it can be retrieved from the console / future "download MP3" feature.

(() => {
  const TAG = '[AAS intercept]';
  const VMD_URL_RE = /sdn\.cz\/.*\/vmd[\/_].*spl2/;
  const AD_DURATION_MAX = 60; // seconds
  const POST_ARTICLE_WINDOW_MS = 30000;

  console.info(TAG, 'installed at', location.href);

  // --- Fast-forward window state -------------------------------------------
  //
  // Mid-roll detection works through two independent signals so a race between
  // "article pauses" and "ad .play() fires" can't slip an ad past us:
  //
  //   1. A different HTMLMediaElement calling .play() while the article is
  //      still considered active — treated as an ad candidate, the hook
  //      engages regardless of `articleStarted`.
  //   2. The article element itself emitting `pause` / `ended` / `emptied`
  //      (the last one catches Seznam swapping src on the SAME element for
  //      the mid-roll, which would otherwise never fire pause).
  //
  // Both reopen a POST_ARTICLE_WINDOW_MS fast-forward window. The bounded
  // length means an article-body <video> the user plays much later still
  // works normally.
  let fastForwardUntil = 0;
  let articleStarted = false;
  let articleEl = null;

  document.addEventListener('aas:tts-clicked', (e) => {
    fastForwardUntil = Math.max(fastForwardUntil, Number(e.detail?.until) || (Date.now() + 60000));
    articleStarted = false;
    articleEl = null; // fresh session — let the next article-length stream be adopted
    console.info(TAG, 'fast-forward window opened until', new Date(fastForwardUntil).toISOString());
  });

  function reopenForAdBreak(reason) {
    if (!articleStarted && Date.now() <= fastForwardUntil) return;
    articleStarted = false;
    fastForwardUntil = Math.max(fastForwardUntil, Date.now() + POST_ARTICLE_WINDOW_MS);
    console.info(TAG, `article ${reason} — fast-forward window reopened until`, new Date(fastForwardUntil).toISOString());
  }

  // --- HTMLMediaElement.play() hook ---------------------------------------
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (this.classList.contains('aas-audio')) {
      return origPlay.apply(this, arguments);
    }

    const el = this;
    const inWindow = Date.now() <= fastForwardUntil;
    const isKnownArticle = articleEl === el;

    // No active tracking, no forced window → unrelated page media.
    if (!articleStarted && !inWindow) {
      return origPlay.apply(this, arguments);
    }
    // The known article element resuming while still article-length → pass through.
    // (Duration only stays article-length until Seznam swaps src to an ad, which
    // fires `emptied` and flips articleStarted off — so a stale long duration
    // can't leak an ad past us here.)
    if (isKnownArticle && el.duration > AD_DURATION_MAX) {
      return origPlay.apply(this, arguments);
    }

    el.muted = true; // immediate mute — no ad audio ever leaks

    const decide = () => {
      const d = el.duration;
      if (!d || isNaN(d) || d === Infinity) return;

      if (d > AD_DURATION_MAX) {
        // Long stream. If we already have a known active article elsewhere,
        // this is unrelated page media (e.g. an article-body video) — release
        // it without claiming the article role.
        if (articleEl && articleEl !== el && articleStarted) {
          console.info(TAG, `unrelated long media (${d.toFixed(1)}s) — releasing`);
          el.muted = false;
          el.removeEventListener('loadedmetadata', decide);
          el.removeEventListener('durationchange', decide);
          return;
        }
        // Article-length stream — let it play normally
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
        // Ad — jump near the end so 'ended' fires and Seznam advances playlist
        const phase = !articleEl
          ? 'preroll'
          : isKnownArticle
            ? 'mid-roll (same element)'
            : articleEl.ended ? 'post-roll' : 'mid-roll';
        console.info(TAG, `fast-forwarding ${phase} ad (${d.toFixed(1)}s)`);
        // Extend the window so the next ad in a multi-ad break is also caught
        fastForwardUntil = Math.max(fastForwardUntil, Date.now() + POST_ARTICLE_WINDOW_MS);
        try { el.currentTime = d - 0.05; } catch {}
      }
    };

    if (el.duration) decide();
    el.addEventListener('loadedmetadata', decide);
    el.addEventListener('durationchange', decide);

    return origPlay.apply(this, arguments);
  };

  // --- VMD response interception (kept for diagnostics) -------------------
  const origJson = Response.prototype.json;
  Response.prototype.json = function () {
    const url = this.url;
    const promise = origJson.apply(this, arguments);
    if (url && VMD_URL_RE.test(url)) {
      promise.then((j) => maybeLogStream(url, j)).catch(() => {});
    }
    return promise;
  };

  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    const resp = await origFetch.apply(this, arguments);
    if (url && VMD_URL_RE.test(url)) {
      resp.clone().json().then((j) => maybeLogStream(url, j)).catch(() => {});
    }
    return resp;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__aasUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', () => {
      const url = this.__aasUrl;
      if (!url || !VMD_URL_RE.test(String(url))) return;
      try {
        let json = null;
        if (this.responseType === 'json') json = this.response;
        else if (this.responseType === '' || this.responseType === 'text') json = JSON.parse(this.responseText);
        else if (this.responseType === 'arraybuffer') json = JSON.parse(new TextDecoder().decode(this.response));
        if (json) maybeLogStream(String(url), json);
      } catch {}
    });
    return origSend.apply(this, arguments);
  };

  function maybeLogStream(url, json) {
    if (!isArticleTts(url, json)) return;
    const mp3 = pickMp3(url, json);
    if (!mp3) return;
    const duration = json?.pls?.hls_fmp4?.duration ?? null;
    console.info(TAG, 'TTS article stream', { mp3, duration });
    document.dispatchEvent(
      new CustomEvent('aas:tts-found', { detail: { mp3, duration, vmdUrl: url } })
    );
  }

  function isArticleTts(url, json) {
    if (!url.includes('~SEC1~')) return false;
    if (!/\/vmd\/[a-f0-9]{24}/i.test(url)) return false;
    const idmap = json?.pls?.hls_fmp4?.templated?.idmap || {};
    return Object.values(idmap).some((v) => v.language === 'cs');
  }

  function pickMp3(vmdUrl, json) {
    const mp3 = json?.data?.mp3;
    if (!mp3) return null;
    const pref = document.documentElement.dataset.aasQuality || 'high';
    const order = pref === 'low' ? ['low', 'medium', 'high']
      : pref === 'medium' ? ['medium', 'high', 'low']
      : ['high', 'medium', 'low'];
    const chosen = order.map((k) => mp3[k]).find((v) => v?.url);
    if (!chosen?.url) return null;
    try { return new URL(chosen.url, vmdUrl).href; } catch { return null; }
  }
})();
