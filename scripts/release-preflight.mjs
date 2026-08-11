#!/usr/bin/env node
// @ts-check

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { auditPackageEntries, extractPackResult } from "./verify-package.mjs";

const MAX_TARBALL_BYTES = 20 * 1024 * 1024;

/**
 * @param {string | Uint8Array} value
 * @returns {string}
 */
export function sha512Hex(value) {
  return createHash("sha512").update(value).digest("hex");
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
    runNpm(["run", "bundle"], projectRoot);
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
