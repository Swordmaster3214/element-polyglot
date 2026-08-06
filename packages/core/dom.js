/**
 * element-polyglot DOM-level integration
 *
 * As of the current Module API (@element-hq/element-web-module-api),
 * incoming-message translation has a real, sanctioned hook:
 * `customComponents.registerMessageRenderer()` (see
 * packages/web-module/index.js). That replaced everything this file
 * used to do for the hover-menu button - no more MutationObserver,
 * no more tracking which message's "..." button was last clicked to
 * work around the context menu being portalled away from its message.
 *
 * What's left here, genuinely still needed:
 *
 * 1. `initOutgoingTranslateHook()` - translate-before-send. The Module
 *    API's ClientApi is read-oriented (account data, room lookup) and
 *    has no hook into composing/sending a message, so this stays a DOM
 *    hack: listening for Enter in the composer and substituting
 *    translated text first. Used by the real module AND the fallbacks.
 *
 * 2. `initHoverMenuTranslate()` - the original hover-menu button logic,
 *    kept only for the fallback delivery paths (browser extension /
 *    asar patch) that don't have Module API access at all. If you're
 *    loading this via config.json's `modules`, you don't need this -
 *    the module's registerMessageRenderer call already covers it, more
 *    robustly, with the real MatrixEvent instead of scraped DOM text.
 *
 * Selectors below confirmed against a live Element instance (2026-07).
 *
 * CONFIRMED (2026-07), not just a theoretical caveat anymore: setting
 * `.innerText` directly on the composer changes what's visually on
 * screen, but Element's composer keeps its own internal editor model
 * (needed for pills, formatting, cursor position - most contenteditable
 * rich editors work this way). Console logging showed translation
 * succeeding and the DOM updating correctly, but the message that
 * actually arrived on the other end was the untranslated original -
 * Element's send logic reads from its own model, which direct DOM
 * mutation never touches.
 *
 * Fixed via `document.execCommand('insertText', ...)` instead of direct
 * assignment - deprecated API, but still implemented in Chromium
 * (Electron's engine) and specifically dispatches genuine
 * `beforeinput`/`input` events with real `inputType` metadata, the same
 * pipeline actual typing produces. Most contenteditable-based rich
 * editors listen to that pipeline to stay in sync, which is presumably
 * how Element's does too - though this is inference, not confirmed
 * against Element's actual source, so treat it as the next hypothesis
 * to verify against a real send rather than a guaranteed fix.
 */

import { translate } from "./translate.js";
import { getSettings } from "./settings.js";

const SELECTORS = {
    messageOptionsButton: 'button[aria-label="Options"]',
    contextMenu: "ul.mx_MessageContextMenu",
    templateMenuItem: 'li[role="menuitem"]',
    optionList: ".mx_IconizedContextMenu_optionList",
    eventTile: ".mx_EventTile",
    messageBody: ".mx_EventTile_body",
    composer: '.mx_BasicMessageComposer_input[aria-label="Send a message…"]',
};

// Removed findMatrixClient() (used to gate initOutgoingTranslateHook on
// window.mxMatrixClientPeg) - that undocumented global not being present
// or shaped as expected on some builds is the leading hypothesis for why
// outgoing translation was silently no-oping with zero errors. Nothing
// else here ever used the client reference for anything, so the gate
// was pure risk with no corresponding benefit.

/**
 * Replaces the composer's content via the real browser input pipeline
 * instead of directly setting .innerText. Direct mutation changes what's
 * visually shown but doesn't reach Element's internal editor model - see
 * file header. Selecting all content then using execCommand('insertText')
 * dispatches genuine beforeinput/input events with real inputType
 * metadata, the same events actual typing produces, which is what
 * contenteditable-based rich editors generally listen to for staying in
 * sync. Logs the before/after DOM state so a failure here is visible
 * immediately rather than only showing up as "wrong text arrived."
 */
function replaceComposerText(composer, newText) {
    composer.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection.removeAllRanges();
    selection.addRange(range);

    const supported = document.execCommand("insertText", false, newText);
    console.log(
        "[element-polyglot][outgoing] execCommand('insertText') returned:",
        supported,
        "- composer now reads:",
        JSON.stringify(composer.innerText),
    );

    if (!supported || composer.innerText.trim() !== newText.trim()) {
        console.warn(
            "[element-polyglot][outgoing] execCommand may not have worked as " +
                "expected (unsupported, or composer text doesn't match what we " +
                "tried to insert) - falling back to direct assignment, which is " +
                "known not to reach Element's internal editor model.",
        );
        composer.innerText = newText;
    }
}

export function initOutgoingTranslateHook() {
    document.addEventListener(
        "keydown",
        async (e) => {
            // Critical: our own redispatched Enter below also bubbles
            // through document and would otherwise hit this exact same
            // listener again - translating already-translated text,
            // redispatching again, forever. isTrusted is the browser's
            // built-in way to tell "a real keypress" apart from anything
            // created via `new KeyboardEvent()` and dispatchEvent() -
            // real input is always true, script-dispatched is always
            // false. Bailing out here on untrusted events is what breaks
            // the loop; nothing else in this function can safely tell
            // the two apart, since the target/key/composer all look
            // identical either way. Not logged - fires on every keydown,
            // including every normal keystroke, and would spam.
            if (!e.isTrusted) return;

            const settings = getSettings();
            if (!settings.autoTranslateOutgoing) return;
            if (e.key !== "Enter" || e.shiftKey) return;

            console.log(
                "[element-polyglot][outgoing] Enter pressed, feature enabled, target:",
                e.target,
            );

            const composer = e.target.closest?.(SELECTORS.composer);
            if (!composer) {
                console.warn(
                    "[element-polyglot][outgoing] bailing: e.target didn't match " +
                        "SELECTORS.composer - likely a stale selector for this Element " +
                        "version. Falling through to a normal, untranslated send.",
                    { target: e.target, selector: SELECTORS.composer },
                );
                return;
            }

            // Previously gated on finding window.mxMatrixClientPeg here and
            // bailing silently if it wasn't present - removed. That global
            // is undocumented and this build may not expose it the same
            // way (or at all), and nothing below actually uses the client
            // reference for anything. It was a no-op safety check that
            // could silently kill the entire feature with zero indication
            // - exactly matching "not translating at all, no errors."

            const original = composer.innerText;
            console.log(
                "[element-polyglot][outgoing] composer matched, translating:",
                JSON.stringify(original),
            );

            e.stopImmediatePropagation();
            e.preventDefault();

            let translated = original;
            try {
                const result = await translate(original, settings.outgoingTargetLang);
                translated = result.translated;
                console.log(
                    "[element-polyglot][outgoing] translated to:",
                    JSON.stringify(translated),
                );
            } catch (err) {
                console.error(
                    "[element-polyglot][outgoing] translate() failed, sending original text instead:",
                    err,
                );
            }

            replaceComposerText(composer, translated);

            // This redispatch is what needed the isTrusted guard above -
            // it's a real Enter as far as Element's composer is
            // concerned, but the browser correctly marks it untrusted,
            // and now we correctly ignore it ourselves too.
            composer.dispatchEvent(
                new KeyboardEvent("keydown", {
                    key: "Enter",
                    bubbles: true,
                    cancelable: true,
                }),
            );
        },
        true,
    );
}

// --- Everything below is fallback-only, for delivery paths without ---
// --- Module API access. Not used by packages/web-module/index.js.  ---

let lastActiveEventTile = null;

async function handleTranslateClick(eventTile) {
    const body = eventTile?.querySelector(SELECTORS.messageBody);
    if (!body) return;

    const settings = getSettings();
    const original = body.innerText;

    try {
        const { translated, detectedSourceLang } = await translate(
            original,
            settings.incomingTargetLang,
        );
        showInlineTranslation(body, translated, detectedSourceLang);
    } catch (err) {
        console.error("[element-polyglot] translate failed", err);
    }
}

function showInlineTranslation(messageBodyEl, translated, sourceLang) {
    const container =
        messageBodyEl.closest(".mx_EventTile_line") || messageBodyEl.parentElement;
    const existing = container.querySelector(".polyglot-translation");
    if (existing) {
        existing.remove();
        return; // acts as a toggle: click again to hide
    }

    const note = document.createElement("div");
    note.className = "polyglot-translation";
    note.style.cssText =
        "opacity:0.75;font-style:italic;margin-top:2px;font-size:0.9em;";
    note.textContent = `(${sourceLang} → translated) ${translated}`;
    container.appendChild(note);
}

function injectTranslateMenuItem(menuEl) {
    const settings = getSettings();
    if (!settings.incomingHoverTranslate) return;
    if (menuEl.querySelector(".polyglot-menu-item")) return;

    const template = menuEl.querySelector(SELECTORS.templateMenuItem);
    const optionList = menuEl.querySelector(SELECTORS.optionList);
    if (!template || !optionList) return;

    const item = template.cloneNode(true);
    item.classList.add("polyglot-menu-item");
    item.setAttribute("aria-label", "Translate to English");
    item.removeAttribute("href");
    const label = item.querySelector(".mx_IconizedContextMenu_label");
    if (label) label.textContent = "Translate to English";

    const eventTile = lastActiveEventTile;

    item.addEventListener("click", () => {
        if (eventTile) handleTranslateClick(eventTile);
        document.querySelector(".mx_ContextualMenu_background")?.click();
    });

    optionList.insertBefore(item, template);
}

function observeContextMenu() {
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (!(node instanceof HTMLElement)) continue;
                const menu = node.matches?.(SELECTORS.contextMenu)
                    ? node
                    : node.querySelector?.(SELECTORS.contextMenu);
                if (menu) injectTranslateMenuItem(menu);
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
}

function trackOptionsButtonClicks() {
    document.addEventListener(
        "click",
        (e) => {
            const btn = e.target.closest?.(SELECTORS.messageOptionsButton);
            if (!btn) return;
            lastActiveEventTile = btn.closest(SELECTORS.eventTile) || null;
        },
        true,
    );
}

export function initHoverMenuTranslate() {
    trackOptionsButtonClicks();
    observeContextMenu();
}

/**
 * Convenience for the fallback delivery paths (browser extension / asar
 * patch), which have no Module API access and so need both pieces.
 */
export function initDomIntegration() {
    const start = () => {
        initHoverMenuTranslate();
        initOutgoingTranslateHook();
        console.log("[element-polyglot] DOM integration active (fallback mode)");
    };

    if (document.readyState === "complete" || document.readyState === "interactive") {
        start();
    } else {
        document.addEventListener("DOMContentLoaded", start);
    }
}
