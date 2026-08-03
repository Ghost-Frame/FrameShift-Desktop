import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

// Creates one representative signed updater bundle and optional human installer.
function createPlatform(root, key, updaterName, installerName) {
  const platformRoot = join(root, `updater-${key}`, "bundle");
  mkdirSync(platformRoot, { recursive: true });
  const updater = join(platformRoot, updaterName);
  writeFileSync(updater, `${key} updater`);
  writeFileSync(`${updater}.sig`, `${key}-signature`);
  if (installerName && installerName !== updaterName) {
    writeFileSync(join(platformRoot, installerName), `${key} installer`);
  }
}

// Verifies updater and human-download artifacts stay distinct and collision-safe.
test("assembles a complete early-access release manifest", (t) => {
  const root = join(
    tmpdir(),
    `frameshift-release-test-${process.pid}-${Date.now()}`,
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const artifacts = join(root, "artifacts");
  const stage = join(root, "stage");
  mkdirSync(artifacts, { recursive: true });

  createPlatform(artifacts, "linux-x86_64", "FrameShift.AppImage");
  createPlatform(artifacts, "windows-x86_64", "FrameShift-setup.exe");

  const script = new URL("./build-latest-json.mjs", import.meta.url);
  const run = spawnSync(process.execPath, [script.pathname, artifacts, stage], {
    encoding: "utf8",
    env: {
      ...process.env,
      UPDATER_PUBLIC_BASE: "https://downloads.example.test/desktop",
      UPDATER_PUB_DATE: "2026-07-21T00:00:00.000Z",
    },
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const manifest = JSON.parse(readFileSync(join(stage, "latest.json"), "utf8"));
  assert.equal(manifest.version, "0.1.10");
  assert.equal(manifest.pub_date, "2026-07-21T00:00:00.000Z");
  assert.deepEqual(Object.keys(manifest.platforms).sort(), [
    "linux-x86_64",
    "windows-x86_64",
  ]);
  assert.equal(
    manifest.platforms["windows-x86_64"].signature,
    "windows-x86_64-signature",
  );

  for (const platform of Object.values(manifest.platforms)) {
    const updaterName = decodeURIComponent(
      new URL(platform.url).pathname.split("/").at(-1),
    );
    const installerName = decodeURIComponent(
      new URL(platform.download_url).pathname.split("/").at(-1),
    );
    assert.ok(
      existsSync(join(stage, updaterName)),
      `missing staged updater ${updaterName}`,
    );
    assert.ok(
      existsSync(join(stage, installerName)),
      `missing staged installer ${installerName}`,
    );
  }
});

// Refuses to publish when any supported operating-system artifact is absent.
test("rejects a partial release manifest", (t) => {
  const root = join(
    tmpdir(),
    `frameshift-partial-release-test-${process.pid}-${Date.now()}`,
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const artifacts = join(root, "artifacts");
  const stage = join(root, "stage");
  mkdirSync(artifacts, { recursive: true });

  createPlatform(artifacts, "linux-x86_64", "FrameShift.AppImage");

  const script = new URL("./build-latest-json.mjs", import.meta.url);
  const run = spawnSync(process.execPath, [script.pathname, artifacts, stage], {
    encoding: "utf8",
  });
  assert.notEqual(run.status, 0);
  assert.match(
    run.stderr,
    /missing signed updater artifacts for: windows-x86_64/,
  );
  assert.equal(existsSync(join(stage, "latest.json")), false);
});

// Refuses a signed Windows updater archive that lacks a human installer.
test("rejects a platform without a human installer", (t) => {
  const root = join(
    tmpdir(),
    `frameshift-installer-release-test-${process.pid}-${Date.now()}`,
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const artifacts = join(root, "artifacts");
  const stage = join(root, "stage");
  mkdirSync(artifacts, { recursive: true });

  createPlatform(artifacts, "linux-x86_64", "FrameShift.AppImage");
  createPlatform(artifacts, "windows-x86_64", "FrameShift.nsis.zip");

  const script = new URL("./build-latest-json.mjs", import.meta.url);
  const run = spawnSync(process.execPath, [script.pathname, artifacts, stage], {
    encoding: "utf8",
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /no human installer found for windows-x86_64/);
  assert.match(
    run.stderr,
    /missing signed updater artifacts for: windows-x86_64/,
  );
  assert.equal(existsSync(join(stage, "latest.json")), false);
});
