# Desktop releases

The `release-desktop` workflow builds, signs, notarizes, attests, and publishes
the Electron app from a `vMAJOR.MINOR.PATCH` tag on `main`. Publishing the
Docker images triggers from the same tag.

## Repository secrets

macOS (required):

| Secret | Value |
| --- | --- |
| `DESKTOP_MAC_CSC_LINK` | Base64 of the `Developer ID Application` certificate exported as `.p12` |
| `DESKTOP_MAC_CSC_KEY_PASSWORD` | Password used when exporting the `.p12` |
| `APPLE_API_KEY_ID` | App Store Connect API key ID (the `XXXXXXXXXX` in `AuthKey_XXXXXXXXXX.p8`) |
| `APPLE_API_ISSUER` | Issuer ID shown on App Store Connect > Users and Access > Integrations |
| `APPLE_API_KEY_P8` | Contents of the `AuthKey_*.p8` file |

The API key needs the Developer role. The workflow writes it to a mode 600 file
in the runner's temp directory for the packaging step and deletes it afterwards.

`patches/app-builder-lib@26.15.3.patch` carries electron-builder PR #10101:
without it `CSC_LINK` signing fails while creating the temporary keychain. Drop
the patch once an electron-builder release includes that fix.

Windows (optional):

| Secret | Value |
| --- | --- |
| `DESKTOP_WIN_CSC_LINK` | Base64 of the Authenticode certificate as `.p12`/`.pfx` |
| `DESKTOP_WIN_CSC_KEY_PASSWORD` | Its password |

When `DESKTOP_WIN_CSC_LINK` is unset the Windows build and its release assets
are skipped. macOS and Linux always build, and the release is only published
when every platform that was built produced its installer and update feed.

Set a secret from a file without echoing it:

```sh
base64 -i devid.p12 | gh secret set DESKTOP_MAC_CSC_LINK
gh secret set APPLE_API_KEY_P8 < AuthKey_XXXXXXXXXX.p8
```

## Cut a release

1. Bump `version` in `apps/desktop/package.json` on `main`.
2. Tag that commit `v<version>` and push the tag:

```sh
git tag v0.1.1
git push origin v0.1.1
```

The workflow refuses tags that do not match the desktop version, are not on
`main`, or are not newer than the latest published release.

## Native macOS runtime (This computer)

The macOS installer needs no Docker for the local backend. It ships a
`runtime/` resource beside the web bundle containing the API and worker
service bundles plus a pinned PostgreSQL 16 distribution for both Mac
architectures (`arm64`, `x64`), built against the `13.0` minimum macOS
version. Compose stack assets are excluded from the installer. E2B is the
primary bot-computer provider; Docker runs only as an explicit opt-in
computer fallback, never for the backend and never on the Mac host.

Release CI builds the universal runtime with
`SAPPHIRE_RUNTIME_UNIVERSAL=1 SAPPHIRE_POSTGRES_BUILD=1 pnpm --filter
@sapphire/desktop run runtime:build`, then verifies both architectures, the
minimum version, and every staged native binary's signature before reporting
installer size.

## Pinned PostgreSQL provisioning

The native runtime needs PostgreSQL 16 for both Mac architectures, built
against the 13.0 minimum macOS version. `runtime:build` no longer fails
closed on a clean runner: with `SAPPHIRE_POSTGRES_BUILD=1` it provisions
whatever architecture is missing via
`apps/desktop/scripts/provision-postgres.mjs`, which downloads the pinned
source tarball (16.15, SHA256-verified against the checksum in the script),
builds it hermetically (no Homebrew, no MacPorts, no Docker), and proves the
result by booting a throwaway cluster and completing a SCRAM password login
over TCP. On Apple Silicon `--universal` produces one fat `arm64+x86_64`
build that is staged under both architecture directories; explicit
`SAPPHIRE_POSTGRES_DIR_ARM64` / `SAPPHIRE_POSTGRES_DIR_X64` directories still
take precedence when set.

```sh
# One fat build for both Mac architectures (Apple Silicon host):
node apps/desktop/scripts/provision-postgres.mjs --universal
# Or a single host-arch build:
node apps/desktop/scripts/provision-postgres.mjs --arch arm64
```

Provisioning is idempotent: matching `.provision.json` records are skipped
unless `--force` is passed. Bumping the minor version means updating
`POSTGRES_VERSION` and `POSTGRES_TARBALL_SHA256` in the provision script
after review, then re-running acceptance.

## Release acceptance

Before tagging, dispatch the opt-in `desktop-native-acceptance` workflow
(it never runs automatically). It always runs the Docker-absent offline
acceptance (packaged backend needs no Docker, setup UI has no Docker copy,
desktop unit tests, budget-check self-test) and the universal provision
verification (both `lipo` slices, `16.x` version, `13.0` minimum). The billed
live E2B computer test and the Docker fallback check run only when their
dispatch inputs are enabled (E2B additionally requires the `E2B_API_KEY`
secret).

Resource budgets (locked; never raise without user review): total Sapphire
RSS at or below 1.5 GiB after five minutes idle, and 95th-percentile total
RSS at or below 2.5 GiB during one active chat turn plus one E2B computer
session, counting Electron main, renderer, API, worker, and PostgreSQL.
Docker Desktop VM memory is excluded. To validate a release candidate,
capture per-process RSS on a clean Mac (e.g. `ps -o rss= -p <pid>`, KiB on
macOS, multiply by 1024), write the measurements file, and check it:

```sh
node apps/desktop/scripts/check-resource-budgets.mjs --measurements measurements.json
```

If a build misses either target, stop and report the measurements as the
release blocker.
