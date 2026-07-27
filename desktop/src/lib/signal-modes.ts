// Defines the public Signal Mode contract shared by desktop storage and controls.

// Names every atmosphere accepted by desktop state, storage, and CSS.
export type SignalMode =
  | "neon-grid"
  | "aurora-drift"
  | "terminal-rain"
  | "redshift";

// Describes one selectable desktop atmosphere.
export interface SignalModeDefinition {
  id: SignalMode;
  label: string;
  description: string;
}

// Names the versioned preference shared with the FrameShift website.
export const SIGNAL_MODE_STORAGE_KEY = "frameshift:signal-mode:v1";

// Provides the deterministic first-run atmosphere.
export const DEFAULT_SIGNAL_MODE: SignalMode = "neon-grid";

// Defines the complete ordered selector catalog.
export const SIGNAL_MODES: readonly SignalModeDefinition[] = [
  {
    id: "neon-grid",
    label: "Neon Grid",
    description: "Synthwave horizon and precise cyan grid.",
  },
  {
    id: "aurora-drift",
    label: "Aurora Drift",
    description: "Soft violet and magenta atmospheric clouds.",
  },
  {
    id: "terminal-rain",
    label: "Terminal Rain",
    description: "Emerald signal rain behind cyan controls.",
  },
  {
    id: "redshift",
    label: "Redshift",
    description: "Dark starfield with red and restrained gold light.",
  },
];

// Narrows untrusted storage and document values to the approved mode union.
export function isSignalMode(value: unknown): value is SignalMode {
  return SIGNAL_MODES.some((mode) => mode.id === value);
}

// Resolves the definition that owns one validated mode.
export function getSignalModeDefinition(
  mode: SignalMode,
): SignalModeDefinition {
  return SIGNAL_MODES.find((candidate) => candidate.id === mode) ?? SIGNAL_MODES[0]!;
}

// Reads the bootstrapped document mode without trusting its string value.
export function readDocumentSignalMode(): SignalMode {
  const value = document.documentElement.dataset.signalMode;
  return isSignalMode(value) ? value : DEFAULT_SIGNAL_MODE;
}
