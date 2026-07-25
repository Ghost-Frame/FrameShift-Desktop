"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { parseInstallDeepLink } from "@/lib/deep-link";
// Validated install request returned by the deep-link parser.
import type { DeepLinkInstallRequest } from "@/lib/deep-link";
import { installPersona } from "@/lib/tauri";
import { isTauri } from "@/lib/is-tauri";

// In-app status banner shown after an install attempt resolves.
type ToastState = { message: string; kind: "success" | "error" } | null;

// How long a status toast stays visible before it auto-dismisses.
const TOAST_DURATION_MS = 4000;

// Returns keyboard-focusable controls inside the install dialog.
function focusableControls(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

/**
 * Mounted once in the root layout. Listens for the `frameshift://install`
 * deep link across every delivery path Tauri v2 uses:
 *  - cold start: the URL is already in the process argv, read via `getCurrent()`
 *  - warm on macOS/mobile: the OS re-delivers the URL to the running process
 *    via the deep-link plugin's `onOpenUrl` event
 *  - warm on Windows/Linux: a second OS process is spawned instead, and the
 *    single-instance plugin (src-tauri/src/lib.rs) forwards that process's
 *    argv to us as a `single-instance` Tauri event
 * Every candidate URL runs through `parseInstallDeepLink`, which treats the
 * `pack`/`version` query params as untrusted and only returns a request once
 * both pass validation. A confirmation dialog is required before the
 * `install_persona` command ever runs.
 */
export function DeepLinkListener() {
  const [pending, setPending] = useState<DeepLinkInstallRequest | null>(null);
  const [installing, setInstalling] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const installingRef = useRef(false);

  // Parses a candidate URL and stages it for confirmation when it is a valid
  // install link. Anything else (a foreign scheme, a malformed query) is
  // silently ignored -- there is nothing safe to confirm.
  const handleCandidateUrl = useCallback((url: string) => {
    const request = parseInstallDeepLink(url);
    if (request && !installingRef.current) {
      setPending(request);
    }
  }, []);

  // Shows a status toast for `TOAST_DURATION_MS`, replacing any pending timer.
  const showToast = useCallback(
    (message: string, kind: "success" | "error") => {
      setToast({ message, kind });
      if (toastTimer.current) {
        clearTimeout(toastTimer.current);
      }
      toastTimer.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
    },
    [],
  );

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let unlistenOpenUrl: (() => void) | undefined;
    let unlistenSingleInstance: (() => void) | undefined;
    let cancelled = false;

    // Subscribes to every cold-start and warm-process deep-link delivery path.
    async function setup() {
      const { onOpenUrl, getCurrent } = await import(
        "@tauri-apps/plugin-deep-link"
      );
      const { listen } = await import("@tauri-apps/api/event");

      // Cold start: the launching URL is already in this process's argv.
      try {
        const initialUrls = await getCurrent();
        initialUrls?.forEach(handleCandidateUrl);
      } catch (error) {
        console.error("deep link getCurrent failed:", error);
      }

      if (cancelled) {
        return;
      }

      const stopOpenUrl = await onOpenUrl((urls) => {
        urls.forEach(handleCandidateUrl);
      });
      if (cancelled) {
        stopOpenUrl();
        return;
      }
      unlistenOpenUrl = stopOpenUrl;

      const stopSingleInstance = await listen<{ argv: string[]; cwd: string }>(
        "single-instance",
        (event) => {
          event.payload.argv.forEach(handleCandidateUrl);
        },
      );
      if (cancelled) {
        stopSingleInstance();
        return;
      }
      unlistenSingleInstance = stopSingleInstance;
    }

    void setup().catch((error) => {
      console.error("deep link setup failed:", error);
      if (!cancelled) {
        showToast("FrameShift could not start desktop link handling.", "error");
      }
    });

    return () => {
      cancelled = true;
      unlistenOpenUrl?.();
      unlistenSingleInstance?.();
      if (toastTimer.current) {
        clearTimeout(toastTimer.current);
      }
    };
  }, [handleCandidateUrl, showToast]);

  useEffect(() => {
    if (!pending) {
      return;
    }

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    cancelButtonRef.current?.focus();

    // Keeps keyboard navigation inside the modal and supports Escape dismissal.
    function handleDialogKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !installingRef.current) {
        event.preventDefault();
        setPending(null);
        return;
      }
      if (event.key !== "Tab" || !modalRef.current) {
        return;
      }
      const controls = focusableControls(modalRef.current);
      if (controls.length === 0) {
        event.preventDefault();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      document.removeEventListener("keydown", handleDialogKeyDown);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [pending]);

  // Installs the confirmed pack/version and reports the outcome as a toast.
  async function handleConfirm() {
    if (!pending) {
      return;
    }
    const { pack, version } = pending;
    installingRef.current = true;
    setInstalling(true);
    try {
      await installPersona(pack, version);
      showToast(
        `Installed ${pack} v${version}. Activate it in Personas or configure Automate in Settings.`,
        "success",
      );
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : `Failed to install ${pack}`,
        "error",
      );
    } finally {
      installingRef.current = false;
      setInstalling(false);
      setPending(null);
    }
  }

  // Dismisses the confirmation dialog without installing anything.
  function handleCancel() {
    if (!installing) {
      setPending(null);
    }
  }

  return (
    <>
      {pending ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={handleCancel}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="deep-link-install-title"
            aria-describedby="deep-link-install-description"
            ref={modalRef}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="deep-link-install-title" className="modal-title">
              Install persona from link
            </h2>
            <div id="deep-link-install-description" className="modal-body">
              <div className="modal-row">
                <span className="modal-row-label">Pack</span>
                <span className="mono">{pending.pack}</span>
              </div>
              <div className="modal-row">
                <span className="modal-row-label">Version</span>
                <span className="mono">v{pending.version}</span>
              </div>
            </div>
            <div className="modal-actions">
              <button
                className="btn"
                onClick={handleCancel}
                disabled={installing}
                ref={cancelButtonRef}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void handleConfirm()}
                disabled={installing}
              >
                {installing ? "Installing..." : "Install"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div
        className={`theme-toast theme-toast-wide${toast ? " visible" : ""}${
          toast?.kind === "error" ? " theme-toast-error" : ""
        }`}
        aria-live="polite"
        aria-atomic="true"
      >
        {toast?.message ?? ""}
      </div>
    </>
  );
}
