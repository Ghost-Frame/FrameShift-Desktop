// Single source of truth for "are we running inside the packaged Tauri shell?".
//
// This re-exports Tauri v2's official runtime check. It must NOT be hand-rolled
// as `"__TAURI__" in window`: that global is a Tauri v1 convention and, under
// Tauri v2, is only injected when `app.withGlobalTauri` is true (it is not in
// this app). Tauri v2 instead injects `globalThis.isTauri`, which the official
// `isTauri()` reads. Using the wrong check made every command silently fall
// back to mock data and disabled the frameshift:// deep-link install flow in
// the packaged app.
export { isTauri } from "@tauri-apps/api/core";
