#!/usr/bin/env node
// @ts-check

import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { auditPackageEntries, extractPackResult } from "./verify-package.mjs";

const MAX_TARBALL_BYTES = 20 * 1024 * 1024;
const MAX_PROVENANCE_BYTES = 128 * 1024;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;
const SHA512_HEX = /^[0-9a-f]{128}$/iu;
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/u;
const SHASUM = /^[0-9a-f]{40}$/iu;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function record(value) {
  if (!isRecord(value)) {
    throw new Error("JSON value must be an object");
  }
  return value;
}

/**
 * @param {string} path
 * @returns {unknown}
 */
function readJson(path) {
  return /** @type {unknown} */ (JSON.parse(readFileSync(path, "utf8")));
}

/**
 * @param {string | Uint8Array} value
 * @returns {string}
 */
export function sha512Hex(value) {
  return createHash("sha512").update(value).digest("hex");
}

/**
 * @param {{ packageVersion: unknown, lockVersion: unknown, changelog: unknown }} value
 * @returns {string}
 */
export function assertReleaseMetadata(value) {
  if (
    typeof value.packageVersion !== "string" ||
    typeof value.lockVersion !== "string" ||
    typeof value.changelog !== "string"
  ) {
    throw new Error("release metadata is invalid");
  }
  if (value.packageVersion !== value.lockVersion) {
    throw new Error("package and lockfile versions must match");
  }
  if (!SEMVER.test(value.packageVersion)) {
    throw new Error("package version is not valid semantic version text");
  }
  if (!value.changelog.includes("## [" + value.packageVersion + "]")) {
    throw new Error("changelog does not document package version");
  }
  return value.packageVersion;
}

/**
 * @param {unknown} value
 * @returns {void}
 */
export function assertReleaseProvenance(value) {
  if (typeof value !== "object" || value === null) {
    throw new Error("release provenance is invalid");
  }
  const provenance = /** @type {Record<string, unknown>} */ (value);
  const requiredStrings = [
    "packageName",
    "version",
    "packageVersion",
    "lockVersion",
    "mainCommit",
    "immutableTagCommit",
    "stableTagCommit",
    "npmVersion",
    "npmLatestVersion",
    "previousVersion",
    "previousNpmVersion",
    "localSha512",
    "registryIntegrity",
    "registryShasum",
    "tarballUrl",
    "releaseUrl",
    "releaseTarget"
  ];
  for (const field of requiredStrings) {
    if (typeof provenance[field] !== "string" || provenance[field].length === 0) {
      throw new Error("release provenance field is invalid: " + field);
    }
  }
  const packageName = /** @type {string} */ (provenance.packageName);
  const version = /** @type {string} */ (provenance.version);
  if (packageName !== "@ahoooooo/reviewready" || !SEMVER.test(version)) {
    throw new Error("release package identity is invalid");
  }
  for (const field of ["packageVersion", "lockVersion", "npmVersion", "npmLatestVersion"]) {
    if (provenance[field] !== version) {
      throw new Error("release version does not agree: " + field);
    }
  }
  if (
    typeof provenance.previousVersion !== "string" ||
    !SEMVER.test(provenance.previousVersion) ||
    provenance.previousVersion === version ||
    provenance.previousNpmVersion !== provenance.previousVersion
  ) {
    throw new Error("previous release version is invalid");
  }
  const mainCommit = /** @type {string} */ (provenance.mainCommit);
  if (!COMMIT.test(mainCommit)) {
    throw new Error("release main commit is invalid");
  }
  if (provenance.immutableTagCommit !== mainCommit) {
    throw new Error("immutable release tag does not match main commit");
  }
  if (provenance.stableTagCommit !== mainCommit) {
    throw new Error("stable Action tag does not match main commit");
  }
  if (provenance.releaseTarget !== mainCommit) {
    throw new Error("GitHub release target does not match main commit");
  }
  const localSha512 = /** @type {string} */ (provenance.localSha512);
  const registryIntegrity = /** @type {string} */ (provenance.registryIntegrity);
  if (!SHA512_HEX.test(localSha512) || !SHA512_INTEGRITY.test(registryIntegrity)) {
    throw new Error("release SHA-512 metadata is invalid");
  }
  const registryHex = Buffer.from(registryIntegrity.slice("sha512-".length), "base64").toString(
    "hex"
  );
  if (registryHex !== localSha512) {
    throw new Error("registry integrity does not match local tarball");
  }
  if (!SHASUM.test(/** @type {string} */ (provenance.registryShasum))) {
    throw new Error("registry shasum is invalid");
  }
  const expectedTarball =
    "https://registry.npmjs.org/@ahoooooo/reviewready/-/reviewready-" + version + ".tgz";
  const expectedRelease = "https://github.com/ahoooooooo/reviewready/releases/tag/v" + version;
  if (provenance.tarballUrl !== expectedTarball || provenance.releaseUrl !== expectedRelease) {
    throw new Error("public release URL is invalid");
  }
}

/**
 * @param {string} before
 * @param {string} after
 * @returns {void}
 */
export function assertActionBundleSynchronized(before, after) {
  if (before !== after) {
    throw new Error("Action bundle changed during release preflight");
  }
}

/**
 * @param {string} projectRoot
 * @returns {string}
 */
function actionBundleState(projectRoot) {
  const git = process.platform === "win32" ? "git.exe" : "git";
  /** @param {string[]} arguments_ @returns {string[]} */
  const safeArguments = (arguments_) => [
    "-c",
    "safe.directory=" + resolve(projectRoot),
    ...arguments_
  ];
  const status = execFileSync(
    git,
    safeArguments([
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--ignored=matching",
      "--",
      "dist/action"
    ]),
    { cwd: projectRoot, encoding: "utf8" }
  );
  const bundleRoot = resolve(projectRoot, "dist/action");
  /** @type {Array<{ path: string, sha512?: string, special?: boolean }>} */
  const files = [];
  /**
   * @param {string} directory
   * @param {string} prefix
   * @returns {void}
   */
  const visit = (directory, prefix) => {
    if (!existsSync(directory)) {
      return;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix === "" ? entry.name : prefix + "/" + entry.name;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute, relative);
      } else if (entry.isFile()) {
        files.push({ path: relative, sha512: sha512Hex(readFileSync(absolute)) });
      } else {
        files.push({ path: relative, special: true });
      }
    }
  };
  visit(bundleRoot, "");
  files.sort((left, right) => left.path.localeCompare(right.path, "en-US"));
  return status + "\0" + JSON.stringify(files);
}

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizePackagedPath(value) {
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error("unsafe package path");
  }
  return normalized;
}

/**
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string}
 */
function runNpm(args, cwd) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    return execFileSync(process.execPath, [npmExecPath, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"]
    });
  }
  return execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"]
  });
}

/**
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string}
 */
function runNode(args, cwd) {
  return execFileSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"]
  });
}

/**
 * @param {unknown} parsed
 * @returns {string | undefined}
 */
function packFilename(parsed) {
  /** @type {unknown} */
  let candidate;
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1) {
      return undefined;
    }
    const values = /** @type {readonly unknown[]} */ (parsed);
    candidate = values[0];
  } else if (typeof parsed === "object" && parsed !== null) {
    const values = Object.values(/** @type {Record<string, unknown>} */ (parsed));
    if (values.length !== 1) {
      return undefined;
    }
    candidate = values[0];
  }
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return undefined;
  }
  const filename = /** @type {Record<string, unknown>} */ (candidate).filename;
  return typeof filename === "string" && filename.length > 0 ? filename : undefined;
}

/**
 * @param {string} tarballPath
 * @returns {string[]}
 */
function listTarballFiles(tarballPath) {
  const tar = process.platform === "win32" ? "tar.exe" : "tar";
  const output = execFileSync(tar, ["-tzf", tarballPath], { encoding: "utf8" });
  const files = [];
  for (const rawLine of output.split(/\r?\n/u)) {
    if (rawLine.length === 0 || rawLine.endsWith("/")) {
      continue;
    }
    const entry = normalizePackagedPath(rawLine);
    if (!entry.startsWith("package/")) {
      throw new Error("tarball entry is outside package root");
    }
    const path = entry.slice("package/".length);
    if (path.length === 0) {
      throw new Error("tarball file path is empty");
    }
    files.push(path);
  }
  return files.sort();
}

/**
 * @param {string} tarballPath
 * @param {string} extractionRoot
 * @returns {void}
 */
function extractTarball(tarballPath, extractionRoot) {
  mkdirSync(extractionRoot, { recursive: true });
  const tar = process.platform === "win32" ? "tar.exe" : "tar";
  execFileSync(tar, ["-xzf", tarballPath, "-C", extractionRoot], {
    stdio: ["ignore", "ignore", "inherit"]
  });
  const packageRoot = resolve(extractionRoot, "package");
  if (!existsSync(packageRoot) || !lstatSync(packageRoot).isDirectory()) {
    throw new Error("tarball has no package root");
  }
}

/**
 * @param {string} projectRoot
 * @param {string} artifactRoot
 * @returns {{ tarballPath: string, sha512: string, fileCount: number }}
 */
function verifyExactTarball(projectRoot, artifactRoot) {
  mkdirSync(artifactRoot, { recursive: true });
  const artifactAbsolute = resolve(artifactRoot);
  const output = runNpm(
    ["pack", "--json", "--ignore-scripts", "--pack-destination", artifactAbsolute],
    projectRoot
  );
  /** @type {unknown} */
  const parsed = JSON.parse(output);
  const packResult = extractPackResult(parsed);
  const filename = packFilename(parsed);
  if (!packResult || filename === undefined) {
    throw new Error("npm pack returned an unexpected artifact manifest");
  }
  const tarballPath = resolve(artifactAbsolute, basename(filename));
  if (!tarballPath.startsWith(`${artifactAbsolute}${sep}`) || !existsSync(tarballPath)) {
    throw new Error("npm pack returned an unsafe artifact path");
  }
  const tarballBytes = readFileSync(tarballPath);
  if (tarballBytes.byteLength > MAX_TARBALL_BYTES) {
    throw new Error("release tarball exceeds the bounded artifact size");
  }
  const extractionRoot = mkdtempSync(join(artifactAbsolute, "extract-"));
  try {
    extractTarball(tarballPath, extractionRoot);
    const tarFiles = listTarballFiles(tarballPath);
    const manifestFiles = packResult.files.map((file) => normalizePackagedPath(file.path)).sort();
    if (JSON.stringify(tarFiles) !== JSON.stringify(manifestFiles)) {
      throw new Error("npm pack manifest does not match the exact tarball contents");
    }
    const packageRoot = resolve(extractionRoot, "package");
    const packagePrefix = `${packageRoot}${sep}`;
    const entries = tarFiles.map((path) => {
      const absolutePath = resolve(packageRoot, path);
      if (!absolutePath.startsWith(packagePrefix) || !lstatSync(absolutePath).isFile()) {
        throw new Error(`tarball entry is not a regular file: ${path}`);
      }
      return { path, content: readFileSync(absolutePath, "utf8") };
    });
    const errors = auditPackageEntries(entries);
    if (errors.length > 0) {
      throw new Error(`package audit failed: ${errors.join("; ")}`);
    }
    return { tarballPath, sha512: sha512Hex(tarballBytes), fileCount: entries.length };
  } finally {
    rmSync(extractionRoot, { recursive: true, force: true });
  }
}

/**
 * @param {string} projectRoot
 * @param {string} tarballPath
 * @returns {void}
 */
function verifyCleanRoom(projectRoot, tarballPath) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "reviewready-clean-room-"));
  try {
    runNpm(
      [
        "install",
        "--ignore-scripts",
        "--no-package-lock",
        "--no-audit",
        "--no-fund",
        "--prefix",
        temporaryRoot,
        tarballPath
      ],
      projectRoot
    );
    const installedRoot = join(temporaryRoot, "node_modules", "@ahoooooo", "reviewready");
    const cli = join(installedRoot, "dist", "cli.js");
    if (!existsSync(cli)) {
      throw new Error("clean-room installation did not contain the CLI");
    }
    const policy = join(projectRoot, "fixtures", "basic", ".reviewready.yml");
    const readyInput = join(projectRoot, "fixtures", "basic", "ready.json");
    runNode([cli, "validate", "--policy", policy], projectRoot);
    const outputJson = runNode(
      [cli, "check", "--policy", policy, "--input", readyInput, "--json"],
      projectRoot
    );
    /** @type {unknown} */
    const report = JSON.parse(outputJson);
    if (
      typeof report !== "object" ||
      report === null ||
      /** @type {{ status?: unknown }} */ (report).status !== "ready"
    ) {
      throw new Error("clean-room CLI smoke test did not produce a ready result");
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

/**
 * Run the exact artifact and clean-room release checks.
 *
 * @param {string} projectRoot
 * @param {string} [requestedArtifactRoot]
 * @returns {{ tarballPath: string, sha512: string, fileCount: number }}
 */
export function runReleasePreflight(projectRoot, requestedArtifactRoot) {
  const ownsArtifactRoot = requestedArtifactRoot === undefined;
  const artifactRoot = ownsArtifactRoot
    ? mkdtempSync(join(tmpdir(), "reviewready-release-"))
    : resolve(/** @type {string} */ (requestedArtifactRoot));
  try {
    const packageManifest = record(readJson(join(projectRoot, "package.json")));
    const packageLock = record(readJson(join(projectRoot, "package-lock.json")));
    const lockPackages = packageLock.packages;
    const lockRoot = isRecord(lockPackages) ? lockPackages[""] : undefined;
    const lockVersion =
      packageLock.version === (isRecord(lockRoot) ? lockRoot.version : undefined)
        ? packageLock.version
        : "";
    assertReleaseMetadata({
      packageVersion: packageManifest.version,
      lockVersion,
      changelog: readFileSync(join(projectRoot, "CHANGELOG.md"), "utf8")
    });
    const bundleBefore = actionBundleState(projectRoot);
    runNpm(["run", "bundle"], projectRoot);
    assertActionBundleSynchronized(bundleBefore, actionBundleState(projectRoot));
    const result = verifyExactTarball(projectRoot, artifactRoot);
    verifyCleanRoom(projectRoot, result.tarballPath);
    return result;
  } finally {
    if (ownsArtifactRoot) {
      rmSync(artifactRoot, { recursive: true, force: true });
    }
  }
}

function main() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const provenanceFlag = process.argv.indexOf("--provenance");
  if (provenanceFlag >= 0) {
    const evidencePath = process.argv[provenanceFlag + 1];
    if (
      evidencePath === undefined ||
      evidencePath.startsWith("--") ||
      process.argv.some(
        (argument, index) => index !== provenanceFlag && argument === "--provenance"
      )
    ) {
      throw new Error("--provenance requires one evidence JSON path");
    }
    const absoluteEvidencePath = resolve(process.cwd(), evidencePath);
    const evidenceStats = lstatSync(absoluteEvidencePath);
    if (!evidenceStats.isFile() || evidenceStats.size > MAX_PROVENANCE_BYTES) {
      throw new Error("release provenance evidence is too large or not a file");
    }
    const evidence = readJson(absoluteEvidencePath);
    assertReleaseProvenance(evidence);
    process.stdout.write("Release provenance passed.\n");
    return;
  }
  const artifactFlag = process.argv.indexOf("--artifact-dir");
  const requestedArtifactRoot = artifactFlag < 0 ? undefined : process.argv[artifactFlag + 1];
  if (
    artifactFlag >= 0 &&
    (requestedArtifactRoot === undefined || requestedArtifactRoot.startsWith("--"))
  ) {
    throw new Error("--artifact-dir requires a directory");
  }
  const result = runReleasePreflight(projectRoot, requestedArtifactRoot);
  process.stdout.write(
    `Release preflight passed: ${String(result.fileCount)} files, SHA-512 ${result.sha512}.\nArtifact: ${result.tarballPath}\n`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
