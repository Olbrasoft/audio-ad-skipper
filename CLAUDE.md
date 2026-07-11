# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Silently fast-forwards audio ads in Seznam-family TTS articles (novinky.cz, seznamzpravy.cz, sport.cz, super.cz, prozeny.cz) and video ads on YouTube. No own UI — it piggybacks on the original Seznam / YouTube players. Proof-of-concept, plain JS / HTML / CSS, no build step, no tests.

Three distributions, behaviorally identical, shipped from the same repo:

- **`extension/`** — Chromium / Edge MV3 extension (desktop only). The Seznam path is split across two JS execution worlds; the YouTube path is a separate content script.
- **`userscript/audio-ad-skipper.user.js`** — single self-contained Tampermonkey/Violentmonkey userscript. Targets Firefox and mobile Chromium browsers where MV3 with `world: "MAIN"` doesn't work (mobile Edge / Kiwi / Firefox for Android). Uses `@grant none` to run in the page's JS context (the userscript-manager equivalent of MAIN world), which is the one thing that makes the `HTMLMediaElement.prototype.play` hook possible.
- **`bookmarklet/`** — single-file `javascript:…` URL for users who can't install extensions or userscript managers (notably Google Chrome stable on Android). Same logic packed into a self-contained IIFE; user must tap the bookmark **on every article** before tapping play, because there is no document-start install path. Two files: `*.bookmarklet.js` is the readable source, `*.bookmarklet.min.txt` is the single-line production URL.

All three are hand-merged copies of the same logic. There is no build step that generates one from another — **if you change skip logic, the VMD URL regex, the TTS button selector, or the `AD_DURATION_MAX` threshold in any one, update all three in the same commit.** The userscript drops the CustomEvent bridge between the two original extension files (both halves now live in the same world) and replaces `chrome.storage.sync` with a hardcoded `PREFERRED_QUALITY` constant, since `@grant none` precludes any `GM_*` API and that setting only affects the diagnostic VMD log. The bookmarklet additionally drops the VMD-response interception entirely (it's diagnostic-only and the bookmarklet aims to minimize URL size) and adds two `alert()`s as the only user-visible feedback that the hook armed / is already armed. When updating the bookmarklet, edit `*.bookmarklet.js` first, then hand-minify into `*.bookmarklet.min.txt` keeping the `javascript:void(…)` wrapper — `void` prevents Chrome from navigating away if the IIFE's last expression accidentally returns a value.

## Dev loop

There is no build, lint, or test command. Workflow:

1. Edit files under `extension/`.
2. `edge://extensions` (or `chrome://extensions`) → Audio Add Skipper → **Reload**.
3. Refresh an article tab and watch the DevTools console.

Both `[AAS intercept]` (MAIN world) and `[AAS player]` (isolated world) logs land in the same page console — Chrome MV3 merges them.
YouTube logs use `[AAS YouTube]`.

## Architecture — the one thing you must understand

The extension is split across **two JavaScript execution worlds**, because Seznam's player runs in the page's own JS context and can only be monkey-patched from there. Communication between the two halves happens via `CustomEvent`s dispatched on `document`.

```
┌─────────────────────────────────────────────────────────────────┐
│ Page (MAIN world) — content/intercept.js, run_at: document_start │
│   • Monkey-patches HTMLMediaElement.prototype.play               │
│   • Monkey-patches fetch / XHR / Response.json (VMD logger)      │
│   • Listens for  aas:tts-clicked  → opens fast-forward window   │
│   • Emits        aas:tts-found    when VMD response decoded     │
└──────────────────────────▲──────────────────────────────────────┘
                           │ CustomEvent on document
┌──────────────────────────┴──────────────────────────────────────┐
│ Isolated world — content/player.js, run_at: document_idle        │
│   • Click listener (capture: true) on [data-dot="atm-tts-play-btn"]│
│   • Emits   aas:tts-clicked   on user click                      │
│   • Reads chrome.storage.sync.quality, writes it to              │
│     document.documentElement.dataset.aasQuality so MAIN world    │
│     can read it (the two worlds share the DOM, not JS state)     │
└─────────────────────────────────────────────────────────────────┘
```

Why this split: only MAIN world can replace `HTMLMediaElement.prototype.play` on the prototype Seznam's code actually sees; only the isolated world has access to `chrome.storage`. Crossing the boundary requires DOM (events or dataset). Do not try to merge these — both files need their respective worlds.

## The skip heuristic (load-bearing)

Inside the patched `.play()`, when `Date.now() < fastForwardUntil` and the element is not yet identified as the article:

- Element is muted **immediately** (before any audio can leak).
- On `loadedmetadata` / `durationchange`, `el.duration` is checked:
  - `duration > 60s` → article → unmute, close fast-forward window, `articleStarted = true`.
  - `duration ≤ 60s` → ad → `currentTime = duration − 0.05` to force `ended` to fire so Seznam's player advances to the next playlist item.

The 60-second threshold and the 60-second fast-forward window length are the two magic numbers. Real prerolls are 15–30s; real TTS articles are typically 90s+. If you change `AD_DURATION_MAX` in `intercept.js`, also reconsider the window duration in `player.js` (currently both 60s, but they mean different things).

## YouTube path

`content/youtube.js` does not use the Seznam duration heuristic. YouTube ads can be longer than 60s. Instead it watches `#movie_player` for `ad-showing` / `ad-interrupting`, mutes the visible `<video>`, tries a visible skip button, and seeks the visible ad video to `duration - 0.05`. It repeats on a short interval because an ad break can contain multiple ads. When the player leaves ad mode, it restores the touched video's original `muted` / `playbackRate` values.

## Fragile selectors / contracts

If the extension stops working, the most likely causes (in order):

1. **TTS button selector changed.** `TTS_BTN_SELECTOR = '[data-dot="atm-tts-play-btn"]'` in `content/player.js`.
2. **VMD URL regex no longer matches.** `VMD_URL_RE = /sdn\.cz\/.*\/vmd[\/_].*spl2/` and the article-vs-ad discriminator `isArticleTts` (looks for `~SEC1~`, 24-hex VMD id, and `language: "cs"` in `idmap`) — both in `content/intercept.js`. See README "Heuristika detekce" table for the full ad-vs-article signal set.
3. **Host list out of sync.** `manifest.json` `host_permissions` and both `content_scripts[].matches` arrays must list the same domains. The `*.sdn.cz/*` host permission is required for the VMD diagnostic logger only.
4. **YouTube player contract changed.** `content/youtube.js` depends on `#movie_player`, `ad-showing` / `ad-interrupting`, visible `<video>` playback, and the current skip-button class names.

## Options page

`extension/options/options.{html,js}` stores `quality` (`high` / `medium` / `low`) in `chrome.storage.sync`. Currently this only affects which MP3 variant is picked in the diagnostic VMD log (`pickMp3` in `intercept.js`); the skip behavior itself does not consult it. Don't add UI that suggests otherwise without also wiring it through.

## Repo

- `extension/` — everything Chrome loads. This is what "Load unpacked" points at.
- Root-level PNGs (`aas-*.png`) are README screenshots, not used by the extension.
- `extension/icons/` are placeholder PNGs.
- `extension/content/player.css` exists but is currently unused (legacy from an earlier design that had its own UI).
- `extension/content/youtube.js` is independent from the Seznam TTS split and should stay that way unless the two paths genuinely share behavior.
