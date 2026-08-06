#!/usr/bin/env node
/**
 * Run this once (e.g. as a login item / systemd user service / Task
 * Scheduler entry) and it'll keep element-polyglot applied across
 * Element Desktop auto-updates, the same way tools like
 * VencordAutoUpdater or BetterVencordPatch handle Discord.
 *
 * It works by polling app.asar's mtime + size. When Element updates
 * itself, it replaces app.asar with a fresh, unpatched one - this
 * detects that and re-runs patch.js against it.
 *
 * Usage:
 *   node watch-and-repatch.js /path/to/Element/resources
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const POLL_INTERVAL_MS = 30_000;

function statKey(asarPath) {
    const s = fs.statSync(asarPath);
    return `${s.size}:${s.mtimeMs}`;
}

function isOurs(asarPath, resourcesDir) {
    // Cheap check: our patched preload marker file exists alongside a
    // freshly-packed asar only if patch.js has already run against this
    // exact asar content. We don't unpack just to check, so instead we
    // rely on comparing against the backup - if app.asar now matches
    // neither our last-known-patched state, treat it as "needs patching."
    const backupPath = path.join(resourcesDir, "app.asar.polyglot-orig");
    return fs.existsSync(backupPath);
}

function main() {
    const resourcesDir = process.argv[2];
    if (!resourcesDir) {
        console.error("Usage: node watch-and-repatch.js <path-to-Element-resources-dir>");
        process.exit(1);
    }

    const asarPath = path.join(resourcesDir, "app.asar");
    const patchScript = path.join(__dirname, "patch.js");

    let lastKnownGood = fs.existsSync(asarPath) ? statKey(asarPath) : null;

    console.log(`Watching ${asarPath} for updates...`);

    setInterval(() => {
        if (!fs.existsSync(asarPath)) return;

        const current = statKey(asarPath);
        if (current === lastKnownGood) return;

        console.log("app.asar changed (likely an Element update) - repatching...");
        try {
            execFileSync("node", [patchScript, resourcesDir], { stdio: "inherit" });
            lastKnownGood = statKey(asarPath);
            console.log("Repatched successfully.");
        } catch (err) {
            console.error("Repatch failed:", err.message);
            // Don't update lastKnownGood, so we retry next tick.
        }
    }, POLL_INTERVAL_MS);
}

main();
