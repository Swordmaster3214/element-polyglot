/**
 * Settings persistence. Uses localStorage since both the module (runs in
 * the Element Web page) and the injected script (also runs in the page,
 * or in the desktop renderer) share the same origin storage.
 */

const KEY = "element-polyglot:settings";

const DEFAULTS = {
    // translate my outgoing messages before sending
    autoTranslateOutgoing: false,
    outgoingTargetLang: "es",

    // show a "Translate to English" item in the message hover menu
    incomingHoverTranslate: true,
    incomingTargetLang: "en",
};

export function getSettings() {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return { ...DEFAULTS };
        return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
        return { ...DEFAULTS };
    }
}

export function setSettings(partial) {
    const next = { ...getSettings(), ...partial };
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
}
