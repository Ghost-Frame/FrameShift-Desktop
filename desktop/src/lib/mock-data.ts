// Mock data used as fallback when not running in Tauri context (browser dev mode)

// Describes one installed persona in the browser-development fallback.
export interface PersonaSummary {
  name: string;
  description: string;
  version: string;
  active: boolean;
  capabilities: string[];
  installed_at: string;
}

// Describes one mock capability score and its seven-day change.
export interface CapabilityScore {
  capability: string;
  score: number;
  delta_7d: number;
}

// Describes one chronological mock growth-log event.
export interface GrowthEntry {
  timestamp: string;
  event: string;
  delta: number;
}

// Describes the complete mock growth report shown outside Tauri.
export interface GrowthReport {
  persona: string;
  total_sessions: number;
  total_tokens_processed: number;
  capability_scores: CapabilityScore[];
  log: GrowthEntry[];
}

export const MOCK_PERSONAS: PersonaSummary[] = [
  {
    name: "security",
    description:
      "Security-focused persona with threat modeling and audit capabilities",
    version: "0.3.1",
    active: true,
    capabilities: ["threat-model", "audit", "vuln-scan"],
    installed_at: "2026-05-01T00:00:00Z",
  },
  {
    name: "cryptographic",
    description:
      "Cryptographic systems expert -- key management, protocol design",
    version: "0.2.0",
    active: false,
    capabilities: ["key-derivation", "protocol-review"],
    installed_at: "2026-05-05T00:00:00Z",
  },
  {
    name: "systems",
    description:
      "Low-level systems programming, kernel interfaces, memory safety",
    version: "0.4.2",
    active: false,
    capabilities: ["memory-analysis", "perf-profiling", "kernel-debug"],
    installed_at: "2026-04-20T00:00:00Z",
  },
  {
    name: "frontend",
    description: "Frontend engineering -- React, accessibility, performance",
    version: "0.1.8",
    active: false,
    capabilities: ["a11y-audit", "bundle-analysis"],
    installed_at: "2026-05-10T00:00:00Z",
  },
];

export const MOCK_ACTIVE_PERSONA = "security";

// Browser-dev fallback that mirrors what the real Tauri backend actually
// produces today (see src-tauri/src/commands/growth.rs): a growth LOG only.
// The engine slice does not yet compute aggregate token counts, capability
// scores, or per-entry deltas, so those are intentionally empty/zero here --
// the dev view must not advertise data the packaged app cannot show.
export function mockGrowthReport(name: string): GrowthReport {
  const log: GrowthEntry[] = [
    {
      timestamp: "2026-05-17T10:00:00Z",
      event: "session completed -- threat model review",
      delta: 0,
    },
    {
      timestamp: "2026-05-15T09:15:00Z",
      event: "session completed -- CVE analysis",
      delta: 0,
    },
  ];

  return {
    persona: name,
    total_sessions: log.length,
    total_tokens_processed: 0,
    capability_scores: [],
    log,
  };
}
