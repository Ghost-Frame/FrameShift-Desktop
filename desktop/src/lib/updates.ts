// In-app update flow wrapping tauri-plugin-updater and tauri-plugin-process.
//
// The plugins exist only inside the packaged Tauri shell, so every entry point
// guards on the Tauri bridge and surfaces a clear message in plain-browser dev
// instead of throwing an opaque import error.

import { isTauri } from "./is-tauri";

// Details of an update that is newer than the running version.
export interface AvailableUpdate {
  // Version offered by the update manifest.
  version: string;
  // Version currently running.
  currentVersion: string;
  // Optional release notes from the manifest body.
  notes?: string;
}

// Raised when an update action is attempted outside the packaged desktop app.
export const UNSUPPORTED_MESSAGE = "Updates are only available in the desktop app.";

// Checks the configured endpoint for a newer signed release.
//
// Returns the update details when one is available, or null when the app is
// already current. Throws in browser-dev or on a network/signature failure.
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri()) {
    throw new Error(UNSUPPORTED_MESSAGE);
  }
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) {
    return null;
  }
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body ?? undefined,
  };
}

// Downloads and installs the pending update, then relaunches the app so the new
// version takes effect. No-op (returns false) when nothing is available.
export async function installUpdateAndRelaunch(): Promise<boolean> {
  if (!isTauri()) {
    throw new Error(UNSUPPORTED_MESSAGE);
  }
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) {
    return false;
  }
  await update.downloadAndInstall();
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
  return true;
}
