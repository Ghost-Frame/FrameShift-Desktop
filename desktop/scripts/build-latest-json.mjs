// Assembles the Tauri updater manifest (`latest.json`) and stages every file
// that must be published to R2 for a desktop release.
//
// Input  (argv[2]): a directory containing one subdirectory per platform build,
//                   each named `updater-<platform-key>` (e.g. `updater-linux-x86_64`)
//                   and holding that platform's signed updater bundle + `.sig`.
// Output (argv[3]): a staging directory populated with the bundles and a
//                   `latest.json` -- the workflow uploads this whole directory
//                   to `r2://frameshift-desktop/desktop/`.
//
// The manifest `url` for each platform points at the public R2 path the bundle
// is uploaded to, so the in-app updater can fetch it directly.

import { readdirSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";

// Public base URL the bundles are served from (R2 custom domain + key prefix).
const PUBLIC_BASE = process.env.UPDATER_PUBLIC_BASE ?? "https://dl.frameshift.syntheos.dev/desktop";

// Updater artifact suffixes in preference order; the first match per platform is
// the one the updater downloads. Each has a sibling `<suffix>.sig` signature.
const UPDATER_SUFFIXES = [
  ".AppImage",
  "-setup.exe",
  ".nsis.zip",
  ".msi",
  ".app.tar.gz",
];

// Human-facing installer suffixes selected for the early-access platforms.
const INSTALLER_SUFFIXES = {
  linux: [".AppImage"],
  windows: ["-setup.exe", ".msi"],
};

// Every supported desktop target that must be present before a release can publish.
const REQUIRED_PLATFORMS = [
  "linux-x86_64",
  "windows-x86_64",
];

// Reads the desktop app version from the Tauri config (single source of truth).
function readVersion() {
  const conf = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  return conf.version;
}

// Recursively lists every file under `dir`.
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      out.push(...walk(p));
    } else {
      out.push(p);
    }
  }
  return out;
}

// Picks the updater bundle + its signature for one platform's build tree.
function findBundle(platformDir) {
  const files = walk(platformDir);
  for (const suffix of UPDATER_SUFFIXES) {
    // The bundle is the file ending in `suffix` whose `${file}.sig` also exists.
    const bundle = files.find(
      (f) => f.endsWith(suffix) && files.includes(`${f}.sig`),
    );
    if (bundle) {
      return { bundle, sig: `${bundle}.sig` };
    }
  }
  return null;
}

// Picks the installer a person should download for one platform build.
function findInstaller(platformDir, platformKey) {
  const family = platformKey.split("-", 1)[0];
  const suffixes = INSTALLER_SUFFIXES[family] ?? [];
  const files = walk(platformDir);
  for (const suffix of suffixes) {
    const installer = files.find((file) => file.endsWith(suffix));
    if (installer) {
      return installer;
    }
  }
  return null;
}

// Produces a collision-safe filename for a staged platform artifact.
function stagedName(platformKey, file) {
  return `${platformKey}-${basename(file)}`;
}

// Builds the public URL for a staged release file.
function publicUrl(fileName) {
  return `${PUBLIC_BASE}/${encodeURIComponent(fileName)}`;
}

// Assembles every platform artifact and the updater manifest.
function main() {
  const artifactsRoot = process.argv[2];
  const stageDir = process.argv[3];
  if (!artifactsRoot || !stageDir) {
    console.error("usage: build-latest-json.mjs <artifacts-root> <stage-dir>");
    process.exit(1);
  }
  mkdirSync(stageDir, { recursive: true });

  const version = readVersion();
  const platforms = {};

  for (const entry of readdirSync(artifactsRoot)) {
    if (!entry.startsWith("updater-")) {
      continue;
    }
    const platformKey = entry.slice("updater-".length);
    const dir = join(artifactsRoot, entry);
    const found = findBundle(dir);
    if (!found) {
      console.error(`WARN: no signed updater bundle found for ${platformKey} in ${dir}`);
      continue;
    }
    const installer = findInstaller(dir, platformKey);
    if (!installer) {
      console.error(`WARN: no human installer found for ${platformKey} in ${dir}`);
      continue;
    }
    const signature = readFileSync(found.sig, "utf8").trim();
    if (!signature) {
      console.error(`WARN: updater signature is empty for ${platformKey} in ${dir}`);
      continue;
    }
    const bundleName = stagedName(platformKey, found.bundle);
    const installerName = stagedName(platformKey, installer);
    // Stage the bundle for upload and record its public URL + signature.
    copyFileSync(found.bundle, join(stageDir, bundleName));
    if (installer && installer !== found.bundle) {
      copyFileSync(installer, join(stageDir, installerName));
    }
    platforms[platformKey] = {
      signature,
      url: publicUrl(bundleName),
      download_url: publicUrl(installerName),
    };
    console.log(`staged ${platformKey}: updater ${bundleName}, installer ${installerName}`);
  }

  const missingPlatforms = REQUIRED_PLATFORMS.filter(
    (platform) => !(platform in platforms),
  );
  if (missingPlatforms.length > 0) {
    console.error(
      `ERROR: release is incomplete; missing signed updater artifacts for: ${missingPlatforms.join(", ")}`,
    );
    process.exit(1);
  }

  const manifest = {
    version,
    notes: `FrameShift ${version}`,
    pub_date: process.env.UPDATER_PUB_DATE ?? new Date().toISOString(),
    platforms,
  };
  writeFileSync(join(stageDir, "latest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nlatest.json (v${version}) covers: ${Object.keys(platforms).join(", ")}`);
}

main();
