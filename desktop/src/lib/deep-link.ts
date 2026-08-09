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

// Public Studio creates portable identifiers of at most 64 ASCII bytes, while
// the registry route accepts this same character set for published pack names.
const PACK_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// Mirrors the public registry and Studio publication identifier boundary so
// the confirmation dialog cannot display bidi, zero-width, or oversized names
// that no public pack could legitimately use. The Rust engine validates again.
export function isValidPackName(name: string): boolean {
  return PACK_NAME_PATTERN.test(name);
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
