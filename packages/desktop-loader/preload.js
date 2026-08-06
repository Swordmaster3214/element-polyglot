/**
 * Preload script for Element Desktop.
 *
 * CONFIRMED LIVE (2026-07): Element Desktop's CSP is
 *   script-src 'self' 'wasm-unsafe-eval' https://www.recaptcha.net/recaptcha/ https://www.gstatic.com/recaptcha/
 * No wildcards, no 'unsafe-inline', nothing outside that exact list.
 * 'self' means the document's own origin - vector://vector - and
 * nothing else. This has real consequences for how this file works:
 *
 * An earlier version of this file created a <script> element and set
 * its .textContent to the bundled injector code. That's an INLINE
 * script block, which this exact CSP also blocks (no 'unsafe-inline',
 * no nonce, no hash) - it would have failed the same way the
 * config.json `modules` approach did, just with a different error.
 *
 * The fix: don't go through the page's script-loading pipeline at all.
 * Preload scripts run in a privileged context that Electron injects
 * directly at BrowserWindow creation - they're not a <script src>, not
 * an inline <script> block, and aren't subject to the page's CSP.
 * require()ing the bundle directly, from within the preload's own
 * execution, runs its top-level code immediately (same effect as the
 * IIFE self-executing) without ever asking the CSP-governed pipeline to
 * load or execute anything. The bundle still gets the real `window`/
 * `document` - contextIsolation isolates JS globals/prototypes injected
 * via preload from the page tampering with them, it doesn't block DOM
 * access (querySelector, MutationObserver, fetch, etc. all still work
 * normally from here).
 */

window.addEventListener("DOMContentLoaded", () => {
    try {
        require("./polyglot-inject.bundle.js");
    } catch (err) {
        console.error("[element-polyglot] failed to inject", err);
    }
});
