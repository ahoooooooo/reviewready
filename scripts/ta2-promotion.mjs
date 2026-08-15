#!/usr/bin/env node
// @ts-check

import { execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const PROMOTION_REPOSITORY = "ahoooooooo/reviewready";
export const PROMOTION_REF = "refs/heads/main";
export const PROMOTION_POLICY_PATH = ".reviewready.yml";
export const PROMOTION_TRUSTED_WORKFLOW = ".github/workflows/reviewready-trusted.yml";
export const PROMOTION_WORKFLOW_PATH = ".github/workflows/reviewready-ta2-promotion.yml";
export const PROMOTION_EVENT_NAMES = ["push:", "workflow_dispatch:"];

const SHA = /^[0-9a-f]{40}$/iu;
const MAX_TOKEN_BYTES = 16_384;
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
const MAX_CHILD_OUTPUT_BYTES = 1 * 1024 * 1024;
const MAX_CHILD_PROCESS_MS = 180_000;
const ALLOWED_EVENTS = new Set(["push", "workflow_dispatch"]);
const AUDIT_EXIT_CODES = [0, 1, 2];
const NO_FOLLOW = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
const DIRECTORY_FD_SUPPORTED =
  process.platform === "linux" &&
  typeof constants.O_DIRECTORY === "number" &&
  typeof constants.O_NOFOLLOW === "number";
const DIRECTORY_FD_ROOT = "/proc/self/fd";
const CHILD_DIRECTORY_FD = 3;
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

/** @typedef {(projectRoot: string, args: readonly string[], environment: NodeJS.ProcessEnv, maxOutputBytes?: number, allowedExitCodes?: readonly number[], directoryDescriptor?: number) => Buffer} CommandRunner */
/** @typedef {{stats: import("node:fs").Stats, bytes: number, sha256: string}} OwnedEvidenceFile */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {string} detail @returns {never} */
function promotionFailure(detail) {
  throw new Error("trusted TA-2 promotion environment: " + detail);
}

/**
 * @param {NodeJS.ProcessEnv} environment
 * @param {readonly string[]} args
 * @returns {{repository: string, revision: string, outputRoot: string}}
 */
export function validatePromotionEnvironment(environment, args) {
  if (args.length !== 0) {
    throw new Error("trusted TA-2 promotion accepts no arguments");
  }
  const event = environment.GITHUB_EVENT_NAME;
  const workflowRef = PROMOTION_REPOSITORY + "/" + PROMOTION_WORKFLOW_PATH + "@" + PROMOTION_REF;
  const token = environment.GITHUB_TOKEN;
  const runnerTemp = environment.RUNNER_TEMP;
  const revision = environment.GITHUB_SHA;
  if (typeof revision !== "string") {
    promotionFailure("repository revision is missing");
  }
  if (
    environment.GITHUB_ACTIONS !== "true" ||
    typeof event !== "string" ||
    !ALLOWED_EVENTS.has(event) ||
    environment.GITHUB_REPOSITORY !== PROMOTION_REPOSITORY ||
    environment.GITHUB_REF !== PROMOTION_REF ||
    environment.GITHUB_WORKFLOW_REF !== workflowRef ||
    !SHA.test(revision) ||
    typeof token !== "string" ||
    token.length === 0 ||
    Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES ||
    typeof runnerTemp !== "string" ||
    !isAbsolute(runnerTemp)
  ) {
    promotionFailure("repository, workflow, ref, SHA, token, or runner identity is invalid");
  }
  const runnerRoot = resolve(runnerTemp);
  const outputRoot = resolve(runnerRoot, "reviewready-ta2");
  const runnerPrefix = runnerRoot.endsWith(sep) ? runnerRoot : runnerRoot + sep;
  if (!outputRoot.startsWith(runnerPrefix)) {
    promotionFailure("evidence output escaped the runner temp directory");
  }
  return {
    repository: PROMOTION_REPOSITORY,
    revision: revision.toLowerCase(),
    outputRoot
  };
}

/**
 * @param {string} projectRoot
 * @param {readonly string[]} args
 * @param {NodeJS.ProcessEnv} environment
 * @param {number} [maxOutputBytes]
 * @param {readonly number[]} [allowedExitCodes]
 * @param {number} [directoryDescriptor]
 * @returns {Buffer}
 */
function runNode(
  projectRoot,
  args,
  environment,
  maxOutputBytes = MAX_CHILD_OUTPUT_BYTES,
  allowedExitCodes = [0],
  directoryDescriptor
) {
  try {
    const stdio = /** @type {import("node:child_process").StdioOptions} */ (
      directoryDescriptor !== undefined && DIRECTORY_FD_SUPPORTED
        ? ["ignore", "pipe", "pipe", directoryDescriptor]
        : ["ignore", "pipe", "pipe"]
    );
    const output = execFileSync(process.execPath, args, {
      cwd: projectRoot,
      env: environment,
      stdio,
      windowsHide: true,
      timeout: MAX_CHILD_PROCESS_MS,
      maxBuffer: maxOutputBytes
    });
    if (!Buffer.isBuffer(output)) {
      throw new Error("child output type is invalid");
    }
    return output;
  } catch (error) {
    if (
      isRecord(error) &&
      typeof error.status === "number" &&
      allowedExitCodes.includes(error.status) &&
      Buffer.isBuffer(error.stdout)
    ) {
      return error.stdout;
    }
    throw new Error("trusted TA-2 command failed closed", { cause: error });
  }
}

/**
 * @param {Buffer} bytes
 * @returns {void}
 */
function validateBundleEnvelope(bytes) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("trusted TA-2 evidence bundle is invalid");
  }
  if (
    !isRecord(parsed) ||
    parsed.bundleVersion !== 1 ||
    parsed.canonicalization !== "RFC8785" ||
    Object.keys(parsed).length !== BUNDLE_KEYS.length ||
    BUNDLE_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(parsed, key)) ||
    BUNDLE_KEYS.slice(2).some((key) => !isRecord(parsed[key]))
  ) {
    throw new Error("trusted TA-2 evidence bundle is invalid");
  }
}

/**
 * @param {Buffer} bytes
 * @param {string} repository
 * @param {string} revision
 * @returns {Record<string, unknown>}
 */
function parseReplay(bytes, repository, revision) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CHILD_OUTPUT_BYTES) {
    throw new Error("trusted TA-2 replay output is out of bounds");
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = /** @type {unknown} */ (JSON.parse(bytes.toString("utf8")));
  } catch {
    throw new Error("trusted TA-2 replay output is invalid");
  }
  if (
    !isRecord(parsed) ||
    parsed.auditVersion !== 1 ||
    typeof parsed.status !== "string" ||
    !["pass", "fail", "incomplete"].includes(parsed.status) ||
    !isRecord(parsed.repository) ||
    parsed.repository.owner !== repository.split("/")[0] ||
    parsed.repository.name !== repository.split("/")[1] ||
    parsed.repository.baseSha !== revision ||
    !Array.isArray(parsed.findings) ||
    parsed.findings.length > 500 ||
    parsed.findings.some((finding) => !isRecord(finding)) ||
    !Array.isArray(parsed.checked) ||
    parsed.checked.length > 20 ||
    parsed.checked.some((item) => typeof item !== "string")
  ) {
    throw new Error("trusted TA-2 replay report is invalid");
  }
  return parsed;
}

/**
 * @param {string} path
 * @returns {void}
 */
function ensureOutputDirectory(path) {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const segment of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, segment);
    let stats;
    try {
      stats = lstatSync(current);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        mkdirSync(current);
        stats = lstatSync(current);
      } else {
        throw error;
      }
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error("trusted TA-2 evidence output path is not a regular directory");
    }
  }
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
function samePath(left, right) {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/**
 * @param {string} path
 * @returns {string}
 */
function trustedOutputIdentity(path) {
  try {
    return resolve(realpathSync(path));
  } catch (error) {
    throw new Error("trusted TA-2 evidence output identity is unavailable", { cause: error });
  }
}

/**
 * @param {string} path
 * @param {string} expected
 * @returns {void}
 */
function assertTrustedOutputIdentity(path, expected) {
  if (!samePath(trustedOutputIdentity(path), expected)) {
    throw new Error("trusted TA-2 evidence output path changed");
  }
}

/**
 * @param {string} path
 * @param {number | undefined} directoryDescriptor
 * @returns {string}
 */
function trustedEvidencePath(path, directoryDescriptor) {
  return directoryDescriptor === undefined
    ? path
    : join(DIRECTORY_FD_ROOT, String(directoryDescriptor), basename(path));
}

/**
 * @param {string} path
 * @param {number | undefined} directoryDescriptor
 * @returns {string}
 */
function trustedChildEvidencePath(path, directoryDescriptor) {
  return directoryDescriptor === undefined || !DIRECTORY_FD_SUPPORTED
    ? trustedEvidencePath(path, directoryDescriptor)
    : join(DIRECTORY_FD_ROOT, String(CHILD_DIRECTORY_FD), basename(path));
}

/**
 * @param {string} path
 * @param {string} expected
 * @returns {number | undefined}
 */
function openTrustedOutputDirectory(path, expected) {
  if (!DIRECTORY_FD_SUPPORTED) {
    return undefined;
  }
  let descriptor;
  try {
    assertTrustedOutputIdentity(path, expected);
    const before = lstatSync(path);
    if (before.isSymbolicLink() || !before.isDirectory()) {
      throw new Error("trusted TA-2 evidence output path is not a regular directory");
    }
    descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | NO_FOLLOW);
    const opened = fstatSync(descriptor);
    const after = lstatSync(path);
    if (
      opened.isSymbolicLink() ||
      !opened.isDirectory() ||
      !sameEvidenceIdentity(before, opened) ||
      !sameEvidenceIdentity(opened, after)
    ) {
      throw new Error("trusted TA-2 evidence output path changed");
    }
    return descriptor;
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the original fail-closed error.
      }
    }
    throw new Error("trusted TA-2 evidence output directory handle is unavailable", {
      cause: error
    });
  }
}

/**
 * @param {string} path
 * @param {Buffer} bytes
 * @param {string} trustedRoot
 * @param {number | undefined} directoryDescriptor
 * @param {(path: string) => void} [beforeWrite]
 * @param {(path: string) => void} [beforeOpen]
 * @param {(descriptor: number, bytes: Buffer) => void} [writeBytes]
 * @param {(path: string) => void} [beforePartialCleanup]
 * @param {(path: string) => void} [afterClose]
 * @returns {import("node:fs").Stats}
 */
function writeEvidenceFile(
  path,
  bytes,
  trustedRoot,
  directoryDescriptor,
  beforeWrite,
  beforeOpen,
  writeBytes,
  beforePartialCleanup,
  afterClose
) {
  assertTrustedOutputIdentity(dirname(path), trustedRoot);
  beforeWrite?.(path);
  assertTrustedOutputIdentity(dirname(path), trustedRoot);
  beforeOpen?.(path);
  const evidencePath = trustedEvidencePath(path, directoryDescriptor);
  let descriptor;
  let openedStats;
  let created = false;
  let cleanupIncomplete = false;
  try {
    descriptor = openSync(
      evidencePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW,
      0o600
    );
    created = true;
    openedStats = fstatSync(descriptor);
    (
      writeBytes ??
      ((fileDescriptor, value) => {
        writeFileSync(fileDescriptor, value);
      })
    )(descriptor, bytes);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } finally {
        descriptor = undefined;
      }
    }
    if (created && openedStats !== undefined) {
      try {
        beforePartialCleanup?.(path);
        assertTrustedOutputIdentity(dirname(path), trustedRoot);
        const current = lstatSync(evidencePath);
        if (
          !current.isSymbolicLink() &&
          current.isFile() &&
          sameEvidenceIdentity(openedStats, current)
        ) {
          unlinkSync(evidencePath);
        }
      } catch {
        cleanupIncomplete = true;
      }
    }
    const message =
      "trusted TA-2 evidence output is not a new regular file" +
      (cleanupIncomplete ? "; TA-2 cleanup incomplete: " + path : "");
    throw new Error(message, {
      cause: error
    });
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
  try {
    afterClose?.(path);
    assertTrustedOutputIdentity(dirname(path), trustedRoot);
    const stats = lstatSync(evidencePath);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size !== bytes.byteLength) {
      throw new Error("trusted TA-2 evidence output is not a new regular file");
    }
    return stats;
  } catch (error) {
    try {
      assertTrustedOutputIdentity(dirname(path), trustedRoot);
      const current = lstatSync(evidencePath);
      if (
        !current.isSymbolicLink() &&
        current.isFile() &&
        sameEvidenceIdentity(openedStats, current)
      ) {
        unlinkSync(evidencePath);
      } else {
        cleanupIncomplete = true;
      }
    } catch {
      cleanupIncomplete = true;
    }
    const detail = error instanceof Error ? error.message : "trusted TA-2 evidence output failed";
    const message = detail + (cleanupIncomplete ? "; TA-2 cleanup incomplete: " + path : "");
    throw new Error(message, { cause: error });
  }
}

/**
 * @param {import("node:fs").Stats} left
 * @param {import("node:fs").Stats} right
 * @returns {boolean}
 */
function sameEvidenceFile(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

/**
 * @param {import("node:fs").Stats} left
 * @param {import("node:fs").Stats} right
 * @returns {boolean}
 */
function sameEvidenceIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

/**
 * @param {string} path
 * @param {string} trustedRoot
 * @param {number | undefined} directoryDescriptor
 * @returns {Buffer}
 */
function readStableEvidenceFile(path, trustedRoot, directoryDescriptor) {
  assertTrustedOutputIdentity(dirname(path), trustedRoot);
  const evidencePath = trustedEvidencePath(path, directoryDescriptor);
  const before = lstatSync(evidencePath);
  if (before.isSymbolicLink() || !before.isFile() || before.size > MAX_BUNDLE_BYTES) {
    throw new Error("trusted TA-2 evidence bundle changed during replay");
  }
  const descriptor = openSync(evidencePath, constants.O_RDONLY | NO_FOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (
      opened.isSymbolicLink() ||
      !opened.isFile() ||
      !sameEvidenceFile(before, opened) ||
      opened.size > MAX_BUNDLE_BYTES
    ) {
      throw new Error("trusted TA-2 evidence bundle changed during replay");
    }
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = readSync(descriptor, bytes, offset, bytes.byteLength - offset, null);
      if (count <= 0) {
        throw new Error("trusted TA-2 evidence bundle changed during replay");
      }
      offset += count;
    }
    const extra = Buffer.alloc(1);
    if (readSync(descriptor, extra, 0, 1, null) > 0) {
      throw new Error("trusted TA-2 evidence bundle changed during replay");
    }
    const afterDescriptor = fstatSync(descriptor);
    const afterPath = lstatSync(evidencePath);
    if (
      !sameEvidenceFile(opened, afterDescriptor) ||
      afterPath.isSymbolicLink() ||
      !sameEvidenceFile(opened, afterPath)
    ) {
      throw new Error("trusted TA-2 evidence bundle changed during replay");
    }
    assertTrustedOutputIdentity(dirname(path), trustedRoot);
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

/**
 * @param {string} path
 * @param {OwnedEvidenceFile} expected
 * @param {string} trustedRoot
 * @param {number | undefined} directoryDescriptor
 * @returns {void}
 */
function assertEvidenceOwnership(path, expected, trustedRoot, directoryDescriptor) {
  const bytes = readStableEvidenceFile(path, trustedRoot, directoryDescriptor);
  const stats = lstatSync(trustedEvidencePath(path, directoryDescriptor));
  if (
    !sameEvidenceIdentity(expected.stats, stats) ||
    bytes.byteLength !== expected.bytes ||
    sha256(bytes) !== expected.sha256
  ) {
    throw new Error("trusted TA-2 evidence bundle changed during replay");
  }
}

/**
 * @param {string} path
 * @param {number | undefined} [directoryDescriptor]
 * @returns {boolean}
 */
function evidencePathExists(path, directoryDescriptor) {
  try {
    lstatSync(trustedEvidencePath(path, directoryDescriptor));
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * @param {string} path
 * @param {string} quarantinePath
 * @param {number | undefined} directoryDescriptor
 * @returns {void}
 */
function restoreQuarantinedEvidenceFile(path, quarantinePath, directoryDescriptor) {
  try {
    const target = trustedEvidencePath(path, directoryDescriptor);
    if (!evidencePathExists(path, directoryDescriptor) && evidencePathExists(quarantinePath)) {
      renameSync(quarantinePath, target);
    }
  } catch {
    return;
  }
}

/**
 * Move an owned file to a private same-directory quarantine before removing it.
 * A replacement at the public path can therefore never be the file removed.
 *
 * @param {string} path
 * @param {string} trustedRoot
 * @param {OwnedEvidenceFile} expected
 * @param {number | undefined} directoryDescriptor
 * @param {(path: string) => void} [beforeUnlink]
 * @returns {void}
 */
function unlinkOwnedEvidenceFile(path, trustedRoot, expected, directoryDescriptor, beforeUnlink) {
  assertTrustedOutputIdentity(dirname(path), trustedRoot);
  const sourcePath = trustedEvidencePath(path, directoryDescriptor);
  const quarantinePath = sourcePath + ".reviewready-cleanup-" + randomUUID();
  let verified = false;
  try {
    renameSync(sourcePath, quarantinePath);
    assertTrustedOutputIdentity(dirname(path), trustedRoot);
    assertEvidenceOwnership(quarantinePath, expected, trustedRoot, directoryDescriptor);
    verified = true;
    beforeUnlink?.(path);
    if (evidencePathExists(path, directoryDescriptor)) {
      throw new Error("trusted TA-2 evidence bundle changed during replay");
    }
    unlinkSync(quarantinePath);
  } catch (error) {
    if (verified) {
      try {
        unlinkSync(quarantinePath);
      } catch {
        // Keep failure closed if cleanup of the owned quarantine is unavailable.
      }
    } else {
      restoreQuarantinedEvidenceFile(path, quarantinePath, directoryDescriptor);
    }
    throw error;
  }
}

/**
 * @param {string} path
 * @param {string} trustedRoot
 * @param {OwnedEvidenceFile} expected
 * @param {number | undefined} directoryDescriptor
 * @param {string[]} cleanupFailures
 * @returns {void}
 */
function tryRemoveEvidenceFile(path, trustedRoot, expected, directoryDescriptor, cleanupFailures) {
  try {
    unlinkOwnedEvidenceFile(path, trustedRoot, expected, directoryDescriptor);
  } catch {
    cleanupFailures.push(path);
  }
}

/**
 * @param {Buffer} bytes
 * @returns {string}
 */
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * @param {NodeJS.ProcessEnv} [environment]
 * @param {readonly string[]} [args]
 * @param {string} [projectRoot]
 * @param {{runNode?: CommandRunner, beforeEvidenceWrite?: (path: string) => void, beforeEvidenceOpen?: (path: string) => void, writeEvidenceBytes?: (descriptor: number, bytes: Buffer) => void, beforeEvidencePartialCleanup?: (path: string) => void, afterEvidenceClose?: (path: string) => void, afterEvidenceWrite?: (path: string) => void, beforeEvidenceUnlink?: (path: string) => void, beforeManifestWrite?: () => void}} [options]
 * @returns {Record<string, unknown>}
 */
export function runPromotion(
  environment = process.env,
  args = process.argv.slice(2),
  projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  options = {}
) {
  const commandRunner = options.runNode ?? runNode;
  const context = validatePromotionEnvironment(environment, args);
  const cli = join(projectRoot, "dist", "cli.js");
  if (!existsSync(cli) || !lstatSync(cli).isFile()) {
    throw new Error("trusted TA-2 CLI build is missing");
  }
  ensureOutputDirectory(context.outputRoot);
  const outputIdentity = trustedOutputIdentity(context.outputRoot);
  const bundlePath = join(context.outputRoot, "evidence-bundle-v1.json");
  const pendingBundlePath = join(context.outputRoot, "evidence-bundle-v1.json.pending");
  const replayPath = join(context.outputRoot, "replay.json");
  const manifestPath = join(context.outputRoot, "manifest.json");
  const outputDirectoryDescriptor = openTrustedOutputDirectory(context.outputRoot, outputIdentity);
  /** @param {string} path @param {Buffer} bytes @returns {import("node:fs").Stats} */
  const writeEvidence = (path, bytes) => {
    return writeEvidenceFile(
      path,
      bytes,
      outputIdentity,
      outputDirectoryDescriptor,
      options.beforeEvidenceWrite,
      options.beforeEvidenceOpen,
      options.writeEvidenceBytes,
      options.beforeEvidencePartialCleanup,
      options.afterEvidenceClose
    );
  };
  /** @param {string} path @param {OwnedEvidenceFile} expected @returns {void} */
  const assertOwnership = (path, expected) => {
    assertEvidenceOwnership(path, expected, outputIdentity, outputDirectoryDescriptor);
  };
  let finalBundleWritten = false;
  let replayWritten = false;
  let manifestWritten = false;
  let pendingBundleWritten = false;
  /** @type {OwnedEvidenceFile | undefined} */
  let pendingEvidence;
  /** @type {OwnedEvidenceFile | undefined} */
  let finalEvidence;
  /** @type {OwnedEvidenceFile | undefined} */
  let replayEvidence;
  /** @type {OwnedEvidenceFile | undefined} */
  let manifestEvidence;
  let complete = false;
  try {
    const collectArgs = [
      cli,
      "audit",
      "collect",
      "--github",
      context.repository,
      "--revision",
      context.revision,
      "--policy-path",
      PROMOTION_POLICY_PATH,
      "--protected-workflow",
      PROMOTION_TRUSTED_WORKFLOW,
      "--trusted-workflow",
      PROMOTION_TRUSTED_WORKFLOW
    ];
    const bundle = commandRunner(
      projectRoot,
      collectArgs,
      environment,
      MAX_BUNDLE_BYTES,
      AUDIT_EXIT_CODES,
      outputDirectoryDescriptor
    );
    if (bundle.byteLength === 0 || bundle.byteLength > MAX_BUNDLE_BYTES) {
      throw new Error("trusted TA-2 evidence bundle is out of bounds");
    }
    validateBundleEnvelope(bundle);
    const bundleSha256 = sha256(bundle);
    pendingEvidence = {
      stats: writeEvidence(pendingBundlePath, bundle),
      bytes: bundle.byteLength,
      sha256: bundleSha256
    };
    pendingBundleWritten = true;

    const offlineEnvironment = { ...environment };
    delete offlineEnvironment.GITHUB_TOKEN;
    delete offlineEnvironment.GH_TOKEN;
    delete offlineEnvironment.NODE_AUTH_TOKEN;
    const replayArgs = [
      cli,
      "audit",
      "replay",
      "--bundle",
      trustedChildEvidencePath(pendingBundlePath, outputDirectoryDescriptor),
      "--bundle-sha256",
      bundleSha256,
      "--json"
    ];
    assertTrustedOutputIdentity(context.outputRoot, outputIdentity);
    assertOwnership(pendingBundlePath, pendingEvidence);
    const replay = commandRunner(
      projectRoot,
      replayArgs,
      offlineEnvironment,
      MAX_CHILD_OUTPUT_BYTES,
      AUDIT_EXIT_CODES,
      outputDirectoryDescriptor
    );
    assertOwnership(pendingBundlePath, pendingEvidence);
    const replayAgain = commandRunner(
      projectRoot,
      replayArgs,
      offlineEnvironment,
      MAX_CHILD_OUTPUT_BYTES,
      AUDIT_EXIT_CODES,
      outputDirectoryDescriptor
    );
    assertOwnership(pendingBundlePath, pendingEvidence);
    const report = parseReplay(replay, context.repository, context.revision);
    if (!replay.equals(replayAgain)) {
      throw new Error("trusted TA-2 replay was not deterministic");
    }
    finalEvidence = {
      stats: writeEvidence(bundlePath, bundle),
      bytes: bundle.byteLength,
      sha256: bundleSha256
    };
    finalBundleWritten = true;
    options.afterEvidenceWrite?.(bundlePath);
    assertOwnership(bundlePath, finalEvidence);
    assertTrustedOutputIdentity(context.outputRoot, outputIdentity);
    assertOwnership(pendingBundlePath, pendingEvidence);
    unlinkOwnedEvidenceFile(
      pendingBundlePath,
      outputIdentity,
      pendingEvidence,
      outputDirectoryDescriptor,
      options.beforeEvidenceUnlink
    );
    pendingBundleWritten = false;
    pendingEvidence = undefined;
    const replaySha256 = sha256(replay);
    replayEvidence = {
      stats: writeEvidence(replayPath, replay),
      bytes: replay.byteLength,
      sha256: replaySha256
    };
    replayWritten = true;
    options.afterEvidenceWrite?.(replayPath);
    assertOwnership(replayPath, replayEvidence);
    assertOwnership(bundlePath, finalEvidence);

    const manifest = {
      version: 1,
      repository: context.repository,
      revision: context.revision,
      policyPath: PROMOTION_POLICY_PATH,
      protectedWorkflowPaths: [PROMOTION_TRUSTED_WORKFLOW],
      trustedWorkflowPaths: [PROMOTION_TRUSTED_WORKFLOW],
      bundleBytes: bundle.byteLength,
      bundleSha256,
      replayBytes: replay.byteLength,
      replaySha256,
      status: report.status
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest) + "\n", "utf8");
    options.beforeManifestWrite?.();
    manifestEvidence = {
      stats: writeEvidence(manifestPath, manifestBytes),
      bytes: manifestBytes.byteLength,
      sha256: sha256(manifestBytes)
    };
    manifestWritten = true;
    assertOwnership(manifestPath, manifestEvidence);
    assertOwnership(bundlePath, finalEvidence);
    assertOwnership(replayPath, replayEvidence);
    process.stdout.write(
      "TA-2 trusted promotion evidence written for " +
        context.repository +
        "@" +
        context.revision +
        ".\n"
    );
    complete = true;
    return manifest;
  } catch (error) {
    /** @type {string[]} */
    const cleanupFailures = [];
    if (!complete) {
      if (pendingBundleWritten) {
        if (pendingEvidence !== undefined) {
          tryRemoveEvidenceFile(
            pendingBundlePath,
            outputIdentity,
            pendingEvidence,
            outputDirectoryDescriptor,
            cleanupFailures
          );
        }
      }
      if (finalBundleWritten) {
        if (finalEvidence !== undefined) {
          tryRemoveEvidenceFile(
            bundlePath,
            outputIdentity,
            finalEvidence,
            outputDirectoryDescriptor,
            cleanupFailures
          );
        }
      }
      if (replayWritten) {
        if (replayEvidence !== undefined) {
          tryRemoveEvidenceFile(
            replayPath,
            outputIdentity,
            replayEvidence,
            outputDirectoryDescriptor,
            cleanupFailures
          );
        }
      }
      if (manifestWritten) {
        if (manifestEvidence !== undefined) {
          tryRemoveEvidenceFile(
            manifestPath,
            outputIdentity,
            manifestEvidence,
            outputDirectoryDescriptor,
            cleanupFailures
          );
        }
      }
    }
    if (cleanupFailures.length > 0) {
      const message = "TA-2 cleanup incomplete: " + cleanupFailures.join(", ");
      if (error instanceof Error) {
        error.message += "; " + message;
        throw error;
      }
      throw new Error(message, { cause: error });
    }
    throw error;
  } finally {
    if (outputDirectoryDescriptor !== undefined) {
      closeSync(outputDirectoryDescriptor);
    }
  }
}

/* c8 ignore start -- the workflow bootstrap is exercised outside unit tests. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runPromotion();
  } catch (error) {
    const message = error instanceof Error ? error.message : "trusted TA-2 promotion failed closed";
    process.stderr.write(message + "\n");
    process.exitCode = 1;
  }
}
/* c8 ignore stop */
