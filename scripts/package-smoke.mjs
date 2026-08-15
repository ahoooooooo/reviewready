#!/usr/bin/env node
// @ts-check

import { execFileSync, spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import {
  closeSync,
  constants,
  fstatSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;
const MAX_CHILD_PROCESS_MS = 180_000;
const NO_FOLLOW = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;

/**
 * @param {string[]} argv
 * @param {string} projectRoot
 * @returns {{ directory: string, ownsDirectory: boolean }}
 */
function artifactDirectory(argv, projectRoot) {
  const index = argv.indexOf("--artifact-dir");
  if (index < 0) {
    const directory = mkdtempSync(join(tmpdir(), "reviewready-package-smoke-artifact-"));
    try {
      runNpm(["pack", "--json", "--ignore-scripts", "--pack-destination", directory], projectRoot);
      return { directory, ownsDirectory: true };
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
  }
  const value = index < 0 ? undefined : argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error("package smoke requires --artifact-dir");
  }
  if (argv.some((value, position) => value === "--artifact-dir" && position !== index)) {
    throw new Error("--artifact-dir may be provided only once");
  }
  return { directory: resolve(value), ownsDirectory: false };
}

/**
 * Read an artifact through one stable descriptor before handing it to npm.
 *
 * @param {string} path
 * @param {() => void} [afterOpen]
 * @returns {Buffer}
 */
export function readStableArtifact(path, afterOpen) {
  let before;
  try {
    before = lstatSync(path);
  } catch (error) {
    throw new Error("package artifact is unavailable", { cause: error });
  }
  if (before.isSymbolicLink() || !before.isFile() || before.size > MAX_ARTIFACT_BYTES) {
    throw new Error("package artifact is too large or not a regular file");
  }
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | NO_FOLLOW);
  } catch (error) {
    throw new Error("package artifact cannot be opened safely", { cause: error });
  }
  try {
    const opened = fstatSync(descriptor);
    if (
      opened.isSymbolicLink() ||
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size ||
      opened.mtimeMs !== before.mtimeMs ||
      opened.ctimeMs !== before.ctimeMs
    ) {
      throw new Error("package artifact changed during read");
    }
    afterOpen?.();
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = readSync(descriptor, bytes, offset, bytes.byteLength - offset, null);
      if (count <= 0) {
        throw new Error("package artifact changed during read");
      }
      offset += count;
    }
    const extra = Buffer.alloc(1);
    if (readSync(descriptor, extra, 0, 1, null) > 0) {
      throw new Error("package artifact changed during read");
    }
    const afterDescriptor = fstatSync(descriptor);
    const afterPath = lstatSync(path);
    if (
      afterDescriptor.dev !== opened.dev ||
      afterDescriptor.ino !== opened.ino ||
      afterDescriptor.size !== opened.size ||
      afterDescriptor.mtimeMs !== opened.mtimeMs ||
      afterDescriptor.ctimeMs !== opened.ctimeMs ||
      afterPath.isSymbolicLink() ||
      !afterPath.isFile() ||
      afterPath.dev !== opened.dev ||
      afterPath.ino !== opened.ino ||
      afterPath.size !== opened.size ||
      afterPath.mtimeMs !== opened.mtimeMs ||
      afterPath.ctimeMs !== opened.ctimeMs
    ) {
      throw new Error("package artifact changed during read");
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

/**
 * @param {string} directory
 * @returns {string}
 */
function findArtifact(directory) {
  const entries = requireDirectoryEntries(directory);
  const tarballs = entries.filter((entry) => entry.endsWith(".tgz"));
  if (tarballs.length !== 1) {
    throw new Error("artifact directory must contain exactly one .tgz file");
  }
  const filename = tarballs[0];
  if (filename === undefined) {
    throw new Error("package artifact filename is missing");
  }
  const artifact = join(directory, filename);
  return artifact;
}

/**
 * @param {string} directory
 * @returns {string[]}
 */
function requireDirectoryEntries(directory) {
  return readdirSync(directory);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {string} output
 * @returns {string}
 */
function cliStatus(output) {
  const parsed = /** @type {unknown} */ (JSON.parse(output));
  if (!isRecord(parsed) || typeof parsed.status !== "string") {
    throw new Error("packaged CLI output did not contain a status");
  }
  return parsed.status;
}

/**
 * @param {string} executable
 * @param {string[]} arguments_
 * @param {string} cwd
 * @param {number} expectedStatus
 * @returns {{ stdout: string, stderr: string }}
 */
function runCli(executable, arguments_, cwd, expectedStatus) {
  const result = spawnSync(process.execPath, [executable, ...arguments_], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: MAX_CHILD_PROCESS_MS
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== expectedStatus) {
    throw new Error(
      "CLI exit status mismatch: expected " +
        String(expectedStatus) +
        ", received " +
        String(result.status)
    );
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

/**
 * @param {string[]} arguments_
 * @param {string} cwd
 * @returns {void}
 */
function runNpm(arguments_, cwd) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath !== undefined && !npmExecPath.toLowerCase().endsWith(".cmd")) {
    execFileSync(process.execPath, [npmExecPath, ...arguments_], {
      cwd,
      stdio: ["ignore", "ignore", "inherit"],
      windowsHide: true,
      timeout: MAX_CHILD_PROCESS_MS
    });
    return;
  }
  if (process.platform === "win32") {
    const bundledNpm = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    if (existsSync(bundledNpm)) {
      execFileSync(process.execPath, [bundledNpm, ...arguments_], {
        cwd,
        stdio: ["ignore", "ignore", "inherit"],
        windowsHide: true,
        timeout: MAX_CHILD_PROCESS_MS
      });
      return;
    }
  }
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", arguments_, {
    cwd,
    stdio: ["ignore", "ignore", "inherit"],
    windowsHide: true,
    timeout: MAX_CHILD_PROCESS_MS
  });
}

/**
 * @param {string} projectRoot
 * @returns {void}
 */
function runSmoke(projectRoot) {
  const artifactLocation = artifactDirectory(process.argv.slice(2), projectRoot);
  try {
    const artifact = findArtifact(artifactLocation.directory);
    const installRoot = mkdtempSync(join(tmpdir(), "reviewready-package-smoke-"));
    try {
      const artifactSnapshot = join(installRoot, "package.tgz");
      writeFileSync(artifactSnapshot, readStableArtifact(artifact), {
        flag: "wx",
        mode: 0o600
      });
      runNpm(
        [
          "install",
          "--ignore-scripts",
          "--no-package-lock",
          "--no-audit",
          "--no-fund",
          "--prefix",
          installRoot,
          artifactSnapshot
        ],
        projectRoot
      );

      const packageRoot = join(installRoot, "node_modules", "@ahoooooo", "reviewready");
      const cli = join(packageRoot, "dist", "cli.js");
      const packageManifest = /** @type {unknown} */ (
        JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"))
      );
      if (
        !isRecord(packageManifest) ||
        packageManifest.name !== "@ahoooooo/reviewready" ||
        !existsSync(cli)
      ) {
        throw new Error("installed package surface is incomplete");
      }
      if (
        existsSync(join(packageRoot, "scripts")) ||
        existsSync(join(packageRoot, "node_modules"))
      ) {
        throw new Error("installed package contains development-only files");
      }
      const evidenceSchemaPath = join(packageRoot, "reviewready.audit-evidence.schema.json");
      if (!existsSync(evidenceSchemaPath)) {
        throw new Error("packaged evidence schema is missing");
      }
      const evidenceSchema = /** @type {unknown} */ (
        JSON.parse(readFileSync(evidenceSchemaPath, "utf8"))
      );
      if (
        !isRecord(evidenceSchema) ||
        evidenceSchema.$schema !== "https://json-schema.org/draft/2020-12/schema"
      ) {
        throw new Error("packaged evidence schema is not Draft 2020-12");
      }

      const fixtureRoot = join(projectRoot, "fixtures", "basic");
      const smokeRoot = mkdtempSync(join(tmpdir(), "reviewready-package-fixtures-"));
      try {
        const policy = readFileSync(join(fixtureRoot, ".reviewready.yml"), "utf8");
        const ready = readFileSync(join(fixtureRoot, "ready.json"), "utf8");
        const notReady = readFileSync(join(fixtureRoot, "not-ready.json"), "utf8");
        const policyPath = join(smokeRoot, "policy-crlf.yml");
        const readyPath = join(smokeRoot, "ready-crlf.json");
        const notReadyPath = join(smokeRoot, "not-ready.json");
        const invalidPath = join(smokeRoot, "invalid.json");
        writeFileSync(policyPath, policy.replace(/\n/gu, "\r\n"), "utf8");
        writeFileSync(readyPath, ready.replace(/\n/gu, "\r\n"), "utf8");
        writeFileSync(notReadyPath, notReady, "utf8");
        writeFileSync(invalidPath, "{}", "utf8");

        runCli(cli, ["validate", "--policy", policyPath], projectRoot, 0);
        runCli(cli, ["explain", "--policy", policyPath], projectRoot, 0);
        const readyRun = runCli(
          cli,
          ["check", "--policy", policyPath, "--input", readyPath, "--json"],
          projectRoot,
          0
        );
        if (cliStatus(readyRun.stdout) !== "ready") {
          throw new Error("packaged CLI ready smoke case was not ready");
        }
        const notReadyRun = runCli(
          cli,
          ["check", "--policy", policyPath, "--input", notReadyPath, "--json"],
          projectRoot,
          1
        );
        if (cliStatus(notReadyRun.stdout) !== "not_ready") {
          throw new Error("packaged CLI not-ready smoke case was not not_ready");
        }
        const invalidRun = runCli(
          cli,
          ["check", "--policy", policyPath, "--input", invalidPath],
          projectRoot,
          2
        );
        if (!invalidRun.stderr.includes("[INPUT_SCHEMA_INVALID]")) {
          throw new Error("packaged CLI invalid-input diagnostic was not stable");
        }
        const evidenceFixture = join(projectRoot, "fixtures", "audit", "evidence-bundle-v1.json");
        const replayRun = runCli(
          cli,
          ["audit", "replay", "--bundle", evidenceFixture, "--json"],
          projectRoot,
          0
        );
        if (cliStatus(replayRun.stdout) !== "pass") {
          throw new Error("packaged CLI evidence replay was not pass");
        }
      } finally {
        rmSync(smokeRoot, { recursive: true, force: true });
      }
    } finally {
      rmSync(installRoot, { recursive: true, force: true });
    }
  } finally {
    if (artifactLocation.ownsDirectory) {
      rmSync(artifactLocation.directory, { recursive: true, force: true });
    }
  }
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
runSmoke(projectRoot);
process.stdout.write("Packaged Windows/Node smoke passed.\n");
