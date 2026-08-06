#!/usr/bin/env node
/**
 * Patches Element Desktop's app.asar so our preload script gets loaded
 * into every BrowserWindow it creates. Conceptually identical to how
 * Vencord/Vesktop-style loaders work: swap the packaged main entry for a
 * thin shim, then require the original.
 *
 * Usage:
 *   node patch.js /path/to/Element/resources
 *
 * On most installs that's something like:
 *   Windows: %LOCALAPPDATA%\Programs\Element\resources
 *   macOS:   /Applications/Element.app/Contents/Resources
 *   Linux:   /opt/Element/resources or /usr/lib/element-desktop/resources
 *
 * Requires the `asar` package: npm install -g asar (or use npx asar).
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function main() {
    const resourcesDir = process.argv[2];
    if (!resourcesDir) {
        console.error("Usage: node patch.js <path-to-Element-resources-dir>");
        process.exit(1);
    }

    const asarPath = path.join(resourcesDir, "app.asar");
    const backupPath = path.join(resourcesDir, "app.asar.polyglot-orig");
    const extractDir = path.join(resourcesDir, "app-extracted");

    if (!fs.existsSync(asarPath)) {
        console.error(`Couldn't find app.asar at ${asarPath}`);
        process.exit(1);
    }

    // Idempotent: if we already have a backup, this is a re-patch after
    // an update overwrote app.asar. Reset from the ORIGINAL, not from our
    // own previous patch, so patches never stack.
    if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(asarPath, backupPath);
        console.log("Backed up original app.asar");
    } else {
        console.log("Existing backup found, patching fresh from it");
        fs.copyFileSync(backupPath, asarPath);
    }

    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true });
    execSync(`npx asar extract "${asarPath}" "${extractDir}"`, { stdio: "inherit" });

    // Find the preload script Element itself already uses, rather than
    // replacing webPreferences.preload wholesale - the original preload
    // does real work (IPC bridging for native features), so we want to
    // extend it, not clobber it. Element's electron app has historically
    // kept this at "preload.js" in the packaged root; confirm against
    // the version you've got (grep electron-main.js for "preload:" if
    // this guess is wrong for your install).
    // Confirmed locations across different Element packagings:
    //   lib/preload.cjs - seen on at least one Linux distro package
    //   preload.js, webapp/preload.js - seen in other builds
    // Add more as you find them; order doesn't matter, first match wins.
    const candidateNames = ["lib/preload.cjs", "preload.js", "webapp/preload.js"];
    const originalPreloadRel = candidateNames.find((f) =>
        fs.existsSync(path.join(extractDir, f)),
    );

    if (!originalPreloadRel) {
        console.error(
            "Couldn't locate the existing preload script automatically.\n" +
            "Open electron-main.js in the extracted asar and search for\n" +
            "'preload:' to find its real path, then add that filename to\n" +
            "candidateNames above and re-run.",
        );
        process.exit(1);
    }

    const originalPreloadPath = path.join(extractDir, originalPreloadRel);
    const marker = "// element-polyglot inline injection";
    const existing = fs.readFileSync(originalPreloadPath, "utf8");

    if (!existing.includes(marker)) {
        // Deliberately NOT a separate file + require(), even with a
        // correctly-resolved relative path. Modern Electron commonly runs
        // preload scripts in a sandboxed context where require()ing an
        // arbitrary local file doesn't work the normal way, even when the
        // file genuinely exists - "module not found" despite the file
        // being right there is the telltale symptom. Inlining the whole
        // bundle as literal text directly into the SAME already-loading
        // preload file sidesteps that entirely: there's no second file to
        // resolve, just more top-level statements in a file Electron was
        // already going to execute regardless of sandboxing.
        const bundleCode = fs.readFileSync(
            path.join(__dirname, "inject.bundle.js"),
            "utf8",
        );

        const inlined = `
${marker}
window.addEventListener("DOMContentLoaded", () => {
    try {
${bundleCode}
    } catch (err) {
        console.error("[element-polyglot] failed to inject", err);
    }
});
`;

        fs.appendFileSync(originalPreloadPath, inlined);
    }

    execSync(`npx asar pack "${extractDir}" "${asarPath}"`, { stdio: "inherit" });
    fs.rmSync(extractDir, { recursive: true });

    console.log("Patched. Restart Element Desktop to load element-polyglot.");
}

main();
