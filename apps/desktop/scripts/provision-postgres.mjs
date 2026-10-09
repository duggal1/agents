#!/usr/bin/env node
// Provisions the pinned PostgreSQL 16 distribution the macOS native runtime
// stages per architecture. Release CI calls this before `runtime:build` so the
// universal build no longer fails closed waiting for hand-staged directories.
//
//   node scripts/provision-postgres.mjs --universal [--out <dir>] [--force]
//   node scripts/provision-postgres.mjs --arch arm64 [--out <dir>] [--force]
//
// Sources and pins (override only for a reviewed version bump):
//   SAPPHIRE_POSTGRES_VERSION  pinned minor (default 16.15, must stay major 16)
//   SAPPHIRE_POSTGRES_SHA256   tarball checksum (default is the 16.15 one below)
//   SAPPHIRE_POSTGRES_MIRROR   source mirror (default ftp.postgresql.org)
//
// The build targets macOS 13.0 (`DESKTOP_MINIMUM_MACOS` in src/local-runtime.ts)
// via MACOSX_DEPLOYMENT_TARGET and leaves out optional dependencies
// (readline, zlib, lz4, zstd, ssl, gssapi, ldap, pam) so the result is
// hermetic: no Homebrew, no MacPorts, no Docker. `--universal` produces one
// fat build (`-arch arm64 -arch x86_64`) on Apple Silicon and stages the same
// verified binaries under both architecture directories; a single-arch x64
// build is only attempted natively (configure test-programs must execute).
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

/** Must stay major 16: the self-hosted stack and native cluster share it. */
export const POSTGRES_MAJOR_VERSION = 16;
/** Pinned minor; bump together with the SHA below after review. */
export const POSTGRES_VERSION = process.env.SAPPHIRE_POSTGRES_VERSION ?? "16.15";
/** SHA256 of postgresql-16.15.tar.bz2 from ftp.postgresql.org (verified 2026). */
export const POSTGRES_TARBALL_SHA256 =
  process.env.SAPPHIRE_POSTGRES_SHA256 ??
  "c1575341fa7bd40f5274ea465b34390f4dc64cdd0770af327005caaeb9f6b7ed";
export const POSTGRES_MIRROR =
  process.env.SAPPHIRE_POSTGRES_MIRROR ?? "https://ftp.postgresql.org/pub/source";
/** Must match `DESKTOP_MINIMUM_MACOS` in src/local-runtime.ts. */
export const DESKTOP_MINIMUM_MACOS = "13.0";
export const PROVISION_RECORD_FILE = ".provision.json";

const ARCHES = ["arm64", "x64"];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { arch: null, universal: false, out: null, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--universal") args.universal = true;
    else if (token === "--force") args.force = true;
    else if (token === "--arch") args.arch = argv[(index += 1)];
    else if (token === "--out") args.out = argv[(index += 1)];
    else fail(`Unknown argument: ${token}\nUsage: provision-postgres.mjs [--arch arm64|x64] [--universal] [--out <dir>] [--force]`);
  }
  return args;
}

function hostArch() {
  if (process.arch === "arm64") return "arm64";
  if (process.arch === "x64") return "x64";
  fail(`Unsupported host architecture: ${process.arch}. Build on an Intel or Apple Silicon Mac.`);
}

function resolveArches(args) {
  if (args.universal) return [...ARCHES];
  const arch = args.arch ?? hostArch();
  if (!ARCHES.includes(arch)) fail(`Unsupported architecture: ${arch}. Use arm64 or x64.`);
  // A foreign single-arch build cannot run configure test programs without
  // Rosetta, so it fails closed here instead of midway through configure.
  if (arch === "x64" && process.arch === "arm64" && !args.universal) {
    fail("Cross-building x64-only on Apple Silicon needs Rosetta; use --universal for a fat build instead.");
  }
  return [arch];
}

function tarballUrl() {
  return `${POSTGRES_MIRROR}/v${POSTGRES_VERSION}/postgresql-${POSTGRES_VERSION}.tar.bz2`;
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

async function downloadTarball(cacheDir) {
  const file = path.join(cacheDir, `postgresql-${POSTGRES_VERSION}.tar.bz2`);
  await mkdir(cacheDir, { recursive: true });
  if (await exists(file)) {
    const digest = await sha256File(file);
    if (digest === POSTGRES_TARBALL_SHA256) {
      console.log(`Reusing verified tarball ${file}`);
      return file;
    }
    console.log("Cached tarball checksum mismatch; re-downloading.");
    await rm(file, { force: true });
  }
  console.log(`Downloading ${tarballUrl()}`);
  run("curl", ["-fSL", "--retry", "3", "-o", file, tarballUrl()]);
  const digest = await sha256File(file);
  if (digest !== POSTGRES_TARBALL_SHA256) {
    await rm(file, { force: true });
    fail(
      `Tarball checksum mismatch: got ${digest}, want ${POSTGRES_TARBALL_SHA256}. ` +
        "Refusing to build from an unverified source.",
    );
  }
  return file;
}

/** Deterministic flags: no optional dependencies, deployment target pinned. */
function configureEnv(fat) {
  const archFlags = fat ? "-arch arm64 -arch x86_64" : `-arch ${process.arch === "arm64" ? "arm64" : "x86_64"}`;
  const target = `-mmacosx-version-min=${DESKTOP_MINIMUM_MACOS}`;
  const cflags = `-O2 ${archFlags} ${target}`;
  return {
    ...process.env,
    MACOSX_DEPLOYMENT_TARGET: DESKTOP_MINIMUM_MACOS,
    CFLAGS: process.env.CFLAGS ?? cflags,
    LDFLAGS: process.env.LDFLAGS ?? `${archFlags} ${target}`,
  };
}

function configureArgs(prefix) {
  return [
    `--prefix=${prefix}`,
    // No --with-ssl flag: SSL stays off by default and SCRAM password auth
    // over loopback is proven by the verify step below. Every other optional
    // dependency is explicitly disabled so the build stays hermetic.
    "--without-readline",
    "--without-zlib",
    "--without-icu",
    "--without-lz4",
    "--without-zstd",
    "--without-gssapi",
    "--without-ldap",
    "--without-pam",
  ];
}

/** End-to-end proof the build actually works, including SCRAM over TCP. */
async function verifyBuild(binDir, workDir) {
  const postgres = path.join(binDir, "postgres");
  const version = execFileSync(postgres, ["--version"], { encoding: "utf8" }).trim();
  if (!version.includes(` ${POSTGRES_MAJOR_VERSION}.`)) {
    throw new Error(`${postgres} is not PostgreSQL ${POSTGRES_MAJOR_VERSION}: ${version}`);
  }
  const minimum = execFileSync("vtool", ["-show-build", postgres], { encoding: "utf8" }).match(
    /minos\s+([\d.]+)/,
  )?.[1];
  if (!minimum) throw new Error(`Could not read the minimum macOS version of ${postgres}`);
  const parts = (value) => value.split(".").map(Number);
  const want = parts(DESKTOP_MINIMUM_MACOS);
  const got = parts(minimum);
  let newer = false;
  for (let index = 0; index < Math.max(want.length, got.length); index += 1) {
    const difference = (got[index] ?? 0) - (want[index] ?? 0);
    if (difference !== 0) {
      newer = difference > 0;
      break;
    }
  }
  if (newer) {
    throw new Error(
      `${postgres} requires macOS ${minimum}, newer than the app minimum ${DESKTOP_MINIMUM_MACOS}.`,
    );
  }
  // Boot a throwaway cluster with SCRAM auth and prove a TCP password login works.
  const cluster = path.join(workDir, "verify-cluster");
  const socketDir = path.join(workDir, "verify-socket");
  await mkdir(socketDir, { recursive: true });
  // Throwaway verification credential only; the directory is deleted below.
  const verifyPassword = "verify-scram-proof";
  await writeFile(path.join(workDir, "verify-pw"), `${verifyPassword}\n`, { mode: 0o600 });
  const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` };
  execFileSync(
    path.join(binDir, "initdb"),
    ["-D", cluster, "-U", "postgres", "-A", "scram-sha-256", "-E", "UTF8", "--pwfile", path.join(workDir, "verify-pw")],
    { env, stdio: "pipe" },
  );
  const port = "55433";
  execFileSync(
    path.join(binDir, "pg_ctl"),
    ["-D", cluster, "-l", path.join(workDir, "verify.log"), "-o", `-p ${port} -k ${socketDir} -c listen_addresses=127.0.0.1`, "-w", "-t", "60", "start"],
    { env, stdio: "pipe" },
  );
  try {
    const out = execFileSync(
      path.join(binDir, "psql"),
      ["-h", "127.0.0.1", "-p", port, "-U", "postgres", "-d", "postgres", "-tAc", "SELECT 1"],
      { env: { ...env, PGPASSWORD: verifyPassword }, stdio: "pipe", encoding: "utf8" },
    ).trim();
    if (out !== "1") throw new Error("SCRAM TCP verification query did not return 1.");
  } finally {
    execFileSync(path.join(binDir, "pg_ctl"), ["-D", cluster, "-m", "fast", "-w", "-t", "60", "stop"], {
      env,
      stdio: "pipe",
    });
  }
  return { version, minimum };
}

async function provisionRecord(dir) {
  try {
    return JSON.parse(await readFile(path.join(dir, PROVISION_RECORD_FILE), "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  if (process.platform !== "darwin") {
    fail("Provisioning builds macOS binaries; run this on a Mac (release CI uses macos-26).");
  }
  const args = parseArgs(process.argv.slice(2));
  const arches = resolveArches(args);
  const out = args.out ?? path.join(REPO_ROOT, "runtime", "postgres-deps");
  if (!POSTGRES_VERSION.startsWith(`${POSTGRES_MAJOR_VERSION}.`)) {
    fail(`SAPPHIRE_POSTGRES_VERSION must stay major ${POSTGRES_MAJOR_VERSION}; got ${POSTGRES_VERSION}.`);
  }

  const upToDate = [];
  for (const arch of arches) {
    const dir = path.join(out, arch);
    const record = await provisionRecord(dir);
    const fresh =
      record !== null &&
      record.version === POSTGRES_VERSION &&
      record.sha256 === POSTGRES_TARBALL_SHA256 &&
      record.minimumMacos === DESKTOP_MINIMUM_MACOS &&
      (await exists(path.join(dir, "bin", "postgres")));
    if (fresh && !args.force) {
      console.log(`PostgreSQL ${POSTGRES_VERSION} for ${arch} is already provisioned at ${dir}`);
      upToDate.push(arch);
    }
  }
  const missing = arches.filter((arch) => !upToDate.includes(arch));
  if (missing.length === 0) return;

  for (const tool of ["curl", "make", "vtool", "lipo"]) {
    const check = spawnSync("command", ["-v", tool], { stdio: "ignore", shell: true });
    if (check.status !== 0) fail(`Required tool '${tool}' is not on PATH.`);
  }

  const tarball = await downloadTarball(path.join(out, ".cache"));
  const workDir = await mkdtemp(path.join(os.tmpdir(), "sapphire-postgres-"));
  // One fat build serves both arches; a single-arch build serves its own dir.
  const fat = args.universal || arches.length > 1;
  try {
    const source = path.join(workDir, `postgresql-${POSTGRES_VERSION}`);
    run("tar", ["-xjf", tarball, "-C", workDir]);
    const install = path.join(workDir, "install");
    run("./configure", configureArgs(install), { cwd: source, env: configureEnv(fat) });
    const cpus = execFileSync("sysctl", ["-n", "hw.ncpu"], { encoding: "utf8" }).trim() || "4";
    run("make", ["-j", cpus], { cwd: source, env: configureEnv(fat) });
    run("make", ["install"], { cwd: source, env: configureEnv(fat) });
    const { version, minimum } = await verifyBuild(path.join(install, "bin"), workDir);
    if (fat) {
      const built = execFileSync("lipo", ["-archs", path.join(install, "bin", "postgres")], {
        encoding: "utf8",
      }).trim().split(/\s+/).sort();
      if (built.join(",") !== "arm64,x86_64") {
        throw new Error(`Fat build is missing a slice: lipo reports '${built.join(" ")}'.`);
      }
    }
    for (const arch of missing) {
      const dir = path.join(out, arch);
      await rm(dir, { recursive: true, force: true });
      await mkdir(path.dirname(dir), { recursive: true });
      await cp(install, dir, { recursive: true, dereference: true });
      await writeFile(
        path.join(dir, PROVISION_RECORD_FILE),
        `${JSON.stringify({ version: POSTGRES_VERSION, sha256: POSTGRES_TARBALL_SHA256, minimumMacos: minimum, fat, reportedVersion: version, builtAt: new Date().toISOString() }, null, 2)}\n`,
      );
      console.log(`Provisioned PostgreSQL ${version} (macOS ${minimum}+) at ${dir}`);
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
