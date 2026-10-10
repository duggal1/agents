import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DESKTOP_MINIMUM_MACOS,
  RUNTIME_MANIFEST_FILE,
  RUNTIME_MANIFEST_VERSION,
  SERVICE_READINESS,
} from "./local-runtime.js";

const desktopDir = path.resolve(import.meta.dirname, "..");
const buildScript = readFileSync(path.join(desktopDir, "scripts", "build-runtime.mjs"), "utf8");
const packageJson = JSON.parse(readFileSync(path.join(desktopDir, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("runtime packaging", () => {
  it("exposes a build script the release pipeline can call", () => {
    expect(packageJson.scripts["runtime:build"]).toBe("node scripts/build-runtime.mjs");
  });

  it("pins the same minimum macOS version as the supervisor contract", () => {
    expect(buildScript).toContain(`const DESKTOP_MINIMUM_MACOS = "${DESKTOP_MINIMUM_MACOS}"`);
  });

  it("stages both Mac architectures and no PostgreSQL distribution", () => {
    expect(buildScript).toMatch(/koffi-darwin-\$\{arch\}/);
    expect(buildScript).toContain("arm64");
    expect(buildScript).toContain("x64");
    // The app opens a SQLite file inside its user data; shipping a database
    // server distribution again would silently reintroduce the bundled cluster.
    expect(buildScript).not.toContain("POSTGRES_MAJOR_VERSION");
    expect(buildScript).not.toContain("provision-postgres");
    expect(buildScript).not.toContain("postgresArches");
  });

  it("declares each service's readiness line the same way the supervisor does", () => {
    for (const readiness of Object.values(SERVICE_READINESS)) {
      expect(readiness.kind).toBe("log");
      if (readiness.kind === "log") expect(buildScript).toContain(readiness.pattern);
    }
  });

  it("writes the manifest filename and version the supervisor reads", () => {
    expect(buildScript).toContain("runtime-manifest.json");
    expect(buildScript).toContain("RUNTIME_MANIFEST_VERSION = 1");
    expect(RUNTIME_MANIFEST_FILE).toBe("runtime-manifest.json");
    expect(RUNTIME_MANIFEST_VERSION).toBe(1);
  });
});

describe("native runtime staging", () => {
  it("bundles services with --outdir so native assets ride along", () => {    // The supervisor graph emits a hashed .node binary beside index.js, which
    // --outfile rejects; every entry is index.ts so --outdir keeps the same
    // services/<id>/index.js layout the manifest reads.
    expect(buildScript).toContain('"--outdir"');
    expect(buildScript).not.toContain('"--outfile"');
    expect(buildScript).toContain('endsWith(".node")');
  });

  it("prunes any database server directory a previous build left behind", () => {
    // A stale runtime/postgres from an older version would otherwise ride into
    // the installer and reinstate the bundled cluster this version removed.
    expect(buildScript).toContain('path.join(OUT_DIR, "postgres")');
    expect(buildScript).toContain('path.join(OUT_DIR, "postgres-deps")');
  });

  it("stages the Prisma migrate tooling the packaged backend runs", () => {
    // `prisma migrate deploy` runs before the API starts, with no network
    // and no system Node: the CLI and config are bundled as JS, the schema
    // plus migration history are copied, and one schema-engine binary per
    // architecture is selected through PRISMA_SCHEMA_ENGINE_BINARY.
    for (const token of [
      "stagePrisma",
      "prisma/bin/index.js",
      "prisma/bin/prisma.mjs",
      "CJS-main globals",
      "prisma/prisma.config.js",
      "prisma/schema.prisma",
      "prisma/migrations",
      "PRISMA_ENGINES_COMMIT",
      "PRISMA_SCHEMA_ENGINE_BINARY",
      "schema-engine-",
    ]) {
      expect(buildScript).toContain(token);
    }
  });

  it("pins the Prisma engine matching the installed CLI release", () => {
    // The engines commit is the fail-closed guard: a dependency bump that
    // moves it must update the pin, never silently ship a mismatched engine.
    // d1b3f377ca835d73fd50954a5e22128b9ebdd6b8 is Prisma 8.1.0-dev.9's
    // engines release (the SQLite migration); the old 0edf323 pin was 7.10.
    expect(buildScript).toContain("d1b3f377ca835d73fd50954a5e22128b9ebdd6b8");
    expect(buildScript).not.toContain("0edf323efd1d98336f3f0a68684b56f689b900d3");
    // Engine lookups must follow the staged CLI's own dependency edge, not
    // scan the install store where an older Prisma 7 copy can win.
    expect(buildScript).toContain("stagedEnginesDir");
    expect(buildScript).toContain("stagedPrismaDir");
  });

  it("stages the SQLite native binding the service bundles load", () => {
    // The API/worker bundles inline better-sqlite3's JS but not its .node
    // binary; without the staged copy boot fails with "Could not locate
    // the bindings file".
    expect(buildScript).toContain("better_sqlite3.node");
    expect(buildScript).toContain("RUNTIME_NATIVE_ADDONS");
    expect(buildScript).toContain("build/Release/better_sqlite3.node");
  });

  it("bundles the Electron main process so no workspace .ts ships", () => {
    // tsc output would import @sapphire/contracts straight from src/*.ts;
    // inside app.asar/node_modules Node refuses to strip those types
    // (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), while dev works because
    // the workspace symlink resolves outside node_modules. Bundling inlines
    // every workspace package as JS; only Electron and its updater stay
    // external at runtime.
    const build = packageJson.scripts["build"] as string;
    expect(build).toContain("bun build src/main.ts");
    expect(build).toContain("--external electron");
    expect(build).toContain("--outdir dist");
  });
});
