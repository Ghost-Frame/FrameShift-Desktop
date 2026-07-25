"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { listPersonas, activatePersona, getGrowth } from "@/lib/tauri";
import type { PersonaSummary, GrowthReport } from "@/lib/mock-data";
import { formatDate } from "@/lib/format";
import { toErrorMessage } from "@/lib/errors";

// Loads and renders the static-export-safe persona detail view from `?name=`.
function PersonaDetail() {
  const params = useSearchParams();
  const name = params.get("name") ?? "";

  const [persona, setPersona] = useState<PersonaSummary | null>(null);
  const [growth, setGrowth] = useState<GrowthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!name) {
      setLoading(false);
      return;
    }

    // Loads the installed persona list and the growth log together for detail view rendering.
    async function load() {
      setError(null);
      try {
        const [personas, g] = await Promise.all([
          listPersonas(),
          getGrowth(name),
        ]);
        setPersona(personas.find((p) => p.name === name) ?? null);
        setGrowth(g);
      } catch (err) {
        setError(toErrorMessage(err, `Failed to load ${name}.`));
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [name]);

  // Activates the current persona in the selected desktop project.
  async function handleActivate() {
    if (!persona) {
      return;
    }
    setActivating(true);
    setError(null);
    try {
      await activatePersona(persona.name);
      setPersona((prev) => (prev ? { ...prev, active: true } : prev));
    } catch (err) {
      setError(toErrorMessage(err, `Failed to activate ${persona.name}.`));
    } finally {
      setActivating(false);
    }
  }

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">{name}</h1>
        </div>
        <div className="card-meta">Loading...</div>
      </div>
    );
  }

  if (!persona) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Not Found</h1>
        </div>
        {error ? (
          <div className="status-panel status-panel-error" role="alert">
            {error}
          </div>
        ) : (
          <div className="card-meta">
            Persona &quot;{name}&quot; is not installed.
          </div>
        )}
        <Link href="/personas" className="btn" style={{ marginTop: "1rem" }}>
          Back to Personas
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "1rem",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                marginBottom: "0.25rem",
              }}
            >
              <Link
                href="/personas"
                className="card-meta"
                style={{ textDecoration: "none" }}
              >
                Personas
              </Link>
              <span className="card-meta">/</span>
              <h1 className="page-title">{persona.name}</h1>
              {persona.active && (
                <span className="badge badge-active">active</span>
              )}
            </div>
            <div className="page-subtitle">
              v{persona.version} -- installed {formatDate(persona.installed_at)}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {!persona.active && (
              <button
                className="btn btn-primary"
                onClick={handleActivate}
                disabled={activating}
              >
                {activating ? "Activating..." : "Activate"}
              </button>
            )}
          </div>
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

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div className="card-title">Description</div>
        <div
          style={{
            fontSize: "0.82rem",
            color: "var(--sa-text)",
            lineHeight: 1.6,
          }}
        >
          {persona.description ||
            "No local description. Browse the marketplace for full details."}
        </div>
      </div>

      {persona.capabilities.length > 0 && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <div className="card-title">Capabilities</div>
          <div className="persona-caps" style={{ marginTop: "0.5rem" }}>
            {persona.capabilities.map((cap) => (
              <span key={cap} className="badge badge-accent">
                {cap}
              </span>
            ))}
          </div>
        </div>
      )}

      {growth && (
        <>
          <div className="stat-grid" style={{ marginBottom: "1.5rem" }}>
            <div className="stat-card">
              <div className="stat-label">Growth Entries</div>
              <div className="stat-value">{growth.total_sessions}</div>
            </div>
          </div>

          {growth.log.length > 0 && (
            <div>
              <div
                className="page-subtitle"
                style={{
                  fontSize: "0.72rem",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  marginBottom: "0.75rem",
                }}
              >
                Growth Log
              </div>
              <div className="growth-log">
                {growth.log.map((entry, i) => (
                  <div key={i} className="growth-log-entry">
                    <span className="growth-log-time">
                      {formatDate(entry.timestamp)}
                    </span>
                    <span className="growth-log-event">{entry.event}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Suspense wrapper required for useSearchParams under static export.
export default function PersonaDetailPage() {
  return (
    <Suspense fallback={<div className="card-meta">Loading...</div>}>
      <PersonaDetail />
    </Suspense>
  );
}
