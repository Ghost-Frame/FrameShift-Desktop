// Resolves desktop marketplace persona names to locally bundled card artwork.

const CARD_ART_BASE_PATH = "/cards/generated";

// Returns the local WebP path for a registry persona name.
export function cardArtUrl(name: string): string {
  return `${CARD_ART_BASE_PATH}/${encodeURIComponent(name)}.webp`;
}
