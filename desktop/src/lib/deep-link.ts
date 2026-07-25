// Parsing and validation for the `frameshift://install?pack=NAME&version=V`
// deep link. Values arrive from an OS-level URL that any process on the
// machine (or a malicious link on a webpage) can hand to the app, so both
// fields are treated as untrusted input and validated before they ever reach
// a confirmation dialog or the `install_persona` Tauri command.

// The one scheme and host this app registers as a custom protocol handler
// (see src-tauri/tauri.conf.json `plugins.deep-link.desktop.schemes` and
// src-tauri/capabilities/default.json).
const DEEP_LINK_SCHEME = "frameshift:";
const INSTALL_HOST = "install";

// A validated install request extracted from a deep link, ready to show in
// the confirmation dialog and pass to `installPersona`.
export interface DeepLinkInstallRequest {
  pack: string;
  version: string;
}

// Control characters (C0 range plus DEL) that must never appear in a pack
// name, expressed as a literal escape so no raw control bytes live in this
// source file.
const CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f]/;

// Mirrors `frameshift_client::validate_persona_name` (crates/frameshift-client
// /src/lib.rs): the Rust engine is the authoritative gate that runs again
// inside `install_persona`, but rejecting the same shapes here means the
// confirmation dialog never shows an obviously-hostile name (e.g. `../../etc`)
// pulled straight out of an untrusted URL.
export function isValidPackName(name: string): boolean {
  if (name.length === 0) {
    return false;
  }
  if (name.startsWith(".")) {
    return false;
  }
  if (name.includes("/") || name.includes("\\")) {
    return false;
  }
  if (CONTROL_CHAR_PATTERN.test(name)) {
    return false;
  }
  return true;
}

// Accepts dot-separated numeric versions with optional semver prerelease/
// build metadata (`1.2.3`, `1.2.3-beta.1`, `1.2.3+build.7`). Deliberately
// looser than a full semver grammar since pack versions are not guaranteed
// to be strict semver, but tight enough to reject anything that is not a
// plain version token (no separators, no shell metacharacters).
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// Validates a version string against the sane-semver-ish pattern above.
export function isValidVersion(version: string): boolean {
  return VERSION_PATTERN.test(version);
}

// Parses a `frameshift://install?pack=NAME&version=V` URL, returning null for
// anything that is not that exact shape or whose `pack`/`version` fail
// validation. Never throws -- malformed input from the OS is always treated
// as "not an install link" rather than a parse error.
export function parseInstallDeepLink(url: string): DeepLinkInstallRequest | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== DEEP_LINK_SCHEME) {
    return null;
  }
  // `frameshift://install?...` parses with "install" as the host (the WHATWG
  // URL parser treats the segment after `//` as authority, not path).
  if (parsed.hostname !== INSTALL_HOST) {
    return null;
  }

  const pack = parsed.searchParams.get("pack");
  const version = parsed.searchParams.get("version");
  if (!pack || !version) {
    return null;
  }
  if (!isValidPackName(pack) || !isValidVersion(version)) {
    return null;
  }

  return { pack, version };
}
