/**
 * element-polyglot web module
 *
 * Loaded the sanctioned way, via the `modules` array in config.json,
 * dynamically import()ed at runtime. No fork, no rebuild. Works
 * identically on Element Web and Element Desktop, since Desktop just
 * runs this same webapp bundle inside Electron and reads its own
 * config.json from the OS user-data directory.
 *
 * Package/API confirmed by actually installing it and reading the
 * compiled source (2026-07):
 *   - "@element-hq/element-web-module-api" @ 1.5.0 is what element-web's
 *     own package.json currently depends on. The class-based
 *     RuntimeModule/WrapperLifecycle API from the older
 *     @matrix-org/react-sdk-module-api package is gone - that package
 *     still exists underneath as an internal implementation detail, but
 *     isn't what you code against anymore.
 *   - A module's default export must be a class with a static
 *     `moduleApiVersion` string and a `load()` method. The compiled
 *     engine checks `semver.satisfies(engineVersion, moduleApiVersion)`
 *     - "^1.5.0" is correct for the version installed here. If you're
 *     targeting a different Element release, check its own
 *     package.json for the actual @element-hq/element-web-module-api
 *     version and adjust this range to match.
 *   - Element Web exposes React globally as `window.React` (confirmed
 *     in the compiled plugin engine, which itself calls
 *     `window.React.useState`). Using that instead of importing our own
 *     `react` package avoids bundling a second React copy or needing an
 *     import-map for a bare "react" specifier at runtime - both real
 *     risks for a module that's dynamically import()ed into someone
 *     else's page rather than compiled together with it.
 *
 * What this module does:
 *   1. Registers a message renderer for "m.room.message" via
 *      `customComponents.registerMessageRenderer()`. This is the real,
 *      sanctioned replacement for the old MutationObserver hover-menu
 *      hack - it wraps Element's own rendering of each message with a
 *      small translate toggle underneath, using the actual MatrixEvent
 *      object instead of scraped DOM text.
 *   2. Calls initOutgoingTranslateHook() from packages/core/dom.js for
 *      translate-before-send. This part is NOT covered by the Module
 *      API (ClientApi has no send hook as of this version) and remains
 *      a DOM-level hack - see that file's header for the honest caveat
 *      about React-controlled contenteditable state.
 */

import { translate, LANGUAGES } from "../core/translate.js";
import { getSettings, setSettings } from "../core/settings.js";
import { initOutgoingTranslateHook } from "../core/dom.js";

const React = window.React;

function TranslateToggle({ mxEvent }) {
    const [state, setState] = React.useState({ status: "idle" });

    const body =
        typeof mxEvent?.content?.body === "string" ? mxEvent.content.body : null;
    // Respect the same toggle the old hover-menu version checked - it's
    // read fresh on every render rather than once, so flipping it in
    // localStorage takes effect on the next message render without a
    // reload. Bailing out here (rather than in renderMessage, before
    // this component even mounts) keeps the hook call unconditional,
    // which React's rules require.
    if (!body || !getSettings().incomingHoverTranslate) return null;

    async function handleClick() {
        if (state.status === "loading") return; // already in flight, ignore
        if (state.status === "shown") {
            setState((s) => ({ ...s, status: "hidden" }));
            return;
        }
        if (state.status === "hidden" && state.translated) {
            setState((s) => ({ ...s, status: "shown" }));
            return;
        }

        setState({ status: "loading" });
        try {
            const settings = getSettings();
            const { translated, detectedSourceLang } = await translate(
                body,
                settings.incomingTargetLang,
            );
            setState({ status: "shown", translated, detectedSourceLang });
        } catch (err) {
            console.error("[element-polyglot] translate failed", err);
            setState({ status: "idle" });
        }
    }

    const labelText =
        state.status === "loading"
            ? "Translating…"
            : state.status === "shown"
              ? "Hide translation"
              : "Translate";

    return React.createElement(
        "div",
        { className: "polyglot-translate-row", style: { marginTop: 2 } },
        React.createElement(
            "button",
            {
                type: "button",
                onClick: handleClick,
                style: {
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    color: "inherit",
                    textDecoration: "underline",
                    opacity: 0.7,
                    font: "inherit",
                    fontSize: "0.85em",
                },
            },
            labelText,
        ),
        state.status === "shown" && state.translated
            ? React.createElement(
                  "div",
                  { style: { fontStyle: "italic", opacity: 0.75, fontSize: "0.9em" } },
                  `(${state.detectedSourceLang} → translated) ${state.translated}`,
              )
            : null,
    );
}

function renderMessage(props, originalComponent) {
    return React.createElement(
        React.Fragment,
        null,
        originalComponent ? originalComponent() : null,
        React.createElement(TranslateToggle, { mxEvent: props.mxEvent }),
    );
}

/**
 * Settings dialog body, rendered via api.openDialog(). Per DialogProps<M>,
 * we receive onSubmit(model)/onCancel() as props - calling either is
 * assumed to both resolve the dialog's `finished` promise AND close it,
 * based on the type shapes (not confirmed against the runtime
 * implementation directly, just inference from the API's design - worth
 * a real test rather than taking on faith).
 */
function SettingsDialogBody({ onSubmit, onCancel }) {
    const initial = getSettings();
    const [autoTranslateOutgoing, setAutoTranslateOutgoing] = React.useState(
        initial.autoTranslateOutgoing,
    );
    const [outgoingTargetLang, setOutgoingTargetLang] = React.useState(
        initial.outgoingTargetLang,
    );
    const [incomingHoverTranslate, setIncomingHoverTranslate] = React.useState(
        initial.incomingHoverTranslate,
    );
    const [incomingTargetLang, setIncomingTargetLang] = React.useState(
        initial.incomingTargetLang,
    );

    function handleSave() {
        onSubmit({
            autoTranslateOutgoing,
            outgoingTargetLang,
            incomingHoverTranslate,
            incomingTargetLang,
        });
    }

    const languageOptions = LANGUAGES.map((l) =>
        React.createElement("option", { key: l.code, value: l.code }, l.name),
    );

    function section(checkboxLabel, checked, onCheckedChange, selectLabel, selectValue, onSelectChange) {
        return React.createElement(
            "div",
            { style: { marginBottom: 20 } },
            React.createElement(
                "label",
                { style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" } },
                React.createElement("input", {
                    type: "checkbox",
                    checked,
                    onChange: (e) => onCheckedChange(e.target.checked),
                }),
                checkboxLabel,
            ),
            React.createElement(
                "div",
                {
                    style: {
                        marginTop: 8,
                        marginLeft: 24,
                        opacity: checked ? 1 : 0.5,
                    },
                },
                selectLabel + " ",
                React.createElement(
                    "select",
                    {
                        value: selectValue,
                        disabled: !checked,
                        onChange: (e) => onSelectChange(e.target.value),
                    },
                    languageOptions,
                ),
            ),
        );
    }

    return React.createElement(
        "div",
        { style: { padding: "8px 4px", minWidth: 340 } },
        section(
            "Show translate link under incoming messages",
            incomingHoverTranslate,
            setIncomingHoverTranslate,
            "Translate to:",
            incomingTargetLang,
            setIncomingTargetLang,
        ),
        section(
            "Automatically translate my messages before sending",
            autoTranslateOutgoing,
            setAutoTranslateOutgoing,
            "Translate to:",
            outgoingTargetLang,
            setOutgoingTargetLang,
        ),
        React.createElement(
            "div",
            { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 } },
            React.createElement("button", { type: "button", onClick: onCancel }, "Cancel"),
            React.createElement(
                "button",
                { type: "button", onClick: handleSave, style: { fontWeight: 600 } },
                "Save",
            ),
        ),
    );
}

export default class PolyglotModule {
    // Matches @element-hq/element-web-module-api@1.5.0, the version
    // installed and read against while building this. Adjust if you're
    // targeting a different Element release - see file header.
    static moduleApiVersion = "^1.5.0";

    #api;

    constructor(api) {
        this.#api = api;
    }

    async load() {
        this.#api.customComponents.registerMessageRenderer(
            "m.room.message",
            renderMessage,
        );

        initOutgoingTranslateHook();

        // extras.setSpacePanelItem is genuinely part of the current API
        // (confirmed by reading the installed package's own types), but
        // marked @alpha "subject to change" - a reasonable UI home for
        // now, may need revisiting if this API's shape changes later.
        this.#api.extras.setSpacePanelItem("element-polyglot", {
            label: "Polyglot",
            tooltip: "Translation settings",
            icon: React.createElement(
                "span",
                { style: { fontSize: 20, lineHeight: 1 } },
                "🌐",
            ),
            onSelected: () => this.openSettings(),
        });

        // Bump this string whenever handing over a new build - the
        // fastest way to confirm during testing whether a freshly copied
        // file actually replaced the one Element has loaded, versus a
        // stale cached/leftover copy still being served.
        console.log("[element-polyglot] module loaded - build 2026-07-r5 (settings dialog via space panel item)");
    }

    openSettings() {
        // openDialog is mixed directly into the top-level Api object
        // (Api extends DialogApiExtension), not nested under api.dialog -
        // confirmed by reading the installed package's own index.d.ts
        // rather than assuming from the file it's declared in.
        const handle = this.#api.openDialog(
            { title: "Polyglot translation settings" },
            SettingsDialogBody,
            {},
        );

        handle.finished.then(({ ok, model }) => {
            if (ok && model) {
                setSettings(model);
                console.log("[element-polyglot] settings saved:", model);
            } else {
                console.log("[element-polyglot] settings dialog cancelled");
            }
        });
    }
}
