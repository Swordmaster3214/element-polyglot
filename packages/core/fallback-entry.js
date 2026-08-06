/**
 * Fallback-only entry point. Not needed if you're loading the module via
 * config.json on either Element Web or Element Desktop - see
 * packages/web-module/index.js for the primary path.
 *
 * This exists for the two edge cases where the config.json route isn't
 * available to you: an org-managed config.json with a CSP that blocks
 * remote modules, or an Element version old enough to predate module
 * support. Bundle this file and load it via the browser extension or the
 * asar patch in packages/desktop-loader.
 */

import { initDomIntegration } from "./dom.js";

initDomIntegration();
