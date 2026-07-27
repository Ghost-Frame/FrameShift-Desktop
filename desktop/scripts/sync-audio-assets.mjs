// Injects the private royalty-free station archive into official desktop builds.

import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Lists the exact archive expected by the restored ambient station.
const EXPECTED_AUDIO_FILES = [
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

// Resolves the script's stable desktop workspace root.
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
// Resolves the desktop package containing the ignored public output directory.
const DESKTOP_DIRECTORY = resolve(SCRIPT_DIRECTORY, "..");
// Reads the explicit CI input while allowing the adjacent private monorepo default locally.
const EXPLICIT_SOURCE_DIRECTORY = process.env.FRAMESHIFT_AUDIO_SOURCE?.trim();
// Locates the canonical archive without requiring local configuration in the private monorepo.
const SOURCE_DIRECTORY = resolve(
  EXPLICIT_SOURCE_DIRECTORY || resolve(DESKTOP_DIRECTORY, "../marketplace/public/audio"),
);
// Locates the ignored directory copied into the static desktop export.
const DESTINATION_DIRECTORY = resolve(DESKTOP_DIRECTORY, "public/audio");

// Reports whether a path resolves to a readable directory.
async function directoryExists(directory) {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

// Records whether the configured canonical archive is available.
const sourceExists = await directoryExists(SOURCE_DIRECTORY);

if (!sourceExists && EXPLICIT_SOURCE_DIRECTORY) {
  throw new Error(
    `Configured ambient-audio directory does not exist: ${SOURCE_DIRECTORY}. Set FRAMESHIFT_AUDIO_SOURCE to the canonical 12-track archive.`,
  );
}

if (!sourceExists) {
  console.warn(
    "Canonical ambient audio is unavailable; continuing with controls only for this public-source build",
  );
} else {
  await mkdir(DESTINATION_DIRECTORY, { recursive: true });

  for (const filename of EXPECTED_AUDIO_FILES) {
    const sourcePath = resolve(SOURCE_DIRECTORY, filename);
    const destinationPath = resolve(DESTINATION_DIRECTORY, filename);
    let sourceStats;

    try {
      sourceStats = await stat(sourcePath);
    } catch {
      throw new Error(
        `Canonical ambient archive is incomplete: missing ${filename}. Expected all ${EXPECTED_AUDIO_FILES.length} tracks.`,
      );
    }

    if (!sourceStats.isFile() || sourceStats.size === 0) {
      throw new Error(`Canonical ambient track is empty or invalid: ${filename}`);
    }

    await copyFile(sourcePath, destinationPath);
  }

  // Rejects any unapproved MP3 that would otherwise be bundled by static export.
  const destinationEntries = await readdir(DESTINATION_DIRECTORY, {
    withFileTypes: true,
  });
  // Provides constant-time membership checks for the canonical allowlist.
  const expectedFiles = new Set(EXPECTED_AUDIO_FILES);

  for (const entry of destinationEntries) {
    if (
      entry.isFile() &&
      entry.name.endsWith(".mp3") &&
      !expectedFiles.has(entry.name)
    ) {
      throw new Error(
        `Unexpected desktop ambient track: ${entry.name}. Remove it from the release staging directory.`,
      );
    }
  }

  console.log(
    `Synchronized ${EXPECTED_AUDIO_FILES.length} canonical ambient tracks for desktop`,
  );
}
