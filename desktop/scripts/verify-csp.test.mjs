// Verifies that packaged desktop builds retain the hardened CSP contract.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const configUrl = new URL("../src-tauri/tauri.conf.json", import.meta.url);
const config = JSON.parse(readFileSync(configUrl, "utf8"));

// Parse a serialized Content Security Policy into directive source lists.
const parsePolicy = (policy) =>
  Object.fromEntries(
    policy
      .split(";")
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...sources] = directive.split(/\s+/);
        return [name, sources];
      }),
  );

const productionPolicy = parsePolicy(config.app.security.csp);
const developmentPolicy = parsePolicy(config.app.security.devCsp);

// Packaged assets rely on Tauri-generated script hashes and style nonces.
test("production CSP blocks broad inline script and style execution", () => {
  assert.deepEqual(productionPolicy["script-src"], ["'self'"]);
  assert.deepEqual(productionPolicy["style-src"], ["'self'"]);
  assert.notEqual(
    config.app.security.dangerousDisableAssetCspModification,
    true,
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
  assert.notEqual(config.app.security.devCsp, config.app.security.csp);
});
