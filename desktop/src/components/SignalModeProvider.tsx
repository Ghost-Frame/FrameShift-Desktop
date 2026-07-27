"use client";

// Owns persistent Signal Mode state for the complete desktop document.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_SIGNAL_MODE,
  SIGNAL_MODE_STORAGE_KEY,
  isSignalMode,
  readDocumentSignalMode,
} from "@/lib/signal-modes";
import type { SignalMode } from "@/lib/signal-modes";

// Defines the validated Signal Mode state available to desktop controls.
interface SignalModeContextValue {
  mode: SignalMode;
  setMode: (mode: SignalMode) => void;
  ready: boolean;
}

// Carries the active atmosphere through the persistent desktop shell.
const SignalModeContext = createContext<SignalModeContextValue | null>(null);

// Owns mode state while mirroring it to the document and versioned browser storage.
export function SignalModeProvider({ children }: { children: ReactNode }) {
  const [mode, updateMode] = useState<SignalMode>(DEFAULT_SIGNAL_MODE);
  const [ready, setReady] = useState(false);

  // Hydrates React from the value applied by the before-hydration bootstrap.
  useEffect(() => {
    updateMode(readDocumentSignalMode());
    setReady(true);
  }, []);

  // Applies one validated mode immediately and persists it when storage is available.
  const setMode = useCallback((nextMode: SignalMode): void => {
    if (!isSignalMode(nextMode)) {
      return;
    }
    document.documentElement.dataset.signalMode = nextMode;
    updateMode(nextMode);
    try {
      window.localStorage.setItem(SIGNAL_MODE_STORAGE_KEY, nextMode);
    } catch {
      // The active document state remains usable when storage is restricted.
    }
  }, []);

  // Stabilizes the context object so unrelated shell renders do not notify consumers.
  const value = useMemo(
    () => ({ mode, setMode, ready }),
    [mode, ready, setMode],
  );

  return (
    <SignalModeContext.Provider value={value}>
      {children}
    </SignalModeContext.Provider>
  );
}

// Returns the active desktop atmosphere and rejects use outside the root provider.
export function useSignalMode(): SignalModeContextValue {
  const context = useContext(SignalModeContext);
  if (!context) {
    throw new Error("useSignalMode must be used within SignalModeProvider");
  }
  return context;
}
