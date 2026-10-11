#!/usr/bin/env node
// Builds the native runtime resources the packaged macOS app launches: bundled API and
// worker entry points, their runtime assets, and the staged Prisma migrate tooling.
//
// The database itself is a SQLite file inside the app's user data, so no database
// server is bundled or staged; the only per-architecture native artifact is the
// Prisma schema engine beside the migrate CLI.
import { execFileSync } from "node:child_process";
import { cp, chmod, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const OUT_DIR = path.join(REPO_ROOT, "runtime");
/** Bundles live one level down so their `../data` and `../package.json` resolve inside it. */
const SERVICES_DIR = path.join(OUT_DIR, "services");

/** Must match `DESKTOP_MINIMUM_MACOS` in src/local-runtime.ts. */
const DESKTOP_MINIMUM_MACOS = "13.0";
const RUNTIME_MANIFEST_VERSION = 1;
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
 * The optional Docker sandbox supervisor (T6) is bundled beside the services
 * but never started on E2B-only launches. Electron launches it only when the
 * user enabled Docker fallback and a daemon is present.
 */
const SUPERVISOR_SERVICE = {
  id: "supervisor",
  entry: "infra/sandboxes/supervisor/src/index.ts",
};
/**
 * Exact build-context files `ensureComputerImage` needs. Staged so the image
 * builds lazily on the first Docker fallback; no image tar is ever bundled.
 * Must match COMPUTER_CONTEXT_FILES in src/local-docker-supervisor.ts.
 */
const COMPUTER_CONTEXT_FILES = [
  "Dockerfile",
  "start.sh",
  "user-env.sh",
  "control.py",
  "xcapture.c",
  "rakazo-browser",
  "rakazo-page-browser",
  "rakazo-browser.desktop",
  "embed.html",
  "clipboard-bridge.js",
  "mobile-keyboard.js",
  "fluxbox.init",
  "fluxbox.apps",
  "fluxbox.menu",
];

/**
 * Native addons the service bundles load at startup. Bundlers inline the
 * JavaScript but not these binaries, so each one is staged where the
 * `bindings` lookup finds it next to the bundle. Verified against a real
 * local run of the packaged services.
 */
const RUNTIME_NATIVE_ADDONS = [
  // better-sqlite3 v13+ is bundled --external and loaded from a real staged
  // package: its binary lookup uses a build-time absolute path frozen into
  // the bundle, so only an intact package layout (lib/ + prebuilds/) works.
  // v12 loads via the `bindings` package (walks up from the requiring file),
  // which that same staged package also satisfies.
  {
    package: "better-sqlite3",
    stagePackage: true,
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

/**
 * Resolves a native-addon package the services actually load: the workspace db
 * package's own install, so version bumps apply without a store scan that can
 * return a stale copy (e.g. better-sqlite3 v12 alongside v13).
 */
async function stagedNativePackageDir(name) {
  const direct = await realpath(path.join(REPO_ROOT, "packages/db/node_modules", name)).catch(
    () => null,
  );
  if (direct && (await exists(path.join(direct, "package.json")))) return direct;
  return findPackageDir(name);
}

/** Resolves the package.json path the same way, for callers that want a file. */
async function findPackageJson(specifier) {
  const slash = specifier.lastIndexOf("/package.json");
  const name = slash === -1 ? specifier : specifier.slice(0, slash);
  return path.join(await findPackageDir(name), "package.json");
}

/**
 * Resolves the `prisma` CLI this build stages: the workspace db package's own
 * install, so engine lookups below follow the exact CLI that ships.
 */
async function stagedPrismaDir() {
  return realpath(path.join(REPO_ROOT, "packages/db/node_modules/prisma"));
}

/**
 * Resolves the `@prisma/engines` package the staged CLI runs with, by
 * following its own dependency edge instead of scanning the store.
 */
async function stagedEnginesDir() {
  const prismaDir = await stagedPrismaDir();
  const linkTarget = path.join(path.dirname(prismaDir), "@prisma", "engines");
  try {
    return await realpath(linkTarget);
  } catch {
    return findPackageDir("@prisma/engines");
  }
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

/** Bundles one service into its own directory. `--outdir` (not `--outfile`)
 * because graphs with native assets (the supervisor pulls a `.node` binary
 * through its Docker client stack) emit more than one file; every entry is
 * `index.ts` so the entry point still lands at `<id>/index.js`. */
async function bundleService(service, outDir) {
  const dir = path.join(outDir, service.id);
  await mkdir(dir, { recursive: true });
  run(process.env.SAPPHIRE_BUN ?? "bun", [
    "build",
    path.join(REPO_ROOT, service.entry),
    "--target=node",
    "--outdir",
    dir,
    // koffi ships a per-architecture native addon and is only reachable from the host
    // desktop sandbox provider, which local mode never selects. Its JavaScript is staged
    // as a package so a universal build can carry both architectures.
    "--external",
    "koffi",
    // better-sqlite3 v13+ resolves its prebuilt binary relative to its own
    // package directory (a build-time absolute path is frozen into the
    // bundle), so it must load from a real staged package, never inlined.
    "--external",
    "better-sqlite3",
  ]);
  return path.join(dir, "index.js");
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
  // Native addons resolve relative to a package root that no longer exists
  // inside the bundle, so the full package is staged intact under
  // services/node_modules: the loader's frozen package-relative lookup then
  // resolves inside the staged copy. better-sqlite3 v13+ goes through
  // lib/binding.js (prebuilds/<platform>-<arch>.node, one per staged arch);
  // v12 goes through the `bindings` walk (build/Release/better_sqlite3.node).
  for (const addon of RUNTIME_NATIVE_ADDONS) {
    if (!addon.stagePackage) continue;
    const packageRoot =
      addon.package === "better-sqlite3"
        ? await stagedNativePackageDir(addon.package)
        : await findPackageDir(addon.package);
    const destination = path.join(outDir, "node_modules", addon.package);
    await rm(destination, { recursive: true, force: true });
    await mkdir(path.dirname(destination), { recursive: true });
    // package.json + lib/ + the staged architectures' binaries only: never
    // the full build tree (obj.target, intermediate objects).
    await mkdir(destination, { recursive: true });
    await cp(path.join(packageRoot, "package.json"), path.join(destination, "package.json"));
    await cp(path.join(packageRoot, "lib"), path.join(destination, "lib"), { recursive: true });
    if (await exists(path.join(packageRoot, "prebuilds"))) {
      await mkdir(path.join(destination, "prebuilds"), { recursive: true });
      for (const arch of arches) {
        const name = `darwin-${arch}.node`;
        const source = path.join(packageRoot, "prebuilds", name);
        if (await exists(source)) {
          await cp(source, path.join(destination, "prebuilds", name));
          continue;
        }
        throw new Error(`Runtime is missing better-sqlite3/prebuilds/${name}; reinstall dependencies.`);
      }
    } else {
      // v12 fallback: single build/Release binary shared by all arches.
      const source = path.join(packageRoot, "build/Release/better_sqlite3.node");
      if (!(await exists(source))) {
        throw new Error("Runtime is missing better-sqlite3/build/Release/better_sqlite3.node; reinstall dependencies.");
      }
      await mkdir(path.join(destination, "build/Release"), { recursive: true });
      await cp(source, path.join(destination, "build/Release/better_sqlite3.node"));
    }
    continue;
  }
  for (const addon of RUNTIME_NATIVE_ADDONS) {
    if (addon.stagePackage || !addon.files) continue;
    for (const [from, to] of addon.files) {
      const source = path.join(packageRoot, from);
      if (!(await exists(source))) {
        throw new Error(`Runtime is missing ${addon.package}/${from}; reinstall dependencies.`);
      }
      const destination = path.join(outDir, to);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(source, destination);
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

/** Stages the computer build context the supervisor image build needs. */
async function stageComputerContext(outDir) {
  const source = path.join(REPO_ROOT, "infra/sandboxes/computer");
  const destination = path.join(outDir, "computer");
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const file of COMPUTER_CONTEXT_FILES) {
    const from = path.join(source, file);
    if (!(await exists(from))) {
      throw new Error(`Computer build context is missing ${file}; packaging is incomplete.`);
    }
    await cp(from, path.join(destination, file), { recursive: true });
  }
  return destination;
}

/**
 * Pinned Prisma engines commit for the installed `prisma` CLI. Verified
 * against the installed @prisma/engines-version at build time; a dependency
 * bump that moves the commit fails closed here instead of shipping a
 * mismatched engine.
 */
const PRISMA_ENGINES_COMMIT = "d1b3f377ca835d73fd50954a5e22128b9ebdd6b8";
const PRISMA_ENGINE_TARGETS = { arm64: "darwin-arm64", x64: "darwin" };

function prismaEngineFile(arch) {
  return `schema-engine-${arch}`;
}

/** Reads the engines commit the staged prisma CLI was released with. */
async function installedEnginesCommit() {
  // Follow the CLI's own dependency edge: the engines package's sibling
  // @prisma/engines-version is the exact release it was built against.
  const enginesDir = await stagedEnginesDir();
  const candidate = path.join(path.dirname(enginesDir), "engines-version");
  let resolved = candidate;
  try {
    resolved = await realpath(candidate);
  } catch {
    // Fall through to the existence check below.
  }
  if (await exists(path.join(resolved, "package.json"))) {
    const meta = JSON.parse(await readFile(path.join(resolved, "package.json"), "utf8"));
    if (meta.prisma?.enginesVersion) return String(meta.prisma.enginesVersion);
    const match = String(meta.version).match(/([0-9a-f]{40})$/);
    if (match) return match[1];
  }
  const meta = JSON.parse(
    await readFile(path.join(await findPackageDir("@prisma/engines-version"), "package.json"), "utf8"),
  );
  const match = String(meta.version).match(/([0-9a-f]{40})$/);
  if (!match) throw new Error(`Cannot read the engines commit from @prisma/engines-version ${meta.version}`);
  return match[1];
}

/**
 * Resolves a schema-engine binary for an architecture: an explicit
 * `SAPPHIRE_PRISMA_ENGINES_DIR/<arch>/` override first, then the locally
 * installed engine, then a pinned-commit download from the Prisma CDN
 * (verified runnable below where the host allows it).
 */
async function prismaEngineSource(arch, cacheDir) {
  const file = prismaEngineFile(arch);
  const override = process.env.SAPPHIRE_PRISMA_ENGINES_DIR;
  const candidates = override ? [path.join(override, arch, file)] : [];
  if (candidates.length > 0) {
    for (const candidate of candidates) {
      if (await exists(candidate)) return candidate;
    }
    throw new Error(
      `SAPPHIRE_PRISMA_ENGINES_DIR is set but has no ${arch}/${file}. ` +
        "Stage one per architecture or unset the override.",
    );
  }
  try {
    const dir = await stagedEnginesDir();
    // The store names binaries per platform (schema-engine-darwin-arm64);
    // the staged copy uses the normalized schema-engine-<arch> name.
    for (const name of [file, `schema-engine-darwin-${arch}`]) {
      const local = path.join(dir, name);
      if (await exists(local)) return local;
    }
  } catch {
    // Fall through to the pinned download.
  }
  const target = PRISMA_ENGINE_TARGETS[arch];
  if (!target) throw new Error(`No Prisma engine target for architecture ${arch}.`);
  const url = `https://binaries.prisma.sh/all_commits/${PRISMA_ENGINES_COMMIT}/${target}/schema-engine.gz`;
  await mkdir(cacheDir, { recursive: true });
  const archive = path.join(cacheDir, `${file}.gz`);
  const dest = path.join(cacheDir, file);
  if (await exists(dest)) {
    console.log(`Reusing cached schema engine for ${arch}`);
    return dest;
  }
  console.log(`Downloading pinned schema engine for ${arch}...`);
  run("curl", ["-fSL", "--retry", "3", "-o", archive, url]);
  await rm(dest, { force: true });
  run("gunzip", ["-f", archive]);
  await chmod(dest, 0o755);
  return dest;
}

/**
 * Stages everything `prisma migrate deploy` needs with no network at
 * runtime: the bundled CLI, a bundled prisma.config.js (relative
 * prisma/schema.prisma + prisma/migrations layout preserved), the schema,
 * the migration history, and one schema-engine binary per architecture
 * selected through PRISMA_SCHEMA_ENGINE_BINARY by the launcher.
 */
async function stagePrisma(outDir, arches) {
  if ((await installedEnginesCommit()) !== PRISMA_ENGINES_COMMIT) {
    throw new Error(
      "Installed Prisma engines moved; update PRISMA_ENGINES_COMMIT in scripts/build-runtime.mjs.",
    );
  }
  const prismaDir = path.join(REPO_ROOT, "packages/db/node_modules/prisma");
  if (!(await exists(path.join(prismaDir, "build", "index.js")))) {
    throw new Error("The prisma CLI is not installed. Run the package manager install first.");
  }
  const dest = path.join(outDir, "prisma");
  await rm(dest, { recursive: true, force: true });
  await mkdir(path.join(dest, "bin"), { recursive: true });
  console.log("Bundling Prisma migrate CLI...");
  // Plain ESM bundle plus a small CJS-compat launcher next to it: the CLI's
  // startup gate eval("require.main === module") passes only with CJS-main
  // globals present, which the launcher replicates exactly as node running
  // the CJS original would. (--compile and CJS output both die on this
  // gate or on top-level awaits in its dependencies.)
  run(process.env.SAPPHIRE_BUN ?? "bun", [
    "build",
    path.join(prismaDir, "build", "index.js"),
    "--target=node",
    "--outdir",
    path.join(dest, "bin"),
  ]);
  if (!(await exists(path.join(dest, "bin", "index.js")))) {
    throw new Error("Prisma CLI bundle did not produce bin/index.js; packaging is incomplete.");
  }
  await writeFile(
    path.join(dest, "bin", "prisma.mjs"),
    `// Replicates CJS-main globals for the bundled Prisma CLI next to it.
// Generated at stage time; do not edit by hand.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const bundle = new URL("./index.js", import.meta.url);
const require = createRequire(bundle);
require.main = { exports: {}, filename: fileURLToPath(bundle), loaded: false };
globalThis.require = require;
globalThis.module = require.main;
globalThis.exports = require.main.exports;
globalThis.__dirname = path.dirname(fileURLToPath(bundle));
globalThis.__filename = fileURLToPath(bundle);
await import(bundle.href);
`,
  );
  console.log("Bundling Prisma config...");
  run(process.env.SAPPHIRE_BUN ?? "bun", [
    "build",
    path.join(REPO_ROOT, "packages/db/prisma.config.ts"),
    "--target=node",
    "--outdir",
    dest,
  ]);
  await cp(
    path.join(REPO_ROOT, "packages/db/prisma/schema.prisma"),
    path.join(dest, "prisma", "schema.prisma"),
  );
  await rm(path.join(dest, "prisma", "migrations"), { recursive: true, force: true });
  await cp(path.join(REPO_ROOT, "packages/db/prisma/migrations"), path.join(dest, "prisma", "migrations"), {
    recursive: true,
  });
  for (const arch of arches) {
    const engineDir = path.join(dest, "engines", arch);
    await mkdir(engineDir, { recursive: true });
    const source = await prismaEngineSource(arch, path.join(outDir, ".cache", "prisma-engines"));
    await cp(source, path.join(engineDir, prismaEngineFile(arch)));
    await chmod(path.join(engineDir, prismaEngineFile(arch)), 0o755);
  }
  return dest;
}

/** Writes the manifest the Electron main process reads to launch the services. */
async function writeManifest(outDir, appVersion, koffiArches) {
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
    koffiArches,
  };
  await writeFile(
    path.join(outDir, "runtime-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

/** Fails the build when a service entry, asset, native addon, or Prisma engine is absent. */
async function verifyLayout(manifest, arches) {
  const required = [
    [OUT_DIR, "runtime-manifest.json"],
    [SERVICES_DIR, "data/patch.json"],
    [SERVICES_DIR, "package.json"],
    [SERVICES_DIR, "node_modules/koffi/package.json"],
    [SERVICES_DIR, "node_modules/mdn-data/css/at-rules.json"],
    [SERVICES_DIR, "supervisor/index.js"],
    [OUT_DIR, "computer/Dockerfile"],
    [OUT_DIR, "computer/control.py"],
    [OUT_DIR, "computer/start.sh"],
    [OUT_DIR, "prisma/bin/index.js"],
    [OUT_DIR, "prisma/bin/prisma.mjs"],
    [OUT_DIR, "prisma/prisma.config.js"],
    [OUT_DIR, "prisma/prisma/schema.prisma"],
    [OUT_DIR, "prisma/prisma/migrations/migration_lock.toml"],
    ...arches.map((arch) => [OUT_DIR, `prisma/engines/${arch}/schema-engine-${arch}`]),
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
  // better-sqlite3 is bundled --external and loads from the staged package in
  // services/node_modules: v13+ needs lib/ plus one prebuild per arch, v12
  // needs the single build/Release binary.
  const stagedBs3 = path.join(SERVICES_DIR, "node_modules", "better-sqlite3");
  if (!(await exists(path.join(stagedBs3, "package.json")))) {
    throw new Error("Runtime is missing node_modules/better-sqlite3; packaging is incomplete.");
  }
  for (const arch of arches) {
    const prebuild = path.join(stagedBs3, "prebuilds", `darwin-${arch}.node`);
    const legacy = path.join(stagedBs3, "build", "Release", "better_sqlite3.node");
    if (!(await exists(prebuild)) && !(await exists(legacy))) {
      throw new Error(
        `Runtime is missing better-sqlite3 for darwin-${arch}; packaging is incomplete.`,
      );
    }
  }
  // The supervisor bundle carries a hashed native asset beside index.js; pin
  // its presence without pinning the hash.
  const supervisorFiles = await readdir(path.join(SERVICES_DIR, "supervisor"));
  if (!supervisorFiles.some((file) => file.endsWith(".node"))) {
    throw new Error("Runtime is missing the supervisor native asset (*.node); packaging is incomplete.");
  }
}

async function main() {
  const arch = parseArch(process.argv);
  const universal = process.env.SAPPHIRE_RUNTIME_UNIVERSAL === "1";
  const appVersion = JSON.parse(
    await readFile(path.join(REPO_ROOT, "apps/desktop/package.json"), "utf8"),
  ).version;

  await mkdir(OUT_DIR, { recursive: true });
  // A fresh service copy per build; everything the app launches is regenerated.
  await rm(SERVICES_DIR, { recursive: true, force: true });
  // Drop a PostgreSQL distribution left by a previous build: this app version
  // opens a SQLite file and must never ship database server binaries.
  await rm(path.join(OUT_DIR, "postgres"), { recursive: true, force: true });
  await rm(path.join(OUT_DIR, "postgres-deps"), { recursive: true, force: true });

  console.log(`Bundling services...${universal ? " (universal)" : ` (${arch})`}`);
  for (const service of SERVICES) await bundleService(service, SERVICES_DIR);
  console.log("Bundling Docker sandbox supervisor (fallback only)...");
  await bundleService(SUPERVISOR_SERVICE, SERVICES_DIR);
  console.log("Staging computer build context...");
  await stageComputerContext(OUT_DIR);
  const arches = universal ? ["arm64", "x64"] : [arch];
  const koffiArches = await copyRuntimeAssets(SERVICES_DIR, arches);
  console.log("Staging Prisma migrate tooling...");
  await stagePrisma(OUT_DIR, arches);

  const manifest = await writeManifest(OUT_DIR, appVersion, koffiArches);
  await verifyLayout(manifest, arches);
  console.log(
    `Runtime ready at ${OUT_DIR} (macOS ${DESKTOP_MINIMUM_MACOS}+, ${manifest.services.length} services, SQLite database).`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
