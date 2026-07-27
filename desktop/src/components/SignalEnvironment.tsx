"use client";

// Renders a public-source-safe desktop atmosphere without private effect packages.

import { useEffect } from "react";
import type { CSSProperties, ReactElement } from "react";

// Provides deterministic terminal glyph columns without runtime randomization.
const TERMINAL_STREAMS = [
  "FRAME", "SHIFT", "01", "PERSONA", "SYNC", "LOCAL", "AGENT", "MODE",
  "101", "CREW", "SIGNAL", "READY", "010", "BUILD", "GROW", "RUN",
] as const;

// Renders one persistent decorative atmosphere below every desktop route.
export function SignalEnvironment(): ReactElement {
  // Mirrors motion preference and visibility into the root renderer state.
  useEffect(() => {
    const root = document.documentElement;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    // Applies the exact state used by CSS and browser-level regression tests.
    const syncRendererState = (): void => {
      root.dataset.signalRenderer = motionQuery.matches
        ? "static"
        : document.hidden
          ? "paused"
          : "css";
    };

    syncRendererState();
    document.addEventListener("visibilitychange", syncRendererState);
    motionQuery.addEventListener("change", syncRendererState);
    return () => {
      document.removeEventListener("visibilitychange", syncRendererState);
      motionQuery.removeEventListener("change", syncRendererState);
      root.dataset.signalRenderer = "static";
    };
  }, []);

  return (
    <div className="desktop-signal-environment" aria-hidden="true">
      <div className="signal-neon-scene">
        <span className="signal-neon-sun" />
        <span className="signal-neon-grid" />
      </div>
      <div className="signal-aurora-scene">
        <span className="signal-aurora signal-aurora-one" />
        <span className="signal-aurora signal-aurora-two" />
        <span className="signal-aurora signal-aurora-three" />
      </div>
      <div className="signal-terminal-scene">
        {TERMINAL_STREAMS.map((glyphs, index) => (
          <span key={`${glyphs}-${index}`} style={{ "--stream": index } as CSSProperties}>
            {glyphs}
          </span>
        ))}
      </div>
      <div className="signal-redshift-scene">
        <span className="signal-redshift-halo" />
        <span className="signal-redshift-stars" />
      </div>
      <div className="signal-grain" />
    </div>
  );
}
