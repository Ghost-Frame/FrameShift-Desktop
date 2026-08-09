// Unit tests for the `frameshift://install` deep link parser/validators.
//
// These use Node's built-in test runner through the desktop package's test
// script, with no additional test-runner dependency.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isValidPackName,
  isValidVersion,
  parseInstallDeepLink,
} from "./deep-link";

test("isValidPackName accepts a plain name", () => {
  assert.equal(isValidPackName("code-reviewer"), true);
});

test("isValidPackName rejects empty, dotted, and separator-bearing names", () => {
  assert.equal(isValidPackName(""), false);
  assert.equal(isValidPackName("."), false);
  assert.equal(isValidPackName(".."), false);
  assert.equal(isValidPackName(".hidden"), false);
  assert.equal(isValidPackName("../../etc"), false);
  assert.equal(isValidPackName("a/b"), false);
  assert.equal(isValidPackName("a\\b"), false);
});

test("isValidPackName rejects control characters", () => {
  // Built via fromCharCode rather than a literal escape so no raw control
  // byte has to round-trip through this source file.
  const withNul = "bad" + String.fromCharCode(0) + "name";
  const withDel = "bad" + String.fromCharCode(127) + "name";
  assert.equal(isValidPackName(withNul), false);
  assert.equal(isValidPackName(withDel), false);
  assert.equal(isValidPackName("goodname"), true);
});

test("isValidPackName rejects deceptive and non-registry identifiers", () => {
  assert.equal(isValidPackName("trusted\u202ereweiver"), false);
  assert.equal(isValidPackName("trusted\u200breviewer"), false);
  assert.equal(isValidPackName("name.with.dot"), false);
  assert.equal(isValidPackName("a".repeat(64)), true);
  assert.equal(isValidPackName("a".repeat(65)), false);
});

test("isValidVersion accepts plain and prerelease/build semver", () => {
  assert.equal(isValidVersion("1.2.3"), true);
  assert.equal(isValidVersion("1.2.3-beta.1"), true);
  assert.equal(isValidVersion("1.2.3+build.7"), true);
});

test("isValidVersion rejects non-semver-ish strings", () => {
  assert.equal(isValidVersion(""), false);
  assert.equal(isValidVersion("latest"), false);
  assert.equal(isValidVersion("1.2"), false);
  assert.equal(isValidVersion("1.2.3; rm -rf /"), false);
});

test("parseInstallDeepLink accepts a well-formed install link", () => {
  const result = parseInstallDeepLink(
    "frameshift://install?pack=code-reviewer&version=1.2.3",
  );
  assert.deepEqual(result, { pack: "code-reviewer", version: "1.2.3" });
});

test("parseInstallDeepLink rejects a different scheme or host", () => {
  assert.equal(
    parseInstallDeepLink("https://install?pack=a&version=1.0.0"),
    null,
  );
  assert.equal(
    parseInstallDeepLink("frameshift://uninstall?pack=a&version=1.0.0"),
    null,
  );
});

test("parseInstallDeepLink rejects missing or invalid params", () => {
  assert.equal(parseInstallDeepLink("frameshift://install?pack=a"), null);
  assert.equal(
    parseInstallDeepLink("frameshift://install?version=1.0.0"),
    null,
  );
  assert.equal(
    parseInstallDeepLink("frameshift://install?pack=../../etc&version=1.0.0"),
    null,
  );
  assert.equal(
    parseInstallDeepLink("frameshift://install?pack=a&version=not-a-version"),
    null,
  );
});

test("parseInstallDeepLink never throws on malformed input", () => {
  assert.doesNotThrow(() => parseInstallDeepLink("not a url at all"));
  assert.equal(parseInstallDeepLink("not a url at all"), null);
});
