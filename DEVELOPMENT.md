# Development notes

Technical detail for anyone working on the code itself. For "how do I
install this," see `README.md` instead.

## Why this isn't a straight Vencord port

Discord is closed-source, so Vencord has to patch obfuscated code at
runtime. Element is open source and ships an actual Module API for this.
Element Desktop isn't a separate app with its own story, either - it's
literally Element Web running inside Electron, reading a `config.json`
from an OS-specific user data folder. Same `modules` array, same dynamic
`import()` at runtime, same everything.

| Platform | Where `config.json` lives |
|---|---|
| Element Web | wherever your deployment serves it |
| Element Desktop (Windows) | `%APPDATA%\Element\config.json` |
| Element Desktop (macOS) | `~/Library/Application Support/Element/config.json` |
| Element Desktop (Linux) | `~/.config/Element/config.json` (or `$XDG_CONFIG_HOME`) |
| Element Desktop (Flatpak) | `~/.var/app/im.riot.Riot/config/Element/config.json` |
| (any, with `--profile NAME`) | same paths, `Element-NAME` instead of `Element` |
| Self-hosted via the official Docker image | drop a directory under `/modules/` via bind mount - auto-wired into `config.json` for you |

## Module API - confirmed by reading the installed package, not docs alone

`@element-hq/element-web-module-api` (`1.5.0` at time of writing) is what
element-web's own `package.json` currently depends on. A module's
default export is a plain class with a static `moduleApiVersion` string
and a `load()` method - the engine checks `semver.satisfies(engineVersion,
moduleApiVersion)`, so `"^1.5.0"` needs adjusting if you're targeting a
different Element release (check its `package.json`).

What's actually used here, and where each is declared on the `Api`
object (confirmed against the package's own `.d.ts` files, not assumed
from naming patterns):

- **`customComponents.registerMessageRenderer("m.room.message", fn)`** -
  wraps how a message renders, with access to the real `MatrixEvent`.
  This is the entire incoming-translation feature - no DOM scraping, no
  MutationObserver, no tracking which message a hover menu belongs to.
- **`extras.setSpacePanelItem(key, props)`** - adds an item to the space
  panel sidebar. `@alpha`, "subject to change," but functional. Used for
  the settings entry point.
- **`openDialog(options, Component, props)`** - a real modal dialog API.
  Declared directly on the top-level `Api` interface (`Api extends
  DialogApiExtension`), **not** nested under `api.dialog` - easy mistake
  to make from the file it's declared in (`dialog.d.ts`).
- **`window.React`** - Element Web exposes React globally (confirmed:
  the compiled plugin engine itself calls `window.React.useState`). Used
  instead of importing `react` - avoids bundling a second copy or
  needing an import map for a bare `"react"` specifier, which a
  dynamically-`import()`ed module can't rely on having.
- **What's *not* covered:** sending. `ClientApi` is read-oriented
  (account data, room lookup), no hook into composing or sending a
  message. Translate-before-send stays a DOM-level hack.

## Architecture

```
packages/core/
  translate.js        - translate.googleapis.com call
  settings.js         - localStorage-backed settings (getSettings/setSettings)
  dom.js               - initOutgoingTranslateHook() (still needed, no
                         official send hook exists) + initHoverMenuTranslate()
                         (legacy, fallback-only - registerMessageRenderer
                         covers this properly in the real module)
  fallback-entry.js    - self-executing entry for the two fallback paths
packages/web-module/
  index.js             - the real module: registerMessageRenderer,
                        initOutgoingTranslateHook, settings dialog via
                        extras.setSpacePanelItem + openDialog
packages/browser-extension/   - fallback only
packages/desktop-loader/      - fallback only
```

## CSP and where the module file actually has to live

Element's CSP (`script-src 'self' ...` - confirmed live, no wildcards,
no `'unsafe-inline'`) means dynamic `import()` only works for URLs
within `'self'`. This rules out *any* externally-hosted URL for Desktop
- a real CDN over HTTPS fails exactly the same way `http://localhost`
does, both outside `'self'`. It doesn't rule out the module route
itself, just where the file can live: inside the app's own served
content, not off on another origin.

- **Element Web:** host `dist/polyglot-module.js` on the same origin
  your deployment is served from.
- **Element Desktop:** find where `vector://vector/webapp/` serves from
  on disk. On at least one Linux packaging this is a real unpacked
  directory (`/usr/share/webapps/element` in one confirmed case) - copy
  the file straight in and reference it with a **rooted** path (bare
  specifiers are rejected by dynamic `import()` without an import map):
  ```bash
  sudo cp dist/polyglot-module.js /usr/share/webapps/element/polyglot-module.js
  ```
  ```json
  { "modules": ["/polyglot-module.js"] }
  ```
  If the webapp is bundled inside `app.asar` instead (more common
  upstream), the same extract/add/repack technique as the patch below
  works for adding a static asset - the result still resolves under
  `vector://vector` either way.

Getting the module loaded this way covers incoming translation,
outgoing translation, and the settings UI - no preload/asar patch needed
once this works. Console confirms with `[element-polyglot] module
loaded - build ...`.

## `packages/desktop-loader` - fallback, not primary

Only needed if you can't add a file to wherever the webapp content is
served from. Patches `app.asar`'s existing preload script instead, since
preload scripts don't go through the page's CSP-governed script pipeline
- Electron injects them directly at `BrowserWindow` creation.

**Real limitation:** this route only gets the older DOM-hack hover-menu
translation from `packages/core/dom.js`, not `registerMessageRenderer` -
no path exists to feed the actual module into Element's own
`ModuleLoader` from inside a patched preload. Prefer the direct-file
route above if it works for your install.

**A real bug, fixed:** the preload used to `require()` a separate
bundled file, which failed with "module not found" on at least one
confirmed install even though the file demonstrably existed - consistent
with Electron's sandboxed preload contexts not resolving arbitrary local
`require()` calls normally. Fixed by inlining the whole bundle as
literal text directly into the original preload script instead.

## Outgoing translation - the actual fix, confirmed working

Two bugs surfaced during testing, both fixed:

1. **Infinite recursion.** The hook translates text, sets it into the
   composer, then redispatches a synthetic `Enter` keydown to trigger
   the real send. That synthetic event also bubbles through `document`
   and hit the *same* listener again - translating already-translated
   text, redispatching again, forever (confirmed: 30+ requests/second,
   frozen composer). Fixed with `if (!e.isTrusted) return;` - a
   browser-native, unspoofable way to distinguish real keypresses
   (`isTrusted: true`) from anything created via `new KeyboardEvent()` +
   `dispatchEvent()` (`isTrusted: false`).
2. **Direct `.innerText` mutation doesn't reach Element's internal editor
   model.** Confirmed live: translation succeeded, the DOM visibly
   updated, but the untranslated original still sent. Most
   contenteditable-based rich editors (Element's included) track their
   own model rather than just reading the DOM, and only sync from real
   `input`/`beforeinput` events. Fixed with `document.execCommand
   ('insertText', ...)` instead of direct assignment - deprecated, but
   still implemented in Chromium and dispatches the genuine event
   pipeline real typing produces.

A third dead end worth remembering, not a live bug: an early version
gated the whole hook on finding `window.mxMatrixClientPeg` (an
undocumented global), used for nothing except an existence check. On a
build where that global wasn't present or shaped as expected, this
silently killed the entire feature with zero errors. Removed - nothing
in the hook actually needed a client reference.

## Translation backend

`translate.googleapis.com/translate_a/single` - the same free,
undocumented endpoint Vencord's translator plugin uses. No API key, no
SLA. `packages/core/translate.js` is the only file that needs to change
to swap in LibreTranslate or DeepL.

## Building

```bash
npm install                      # .npmrc handles module-api's peer range automatically
npm run build:web-module         # -> dist/polyglot-module.js (the one that matters)
npm run build:extension          # -> packages/browser-extension/bundle.js (fallback)
npm run build:desktop            # -> packages/desktop-loader/inject.bundle.js (fallback)
```

Bump the version string in the `console.log` at the end of
`PolyglotModule.load()` whenever handing over a new build - the fastest
way to confirm during testing whether a freshly copied file actually
replaced the one Element has loaded.
