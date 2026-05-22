// ==UserScript==
// @name         Audio Add Skipper
// @namespace    https://github.com/Olbrasoft/audio-ad-skipper
// @version      0.2.0
// @description  Přeskočí prerollové reklamy u TTS článků na webech Seznam rodiny (Novinky, Seznam Zprávy, Sport.cz, Super.cz, Prozeny.cz) a pustí rovnou namluvený článek.
// @author       Olbrasoft
// @homepageURL  https://github.com/Olbrasoft/audio-ad-skipper
// @supportURL   https://github.com/Olbrasoft/audio-ad-skipper/issues
// @updateURL    https://raw.githubusercontent.com/Olbrasoft/audio-ad-skipper/main/userscript/audio-ad-skipper.user.js
// @downloadURL  https://raw.githubusercontent.com/Olbrasoft/audio-ad-skipper/main/userscript/audio-ad-skipper.user.js
// @match        https://www.novinky.cz/*
// @match        https://www.seznamzpravy.cz/*
// @match        https://www.sport.cz/*
// @match        https://www.super.cz/*
// @match        https://www.prozeny.cz/*
// @run-at       document-start
// @grant        none
// @noframes
// @license      MIT
// ==/UserScript==

// Userscript distribution of the MV3 extension under ../extension/. Both halves
// of the extension (MAIN-world intercept.js + isolated-world player.js) are
// merged into this single file because @grant none makes Tampermonkey /
// Violentmonkey run the script in the page's own JS context — which is the
// MAIN-world equivalent and the one place where HTMLMediaElement.prototype.play
// can be monkey-patched so Seznam's own player code sees the hook.
//
// Behavior is identical to the extension. See README.md and CLAUDE.md for the
// architecture rationale and the load-bearing 60-second skip heuristic.

(() => {
  'use strict';

  // Preferred MP3 quality for the diagnostic VMD logger. The userscript has no
  // options UI; edit this constant in Tampermonkey's editor if you want a
  // different default. Has no effect on the ad-skip behavior itself.
  const PREFERRED_QUALITY = 'high'; // 'high' | 'medium' | 'low'

  const TAG_INTERCEPT = '[AAS intercept]';
  const TAG_PLAYER = '[AAS player]';
  const TTS_BTN_SELECTOR = '[data-dot="atm-tts-play-btn"]';
  const VMD_URL_RE = /sdn\.cz\/.*\/vmd[\/_].*spl2/;
  const AD_DURATION_MAX = 60; // seconds
  const POST_ARTICLE_WINDOW_MS = 30000;
  const DECIDER = Symbol('aasDecider');
  const LAST_AD_SKIP = Symbol('aasLastAdSkip');

  console.info(TAG_INTERCEPT, 'installed at', location.href);

  // --- Fast-forward window state -------------------------------------------
  //
  // The window is opened by the TTS button click (60s) and re-opened by
  // pause/ended on the article element (POST_ARTICLE_WINDOW_MS). The second
  // mechanism is what catches mid-roll and post-roll ads: any genuine ad
  // break must first pause or end the article element, which lets us re-open
  // the window before the ad's .play() fires. Bounded length means an
  // article-body <video> played by the user much later still works normally.
  let fastForwardUntil = 0;
  let listeningActive = false;
  let articleEl = null;
  let lastAdLog = { key: '', until: 0 };

  function reopenForAdBreak(reason) {
    fastForwardUntil = Math.max(fastForwardUntil, Date.now() + POST_ARTICLE_WINDOW_MS);
    console.info(TAG_INTERCEPT, `article ${reason} — fast-forward window reopened until`, new Date(fastForwardUntil).toISOString());
  }

  // --- TTS button click detector (was player.js) ---------------------------
  // Document may not exist yet at document-start — defer click listener
  // installation until DOM is ready enough to attach to `document`.
  const installClickListener = () => {
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      if (t.closest(TTS_BTN_SELECTOR)) {
        console.info(TAG_PLAYER, 'TTS button clicked → opening fast-forward window');
        fastForwardUntil = Math.max(fastForwardUntil, Date.now() + 60000);
        listeningActive = false;
        console.info(TAG_INTERCEPT, 'fast-forward window opened until', new Date(fastForwardUntil).toISOString());
      }
    }, { capture: true });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installClickListener, { once: true });
  } else {
    installClickListener();
  }

  // --- HTMLMediaElement.play() hook (was intercept.js) ---------------------
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (this.classList.contains('aas-audio')) {
      return origPlay.apply(this, arguments);
    }
    if (!listeningActive && Date.now() > fastForwardUntil) {
      return origPlay.apply(this, arguments);
    }

    const el = this;
    el.muted = true; // immediate mute — no ad audio ever leaks

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

    if (d > AD_DURATION_MAX) {
      if (articleEl !== el || el.muted) {
        console.info(TAG_INTERCEPT, `article reached (${d.toFixed(1)}s) — unmuting`);
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
        console.info(TAG_INTERCEPT, `fast-forwarding ${phase} ad (${d.toFixed(1)}s)`);
        lastAdLog = { key: logKey, until: Date.now() + 10000 };
      }
      el.muted = true;
      forceSkipAd(el, d);
      fastForwardUntil = Math.max(fastForwardUntil, Date.now() + POST_ARTICLE_WINDOW_MS);
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

  // --- VMD response interception (diagnostics) -----------------------------
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
    console.info(TAG_INTERCEPT, 'TTS article stream', { mp3, duration });
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
    const order = PREFERRED_QUALITY === 'low' ? ['low', 'medium', 'high']
      : PREFERRED_QUALITY === 'medium' ? ['medium', 'high', 'low']
      : ['high', 'medium', 'low'];
    const chosen = order.map((k) => mp3[k]).find((v) => v?.url);
    if (!chosen?.url) return null;
    try { return new URL(chosen.url, vmdUrl).href; } catch { return null; }
  }
})();
