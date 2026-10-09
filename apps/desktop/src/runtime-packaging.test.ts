import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { POSTGRES_MAJOR_VERSION } from "./local-postgres.js";
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

  it("pins PostgreSQL 16 and both Mac architectures", () => {
    expect(buildScript).toContain("POSTGRES_MAJOR_VERSION = 16");
    expect(buildScript).toMatch(/koffi-darwin-\$\{arch\}/);
    expect(buildScript).toContain("arm64");
    expect(buildScript).toContain("x64");
    expect(POSTGRES_MAJOR_VERSION).toBe(16);
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

describe("pinned PostgreSQL provisioning", () => {
  const provisionScript = readFileSync(
    path.join(desktopDir, "scripts", "provision-postgres.mjs"),
    "utf8",
  );

  it("pins the 16.15 source tarball with a verified checksum", () => {
    expect(provisionScript).toContain('"16.15"');
    expect(provisionScript).toContain(
      "c1575341fa7bd40f5274ea465b34390f4dc64cdd0770af327005caaeb9f6b7ed",
    );
    expect(provisionScript).toContain("https://ftp.postgresql.org/pub/source");
    expect(provisionScript).toContain("sha256");
  });

  it("targets the same macOS minimum as the supervisor contract", () => {
    expect(provisionScript).toContain(`"${DESKTOP_MINIMUM_MACOS}"`);
    expect(provisionScript).toContain("MACOSX_DEPLOYMENT_TARGET");
  });

  it("builds hermetically and proves the result before staging", () => {
    for (const flag of ["--without-readline", "--without-zlib", "--without-icu"]) {
      expect(provisionScript).toContain(flag);
    }
    expect(provisionScript).not.toContain("--with-ssl=");
    expect(provisionScript).toContain("--universal");
    // The fat build must carry both slices; the staged result must prove SCRAM logins work.
    expect(provisionScript).toContain("lipo");
    expect(provisionScript).toContain("scram-sha-256");
  });

  it("provisions missing architectures instead of failing closed", () => {
    expect(buildScript).toContain("SAPPHIRE_POSTGRES_BUILD");
    expect(buildScript).toContain("provision-postgres.mjs");
    expect(buildScript).toContain("ensurePostgresSources");
  });

  it("bundles services with --outdir so native assets ride along", () => {    // The supervisor graph emits a hashed .node binary beside index.js, which
    // --outfile rejects; every entry is index.ts so --outdir keeps the same
    // services/<id>/index.js layout the manifest reads.
    expect(buildScript).toContain('"--outdir"');
    expect(buildScript).not.toContain('"--outfile"');
    expect(buildScript).toContain('endsWith(".node")');
  });

  it("prunes architectures from a previous wider build", () => {
    // A single-arch run after a universal one must not leave a stale arch
    // directory the manifest denies, nor ship it in the app.
    expect(buildScript).toContain("previous wider build");
  });

  it("relocates staged binaries off the temp build prefix", () => {
    // PostgreSQL bakes the build prefix into every binary; the temp dir is
    // deleted after staging, so without this the app dies with dyld
    // "Library not loaded". References become @loader_path-relative and
    // touched files are re-signed; --relocate-only repairs old provisions.
    for (const token of ["install_name_tool", "@loader_path", "codesign", "--relocate-only"]) {
      expect(provisionScript).toContain(token);
    }
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
