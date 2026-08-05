// Verifies that packaged desktop builds retain hardened CSP and IPC contracts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/** Location of the Tauri application configuration under test. */
const configUrl = new URL("../src-tauri/tauri.conf.json", import.meta.url);

/** Location of the main-window capability configuration under test. */
const capabilityUrl = new URL(
  "../src-tauri/capabilities/default.json",
  import.meta.url,
);

/** Parsed Tauri application configuration used by the policy assertions. */
const config = JSON.parse(readFileSync(configUrl, "utf8"));

/** Parsed main-window capability used by the exact command assertions. */
const capability = JSON.parse(readFileSync(capabilityUrl, "utf8"));

/** Parses a serialized Content Security Policy into directive source lists. */
function parsePolicy(policy) {
  return Object.fromEntries(
    policy
      .split(";")
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        // Separates the directive name from its ordered source expressions.
        const [name, ...sources] = directive.split(/\s+/);
        return [name, sources];
      }),
  );
}

/** Parsed policy applied to packaged application assets. */
const productionPolicy = parsePolicy(config.app.security.csp);

/** Parsed policy applied only by the local development server. */
const developmentPolicy = parsePolicy(config.app.security.devCsp);

// Packaged assets rely on Tauri-generated script hashes and style nonces.
test("production CSP blocks broad inline script and style execution", () => {
  assert.deepEqual(productionPolicy["script-src"], ["'self'"]);
  assert.deepEqual(productionPolicy["style-src"], ["'self'"]);
  assert.deepEqual(productionPolicy["base-uri"], ["'none'"]);
  assert.deepEqual(productionPolicy["form-action"], ["'none'"]);
  assert.equal(
    config.app.security.dangerousDisableAssetCspModification,
    undefined,
  );
  assert.equal(
    config.app.security["dangerous-disable-asset-csp-modification"],
    undefined,
  );
  assert.equal(
    config.app.security.dangerous_disable_asset_csp_modification,
    undefined,
  );
});

// React style properties retain only the CSP exception that governs attributes.
test("production CSP scopes inline styling to style attributes", () => {
  assert.deepEqual(productionPolicy["style-src-attr"], ["'unsafe-inline'"]);
  assert.ok(!productionPolicy["script-src"].includes("'unsafe-inline'"));
  assert.ok(!productionPolicy["style-src"].includes("'unsafe-inline'"));
});

// Local Next.js development keeps its existing inline allowances out of production.
test("development CSP is isolated from the packaged policy", () => {
  assert.ok(developmentPolicy["script-src"].includes("'unsafe-inline'"));
  assert.ok(developmentPolicy["style-src"].includes("'unsafe-inline'"));
  assert.deepEqual(developmentPolicy["base-uri"], ["'none'"]);
  assert.deepEqual(developmentPolicy["form-action"], ["'none'"]);
  assert.notEqual(config.app.security.devCsp, config.app.security.csp);
});

// Locks the WebView bridge to the exact native commands imported by the UI.
test("main-window capability contains no unused core or plugin commands", () => {
  // Normalizes configured permissions so their source ordering is irrelevant.
  const permissions = [...capability.permissions].sort();

  // Enumerates every Tauri command imported by the public interface.
  const expected = [
    "core:app:allow-version",
    "core:event:allow-listen",
    "core:event:allow-unlisten",
    "deep-link:allow-get-current",
    "dialog:allow-open",
    "process:allow-restart",
    "updater:allow-check",
    "updater:allow-download-and-install",
  ].sort();

  assert.deepEqual(permissions, expected);
});
