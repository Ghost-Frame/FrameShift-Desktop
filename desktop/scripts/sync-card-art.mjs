// Synchronizes the canonical website persona artwork into the desktop app's
// ignored public directory before development, testing, and static export.

import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_ARTWORK_COUNT = 41;
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIRECTORY = resolve(SCRIPT_DIRECTORY, "..");
const EXPLICIT_SOURCE_DIRECTORY =
  process.env.FRAMESHIFT_CARD_ART_SOURCE?.trim();
const SOURCE_DIRECTORY = resolve(
  EXPLICIT_SOURCE_DIRECTORY ||
    resolve(DESKTOP_DIRECTORY, "../marketplace/public/cards/generated"),
);
const DESTINATION_DIRECTORY = resolve(
  DESKTOP_DIRECTORY,
  "public/cards/generated",
);

// Reports whether a path resolves to a readable directory.
async function directoryExists(directory) {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

const sourceExists = await directoryExists(SOURCE_DIRECTORY);

if (!sourceExists && EXPLICIT_SOURCE_DIRECTORY) {
  throw new Error(
    `Configured canonical card-art directory does not exist: ${SOURCE_DIRECTORY}`,
  );
}

await mkdir(DESTINATION_DIRECTORY, { recursive: true });

if (!sourceExists) {
  console.warn(
    "Canonical card artwork is unavailable; continuing with UI fallbacks for this public-source build",
  );
} else {
  const sourceEntries = await readdir(SOURCE_DIRECTORY, {
    withFileTypes: true,
  });
  const artworkFiles = [];

  for (const entry of sourceEntries) {
    if (entry.isFile() && entry.name.endsWith(".webp")) {
      artworkFiles.push(entry.name);
    }
  }

  artworkFiles.sort();

  if (artworkFiles.length !== EXPECTED_ARTWORK_COUNT) {
    throw new Error(
      `Expected ${EXPECTED_ARTWORK_COUNT} canonical card artworks, found ${artworkFiles.length}`,
    );
  }

  for (const filename of artworkFiles) {
    const sourcePath = resolve(SOURCE_DIRECTORY, filename);
    const destinationPath = resolve(DESTINATION_DIRECTORY, filename);
    const sourceStats = await stat(sourcePath);

    if (sourceStats.size === 0) {
      throw new Error(`Canonical card artwork is empty: ${filename}`);
    }

    await copyFile(sourcePath, destinationPath);
  }

  const destinationEntries = await readdir(DESTINATION_DIRECTORY, {
    withFileTypes: true,
  });
  const expectedFiles = new Set(artworkFiles);

  for (const entry of destinationEntries) {
    if (
      entry.isFile() &&
      entry.name.endsWith(".webp") &&
      !expectedFiles.has(entry.name)
    ) {
      throw new Error(`Unexpected stale desktop card artwork: ${entry.name}`);
    }
  }

  console.log(
    `Synchronized ${artworkFiles.length} canonical card artworks for desktop`,
  );
}
