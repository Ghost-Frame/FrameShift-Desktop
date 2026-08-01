//! Native registry catalog access for the desktop marketplace.

use frameshift_client::{RegistrySearchQuery, RegistrySearchResult};
use serde::Serialize;

use crate::project::make_client;

/// Maximum catalog page size accepted by the production registry.
const MARKETPLACE_RESULT_LIMIT: u32 = 200;

/// Hard ceiling that converts broken registry pagination into a clear error.
const MAX_MARKETPLACE_PAGES: u32 = 1000;

/// Registry pack fields rendered by the desktop marketplace.
#[derive(Debug, Serialize)]
pub struct MarketplacePack {
    /// Unique registry pack name.
    name: String,
    /// Technical signing key retained for compatibility identity resolution.
    current_author: String,
    /// Preferred person-facing registry author identity when available.
    author: Option<MarketplaceAuthor>,
    /// Search and discovery tags assigned to the pack.
    tags: Vec<String>,
    /// Human-readable pack summary.
    description: String,
    /// Most recent published version, when one exists.
    latest_version: Option<String>,
    /// Cumulative registry downloads across every version.
    total_downloads: u64,
}

/// Person-facing registry identity serialized for the desktop WebView.
#[derive(Debug, Serialize)]
pub struct MarketplaceAuthor {
    /// Public publisher or legacy author handle.
    handle: String,
    /// Human-readable publisher or legacy author name.
    display_name: String,
}

/// Fetches registry pages until an empty page and maps them for the WebView.
fn load_marketplace_pages<F>(mut fetch_page: F) -> Result<Vec<MarketplacePack>, String>
where
    F: FnMut(&RegistrySearchQuery) -> Result<Vec<RegistrySearchResult>, String>,
{
    let mut packs = Vec::new();
    let mut offset = 0_u32;

    for _ in 0..MAX_MARKETPLACE_PAGES {
        let query = RegistrySearchQuery {
            limit: Some(MARKETPLACE_RESULT_LIMIT),
            offset: Some(offset),
            ..RegistrySearchQuery::default()
        };
        let results = fetch_page(&query)?;
        if results.is_empty() {
            return Ok(packs);
        }
        let result_count = u32::try_from(results.len()).map_err(|_| {
            "Registry returned too many marketplace results in one page.".to_string()
        })?;
        offset = offset
            .checked_add(result_count)
            .ok_or_else(|| "Registry marketplace offset overflowed.".to_string())?;
        packs.extend(results.into_iter().map(|result| {
            let author = result
                .publisher
                .map(|publisher| MarketplaceAuthor {
                    handle: publisher.handle,
                    display_name: publisher.display_name,
                })
                .or_else(|| {
                    result.legacy_author.map(|legacy_author| MarketplaceAuthor {
                        display_name: legacy_author
                            .display_name
                            .unwrap_or_else(|| legacy_author.handle.clone()),
                        handle: legacy_author.handle,
                    })
                });
            let pack = result.pack;
            MarketplacePack {
                name: pack.name,
                current_author: pack.current_author,
                author,
                tags: pack.tags,
                description: pack.description,
                latest_version: pack.latest_version,
                total_downloads: pack.total_downloads,
            }
        }));
    }

    Err(format!(
        "Registry marketplace exceeded {MAX_MARKETPLACE_PAGES} pages without an empty response."
    ))
}

/// Loads the registry catalog outside the WebView so browser CORS does not
/// block packaged desktop builds.
#[tauri::command]
pub fn list_marketplace_packs() -> Result<Vec<MarketplacePack>, String> {
    let client = make_client()?;
    load_marketplace_pages(|query| {
        client
            .search_registry(query)
            .map_err(|error| error.to_string())
    })
}

/// Tests native pagination without depending on a live registry.
#[cfg(test)]
mod tests {
    use frameshift_client::{
        RegistryLegacyAuthorSummary, RegistryPackSummary, RegistryPublisherSummary,
    };

    use super::*;

    /// Creates one minimal registry result for pagination fixtures.
    fn result(name: &str) -> RegistrySearchResult {
        RegistrySearchResult {
            pack: RegistryPackSummary {
                name: name.to_string(),
                current_author: "fixture-author".to_string(),
                description: format!("{name} description"),
                tags: vec!["test".to_string()],
                latest_version: Some("1.0.0".to_string()),
                total_downloads: 1,
            },
            score: 1.0,
            publisher: None,
            legacy_author: None,
        }
    }

    /// Advances offsets by actual page length until an empty page terminates loading.
    #[test]
    fn loads_every_marketplace_page_without_assuming_server_page_size() {
        let mut offsets = Vec::new();
        let packs = load_marketplace_pages(|query| {
            let offset = query.offset.expect("pagination offset");
            offsets.push(offset);
            Ok(match offset {
                0 => vec![result("alpha"), result("beta")],
                2 => vec![result("gamma")],
                _ => Vec::new(),
            })
        })
        .expect("load pages");

        assert_eq!(offsets, vec![0, 2, 3]);
        assert_eq!(
            packs
                .iter()
                .map(|pack| pack.name.as_str())
                .collect::<Vec<_>>(),
            vec!["alpha", "beta", "gamma"]
        );
    }

    /// Preserves preferred publisher identity when mapping native search results.
    #[test]
    fn maps_preferred_author_identity_for_the_webview() {
        let mut served = false;
        let packs = load_marketplace_pages(|_| {
            if served {
                return Ok(Vec::new());
            }
            served = true;
            let mut fixture = result("publisher-pack");
            fixture.publisher = Some(RegistryPublisherSummary {
                id: "publisher-id".to_string(),
                handle: "zan".to_string(),
                display_name: "Zan".to_string(),
            });
            fixture.legacy_author = Some(RegistryLegacyAuthorSummary {
                handle: "seed-author".to_string(),
                display_name: Some("Seed Author".to_string()),
            });
            Ok(vec![fixture])
        })
        .expect("map publisher fixture");

        let author = packs[0].author.as_ref().expect("mapped author");
        assert_eq!(author.handle, "zan");
        assert_eq!(author.display_name, "Zan");
        assert_eq!(packs[0].current_author, "fixture-author");
    }
}
