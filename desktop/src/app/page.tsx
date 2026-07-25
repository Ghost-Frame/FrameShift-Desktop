"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listPersonas, activePersona, getGrowth } from "@/lib/tauri";
import type { PersonaSummary, GrowthReport } from "@/lib/mock-data";
import { toErrorMessage } from "@/lib/errors";
import { cardArtUrl } from "@/lib/card-art";

// Renders locally bundled artwork for the active persona with a text fallback.
function ActivePersonaArtwork({ name }: { name: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="dashboard-persona-art">
      <span aria-hidden="true">{name.slice(0, 2).toUpperCase()}</span>
      {!failed ? (
        <img
          src={cardArtUrl(name)}
          alt={`${name} persona artwork`}
          onError={() => setFailed(true)}
        />
      ) : null}
    </div>
  );
}

// Renders the dashboard summary for the active desktop workspace persona.
export default function DashboardPage() {
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [growth, setGrowth] = useState<GrowthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    // Loads the dashboard snapshot and converts backend failures into recovery UI.
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [p, a] = await Promise.all([listPersonas(), activePersona()]);
        setPersonas(p);
        setActive(a);
        if (a) {
          const g = await getGrowth(a);
          setGrowth(g);
        }
      } catch (err) {
        setError(
          toErrorMessage(err, "Failed to load this project's dashboard."),
        );
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [reload]);

  const activePersonaData = personas.find((p) => p.name === active);

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Dashboard</h1>
        </div>
        <div className="card-meta">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Dashboard</h1>
          <div className="page-subtitle">
            FrameShift could not read this project.
          </div>
        </div>
        <div className="status-panel status-panel-error" role="alert">
          <strong>Dashboard unavailable</strong>
          <span>{error}</span>
          <button
            className="btn"
            onClick={() => setReload((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Project command center</div>
          <h1 className="page-title">Dashboard</h1>
          <div className="page-subtitle">
            Your active specialist, project signal, and recent activity.
          </div>
        </div>
        <div className="page-header-status">
          <span aria-hidden="true" />
          Runtime ready
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-card-index">01</span>
          <div>
            <div className="stat-label">Installed Personas</div>
            <div className="stat-value">{personas.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-card-index">02</span>
          <div>
            <div className="stat-label">Active Persona</div>
            <div className="stat-value stat-value-name">{active ?? "none"}</div>
          </div>
        </div>
        {growth && (
          <div className="stat-card">
            <span className="stat-card-index">03</span>
            <div>
              <div className="stat-label">Growth Entries</div>
              <div className="stat-value">{growth.total_sessions}</div>
            </div>
          </div>
        )}
        {/* Tokens Processed is only shown once the engine actually aggregates it;
            the current backend returns 0, so the card stays hidden rather than
            advertising an empty metric. */}
        {growth && growth.total_tokens_processed > 0 && (
          <div className="stat-card">
            <span className="stat-card-index">04</span>
            <div>
              <div className="stat-label">Tokens Processed</div>
              <div className="stat-value stat-value-name">
                {(growth.total_tokens_processed / 1_000_000).toFixed(2)}M
              </div>
            </div>
          </div>
        )}
      </div>

      {personas.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">
            No personas installed for this project
          </div>
          <p>
            Install at least one persona, connect your agent to FrameShift, then
            activate a persona manually or configure Automate in Settings.
          </p>
          <Link href="/marketplace" className="btn btn-primary">
            Browse personas
          </Link>
        </div>
      ) : !activePersonaData ? (
        <div className="empty-state">
          <div className="empty-state-title">Choose an active persona</div>
          <p>
            Your installed personas are ready. Activate one manually, or enable
            Automate and have your connected agent invoke it for each task. The
            daemon can also run selection for you.
          </p>
          <Link href="/personas" className="btn btn-primary">
            Choose persona
          </Link>
        </div>
      ) : null}

      {/* Active persona detail */}
      {activePersonaData && (
        <section className="dashboard-section active-persona-section">
          <div className="dashboard-section-heading">
            <div>
              <span>Current operator</span>
              <h2>Active persona</h2>
            </div>
            <Link
              href={`/personas/detail?name=${encodeURIComponent(activePersonaData.name)}`}
              className="btn btn-sm"
            >
              View detail <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className={`persona-card is-active`}>
            <ActivePersonaArtwork name={activePersonaData.name} />
            <div className="dashboard-persona-copy">
              <div className="persona-card-header">
                <div>
                  <div className="persona-name">{activePersonaData.name}</div>
                  <div className="persona-version">
                    Version {activePersonaData.version}
                  </div>
                </div>
                <span className="badge badge-active">active</span>
              </div>
              <div className="persona-description">
                {activePersonaData.description}
              </div>
              <div className="persona-caps">
                {activePersonaData.capabilities.map((cap) => (
                  <span key={cap} className="persona-cap-tag">
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Capability scores */}
      {growth && growth.capability_scores.length > 0 && (
        <section className="dashboard-section">
          <div className="dashboard-section-heading">
            <div>
              <span>Performance model</span>
              <h2>Capability scores</h2>
            </div>
          </div>
          <div className="card">
            <div className="cap-score-list">
              {growth.capability_scores.map((cs) => (
                <div key={cs.capability} className="cap-score-row">
                  <div className="cap-score-header">
                    <span className="cap-score-name">{cs.capability}</span>
                    <span className="cap-score-value">
                      {(cs.score * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="progress-bar-track">
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${cs.score * 100}%` }}
                    />
                  </div>
                  <div className="stat-delta">
                    <span
                      className={
                        cs.delta_7d >= 0 ? "stat-delta-pos" : "stat-delta-neg"
                      }
                    >
                      {cs.delta_7d >= 0 ? "+" : ""}
                      {(cs.delta_7d * 100).toFixed(1)}% 7d
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Recent growth log */}
      {growth && growth.log.length > 0 && (
        <section className="dashboard-section">
          <div className="dashboard-section-heading">
            <div>
              <span>Project telemetry</span>
              <h2>Recent activity</h2>
            </div>
          </div>
          <div className="growth-log">
            {growth.log.slice(0, 5).map((entry, i) => (
              <div key={i} className="growth-log-entry">
                <span className="growth-log-time">
                  {new Date(entry.timestamp).toLocaleDateString()}
                </span>
                <span className="growth-log-event">{entry.event}</span>
                {/* The engine does not emit per-entry deltas yet (always 0), so
                    only render a delta badge when a real non-zero value exists. */}
                {entry.delta !== 0 && (
                  <span
                    className={`growth-log-delta ${entry.delta > 0 ? "stat-delta-pos" : "stat-delta-neg"}`}
                  >
                    {entry.delta > 0 ? "+" : ""}
                    {(entry.delta * 100).toFixed(1)}%
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
