# FrameShift Desktop

This repository contains the public source code for the FrameShift desktop
application. FrameShift Desktop is a Tauri 2 application with a Next.js
interface. It manages project-scoped personas, Automate settings, marketplace
installs, updates, accounts, and publisher keys.

Download the current signed updater build from
[download.frameshift.syntheos.dev](https://download.frameshift.syntheos.dev/).

## Release provenance

Production releases are built from a pinned commit in this public repository
and a pinned commit in the public
[FrameShift engine](https://github.com/Ghost-Frame/FrameShift) repository. The
private release orchestrator injects licensed persona artwork, builds the Linux
and Windows bundles in GitHub Actions, signs the updater artifacts, and
publishes them to the FrameShift download service.

Beginning with version 0.1.5, each desktop release has a matching
`desktop-vX.Y.Z` tag in this repository. That tag identifies the desktop source
used by the release pipeline. The bundled FrameShift engine revision is pinned in
[the public CI workflow](./.github/workflows/ci.yml).

Windows early-access builds are updater-signed but may not yet carry an
Authenticode publisher signature. Linux AppImages and Windows installers are
distributed through the signed FrameShift updater manifest.

## Artwork

Persona card artwork is proprietary and is not included in this repository.
The application remains buildable without it and uses interface fallbacks in a
plain public clone. Official release builds receive the artwork as a separate,
validated build input.

## Development

Clone this repository and the FrameShift engine as siblings:

```text
workspace/
├── FrameShift-Desktop/
└── frameshift/
```

Then install and verify the interface:

```bash
corepack enable
pnpm --dir desktop install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

The native application also requires the platform prerequisites documented by
[Tauri](https://v2.tauri.app/start/prerequisites/). With those installed:

```bash
cargo check --locked --manifest-path desktop/src-tauri/Cargo.toml
pnpm --dir desktop tauri build
```

## Security

Please report suspected vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/Ghost-Frame/FrameShift-Desktop/security/advisories/new).
Do not include credentials or sensitive user data in a public issue.

## License

The source code in this repository is licensed under the Elastic License 2.0.
See [LICENSE](./LICENSE). FrameShift logos, icons, branding, and other visual
assets remain proprietary and are governed by
[ASSETS-LICENSE.md](./ASSETS-LICENSE.md).
