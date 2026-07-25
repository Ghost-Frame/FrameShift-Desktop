"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listPersonas, activatePersona } from "@/lib/tauri";
import type { PersonaSummary } from "@/lib/mock-data";
import { formatDate } from "@/lib/format";
import { toErrorMessage } from "@/lib/errors";

// Renders the installed persona catalog and activation controls.
export default function PersonasPage() {
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPersonas()
      .then(setPersonas)
      .catch((loadError) => {
        setError(
          toErrorMessage(loadError, "Failed to load installed personas."),
        );
      })
      .finally(() => setLoading(false));
  }, []);

  // Activates one persona and updates the local catalog state after success.
  async function handleActivate(name: string) {
    setActivating(name);
    setError(null);
    try {
      await activatePersona(name);
      setPersonas((prev) =>
        prev.map((p) => ({ ...p, active: p.name === name })),
      );
    } catch (err) {
      setError(toErrorMessage(err, `Failed to activate ${name}.`));
    } finally {
      setActivating(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h1 className="page-title">Personas</h1>
            <div className="page-subtitle">
              {personas.length} installed -- click a persona to view details
            </div>
          </div>
          <Link href="/marketplace" className="btn btn-primary btn-sm">
            Browse Marketplace
          </Link>
        </div>
      </div>

      {error ? (
        <div
          className="status-panel status-panel-error page-status"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="card-meta">Loading personas...</div>
      ) : personas.length === 0 && !error ? (
        <div className="empty-state">
          <div className="empty-state-title">No personas installed yet</div>
          <p>
            Install one from the marketplace to start shaping this project's
            agent.
          </p>
          <Link href="/marketplace" className="btn btn-primary">
            Browse marketplace
          </Link>
        </div>
      ) : (
        <div className="persona-grid">
          {personas.map((persona) => (
            <div
              key={persona.name}
              className={`persona-card${persona.active ? " is-active" : ""}`}
            >
              <div className="persona-card-header">
                <div>
                  <div className="persona-name">{persona.name}</div>
                  <div className="persona-version">v{persona.version}</div>
                </div>
                {persona.active ? (
                  <span className="badge badge-active">active</span>
                ) : null}
              </div>

              <div className="persona-description">{persona.description}</div>

              <div className="persona-caps">
                {persona.capabilities.map((cap) => (
                  <span key={cap} className="persona-cap-tag">
                    {cap}
                  </span>
                ))}
              </div>

              <div className="persona-card-footer">
                <span className="card-meta">
                  Installed {formatDate(persona.installed_at)}
                </span>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <Link
                    href={`/personas/detail?name=${encodeURIComponent(persona.name)}`}
                    className="btn btn-sm"
                  >
                    Details
                  </Link>
                  {!persona.active && (
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => handleActivate(persona.name)}
                      disabled={activating === persona.name}
                    >
                      {activating === persona.name
                        ? "Activating..."
                        : "Activate"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
