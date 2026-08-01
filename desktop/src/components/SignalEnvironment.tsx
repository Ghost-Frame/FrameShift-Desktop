"use client";

// Renders the public-source-safe desktop atmosphere without private effect packages.

import { useEffect } from "react";
import type { ReactElement } from "react";

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
      <div className="signal-ambient-scene">
        <span className="signal-ambient-halo" />
        <span className="signal-star-field signal-star-field-far" />
        <span className="signal-star-field signal-star-field-near" />
        <span className="signal-ambient-particles" />
      </div>
      <div className="signal-grain" />
    </div>
  );
}
