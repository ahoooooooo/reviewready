#!/usr/bin/env node
// @ts-check

import { execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const TA2_BUNDLE_FILE = "evidence-bundle-v1.json";
export const TA2_REPLAY_FILE = "replay.json";
export const TA2_MANIFEST_FILE = "manifest.json";

const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
const MAX_REPLAY_BYTES = 1 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_REPLAY_PROCESS_MS = 180_000;
const NO_FOLLOW = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
const SHA256 = /^[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/iu;
const BUNDLE_KEYS = [
  "bundleVersion",
  "canonicalization",
  "subject",
  "collection",
  "assertions",
  "snapshot",
  "artifacts",
  "report",
  "integrity"
];
const MANIFEST_KEYS = [
  "version",
  "repository",
  "revision",
  "policyPath",
  "protectedWorkflowPaths",
  "trustedWorkflowPaths",
  "bundleBytes",
  "bundleSha256",
  "replayBytes",
  "replaySha256",
  "status"
];
const REPLAY_ENVIRONMENT_KEYS = [
  "CI",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
  "WINDIR"
];
const EXPECTED_FILES = [TA2_BUNDLE_FILE, TA2_MANIFEST_FILE, TA2_REPLAY_FILE].sort();

/** @typedef {{output: Buffer, exitCode: number}} ReplayResult */
/** @typedef {(args: readonly string[], environment: NodeJS.ProcessEnv) => ReplayResult} ReplayRunner */
/** @typedef {{version: 1, repository: string, revision: string, policyPath: string, protectedWorkflowPaths: string[], trustedWorkflowPaths: string[], bundleBytes: number, bundleSha256: string, replayBytes: number, replaySha256: string, status: "pass" | "fail" | "incomplete"}} Manifest */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {string} detail @returns {never} */
function reviewFailure(detail) {
  throw new Error("TA-2 saved evidence review failed: " + detail);
}

/** @param {Buffer} bytes @returns {string} */
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** @param {import("node:fs").Stats} left @param {import("node:fs").Stats} right */
function sameStats(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

/** @param {string} path @param {number} maxBytes @param {string} label @returns {Buffer} */
function readStableFile(path, maxBytes, label) {
  let before;
  try {
    before = lstatSync(path);
  } catch {
    reviewFailure(label + " is unavailable");
  }
  if (before.isSymbolicLink() || !before.isFile() || before.size <= 0 || before.size > maxBytes) {
    reviewFailure(label + " is not a bounded regular file");
  }
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | NO_FOLLOW);
    const opened = fstatSync(descriptor);
    if (opened.isSymbolicLink() || !opened.isFile() || !sameStats(before, opened)) {
      reviewFailure(label + " changed during review");
    }
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = readSync(descriptor, bytes, offset, bytes.byteLength - offset, null);
      if (count <= 0) {
        reviewFailure(label + " changed during review");
      }
      offset += count;
    }
    const extra = Buffer.alloc(1);
    if (readSync(descriptor, extra, 0, 1, null) > 0) {
      reviewFailure(label + " changed during review");
    }
    const afterDescriptor = fstatSync(descriptor);
    const afterPath = lstatSync(path);
    if (
      !sameStats(opened, afterDescriptor) ||
      afterPath.isSymbolicLink() ||
      !sameStats(opened, afterPath)
    ) {
      reviewFailure(label + " changed during review");
    }
    return bytes;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("TA-2 saved evidence review failed:")) {
      throw error;
    }
    reviewFailure(label + " cannot be read safely");
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
  reviewFailure(label + " cannot be read safely");
}

/** @param {string} directory @returns {string} */
function validateDirectory(directory) {
  if (!isAbsolute(directory)) {
    reviewFailure("evidence directory must be absolute");
  }
  const absolute = resolve(directory);
  let stats;
  try {
    stats = lstatSync(absolute);
  } catch {
    reviewFailure("evidence directory is unavailable");
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    reviewFailure("evidence directory is not a regular directory");
  }
  let identity;
  try {
    identity = realpathSync(absolute);
  } catch {
    reviewFailure("evidence directory identity is unavailable");
  }
  if (resolve(identity) !== absolute) {
    reviewFailure("evidence directory identity changed");
  }
  return absolute;
}

/** @param {string[]} args @returns {{directory: string, repository: string, revision: string}} */
export function parseReviewArguments(args) {
  if (
    args.length !== 6 ||
    args[0] !== "--directory" ||
    args[2] !== "--repository" ||
    args[4] !== "--revision"
  ) {
    reviewFailure(
      "usage is --directory ABSOLUTE_DIR --repository OWNER/REPOSITORY --revision FULL_SHA"
    );
  }
  const directory = args[1];
  const repository = args[3];
  const revision = args[5];
  if (
    directory === undefined ||
    repository === undefined ||
    revision === undefined ||
    !repository.includes("/") ||
    repository.length > 200 ||
    !REVISION.test(revision)
  ) {
    reviewFailure("review identity is invalid");
  }
  return {
    directory: validateDirectory(directory),
    repository,
    revision: revision.toLowerCase()
  };
}

/** @param {Buffer} bytes @returns {void} */
function validateBundle(bytes) {
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    reviewFailure("saved evidence bundle is invalid");
  }
  if (
    !isRecord(value) ||
    (value.bundleVersion !== 1 && value.bundleVersion !== 2) ||
    value.canonicalization !== "RFC8785" ||
    Object.keys(value).length !== BUNDLE_KEYS.length ||
    BUNDLE_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    BUNDLE_KEYS.slice(2).some((key) => !isRecord(value[key]))
  ) {
    reviewFailure("saved evidence bundle envelope is invalid");
  }
}

/** @param {Buffer} bytes @param {string} repository @param {string} revision @returns {"pass" | "fail" | "incomplete"} */
function parseReplay(bytes, repository, revision) {
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    reviewFailure("saved replay report is invalid");
  }
  const [owner, name] = repository.split("/");
  if (
    !isRecord(value) ||
    value.auditVersion !== 1 ||
    !["pass", "fail", "incomplete"].includes(String(value.status)) ||
    !isRecord(value.repository) ||
    value.repository.owner !== owner ||
    value.repository.name !== name ||
    value.repository.baseSha !== revision ||
    !Array.isArray(value.findings) ||
    value.findings.length > 500 ||
    !Array.isArray(value.checked) ||
    value.checked.length > 20 ||
    value.checked.some((item) => typeof item !== "string")
  ) {
    reviewFailure("saved replay report is invalid");
  }
  return /** @type {"pass" | "fail" | "incomplete"} */ (value.status);
}

/** @param {"pass" | "fail" | "incomplete"} status @returns {0 | 1 | 2} */
function statusExitCode(status) {
  return status === "pass" ? 0 : status === "fail" ? 1 : 2;
}

/** @param {Buffer} bytes @returns {Manifest} */
function parseManifest(bytes) {
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    reviewFailure("saved evidence manifest is invalid");
  }
  if (
    !isRecord(value) ||
    Object.keys(value).length !== MANIFEST_KEYS.length ||
    MANIFEST_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    value.version !== 1 ||
    typeof value.repository !== "string" ||
    typeof value.revision !== "string" ||
    value.policyPath !== ".reviewready.yml" ||
    JSON.stringify(value.protectedWorkflowPaths) !==
      JSON.stringify([".github/workflows/reviewready-trusted.yml"]) ||
    JSON.stringify(value.trustedWorkflowPaths) !==
      JSON.stringify([".github/workflows/reviewready-trusted.yml"]) ||
    !Number.isSafeInteger(value.bundleBytes) ||
    !Number.isSafeInteger(value.replayBytes) ||
    typeof value.bundleSha256 !== "string" ||
    typeof value.replaySha256 !== "string" ||
    !SHA256.test(value.bundleSha256) ||
    !SHA256.test(value.replaySha256) ||
    !["pass", "fail", "incomplete"].includes(String(value.status))
  ) {
    reviewFailure("saved evidence manifest is invalid");
  }
  return /** @type {Manifest} */ (value);
}

/** @param {NodeJS.ProcessEnv} environment @returns {NodeJS.ProcessEnv} */
function replayEnvironment(environment) {
  /** @type {NodeJS.ProcessEnv} */
  const result = {};
  for (const key of REPLAY_ENVIRONMENT_KEYS) {
    const value = environment[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/** @param {string} projectRoot @returns {ReplayRunner} */
function defaultReplayRunner(projectRoot) {
  const cli = join(projectRoot, "dist", "cli.js");
  return (args, environment) => {
    try {
      const output = execFileSync(process.execPath, [cli, ...args], {
        cwd: projectRoot,
        env: replayEnvironment(environment),
        stdio: ["ignore", "pipe", "pipe"],
        timeout: MAX_REPLAY_PROCESS_MS,
        maxBuffer: MAX_REPLAY_BYTES,
        windowsHide: true
      });
      return { output: Buffer.from(output), exitCode: 0 };
    } catch (error) {
      if (
        isRecord(error) &&
        typeof error.status === "number" &&
        (error.status === 1 || error.status === 2) &&
        Buffer.isBuffer(error.stdout)
      ) {
        return { output: error.stdout, exitCode: error.status };
      }
      reviewFailure("offline replay process failed closed");
    }
  };
}

/**
 * @param {string} directory
 * @param {string} repository
 * @param {string} revision
 * @param {{runReplay?: ReplayRunner}} [options]
 * @returns {{repository: string, revision: string, status: "pass" | "fail" | "incomplete", bundleSha256: string, replaySha256: string}}
 */
export function reviewSavedEvidence(directory, repository, revision, options = {}) {
  const root = validateDirectory(directory);
  if (!repository.includes("/") || !REVISION.test(revision)) {
    reviewFailure("review identity is invalid");
  }
  const normalizedRevision = revision.toLowerCase();
  const names = readdirSync(root).sort();
  if (
    names.length !== EXPECTED_FILES.length ||
    names.some((name, index) => name !== EXPECTED_FILES[index])
  ) {
    reviewFailure("saved evidence directory contains unexpected files");
  }
  const manifest = parseManifest(
    readStableFile(join(root, TA2_MANIFEST_FILE), MAX_MANIFEST_BYTES, "saved evidence manifest")
  );
  if (
    manifest.repository !== repository ||
    manifest.revision !== normalizedRevision ||
    !Number.isInteger(manifest.bundleBytes) ||
    manifest.bundleBytes <= 0 ||
    manifest.bundleBytes > MAX_BUNDLE_BYTES ||
    !Number.isInteger(manifest.replayBytes) ||
    manifest.replayBytes <= 0 ||
    manifest.replayBytes > MAX_REPLAY_BYTES
  ) {
    reviewFailure("saved evidence identity or size does not match the requested revision");
  }
  const bundlePath = join(root, TA2_BUNDLE_FILE);
  const replayPath = join(root, TA2_REPLAY_FILE);
  const bundle = readStableFile(bundlePath, MAX_BUNDLE_BYTES, "saved evidence bundle");
  const replay = readStableFile(replayPath, MAX_REPLAY_BYTES, "saved replay report");
  const bundleDigest = sha256(bundle);
  const replayDigest = sha256(replay);
  if (
    bundle.byteLength !== manifest.bundleBytes ||
    bundleDigest !== manifest.bundleSha256 ||
    replay.byteLength !== manifest.replayBytes ||
    replayDigest !== manifest.replaySha256
  ) {
    reviewFailure("saved evidence digest or size does not match its manifest");
  }
  validateBundle(bundle);
  const savedStatus = parseReplay(replay, repository, normalizedRevision);
  const args = [
    "audit",
    "replay",
    "--bundle",
    bundlePath,
    "--bundle-sha256",
    bundleDigest,
    "--json"
  ];
  const replayResult = (
    options.runReplay ?? defaultReplayRunner(resolve(dirname(fileURLToPath(import.meta.url)), ".."))
  )(args, replayEnvironment(process.env));
  if (
    !Buffer.isBuffer(replayResult.output) ||
    replayResult.output.byteLength === 0 ||
    replayResult.output.byteLength > MAX_REPLAY_BYTES ||
    ![0, 1, 2].includes(replayResult.exitCode) ||
    !replay.equals(replayResult.output)
  ) {
    reviewFailure("offline replay differs from the saved report");
  }
  const replayStatus = parseReplay(replayResult.output, repository, normalizedRevision);
  if (
    replayStatus !== savedStatus ||
    replayStatus !== manifest.status ||
    replayResult.exitCode !== statusExitCode(replayStatus)
  ) {
    reviewFailure("offline replay status or exit class differs from the saved report");
  }
  return {
    repository,
    revision: normalizedRevision,
    status: savedStatus,
    bundleSha256: bundleDigest,
    replaySha256: replayDigest
  };
}

/* c8 ignore start -- the workflow invokes this entrypoint outside unit tests. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const identity = parseReviewArguments(process.argv.slice(2));
    const result = reviewSavedEvidence(identity.directory, identity.repository, identity.revision);
    process.stdout.write(
      "TA-2 saved evidence independently verified for " +
        result.repository +
        "@" +
        result.revision +
        " (" +
        result.status +
        ").\n"
    );
  } catch (error) {
    process.stderr.write(
      error instanceof Error ? error.message + "\n" : "TA-2 saved evidence review failed closed.\n"
    );
    process.exitCode = 1;
  }
}
/* c8 ignore stop */
