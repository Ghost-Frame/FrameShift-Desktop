"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { installPersona, listPersonas } from "@/lib/tauri";
import { listMarketplacePacks, type PackRecord } from "@/lib/api";
import { cardArtUrl } from "@/lib/card-art";
import { toErrorMessage } from "@/lib/errors";
import { resolveMarketplaceAuthor } from "@/lib/author-identity";

// Defines the registry identity consumed by a marketplace card artwork panel.
interface MarketplaceArtworkProps {
  name: string;
}

// Renders locally bundled persona artwork with a readable future-pack fallback.
function MarketplaceArtwork({ name }: MarketplaceArtworkProps) {
  const [failed, setFailed] = useState(false);
  const fallbackLabel = name.slice(0, 2).toUpperCase();

  return (
    <div className="marketplace-card-art">
      <div className="marketplace-card-art-fallback" aria-hidden="true">
        {fallbackLabel}
      </div>
      {!failed && (
        <img
          className="marketplace-card-art-image"
          src={cardArtUrl(name)}
          alt={`${name} persona artwork`}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

// Renders the live registry catalog and installs selected personas.
export default function MarketplacePage() {
  const [packs, setPacks] = useState<PackRecord[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [installedMessage, setInstalledMessage] = useState<string | null>(null);

  // Loads the catalog and marks personas already installed in this project.
  const loadMarketplace = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [catalogResult, personasResult] = await Promise.allSettled([
      listMarketplacePacks(),
      listPersonas(),
    ]);
    if (catalogResult.status === "rejected") {
      setError(
        toErrorMessage(
          catalogResult.reason,
          "Failed to load the marketplace.",
        ),
      );
      setLoading(false);
      return;
    }

    setPacks(catalogResult.value);
    if (personasResult.status === "fulfilled") {
      setInstalled(new Set(personasResult.value.map((persona) => persona.name)));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadMarketplace();
  }, [loadMarketplace]);

  const filtered = useMemo(
    () =>
      packs.filter(
        (pack) =>
          pack.name.includes(search.toLowerCase()) ||
          pack.description.toLowerCase().includes(search.toLowerCase()) ||
          pack.tags.some((tag) => tag.includes(search.toLowerCase())),
      ),
    [packs, search],
  );

  // Installs one registry persona and reflects its completed state in the card.
  async function handleInstall(name: string, version: string) {
    setInstalling(name);
    setError(null);
    setInstalledMessage(null);
    try {
      await installPersona(name, version);
      setInstalled((prev) => new Set(prev).add(name));
      setInstalledMessage(
        `${name} v${version} is installed. Activate it in Personas, or install more and configure Automate in Settings.`,
      );
    } catch (err) {
      setError(toErrorMessage(err, `Failed to install ${name}.`));
    } finally {
      setInstalling(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Marketplace</h1>
        <div className="page-subtitle">
          Browse and install community personas
        </div>
      </div>

      <div style={{ marginBottom: "1.5rem" }}>
        <label className="field-label" htmlFor="marketplace-search">
          Search personas
        </label>
        <input
          id="marketplace-search"
          type="text"
          placeholder="Search personas..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            maxWidth: "400px",
            padding: "0.5rem 0.75rem",
            background: "var(--sa-surface)",
            border: "1px solid var(--sa-border)",
            borderRadius: "6px",
            color: "var(--sa-text)",
            fontFamily: "inherit",
            fontSize: "0.82rem",
            outline: "none",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--sa-accent)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--sa-border)";
          }}
        />
      </div>

      {error ? (
        <div
          className="status-panel status-panel-error page-status"
          role="alert"
        >
          <strong>Marketplace action failed</strong>
          <span>{error}</span>
          {packs.length === 0 && !loading ? (
            <button
              className="btn"
              type="button"
              onClick={() => void loadMarketplace()}
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
      {installedMessage ? (
        <div
          className="status-panel status-panel-success page-status"
          role="status"
        >
          {installedMessage}
        </div>
      ) : null}

      {loading ? (
        <div className="card-meta">Loading marketplace...</div>
      ) : error && packs.length === 0 ? null : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">
            {search
              ? "No personas match that search"
              : "No personas are published yet"}
          </div>
          <p>
            {search
              ? "Try a shorter name, capability, or tag."
              : "Check again later."}
          </p>
        </div>
      ) : (
        <div className="marketplace-grid">
          {filtered.map((pack) => {
            const isInstalled = installed.has(pack.name);
            const isInstalling = installing === pack.name;
            const version = pack.latest_version;
            const author = resolveMarketplaceAuthor(pack);
            return (
              <div key={pack.name} className="marketplace-card">
                <MarketplaceArtwork name={pack.name} />

                <div className="marketplace-card-body">
                  <div>
                    <div className="marketplace-card-name">{pack.name}</div>
                    <div className="marketplace-card-meta">
                      <span>author {author.displayName}</span>
                      <span>{version ? `v${version}` : "not published"}</span>
                      <span>
                        {pack.total_downloads.toLocaleString()} installs
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      fontSize: "0.78rem",
                      color: "var(--sa-text)",
                      lineHeight: 1.5,
                    }}
                  >
                    {pack.description}
                  </div>

                  <div className="marketplace-tags">
                    {pack.tags.map((tag) => (
                      <span key={tag} className="marketplace-tag">
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div style={{ marginTop: "auto" }}>
                    {isInstalled ? (
                      <span className="badge badge-active">installed</span>
                    ) : version ? (
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => handleInstall(pack.name, version)}
                        disabled={isInstalling}
                      >
                        {isInstalling ? "Installing..." : "Install"}
                      </button>
                    ) : (
                      <span className="badge">no published release</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
