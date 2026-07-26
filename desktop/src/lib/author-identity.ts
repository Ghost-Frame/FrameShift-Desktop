// Resolves desktop marketplace ownership data into person-facing labels.

import type { PackRecord } from "./api";

// Signing keys used by the historical jobs that published Ghost Frame packs.
const GHOST_FRAME_SEED_KEYS = new Set([
  "dL2L4NKQp_1Z-CVt3jKp0JflooZhPHo_6SpeCt2iY_w",
  "KlKBZfMRQ5_RtJxPLf2QL4-PQ8l78X2suMVhZnfzT1Q",
  "IJxI8nxWh8iyPa8lCEouJa8gH_N68F7YlttjBvGJ0Hk",
]);

// Legacy handles assigned to the same operational publisher jobs.
const GHOST_FRAME_SEED_HANDLES = new Set([
  "seed-author",
  "seed-author-vps",
  "seed-author-metadata",
]);

// Visible author label consumed by a desktop marketplace card.
export interface MarketplaceAuthorLabel {
  handle: string | null;
  displayName: string;
}

// Resolves modern, legacy, and seed identities without displaying a raw key.
export function resolveMarketplaceAuthor(
  pack: Pick<PackRecord, "current_author" | "author">,
): MarketplaceAuthorLabel {
  if (
    pack.author &&
    !GHOST_FRAME_SEED_HANDLES.has(pack.author.handle)
  ) {
    return {
      handle: pack.author.handle,
      displayName: pack.author.display_name,
    };
  }

  if (
    (pack.current_author != null &&
      GHOST_FRAME_SEED_KEYS.has(pack.current_author)) ||
    (pack.author != null &&
      GHOST_FRAME_SEED_HANDLES.has(pack.author.handle))
  ) {
    return {
      handle: "ghost-frame",
      displayName: "Ghost Frame",
    };
  }

  if (pack.author) {
    return {
      handle: pack.author.handle,
      displayName: pack.author.display_name,
    };
  }

  return {
    handle: null,
    displayName: "Verified publisher",
  };
}
