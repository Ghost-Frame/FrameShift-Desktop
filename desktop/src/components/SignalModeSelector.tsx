"use client";

// Presents the accessible desktop selector for the four approved Signal Modes.

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import { useSignalMode } from "@/components/SignalModeProvider";
import { SIGNAL_MODES, getSignalModeDefinition } from "@/lib/signal-modes";
import type { SignalMode } from "@/lib/signal-modes";

// Renders the global radio selector beside the persistent station controls.
export function SignalModeSelector(): ReactElement {
  const { mode, ready, setMode } = useSignalMode();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = getSignalModeDefinition(mode);

  // Closes the selector and returns keyboard focus to its trigger.
  const closeAndRestoreFocus = useCallback((): void => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Applies one validated option before closing the selector.
  const selectOption = useCallback(
    (nextMode: SignalMode): void => {
      setMode(nextMode);
      closeAndRestoreFocus();
    },
    [closeAndRestoreFocus, setMode],
  );

  // Moves option focus with wraparound while leaving selection explicit.
  const focusOption = useCallback((index: number): void => {
    const normalized = ((index % SIGNAL_MODES.length) + SIGNAL_MODES.length) % SIGNAL_MODES.length;
    optionRefs.current[normalized]?.focus();
  }, []);

  // Implements standard horizontal and vertical radio-group focus navigation.
  const handleOptionKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        focusOption(index + 1);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        focusOption(index - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusOption(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusOption(SIGNAL_MODES.length - 1);
      }
    },
    [focusOption],
  );

  // Focuses the selected radio as soon as the option surface opens.
  useEffect(() => {
    if (!open) {
      return;
    }
    const selectedIndex = SIGNAL_MODES.findIndex((candidate) => candidate.id === mode);
    const frame = window.requestAnimationFrame(() => focusOption(selectedIndex));
    return () => window.cancelAnimationFrame(frame);
  }, [focusOption, mode, open]);

  // Closes on outside activation or Escape without leaking document listeners.
  useEffect(() => {
    if (!open) {
      return;
    }

    // Closes only when the pointer target is outside the complete selector.
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    // Restores trigger focus when Escape dismisses the selector.
    const handleEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndRestoreFocus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [closeAndRestoreFocus, open]);

  return (
    <div className="desktop-signal-selector" ref={rootRef}>
      <span className="desktop-signal-label">Signal mode</span>
      <button
        ref={triggerRef}
        type="button"
        className="desktop-signal-trigger"
        aria-label={ready ? `Signal mode: ${selected.label}` : "Signal mode loading"}
        aria-expanded={open}
        aria-controls="desktop-signal-options"
        disabled={!ready}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="desktop-signal-trigger-swatch" data-mode={mode} aria-hidden="true" />
        <span>{ready ? selected.label : "Loading"}</span>
        <span aria-hidden="true">⌁</span>
      </button>

      {open && ready ? (
        <div
          id="desktop-signal-options"
          className="desktop-signal-options"
          role="radiogroup"
          aria-label="Signal mode"
        >
          {SIGNAL_MODES.map((definition, index) => (
            <button
              key={definition.id}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={mode === definition.id}
              tabIndex={mode === definition.id ? 0 : -1}
              aria-label={definition.label}
              className="desktop-signal-option"
              data-mode={definition.id}
              onClick={() => selectOption(definition.id)}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
            >
              <span className="desktop-signal-swatch" aria-hidden="true" />
              <span className="desktop-signal-option-copy">
                <strong>{definition.label}</strong>
                <small>{definition.description}</small>
              </span>
              <span className="desktop-signal-check" aria-hidden="true">
                {mode === definition.id ? "✓" : ""}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
