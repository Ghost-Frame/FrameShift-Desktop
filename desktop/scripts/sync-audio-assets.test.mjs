// Verifies official release audio injection and its actionable failure path.

import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

// Lists the exact archive fixture required by the synchronization script.
const AUDIO_FILES = [
  "alexgrohl-no-copyright-music-bounce-on-it-184234.mp3",
  "cyberpunk-authentic.mp3",
  "diephoanghai-rap-beats-music-161432.mp3",
  "electronic-danix.mp3",
  "electronic-nastelbom.mp3",
  "game-edit.mp3",
  "kontraa-hype-drill-music-438398.mp3",
  "loksii-no-copyright-music-211881.mp3",
  "moonlit-dreams.mp3",
  "panda-beats-royalty-free-element-hard-rap-beat-231463.mp3",
  "soft-bee-pulse.mp3",
  "watermelon_beats-revenge-guitar-rap-beat-beats-music-2026-478872.mp3",
];

// Points each test invocation at the production synchronization script.
const SCRIPT_PATH = new URL("./sync-audio-assets.mjs", import.meta.url).pathname;

// Runs the synchronization script with an isolated canonical source.
function runSync(sourceDirectory) {
  return spawnSync(process.execPath, [SCRIPT_PATH], {
    encoding: "utf8",
    env: { ...process.env, FRAMESHIFT_AUDIO_SOURCE: sourceDirectory },
  });
}

// Copies a complete non-empty archive into the desktop public output.
test("synchronizes the complete canonical ambient archive", async (context) => {
  const sourceDirectory = join(tmpdir(), `frameshift-audio-complete-${process.pid}-${Date.now()}`);
  const destinationDirectory = new URL("../public/audio/", import.meta.url);
  context.after(async () => {
    await rm(sourceDirectory, { recursive: true, force: true });
    await rm(destinationDirectory, { recursive: true, force: true });
  });
  await mkdir(sourceDirectory, { recursive: true });

  for (const filename of AUDIO_FILES) {
    await writeFile(join(sourceDirectory, filename), `fixture:${filename}`);
  }

  const run = runSync(sourceDirectory);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /Synchronized 12 canonical ambient tracks/);
  assert.equal(
    await readFile(new URL(`../public/audio/${AUDIO_FILES[0]}`, import.meta.url), "utf8"),
    `fixture:${AUDIO_FILES[0]}`,
  );
});

// Rejects an incomplete explicitly configured release archive with a repair hint.
test("rejects an incomplete canonical ambient archive", async (context) => {
  const sourceDirectory = join(tmpdir(), `frameshift-audio-partial-${process.pid}-${Date.now()}`);
  context.after(async () => rm(sourceDirectory, { recursive: true, force: true }));
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(join(sourceDirectory, AUDIO_FILES[0]), "only-one-track");

  const run = runSync(sourceDirectory);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /archive is incomplete: missing/);
  assert.match(run.stderr, /Expected all 12 tracks/);
});

// Rejects a stale unapproved MP3 that would otherwise leak into the static bundle.
test("rejects an unexpected staged ambient track", async (context) => {
  const sourceDirectory = join(tmpdir(), `frameshift-audio-stale-${process.pid}-${Date.now()}`);
  const destinationDirectory = new URL("../public/audio/", import.meta.url);
  context.after(async () => {
    await rm(sourceDirectory, { recursive: true, force: true });
    await rm(destinationDirectory, { recursive: true, force: true });
  });
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(destinationDirectory, { recursive: true });

  for (const filename of AUDIO_FILES) {
    await writeFile(join(sourceDirectory, filename), `fixture:${filename}`);
  }
  await writeFile(new URL("../public/audio/unapproved.mp3", import.meta.url), "stale-track");

  const run = runSync(sourceDirectory);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Unexpected desktop ambient track: unapproved\.mp3/);
  assert.match(run.stderr, /Remove it from the release staging directory/);
});
