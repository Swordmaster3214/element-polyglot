# element-polyglot

A translator plugin for [Element](https://element.io), in the spirit of
[Vencord's](https://vencord.dev/) translator plugin for Discord.

- **Incoming messages:** a "Translate" link appears under messages,
  translating them to your chosen language on click.
- **Outgoing messages:** optionally translate what you type before it
  sends, automatically.
- Settings live in a small dialog, opened from a 🌐 icon in the space
  panel (the vertical sidebar on the left).
- Works on both Element Web and Element Desktop.

No fork, no rebuild of Element itself, and no browser extension needed
in the common case - it loads as an official
[Element Module](https://github.com/element-hq/element-modules), the
same mechanism Element itself uses for this kind of extension.

## Installing

You'll need the built file, `polyglot-module.js`. Either grab it from
[Releases](../../releases) if one's published, or build it yourself:

```bash
npm install
npm run build:web-module
```

This produces `dist/polyglot-module.js`.

### Element Web

Host `polyglot-module.js` on the same origin your Element Web deployment
is served from, then add it to your `config.json`:

```json
{
  "modules": ["/polyglot-module.js"]
}
```

(adjust the path to wherever you actually placed the file)

### Element Desktop

Element Desktop reads its own `config.json` from an OS-specific folder:

| Platform | Location |
|---|---|
| Windows | `%APPDATA%\Element\config.json` |
| macOS | `~/Library/Application Support/Element/config.json` |
| Linux | `~/.config/Element/config.json` |

You'll also need to place `polyglot-module.js` somewhere Element is
allowed to load scripts from (its own served content - Element's
security policy blocks loading scripts from elsewhere, including a
plain file path or localhost). Where exactly that is varies by how
Element was packaged on your system; when using the native Linux package use `/usr/lib/element/webapp`. see `DEVELOPMENT.md` for how to
find it if it's not obvious. Once you've placed the file, reference it
in `config.json` the same way as above.

After editing `config.json`, fully quit Element (including from the
system tray if present) and relaunch - a simple window close/reopen
isn't enough, config is only read on process start.

### Confirming it's loaded

Open DevTools (`Ctrl+Shift+I` / `Cmd+Option+I`) and check the console
for a line starting with `[element-polyglot] module loaded`.

## Using it

- Click **Translate** under any message to translate it. Click again to
  hide the translation.
- Click the 🌐 icon in the space panel to open settings: choose your
  target languages, and toggle automatic outgoing translation on or off.

## Translation backend

Uses the same free, undocumented Google Translate endpoint Vencord's
translator plugin uses. No API key required, but also no guaranteed
uptime - if Google changes or rate-limits it, translation will stop
working until `packages/core/translate.js` is updated to use a
different backend (LibreTranslate and DeepL would both be reasonable
swaps).

## Known limitations

- The Module API used for the settings dialog (`extras.setSpacePanelItem`)
  is marked alpha by Element and may change in future Element releases.
- If placing the module file in Element's served content isn't practical
  for your install (e.g. a fully locked-down system), there's a fallback
  path using a browser extension (Element Web) or a patched Electron
  preload (Element Desktop) - see `packages/browser-extension` and
  `packages/desktop-loader`. The fallback path only supports the
  hover-translate and outgoing-translate features, not the settings
  dialog.

## Contributing / how this works internally

See `DEVELOPMENT.md` for the technical detail - which Module API calls
are used and why, the CSP constraints that shape where the file has to
live, and a few real bugs hit and fixed along the way.

## License

MIT - see `LICENSE`.
