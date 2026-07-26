// Live marketplace API client for the desktop app.

import { isTauri } from "./is-tauri";

// Base URL for the hosted Frameshift catalog API.
const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://frameshift-api.syntheos.dev/v1";

// Search response shape returned by GET /v1/packs.
interface PackSearchResponse {
  results: Array<{
    pack: PackRecord;
    score: number;
    publisher?: PublisherSummary;
    legacy_author?: LegacyAuthorSummary;
  }>;
}

// Account-backed publisher identity returned by ownership-aware registries.
interface PublisherSummary {
  id: string;
  handle: string;
  display_name: string;
}

// Named legacy author returned during the registry compatibility window.
interface LegacyAuthorSummary {
  handle: string;
  display_name: string | null;
}

// Person-facing author data passed to the desktop marketplace WebView.
export interface MarketplaceAuthor {
  handle: string;
  display_name: string;
}

// Pack record returned by the marketplace API.
export interface PackRecord {
  name: string;
  current_author?: string;
  author?: MarketplaceAuthor;
  tags: string[];
  description: string;
  latest_version: string | null;
  total_downloads: number;
}

// Fetches a JSON payload from the Frameshift API.
async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`API error ${response.status} for ${path}`);
  }
  return response.json() as Promise<T>;
}

// Server clamps `limit` to `config.max_search_limit` (200 by default); a single
// request for more than that is silently clamped down, so page size must match
// the server's cap rather than assume one request returns the whole catalog.
const PAGE_LIMIT = 200;

// Prevents a broken registry from creating an unbounded pagination loop.
const MAX_CATALOG_PAGES = 1000;

// Reads the full pack catalog for desktop browsing, paginating past the
// server's per-request cap so a catalog larger than one page is never
// silently truncated.
export async function listMarketplacePacks(): Promise<PackRecord[]> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<PackRecord[]>("list_marketplace_packs");
  }

  const packs: PackRecord[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_CATALOG_PAGES; page++) {
    const query = new URLSearchParams({ limit: String(PAGE_LIMIT), offset: String(offset) });
    const payload = await apiFetch<PackSearchResponse>(`/packs?${query.toString()}`);
    if (payload.results.length === 0) {
      return packs;
    }
    packs.push(
      ...payload.results.map((result) => {
        const identity = result.publisher ?? result.legacy_author;
        return {
          ...result.pack,
          author: identity
            ? {
                handle: identity.handle,
                display_name: identity.display_name ?? identity.handle,
              }
            : result.pack.author,
        };
      }),
    );
    offset += payload.results.length;
  }

  throw new Error(`listMarketplacePacks: exceeded ${MAX_CATALOG_PAGES} pages`);
}
