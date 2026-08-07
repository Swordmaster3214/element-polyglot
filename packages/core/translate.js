/**
 * element-polyglot: core translation client
 *
 * Same endpoint Vencord's Translate plugin hits. It's the free "single"
 * translate_a endpoint that the Google Translate website itself uses.
 * No API key needed, but it's undocumented, unrate-limited by us, and
 * Google can change or throttle it whenever they feel like it. Don't
 * hammer it in a tight loop or they'll start blocking the IP.
 */

const ENDPOINT = "https://translate.googleapis.com/translate_a/single";

/**
 * Translate a string of text.
 *
 * @param {string} text - text to translate
 * @param {string} targetLang - ISO 639-1 code, e.g. "en", "ja", "es"
 * @param {string} [sourceLang="auto"] - source language, "auto" to detect
 * @returns {Promise<{translated: string, detectedSourceLang: string}>}
 */
export async function translate(text, targetLang, sourceLang = "auto") {
    if (!text || !text.trim()) {
        return { translated: text, detectedSourceLang: sourceLang };
    }

    const params = new URLSearchParams({
        client: "gtx",
        sl: sourceLang,
        tl: targetLang,
        dt: "t",
        q: text,
    });

    const res = await fetch(`${ENDPOINT}?${params.toString()}`);
    if (!res.ok) {
        throw new Error(`Translate request failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();

    // Response shape is a deeply nested array, not an object. Roughly:
    // data[0] = array of [translatedChunk, originalChunk, ...] per sentence
    // data[2] = detected source language code
    const translated = (data[0] || [])
        .map((chunk) => chunk[0])
        .filter(Boolean)
        .join("");

    const detectedSourceLang = data[2] || sourceLang;

    return { translated, detectedSourceLang };
}

/**
 * Small curated list. Extend as needed; codes must match Google's ISO codes.
 */
export const LANGUAGES = [
    { code: "en", name: "English" },
    { code: "es", name: "Spanish" },
    { code: "fr", name: "French" },
    { code: "de", name: "German" },
    { code: "it", name: "Italian" },
    { code: "pt", name: "Portuguese" },
    { code: "ru", name: "Russian" },
    { code: "ja", name: "Japanese" },
    { code: "ko", name: "Korean" },
    { code: "zh-CN", name: "Chinese (Simplified)" },
    { code: "ar", name: "Arabic" },
    { code: "hi", name: "Hindi" },
    { code: "nl", name: "Dutch" },
    { code: "pl", name: "Polish" },
    { code: "tr", name: "Turkish" },
    { code: "vi", name: "Vietnamese" },
];

export const SOURCE_LANGUAGES = [
{ code: "auto", name: "Detect language" },
...LANGUAGES,
];
