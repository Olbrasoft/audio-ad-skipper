# Audio Ad Skipper

Chromium / Edge rozšíření, které u TTS (text-to-speech) článků na webech Seznam rodiny
**potichu přeskočí prerollové reklamy** a nechá přehrát rovnou článek přes původní Seznam
přehrávač. Žádné vlastní UI — vypadá to, jako by Seznam reklamy nikdy nepouštěl.

| Před                                  | Po                                          |
| ------------------------------------- | ------------------------------------------- |
| Klik na play → 2× reklama (~50 s) → článek | Klik na play → během ~1 s článek od 0:00 |

## Pro koho je to

- Čtenáře, kteří poslouchají namluvené články od redakce Seznam a nechtějí pokaždé sedět ~50 s
  na prerollových reklamách (typicky 2× ~25 s).
- Funguje pro **přihlášené uživatele** (Seznam účet) — bez loginu Seznam VMD endpoint nezavolá
  a rozšíření nemá co interceptovat.

## Podporované weby

Rozšíření se aktivuje na všech URL z těchto domén:

- `www.novinky.cz`
- `www.seznamzpravy.cz`
- `www.sport.cz`
- `www.super.cz`
- `www.prozeny.cz`

Stačí, aby měl článek originální TTS tlačítko Seznamu (`[data-dot="atm-tts-play-btn"]`).

## Kompatibilita

| Prohlížeč         | Stav           | Poznámka                                        |
| ----------------- | -------------- | ----------------------------------------------- |
| Microsoft Edge    | ✅ ověřeno     | Hlavní vývojový prohlížeč (Chromium-based).     |
| Google Chrome     | ✅ ověřeno     | MV3 manifest, stejné API.                        |
| Brave / Vivaldi / Opera | ✅ očekáváno | Chromium derivace, MV3 + `world: "MAIN"` musí být podporováno. |
| Firefox (desktop) | ✅ přes userscript | MV3 v Firefoxu neumí `world: "MAIN"`, ale userscript distribuce přes Tampermonkey funguje. |
| Safari            | ❌ nepodporováno | Web Extensions API se v `"world"` chová jinak. |
| Mobil (Android, Edge/Firefox/Kiwi) | ✅ přes userscript | Tampermonkey + raw `.user.js` URL — plně automatické po nainstalování. |
| Mobil (Android, Google Chrome) | ⚠️ jen přes bookmarklet | Chrome stable na Androidu neumí extensions ani userscript managery — bookmarklet z `bookmarklet/` je jediná cesta, vyžaduje ručně tuknout záložku na každém článku. |
| Mobil (iOS)       | ❌ nepodporováno | Všechny iOS prohlížeče běží na WebKitu a userscript managery jsou tam výrazně omezené. |

**Minimální verze:** Chrome / Edge 111+ (kvůli `content_scripts[].world: "MAIN"`). Userscript distribuce minimum nemá — funguje všude, kde běží Tampermonkey/Violentmonkey s `@grant none`.

## Jak to funguje (technicky)

1. `content/intercept.js` běží v **MAIN světě** stránky (stejný JS kontext jako Seznam) už při
   `document_start` a monkey-patchuje `HTMLMediaElement.prototype.play`.
2. `content/player.js` v **izolovaném světě** poslouchá clicky na originální play tlačítko
   `[data-dot="atm-tts-play-btn"]` a posílá CustomEvent `aas:tts-clicked` — tím otevře
   60sekundové „fast-forward okno".
3. Když Seznam zavolá `.play()` na nějakém `<video>` elementu v rámci tohoto okna, hook ho
   okamžitě **ztiší** a podle `duration` rozhodne:
   - `< 60 s` → **reklama** → `currentTime = duration − 0.05` → vystřelí `ended` → Seznam
     player automaticky přechází na další položku playlistu.
   - `> 60 s` → **článek** → odmute, fast-forward okno se zavře, článek hraje normálně.
4. Vedlejší produkt: VMD odpověď (`*.sdn.cz/.../vmd/<24hex>?...|spl2`) se loguje do konzole
   včetně přímé MP3 URL — připraveno pro budoucí „stáhnout MP3" feature.

### Heuristika detekce TTS článku vs. reklamy

| Znak                     | Reklama                              | TTS článek                            |
| ------------------------ | ------------------------------------ | ------------------------------------- |
| VMD path                 | `vmd_ko_<int>` / `vmd_ng_<int>`      | `vmd/<24hex>`                          |
| URL prefix               | bez `~SEC1~`                         | `~SEC1~expire-...~scope-video~<token>~` |
| `idmap[*].language`      | `"czech"`                            | `"cs"`                                  |
| MP3 buckety              | `high_mp3 / medium_mp3 / low_mp3`    | `mp3_192k / mp3_128k / mp3_64k`        |
| `duration`               | 15 – 30 s                            | typicky 60 – 300 s                     |

## Distribuce

Rozšíření existuje ve dvou podobách — funkčně identických, lišících se jen způsobem instalace a tím, kde fungují:

| Distribuce | Kde | Adresář |
| ---------- | --- | ------- |
| MV3 rozšíření | Desktop Chrome / Edge / Brave / Vivaldi / Opera | [`extension/`](extension/) |
| Userscript    | Cokoli s Tampermonkey/Violentmonkey — vč. mobilního Edge / Firefox / Kiwi | [`userscript/audio-ad-skipper.user.js`](userscript/audio-ad-skipper.user.js) |
| Bookmarklet   | Google Chrome na Androidu / iOS Safari / kdekoli, kde nejde nic jiného | [`bookmarklet/`](bookmarklet/) |

Stačí jedna z nich; instalovat dvě najednou nemá smysl (oba hooky by se prováděly dvakrát).

## Instalace — MV3 rozšíření (Load unpacked)

1. Naklonujte si repo:
   ```bash
   git clone https://github.com/Olbrasoft/audio-ad-skipper.git
   cd audio-ad-skipper
   ```
2. Otevřete v prohlížeči stránku rozšíření:
   - Edge: `edge://extensions`
   - Chrome: `chrome://extensions`
3. Zapněte **Developer mode** (přepínač vpravo nahoře).
4. Klikněte **Load unpacked** a vyberte složku **`extension/`** v tomto repu.
5. (Volitelné) V seznamu nainstalovaných rozšíření klikněte na **Details → Extension options**
   a nastavte preferovanou kvalitu MP3 (high / medium / low). Tato volba se zatím využívá jen
   pro diagnostické logování VMD odpovědí.
6. Přihlaste se na [novinky.cz](https://www.novinky.cz) (vpravo nahoře, Seznam účet).
7. Otevřete libovolný článek s ikonou „přečíst nahlas" a klikněte na ni — reklamy se přeskočí
   během ~1 s a začne hrát článek.

## Instalace — userscript (Tampermonkey / Violentmonkey)

Pro mobil nebo Firefox; funguje i na desktopu, pokud nechcete instalovat rozšíření.

1. Nainstalujte si do prohlížeče **Tampermonkey** nebo **Violentmonkey**.
   - Android: nejjednodušší cesta je **Microsoft Edge for Android** s povolenými rozšířeními a Tampermonkey z addons.mozilla.org / Edge Add-ons, nebo **Firefox for Android** s Tampermonkey.
2. Otevřete přímý odkaz na userscript:
   - <https://raw.githubusercontent.com/Olbrasoft/audio-ad-skipper/main/userscript/audio-ad-skipper.user.js>
3. Tampermonkey nabídne instalaci — potvrďte.
4. Přihlaste se na [novinky.cz](https://www.novinky.cz) (Seznam účet) a otevřete článek s ikonou „přečíst nahlas".

Userscript nemá Options stránku. Pokud chcete změnit preferovanou kvalitu MP3 pro diagnostický log,
upravte konstantu `PREFERRED_QUALITY` nahoře v `audio-ad-skipper.user.js` přímo v Tampermonkey
editoru. Aktualizace skriptu si Tampermonkey tahá sám z `@updateURL`.

## Instalace — bookmarklet (Google Chrome na Androidu)

Pro mobilní Chrome a kdekoli jinde, kde nejde extension ani userscript. Vyžaduje manuálně tuknout záložku **na každém článku** předtím, než tuknete play.

> 📖 **Podrobný návod s obrázky a pitfally pro netechnické uživatele:**
> [`docs/instalace-na-telefonu.md`](docs/instalace-na-telefonu.md)

**Stručná verze (pokud si troufnete bez obrázků):**

1. Otevřete **samostatnou aplikaci Chrome** (ne vyskakovací prohlížeč z Google search widgetu).
2. V Chromu otevřete [`bookmarklet/audio-ad-skipper.bookmarklet.min.txt`](bookmarklet/audio-ad-skipper.bookmarklet.min.txt), dlouze podržte prst **na textu v těle stránky** (ne na adrese!) → **Vybrat vše** → **Kopírovat**.
3. Uložte libovolnou stránku jako záložku (hvězdička v menu). Hned tukněte **Upravit** v bublině „Záložka přidána".
4. V editoru přejmenujte **Název** na `aas`. **Vymažte celý obsah pole „Adresa URL"** a vložte zkopírovaný text. Zkontrolujte, že URL začíná přesně `javascript:void(`. Uložte.
5. Na článku napište `aas` do adresního řádku → tukněte návrh záložky → OK na popup *„armed"* → tukněte Seznam play.

**Časté chyby (viz podrobný návod pro nápravu):**

- Bookmarkujete URL místo *obsahu* stránky — záložka pak jen přesměrovává na github raw text místo aby spouštěla skript.
- V editoru záložky **není** samostatné pole pro „JavaScript text" — `javascript:…` kód musí jít přímo do pole **„Adresa URL"** místo původní `https://…` adresy.
- Použijete vyskakovací prohlížeč z Google search widgetu (Chrome Custom Tab) místo samostatné Chrome aplikace — Custom Tab nemá funkční záložky.

**Známá omezení:**

- **Musíte tuknout na každém článku.** Bookmarklet se nespouští automaticky.
- Pokud má Seznam na nějaké podstránce přísné CSP (`script-src` bez `unsafe-eval`), může Chrome bookmarklet zablokovat. V testech to nebyl problém, ale pokud nic nefunguje a v konzoli vidíte CSP chybu, nainstalujte si raději Edge / Firefox a použijte userscript.
- Pro úplnou jistotu si zdrojový kód můžete přečíst v
  [`bookmarklet/audio-ad-skipper.bookmarklet.js`](bookmarklet/audio-ad-skipper.bookmarklet.js)
  (komentovaná, rozbalená verze).

## Ověření, že funguje

V DevTools konzoli (F12) byste měli při kliknutí na play vidět:

```
[AAS intercept] installed at https://www.novinky.cz/clanek/…
[AAS player]    TTS button clicked → opening fast-forward window
[AAS intercept] fast-forward window opened until 2026-…
[AAS intercept] TTS article stream {mp3: "https://…sdn.cz/…/mp3_192k/…mp3", duration: 250}
[AAS intercept] fast-forwarding ad (20.1s)
[AAS intercept] fast-forwarding ad (29.7s)
[AAS intercept] article reached (250.3s) — unmuting
```

Když uvidíte řádek `article reached … — unmuting`, je to úspěch.

## Struktura repa

```
audio-ad-skipper/
├── README.md
├── LICENSE
├── extension/                            # MV3 rozšíření (desktop Chromium)
│   ├── manifest.json                     # MV3 manifest
│   ├── content/
│   │   ├── intercept.js                  # MAIN-world: HTMLMediaElement.play hook + VMD logger
│   │   ├── player.js                     # isolated-world: detekce kliknutí na TTS tlačítko
│   │   └── player.css                    # CSS pro případný vlastní UI (aktuálně nepoužitý)
│   ├── options/
│   │   ├── options.html                  # volba kvality MP3 (zatím jen pro diagnostiku)
│   │   └── options.js
│   └── icons/                            # placeholder PNG ikony 16/48/128
├── userscript/
│   └── audio-ad-skipper.user.js     # sloučená MAIN+isolated logika v jednom souboru
├── bookmarklet/
│   ├── audio-ad-skipper.bookmarklet.js       # zdroj (komentovaný, rozbalený)
│   └── audio-ad-skipper.bookmarklet.min.txt  # jeden řádek javascript:… URL k vložení do záložky
└── docs/
    ├── instalace-na-telefonu.md          # podrobný návod s obrázky pro Chrome Android
    └── images/                           # screenshoty k mobilnímu návodu
```

## Známé limity

- **Vyžaduje přihlášení k Seznam účtu.** Anonymní uživatel od Seznamu vůbec nedostane VMD
  endpoint, takže není co modifikovat.
- **Heuristika délky `< 60 s`** — pokud by Seznam nasadil delší reklamu, rozšíření by ji
  pustilo jako článek. V praxi jsou prerolly 15–30 s.
- **Heuristika délky `> 60 s`** — krátké články pod 60 s by se omylem označily jako reklama.
  Reálné TTS články mají typicky 90 s a víc.
- **Volba kvality MP3** v Options se uplatní až po `chrome.storage.sync.get` callbacku — pokud
  uživatel klikne play do několika ms po načtení stránky, použije se default „high".
- **Tlačítko musí mít selektor `[data-dot="atm-tts-play-btn"]`.** Pokud Seznam markup změní,
  rozšíření přestane fungovat a je nutno upravit `TTS_BTN_SELECTOR` v `content/player.js`.

## Vývoj

Změny v `extension/**` se po `Reload` v `edge://extensions` projeví okamžitě. Žádný build
step není potřeba — žádný TypeScript, žádný bundler, čisté JS / HTML / CSS.

```bash
# Po edit reloadnout rozšíření a refreshnout stránku článku:
# 1. edge://extensions → Audio Ad Skipper → 🔄 Reload
# 2. F5 na otevřeném článku
```

Pro debugging:

- MAIN-world log (`[AAS intercept]`) najdete přímo v DevTools konzoli stránky.
- Isolated-world log (`[AAS player]`) tamtéž — Chrome MV3 je sloučí do jedné konzole.
- Service worker `chrome://extensions` → Audio Ad Skipper → **Inspect views: service worker**.

## Licence

MIT — viz [`LICENSE`](LICENSE).

## Status

**v0.1 — Proof of Concept.** Otestováno na `novinky.cz` (2026-05). Sportovní / lifestylové
sekce nebyly explicitně otestovány, ale měly by fungovat za předpokladu, že používají stejné
TTS tlačítko a stejný VMD endpoint.
