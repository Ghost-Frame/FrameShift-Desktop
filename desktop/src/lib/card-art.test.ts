// Verifies desktop card-art URL construction and canonical asset synchronization.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

import { cardArtUrl } from "./card-art";

const EXPECTED_ARTWORK_COUNT = 42;
const DESKTOP_DIRECTORY = resolve(process.cwd());
const SOURCE_DIRECTORY = resolve(
  process.env.FRAMESHIFT_CARD_ART_SOURCE?.trim() ||
    resolve(DESKTOP_DIRECTORY, "../marketplace/public/cards/generated"),
);
const DESTINATION_DIRECTORY = resolve(
  DESKTOP_DIRECTORY,
  "public/cards/generated",
);

// Reports whether a path resolves to a readable directory.
async function directoryExists(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

// Verifies plain and URL-significant persona names resolve below the local asset root.
test("cardArtUrl encodes persona names into local WebP paths", () => {
  assert.equal(cardArtUrl("security"), "/cards/generated/security.webp");
  assert.equal(
    cardArtUrl("future pack/alpha"),
    "/cards/generated/future%20pack%2Falpha.webp",
  );
});

// Verifies the desktop mirror contains the full canonical set with identical bytes.
test("desktop card artwork matches the canonical website assets byte-for-byte", async (context) => {
  if (!(await directoryExists(SOURCE_DIRECTORY))) {
    context.skip(
      "Canonical artwork is not included in the public source clone",
    );
    return;
  }

  const sourceFiles = (await readdir(SOURCE_DIRECTORY))
    .filter((filename) => filename.endsWith(".webp"))
    .sort();
  const destinationFiles = (await readdir(DESTINATION_DIRECTORY))
    .filter((filename) => filename.endsWith(".webp"))
    .sort();

  assert.equal(sourceFiles.length, EXPECTED_ARTWORK_COUNT);
  assert.deepEqual(destinationFiles, sourceFiles);

  for (const filename of sourceFiles) {
    const source = await readFile(resolve(SOURCE_DIRECTORY, filename));
    const destination = await readFile(
      resolve(DESTINATION_DIRECTORY, filename),
    );
    const sourceDigest = createHash("sha256").update(source).digest("hex");
    const destinationDigest = createHash("sha256")
      .update(destination)
      .digest("hex");

    assert.equal(
      destinationDigest,
      sourceDigest,
      `${filename} differs from its canonical source`,
    );
  }
});
