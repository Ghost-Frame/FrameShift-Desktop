// Verifies desktop author labels never expose raw registry signing keys.

import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveMarketplaceAuthor } from "./author-identity";
import type { PackRecord } from "./api";

const SEED_KEY = "dL2L4NKQp_1Z-CVt3jKp0JflooZhPHo_6SpeCt2iY_w";

// Creates a minimal desktop pack around identity fields under test.
function pack(overrides: Partial<PackRecord> = {}): PackRecord {
  return {
    name: "identity-fixture",
    current_author: SEED_KEY,
    tags: [],
    description: "Identity fixture.",
    latest_version: "1.0.0",
    total_downloads: 1,
    ...overrides,
  };
}

// Legacy seed keys display the public Ghost Frame author identity.
test("maps a known seed signing key to Ghost Frame", () => {
  assert.deepEqual(resolveMarketplaceAuthor(pack()), {
    handle: "ghost-frame",
    displayName: "Ghost Frame",
  });
});

// Modern publisher attribution takes precedence over legacy compatibility data.
test("prefers a modern publisher identity supplied by the registry", () => {
  assert.deepEqual(
    resolveMarketplaceAuthor(
      pack({
        author: {
          handle: "zan",
          display_name: "Zan",
        },
      }),
    ),
    {
      handle: "zan",
      displayName: "Zan",
    },
  );
});

// Missing ownership metadata gets a neutral label rather than a key fragment.
test("hides an unknown raw key behind a verified publisher label", () => {
  assert.deepEqual(
    resolveMarketplaceAuthor(
      pack({
        current_author: "unrecognized-signing-key",
      }),
    ),
    {
      handle: null,
      displayName: "Verified publisher",
    },
  );
});
