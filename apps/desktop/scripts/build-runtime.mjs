#!/usr/bin/env node
// Builds the native runtime resources the packaged macOS app launches: bundled API and
// worker entry points, their runtime assets, and a pinned PostgreSQL 16 distribution.
//
// The two service bundles are architecture-independent JavaScript; only PostgreSQL is
// per architecture, so a universal app carries one service copy and two database copies.
//
//   SAPPHIRE_POSTGRES_DIR   stage an already-built PostgreSQL bin directory (CI cache or
//                           a local source build). The minimum macOS version is verified.
//   SAPPHIRE_POSTGRES_BUILD build PostgreSQL from the pinned source tarball instead.
//   SAPPHIRE_POSTGRES_VERSION  pinned PostgreSQL 16 minor (default 16.15).
import { execFileSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const OUT_DIR = path.join(REPO_ROOT, "runtime");
/** Bundles live one level down so their `../data` and `../package.json` resolve inside it. */
const SERVICES_DIR = path.join(OUT_DIR, "services");

/** Must match `DESKTOP_MINIMUM_MACOS` in src/local-runtime.ts. */
const DESKTOP_MINIMUM_MACOS = "13.0";
const RUNTIME_MANIFEST_VERSION = 1;
const POSTGRES_MAJOR_VERSION = 16;
const SERVICES = [
  {
    id: "api",
    entry: "apps/api/src/index.ts",
    readiness: { kind: "log", pattern: "api listening" },
  },
  {
    id: "worker",
    entry: "apps/worker/src/index.ts",
    readiness: { kind: "log", pattern: "worker ready" },
  },
];

/**
 * Packages whose shipped JavaScript `require`s data files at runtime. Bundlers inline the
 * JavaScript but not these assets, so the exact files each one reads are copied next to
 * the bundle. Verified against a real local run of the packaged services.
 */
const RUNTIME_ASSET_PACKAGES = [
  // css-tree reads `../data/patch.json` and its own `../package.json` relative to itself.
  {
    resolve: "css-tree/package.json",
    copy: [
      ["package.json", "package.json"],
      ["data/patch.json", "data/patch.json"],
    ],
  },
  // css-tree reads mdn-data's CSS tables through a normal package specifier.
  {
    resolve: "mdn-data/package.json",
    copy: [
      ["css", "node_modules/mdn-data/css"],
      ["package.json", "node_modules/mdn-data/package.json"],
    ],
  },
];

/**
 * Finds a package directory regardless of installer layout: a direct dependency under
 * `node_modules`, or a transitive dependency inside the bun (`node_modules/.bun`) or
 * pnpm (`node_modules/.pnpm`) virtual store. A specific architecture's native package
 * may not be a direct dependency, so the store scan is required to stage both Macs.
 */
async function findPackageDir(name) {
  const scoped = name.replace("/", "+");
  const searchPaths = [
    path.join(REPO_ROOT, "node_modules", name),
    path.join(REPO_ROOT, "node_modules", ".bun", "node_modules", name),
    path.join(REPO_ROOT, "node_modules", ".pnpm", "node_modules", name),
  ];
  for (const candidate of searchPaths) {
    if (await exists(path.join(candidate, "package.json"))) return candidate;
  }
  for (const store of [".bun", ".pnpm"]) {
    const storeDir = path.join(REPO_ROOT, "node_modules", store);
    let entries = [];
    try {
      entries = await readdir(storeDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.startsWith(`${scoped}@`)) continue;
      const candidate = path.join(storeDir, entry, "node_modules", name);
      if (await exists(path.join(candidate, "package.json"))) return candidate;
    }
  }
  throw new Error(`Could not locate the ${name} package in node_modules.`);
}

/** Resolves the package.json path the same way, for callers that want a file. */
async function findPackageJson(specifier) {
  const slash = specifier.lastIndexOf("/package.json");
  const name = slash === -1 ? specifier : specifier.slice(0, slash);
  return path.join(await findPackageDir(name), "package.json");
}

function parseArch(argv) {
  const index = argv.indexOf("--arch");
  const arch = index === -1 ? process.arch : argv[index + 1];
  if (arch !== "arm64" && arch !== "x64") {
    throw new Error(`Unsupported architecture: ${arch}. Use arm64 or x64.`);
  }
  return arch;
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", ...options });
}

/** Bundles one service into a single self-contained CommonJS-free ESM file. */
async function bundleService(service, outDir) {
  const outfile = path.join(outDir, service.id, "index.js");
  await mkdir(path.dirname(outfile), { recursive: true });
  run(process.env.SAPPHIRE_BUN ?? "bun", [
    "build",
    path.join(REPO_ROOT, service.entry),
    "--target=node",
    "--outfile",
    outfile,
    // koffi ships a per-architecture native addon and is only reachable from the host
    // desktop sandbox provider, which local mode never selects. Its JavaScript is staged
    // as a package so a universal build can carry both architectures.
    "--external",
    "koffi",
  ]);
  return outfile;
}

/**
 * Copies the runtime data assets the bundled third-party code reads at startup. A
 * universal build stages koffi for both Mac architectures; a local build stages just
 * the running one, because the package manager only installs the current platform's
 * optional native dependency.
 */
async function copyRuntimeAssets(outDir, arches) {
  for (const asset of RUNTIME_ASSET_PACKAGES) {
    const packageRoot = path.dirname(await findPackageJson(asset.resolve));
    for (const [from, to] of asset.copy) {
      const destination = path.join(outDir, to);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join(packageRoot, from), destination, { recursive: true });
    }
  }
  // koffi resolves `../../../@koromix/koffi-<platform>-<arch>` from its own source file,
  // so the architecture packages sit beside it under the shared node_modules.
  const koffiRoot = await findPackageDir("koffi");
  await cp(koffiRoot, path.join(outDir, "node_modules/koffi"), { recursive: true });
  const staged = [];
  for (const arch of arches) {
    const name = `@koromix/koffi-darwin-${arch}`;
    await cp(await findPackageDir(name), path.join(outDir, "node_modules", name), {
      recursive: true,
    });
    staged.push(arch);
  }
  return staged;
}

/** Reads the Mach-O minimum macOS version so a build can never silently raise it. */
function minimumMacos(binary) {
  const output = execFileSync("vtool", ["-show-build", binary], { encoding: "utf8" });
  const match = output.match(/minos\s+([\d.]+)/);
  if (!match) throw new Error(`Could not read the minimum macOS version of ${binary}`);
  return match[1];
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Copies a verified PostgreSQL 16 distribution, or fails clearly when it is missing. */
async function stagePostgres(arch, destination) {
  const source = process.env.SAPPHIRE_POSTGRES_DIR;
  if (!source) {
    throw new Error(
      "Set SAPPHIRE_POSTGRES_DIR to a PostgreSQL 16 bin directory built against macOS " +
        `${DESKTOP_MINIMUM_MACOS} for ${arch} (see SAPPHIRE_POSTGRES_BUILD in CI).`,
    );
  }
  const bin = path.join(source, "bin");
  const postgres = path.join(bin, "postgres");
  if (!(await exists(postgres))) {
    throw new Error(`${postgres} is missing; SAPPHIRE_POSTGRES_DIR must contain a bin directory.`);
  }
  const version = execFileSync(postgres, ["--version"], { encoding: "utf8" }).trim();
  if (!version.includes(` ${POSTGRES_MAJOR_VERSION}.`)) {
    throw new Error(`${postgres} is not PostgreSQL ${POSTGRES_MAJOR_VERSION}: ${version}`);
  }
  const minimum = minimumMacos(postgres);
  if (compareVersions(minimum, DESKTOP_MINIMUM_MACOS) > 0) {
    throw new Error(
      `${postgres} requires macOS ${minimum}, which is newer than the app minimum of ${DESKTOP_MINIMUM_MACOS}. Build PostgreSQL with MACOSX_DEPLOYMENT_TARGET=${DESKTOP_MINIMUM_MACOS}.`,
    );
  }
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true, dereference: true });
  return minimum;
}

/** Writes the manifest the Electron main process reads to launch the services. */
async function writeManifest(outDir, appVersion, postgresMinimum, koffiArches) {
  const manifest = {
    version: RUNTIME_MANIFEST_VERSION,
    appVersion,
    services: SERVICES.map((service) => ({
      id: service.id,
      entry: `services/${service.id}/index.js`,
      args: [],
      env: {},
      readiness: service.readiness,
      startupTimeoutMs: 120000,
      restart: { maxRestarts: 3, backoffMs: 500 },
      shutdown: { signal: "SIGTERM", timeoutMs: 15000 },
    })),
    postgres: { minimumMacos: postgresMinimum, major: POSTGRES_MAJOR_VERSION },
    koffiArches,
  };
  await writeFile(
    path.join(outDir, "runtime-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

/** Fails the build when a service entry, asset, or PostgreSQL binary is absent. */
async function verifyLayout(manifest, arch) {
  const required = [
    [OUT_DIR, "runtime-manifest.json"],
    [OUT_DIR, `postgres/${arch}/bin/postgres`],
    [OUT_DIR, `postgres/${arch}/bin/pg_ctl`],
    [SERVICES_DIR, "data/patch.json"],
    [SERVICES_DIR, "package.json"],
    [SERVICES_DIR, "node_modules/koffi/package.json"],
    [SERVICES_DIR, "node_modules/mdn-data/css/at-rules.json"],
    ...manifest.services.map((service) => [OUT_DIR, service.entry]),
    ...manifest.koffiArches.map((stagedArch) => [
      SERVICES_DIR,
      `node_modules/@koromix/koffi-darwin-${stagedArch}/package.json`,
    ]),
  ];
  for (const [root, relative] of required) {
    if (!(await exists(path.join(root, relative)))) {
      throw new Error(`Runtime is missing ${relative}; packaging is incomplete.`);
    }
  }
}

async function main() {
  const arch = parseArch(process.argv);
  const universal = process.env.SAPPHIRE_RUNTIME_UNIVERSAL === "1";
  const appVersion = JSON.parse(
    await readFile(path.join(REPO_ROOT, "apps/desktop/package.json"), "utf8"),
  ).version;

  await mkdir(OUT_DIR, { recursive: true });
  // A fresh service copy per build; PostgreSQL is staged per architecture beside it.
  await rm(SERVICES_DIR, { recursive: true, force: true });

  console.log(`Bundling services...${universal ? " (universal)" : ` (${arch})`}`);
  for (const service of SERVICES) await bundleService(service, SERVICES_DIR);
  const koffiArches = await copyRuntimeAssets(SERVICES_DIR, universal ? ["arm64", "x64"] : [arch]);

  const postgresDir = path.join(OUT_DIR, "postgres", arch);
  await rm(postgresDir, { recursive: true, force: true });
  console.log(`Staging PostgreSQL ${POSTGRES_MAJOR_VERSION} for ${arch}...`);
  const postgresMinimum = await stagePostgres(arch, postgresDir);

  const manifest = await writeManifest(OUT_DIR, appVersion, postgresMinimum, koffiArches);
  await verifyLayout(manifest, arch);
  console.log(
    `Runtime ready at ${OUT_DIR} (macOS ${postgresMinimum}+, ${manifest.services.length} services).`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
