#!/usr/bin/env node
// @ts-check

import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { auditPackageEntries, extractPackResult } from "./verify-package.mjs";

const MAX_TARBALL_BYTES = 20 * 1024 * 1024;
const MAX_TARBALL_ENTRIES = 512;
const MAX_TARBALL_PATH_BYTES = 4 * 1024;
const MAX_TAR_LISTING_BYTES = 4 * 1024 * 1024;
const MAX_EXTRACTED_PACKAGE_BYTES = 20 * 1024 * 1024;
const MAX_PROVENANCE_BYTES = 128 * 1024;
const MAX_SIGNATURE_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_CHUNKS = 65_536;
const MAX_CHILD_PROCESS_MS = 180_000;
const NO_FOLLOW = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;
const SHA512_HEX = /^[0-9a-f]{128}$/iu;
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/u;
const SHASUM = /^[0-9a-f]{40}$/iu;
const NPM_PROVENANCE_PREDICATE = "https://slsa.dev/provenance/v1";
const RELEASE_WORKFLOW_PATH = ".github/workflows/release-publish.yml";
const RELEASE_REPOSITORY = "https://github.com/ahoooooooo/reviewready";

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
 * Read one bounded regular file through a stable descriptor.
 *
 * @param {string} path
 * @param {number} limit
 * @param {string} label
 * @param {() => void} [afterOpen]
 * @returns {Buffer}
 */
export function readBoundedFile(path, limit, label, afterOpen) {
  let before;
  try {
    before = lstatSync(path);
  } catch (error) {
    throw new Error(label + " is unavailable", { cause: error });
  }
  if (before.isSymbolicLink() || !before.isFile() || before.size > limit) {
    throw new Error(label + " is too large or not a regular file");
  }
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | NO_FOLLOW);
  } catch (error) {
    throw new Error(label + " cannot be opened safely", { cause: error });
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
      opened.ctimeMs !== before.ctimeMs ||
      opened.size > limit
    ) {
      throw new Error(label + " changed during read");
    }
    afterOpen?.();
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = readSync(descriptor, bytes, offset, bytes.byteLength - offset, null);
      if (count <= 0) {
        throw new Error(label + " changed during read");
      }
      offset += count;
    }
    const extra = Buffer.alloc(1);
    if (readSync(descriptor, extra, 0, 1, null) > 0) {
      throw new Error(label + " changed during read");
    }
    const afterDescriptor = fstatSync(descriptor);
    let afterPath;
    try {
      afterPath = lstatSync(path);
    } catch (error) {
      throw new Error(label + " changed during read", { cause: error });
    }
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
      throw new Error(label + " changed during read");
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

/**
 * @param {string | Uint8Array} value
 * @returns {string}
 */
export function sha512Hex(value) {
  return createHash("sha512").update(value).digest("hex");
}

/**
 * @param {string | Uint8Array} value
 * @returns {string}
 */
export function sha1Hex(value) {
  return createHash("sha1").update(value).digest("hex");
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
    "localShasum",
    "registryIntegrity",
    "registryShasum",
    "provenancePredicateType",
    "provenanceRepository",
    "provenanceWorkflow",
    "provenanceRef",
    "provenanceCommit",
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
  const localShasum = /** @type {string} */ (provenance.localShasum);
  const registryIntegrity = /** @type {string} */ (provenance.registryIntegrity);
  const registryShasum = /** @type {string} */ (provenance.registryShasum);
  if (
    !SHA512_HEX.test(localSha512) ||
    !SHASUM.test(localShasum) ||
    !SHA512_INTEGRITY.test(registryIntegrity) ||
    !SHASUM.test(registryShasum)
  ) {
    throw new Error("release SHA-512 metadata is invalid");
  }
  const registryHex = Buffer.from(registryIntegrity.slice("sha512-".length), "base64").toString(
    "hex"
  );
  if (registryHex !== localSha512) {
    throw new Error("registry integrity does not match local tarball");
  }
  if (registryShasum !== localShasum) {
    throw new Error("registry shasum does not match the local tarball");
  }
  if (provenance.provenancePredicateType !== NPM_PROVENANCE_PREDICATE) {
    throw new Error("npm provenance predicate type is invalid");
  }
  if (
    provenance.provenanceRepository !== RELEASE_REPOSITORY ||
    provenance.provenanceWorkflow !== RELEASE_WORKFLOW_PATH ||
    provenance.provenanceRef !== "refs/heads/main" ||
    provenance.provenanceCommit !== mainCommit
  ) {
    throw new Error("npm provenance does not bind the release workflow and commit");
  }
  const expectedTarball =
    "https://registry.npmjs.org/@ahoooooo/reviewready/-/reviewready-" + version + ".tgz";
  const expectedRelease = "https://github.com/ahoooooooo/reviewready/releases/tag/v" + version;
  if (provenance.tarballUrl !== expectedTarball || provenance.releaseUrl !== expectedRelease) {
    throw new Error("public release URL is invalid");
  }
}

/**
 * @typedef {(input: string, init?: RequestInit) => Promise<Response>} ReleaseFetch
 */

/**
 * @typedef {(args: string[], cwd: string) => string} NpmRunner
 */

/**
 * @param {string} url
 * @param {string} host
 * @param {number} limit
 * @param {ReleaseFetch} fetchImpl
 * @returns {Promise<Buffer>}
 */
export async function fetchBounded(url, host, limit, fetchImpl) {
  const parsed = new globalThis.URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== host || parsed.port !== "") {
    throw new Error("release verification endpoint is not trusted");
  }
  const response = await fetchImpl(url, {
    headers: { accept: "application/json", "user-agent": "reviewready-release-verifier" },
    signal: globalThis.AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    throw new Error("release verification endpoint returned an unexpected status");
  }
  if (response.url !== "") {
    const finalUrl = new globalThis.URL(response.url);
    if (finalUrl.protocol !== "https:" || finalUrl.hostname !== host || finalUrl.port !== "") {
      throw new Error("release verification endpoint redirected to an untrusted host");
    }
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/u.test(contentLength) || Number(contentLength) > limit)) {
    throw new Error("release verification response exceeds the bounded size");
  }
  if (response.body === null) {
    throw new Error("release verification response has no body");
  }
  const body = /** @type {ReadableStream<Uint8Array>} */ (response.body);
  const reader = body.getReader();
  /** @type {Buffer[]} */
  const chunks = [];
  let total = 0;
  let done = false;
  while (!done) {
    const result = await reader.read();
    done = result.done;
    if (done) continue;
    const chunk = result.value;
    if (chunk === undefined) {
      throw new Error("release verification response is malformed");
    }
    total += chunk.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("release verification response exceeds the bounded size");
    }
    if (chunks.length >= MAX_RESPONSE_CHUNKS) {
      await reader.cancel();
      throw new Error("release verification response exceeds the bounded chunk count");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * @param {string} url
 * @param {string} host
 * @param {ReleaseFetch} fetchImpl
 * @returns {Promise<Record<string, unknown>>}
 */
async function fetchJson(url, host, fetchImpl) {
  const bytes = await fetchBounded(url, host, MAX_PROVENANCE_BYTES, fetchImpl);
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("release verification endpoint returned invalid JSON");
  }
  return record(parsed);
}

/**
 * @param {string} changelog
 * @param {string} version
 * @returns {string}
 */
function releaseNotesForVersion(changelog, version) {
  const marker = "## [" + version + "]";
  const start = changelog.indexOf(marker);
  if (start < 0) {
    throw new Error("changelog does not contain the release version");
  }
  const next = changelog.indexOf("\n## [", start + marker.length);
  return changelog.slice(start, next < 0 ? changelog.length : next).trim();
}

/**
 * @param {Record<string, unknown>} provenance
 * @param {ReleaseFetch} fetchImpl
 * @param {string} expectedReleaseBody
 * @returns {Promise<void>}
 */
async function verifyPublicReleaseCoordinates(provenance, fetchImpl, expectedReleaseBody) {
  const version = /** @type {string} */ (provenance.version);
  const packageMetadata = await fetchJson(
    "https://registry.npmjs.org/@ahoooooo/reviewready",
    "registry.npmjs.org",
    fetchImpl
  );
  if (packageMetadata.name !== "@ahoooooo/reviewready") {
    throw new Error("registry package name does not match release provenance");
  }
  const distTags = record(packageMetadata["dist-tags"]);
  if (distTags.latest !== version) {
    throw new Error("registry latest dist-tag does not match release provenance");
  }
  const versions = record(packageMetadata.versions);
  const versionMetadata = record(versions[version]);
  const previousVersion = /** @type {string} */ (provenance.previousVersion);
  if (!isRecord(versions[previousVersion])) {
    throw new Error("previous npm release does not exist");
  }
  const dist = record(versionMetadata.dist);
  if (
    dist.integrity !== provenance.registryIntegrity ||
    dist.shasum !== provenance.registryShasum ||
    dist.tarball !== provenance.tarballUrl
  ) {
    throw new Error("registry metadata does not match release provenance");
  }
  const registryBytes = await fetchBounded(
    /** @type {string} */ (provenance.tarballUrl),
    "registry.npmjs.org",
    MAX_TARBALL_BYTES,
    fetchImpl
  );
  if (
    sha512Hex(registryBytes) !== provenance.localSha512 ||
    sha1Hex(registryBytes) !== provenance.localShasum
  ) {
    throw new Error("registry tarball bytes do not match release provenance");
  }

  const mainCommit = /** @type {string} */ (provenance.mainCommit);
  const releaseApi =
    "https://api.github.com/repos/ahoooooooo/reviewready/releases/tags/v" + version;
  const release = await fetchJson(releaseApi, "api.github.com", fetchImpl);
  const releaseBody = release.body;
  if (
    release.tag_name !== "v" + version ||
    release.target_commitish !== mainCommit ||
    release.draft !== false ||
    release.prerelease !== false ||
    release.name !== "ReviewReady " + version ||
    typeof releaseBody !== "string" ||
    releaseBody.trim() !== expectedReleaseBody
  ) {
    throw new Error("GitHub release metadata does not match release provenance");
  }
  const previousRelease = await fetchJson(
    "https://api.github.com/repos/ahoooooooo/reviewready/releases/tags/v" + previousVersion,
    "api.github.com",
    fetchImpl
  );
  if (
    previousRelease.tag_name !== "v" + previousVersion ||
    previousRelease.draft !== false ||
    previousRelease.prerelease !== false
  ) {
    throw new Error("previous GitHub release does not exist as a stable release");
  }
  const latestRelease = await fetchJson(
    "https://api.github.com/repos/ahoooooooo/reviewready/releases/latest",
    "api.github.com",
    fetchImpl
  );
  if (latestRelease.tag_name !== "v" + version) {
    throw new Error("GitHub latest release does not match release provenance");
  }

  /**
   * @param {string} tagName
   * @returns {Promise<string>}
   */
  const resolveTag = async (tagName) => {
    const ref = await fetchJson(
      "https://api.github.com/repos/ahoooooooo/reviewready/git/ref/tags/" + tagName,
      "api.github.com",
      fetchImpl
    );
    const object = record(ref.object);
    const objectType = object.type;
    const objectSha = object.sha;
    if (objectType === "commit" && typeof objectSha === "string" && COMMIT.test(objectSha)) {
      return objectSha;
    }
    if (objectType !== "tag" || typeof objectSha !== "string" || !COMMIT.test(objectSha)) {
      throw new Error("GitHub tag does not resolve to a commit");
    }
    const tagObject = await fetchJson(
      "https://api.github.com/repos/ahoooooooo/reviewready/git/tags/" + objectSha,
      "api.github.com",
      fetchImpl
    );
    const target = record(tagObject.object);
    if (target.type !== "commit" || typeof target.sha !== "string" || !COMMIT.test(target.sha)) {
      throw new Error("GitHub annotated tag does not resolve to a commit");
    }
    return target.sha;
  };

  if ((await resolveTag("v" + version)) !== mainCommit || (await resolveTag("v1")) !== mainCommit) {
    throw new Error("GitHub tags do not match release provenance");
  }
}

/**
 * @param {Record<string, unknown>} provenance
 * @param {string} cwd
 * @param {NpmRunner} npmRunner
 * @returns {void}
 */
function verifyNpmProvenance(provenance, cwd, npmRunner) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "reviewready-release-signatures-"));
  try {
    writeFileSync(
      join(temporaryRoot, "package.json"),
      JSON.stringify({
        name: "reviewready-release-signature-consumer",
        private: true,
        dependencies: { "@ahoooooo/reviewready": provenance.version }
      }),
      "utf8"
    );
    npmRunner(
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", temporaryRoot],
      cwd
    );
    const output = npmRunner(
      ["audit", "signatures", "--prefix", temporaryRoot, "--json", "--include-attestations"],
      cwd
    );
    if (Buffer.byteLength(output, "utf8") > MAX_SIGNATURE_OUTPUT_BYTES) {
      throw new Error("npm signature output exceeds the bounded size");
    }
    /** @type {unknown} */
    const parsed = JSON.parse(output);
    const data = record(parsed);
    const verified = Array.isArray(data.verified) ? /** @type {unknown[]} */ (data.verified) : [];
    const packageName = provenance.packageName;
    const version = provenance.version;
    const item = verified.find(
      (candidate) =>
        isRecord(candidate) && candidate.name === packageName && candidate.version === version
    );
    if (!isRecord(item)) {
      throw new Error("npm provenance attestation is missing for the release package");
    }
    const attestations = record(item.attestations);
    const npmProvenance = record(attestations.provenance);
    if (npmProvenance.predicateType !== NPM_PROVENANCE_PREDICATE) {
      throw new Error("npm provenance attestation predicate is invalid");
    }
    const bundles = Array.isArray(item.attestationBundles)
      ? /** @type {unknown[]} */ (item.attestationBundles)
      : [];
    const bundle = bundles.find(
      (candidate) => isRecord(candidate) && candidate.predicateType === NPM_PROVENANCE_PREDICATE
    );
    const bundleRecord = record(bundle);
    const bundleBody = record(bundleRecord.bundle);
    const dsse = record(bundleBody.dsseEnvelope);
    if (typeof dsse.payload !== "string") {
      throw new Error("npm provenance DSSE payload is missing");
    }
    /** @type {unknown} */
    const parsedPayload = JSON.parse(Buffer.from(dsse.payload, "base64").toString("utf8"));
    const payload = record(parsedPayload);
    if (payload.predicateType !== NPM_PROVENANCE_PREDICATE) {
      throw new Error("npm provenance payload predicate is invalid");
    }
    const subjects = Array.isArray(payload.subject)
      ? /** @type {unknown[]} */ (payload.subject)
      : [];
    const subject = subjects.find(
      (candidate) =>
        isRecord(candidate) &&
        isRecord(candidate.digest) &&
        candidate.digest.sha512 === provenance.localSha512
    );
    if (!isRecord(subject)) {
      throw new Error("npm provenance subject does not match the release tarball");
    }
    const predicate = record(payload.predicate);
    const buildDefinition = record(predicate.buildDefinition);
    const externalParameters = record(buildDefinition.externalParameters);
    const workflow = record(externalParameters.workflow);
    if (
      workflow.repository !== RELEASE_REPOSITORY ||
      workflow.path !== RELEASE_WORKFLOW_PATH ||
      workflow.ref !== provenance.provenanceRef
    ) {
      throw new Error("npm provenance workflow identity does not match release provenance");
    }
    const resolvedDependencies = Array.isArray(buildDefinition.resolvedDependencies)
      ? buildDefinition.resolvedDependencies
      : [];
    const resolvedCommit = resolvedDependencies.some(
      (dependency) =>
        isRecord(dependency) &&
        isRecord(dependency.digest) &&
        dependency.digest.gitCommit === provenance.mainCommit
    );
    if (!resolvedCommit) {
      throw new Error("npm provenance source commit does not match release provenance");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("npm provenance")) {
      throw error;
    }
    throw new Error("npm provenance verification failed", { cause: error });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

/**
 * Verify the recorded artifact and all public coordinates.
 *
 * @param {unknown} value
 * @param {string} artifactPath
 * @param {{ cwd?: string, fetchImpl?: ReleaseFetch, npmRunner?: NpmRunner }} [options]
 * @returns {Promise<void>}
 */
export async function verifyReleaseProvenance(value, artifactPath, options = {}) {
  assertReleaseProvenance(value);
  const bytes = readBoundedFile(artifactPath, MAX_TARBALL_BYTES, "release provenance artifact");
  const provenance = /** @type {Record<string, unknown>} */ (value);
  if (sha512Hex(bytes) !== provenance.localSha512) {
    throw new Error("local tarball SHA-512 does not match release provenance");
  }
  if (sha1Hex(bytes) !== provenance.localShasum) {
    throw new Error("local tarball SHA-1 does not match release provenance");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("release verification fetch is unavailable");
  }
  const projectRoot = options.cwd ?? process.cwd();
  const expectedReleaseBody = releaseNotesForVersion(
    readFileSync(join(projectRoot, "CHANGELOG.md"), "utf8"),
    /** @type {string} */ (provenance.version)
  );
  await verifyPublicReleaseCoordinates(provenance, fetchImpl, expectedReleaseBody);
  verifyNpmProvenance(provenance, projectRoot, options.npmRunner ?? runNpm);
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
 * @param {string} status
 * @returns {void}
 */
export function assertActionBundleClean(status) {
  if (status.trim().length > 0) {
    throw new Error("Action bundle must be clean before release preflight");
  }
}

/**
 * @param {string} projectRoot
 * @returns {string}
 */
function actionBundleStatus(projectRoot) {
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
    { cwd: projectRoot, encoding: "utf8", timeout: MAX_CHILD_PROCESS_MS }
  );
  return status;
}

/**
 * @param {string} projectRoot
 * @returns {string}
 */
function actionBundleState(projectRoot) {
  const status = actionBundleStatus(projectRoot);
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
      maxBuffer: MAX_SIGNATURE_OUTPUT_BYTES,
      timeout: MAX_CHILD_PROCESS_MS,
      stdio: ["ignore", "pipe", "inherit"]
    });
  }
  if (process.platform === "win32") {
    const bundledNpmCli = join(
      dirname(process.execPath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js"
    );
    if (existsSync(bundledNpmCli)) {
      return execFileSync(process.execPath, [bundledNpmCli, ...args], {
        cwd,
        encoding: "utf8",
        timeout: MAX_CHILD_PROCESS_MS,
        maxBuffer: MAX_SIGNATURE_OUTPUT_BYTES,
        stdio: ["ignore", "pipe", "inherit"]
      });
    }
  }
  return execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd,
    encoding: "utf8",
    timeout: MAX_CHILD_PROCESS_MS,
    maxBuffer: MAX_SIGNATURE_OUTPUT_BYTES,
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
    timeout: MAX_CHILD_PROCESS_MS,
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
  const output = execFileSync(tar, ["-tzf", tarballPath], {
    encoding: "utf8",
    timeout: MAX_CHILD_PROCESS_MS,
    maxBuffer: MAX_TAR_LISTING_BYTES
  });
  const files = [];
  let entryCount = 0;
  for (const rawLine of output.split(/\r?\n/u)) {
    if (rawLine.length === 0) {
      continue;
    }
    if (Buffer.byteLength(rawLine, "utf8") > MAX_TARBALL_PATH_BYTES) {
      throw new Error("tarball entry path is too long");
    }
    entryCount += 1;
    if (entryCount > MAX_TARBALL_ENTRIES) {
      throw new Error("tarball contains too many entries");
    }
    const directory = rawLine.endsWith("/");
    const entry = normalizePackagedPath(directory ? rawLine.slice(0, -1) : rawLine);
    if (entry === "package" && directory) {
      continue;
    }
    if (!entry.startsWith("package/")) {
      throw new Error("tarball entry is outside package root");
    }
    const path = entry.slice("package/".length);
    if (path.length === 0 || directory) {
      throw new Error("tarball file path is empty");
    }
    files.push(path);
  }
  return files.sort();
}

/**
 * @param {string} tarballPath
 * @returns {void}
 */
function assertTarballEntryTypes(tarballPath) {
  const tar = process.platform === "win32" ? "tar.exe" : "tar";
  const output = execFileSync(tar, ["-tvzf", tarballPath], {
    encoding: "utf8",
    timeout: MAX_CHILD_PROCESS_MS,
    maxBuffer: MAX_TAR_LISTING_BYTES
  });
  for (const rawLine of output.split(/\r?\n/u)) {
    if (rawLine.length === 0) {
      continue;
    }
    const type = rawLine[0];
    if (type !== "-" && type !== "d") {
      throw new Error("tarball contains a link or special entry");
    }
  }
}

/**
 * @param {string} tarballPath
 * @param {string} path
 * @param {number} remainingBytes
 * @returns {Buffer}
 */
function readTarballFile(tarballPath, path, remainingBytes) {
  if (remainingBytes <= 0) {
    throw new Error("tarball extracted package is too large");
  }
  const tar = process.platform === "win32" ? "tar.exe" : "tar";
  try {
    const bytes = execFileSync(tar, ["-xOf", tarballPath, "package/" + path], {
      timeout: MAX_CHILD_PROCESS_MS,
      maxBuffer: Math.min(MAX_TARBALL_BYTES + 1, remainingBytes + 1),
      stdio: ["ignore", "pipe", "inherit"]
    });
    if (bytes.byteLength > remainingBytes) {
      throw new Error("tarball extracted package is too large");
    }
    return bytes;
  } catch (error) {
    throw new Error("tarball member could not be read within bounds: " + path, { cause: error });
  }
}

/**
 * @param {string} projectRoot
 * @param {string} artifactRoot
 * @returns {{ tarballPath: string, sha512: string, shasum: string, fileCount: number }}
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
  if (packResult.files.length > MAX_TARBALL_ENTRIES) {
    throw new Error("npm pack returned too many package files");
  }
  const tarballPath = resolve(artifactAbsolute, basename(filename));
  if (!tarballPath.startsWith(`${artifactAbsolute}${sep}`) || !existsSync(tarballPath)) {
    throw new Error("npm pack returned an unsafe artifact path");
  }
  const tarballBytes = readBoundedFile(tarballPath, MAX_TARBALL_BYTES, "release tarball");
  const memberRoot = mkdtempSync(join(artifactAbsolute, "members-"));
  try {
    const snapshotPath = join(memberRoot, "audited-release.tgz");
    writeFileSync(snapshotPath, tarballBytes, { mode: 0o600 });
    assertTarballEntryTypes(snapshotPath);
    const tarFiles = listTarballFiles(snapshotPath);
    const manifestFiles = packResult.files
      .map((file) => {
        const path = normalizePackagedPath(file.path);
        if (Buffer.byteLength(path, "utf8") > MAX_TARBALL_PATH_BYTES) {
          throw new Error("npm pack returned an overlong package path");
        }
        return path;
      })
      .sort();
    if (JSON.stringify(tarFiles) !== JSON.stringify(manifestFiles)) {
      throw new Error("npm pack manifest does not match the exact tarball contents");
    }
    const entries = [];
    let totalBytes = 0;
    for (const path of tarFiles) {
      const remainingBytes = MAX_EXTRACTED_PACKAGE_BYTES - totalBytes;
      const content = readTarballFile(snapshotPath, path, remainingBytes);
      totalBytes += content.byteLength;
      entries.push({ path, content: content.toString("utf8") });
    }
    const errors = auditPackageEntries(entries);
    if (errors.length > 0) {
      throw new Error(`package audit failed: ${errors.join("; ")}`);
    }
    return {
      tarballPath,
      sha512: sha512Hex(tarballBytes),
      shasum: sha1Hex(tarballBytes),
      fileCount: entries.length
    };
  } finally {
    rmSync(memberRoot, { recursive: true, force: true });
  }
}

/**
 * @param {string} projectRoot
 * @param {string} tarballPath
 * @param {string} expectedSha512
 * @returns {void}
 */
function verifyCleanRoom(projectRoot, tarballPath, expectedSha512) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "reviewready-clean-room-"));
  try {
    const tarballBytes = readBoundedFile(tarballPath, MAX_TARBALL_BYTES, "release tarball");
    if (sha512Hex(tarballBytes) !== expectedSha512) {
      throw new Error("release tarball changed after exact artifact verification");
    }
    const snapshotPath = join(temporaryRoot, "audited-release.tgz");
    writeFileSync(snapshotPath, tarballBytes, { mode: 0o600 });
    runNpm(
      [
        "install",
        "--ignore-scripts",
        "--no-package-lock",
        "--no-audit",
        "--no-fund",
        "--prefix",
        temporaryRoot,
        snapshotPath
      ],
      projectRoot
    );
    const installedRoot = join(temporaryRoot, "node_modules", "@ahoooooo", "reviewready");
    const cli = join(installedRoot, "dist", "cli.js");
    if (!existsSync(cli)) {
      throw new Error("clean-room installation did not contain the CLI");
    }
    const evidenceSchemaPath = join(installedRoot, "reviewready.audit-evidence.schema.json");
    if (!existsSync(evidenceSchemaPath)) {
      throw new Error("clean-room installation did not contain the evidence schema");
    }
    const evidenceSchema = record(readJson(evidenceSchemaPath));
    if (evidenceSchema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
      throw new Error("clean-room evidence schema is not Draft 2020-12");
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
    const evidenceFixture = join(projectRoot, "fixtures", "audit", "evidence-bundle-v1.json");
    const replayOutput = runNode(
      [cli, "audit", "replay", "--bundle", evidenceFixture, "--json"],
      projectRoot
    );
    const replayReport = record(JSON.parse(replayOutput));
    if (replayReport.status !== "pass") {
      throw new Error("clean-room evidence replay did not produce a pass result");
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
 * @returns {{ tarballPath: string, sha512: string, shasum: string, fileCount: number }}
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
    assertActionBundleClean(actionBundleStatus(projectRoot));
    const bundleBefore = actionBundleState(projectRoot);
    runNpm(["run", "bundle"], projectRoot);
    assertActionBundleSynchronized(bundleBefore, actionBundleState(projectRoot));
    const result = verifyExactTarball(projectRoot, artifactRoot);
    verifyCleanRoom(projectRoot, result.tarballPath, result.sha512);
    return result;
  } finally {
    if (ownsArtifactRoot) {
      rmSync(artifactRoot, { recursive: true, force: true });
    }
  }
}

export async function main() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const provenanceFlag = process.argv.indexOf("--provenance");
  if (provenanceFlag >= 0) {
    const evidencePath = process.argv[provenanceFlag + 1];
    const artifactFlag = process.argv.indexOf("--artifact");
    const artifactPath = artifactFlag >= 0 ? process.argv[artifactFlag + 1] : undefined;
    if (
      evidencePath === undefined ||
      evidencePath.startsWith("--") ||
      artifactFlag < 0 ||
      artifactPath === undefined ||
      artifactPath.startsWith("--") ||
      process.argv.some(
        (argument, index) => index !== provenanceFlag && argument === "--provenance"
      ) ||
      process.argv.some((argument, index) => index !== artifactFlag && argument === "--artifact")
    ) {
      throw new Error("--provenance requires an evidence JSON path and --artifact tarball path");
    }
    const absoluteEvidencePath = resolve(process.cwd(), evidencePath);
    const absoluteArtifactPath = resolve(process.cwd(), artifactPath);
    const evidence = /** @type {unknown} */ (
      JSON.parse(
        readBoundedFile(
          absoluteEvidencePath,
          MAX_PROVENANCE_BYTES,
          "release provenance evidence"
        ).toString("utf8")
      )
    );
    await verifyReleaseProvenance(evidence, absoluteArtifactPath, { cwd: projectRoot });
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

/* c8 ignore start -- the module bootstrap is exercised by the CLI smoke workflow. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "release verification failed";
    process.stderr.write(message + "\n");
    process.exitCode = 1;
  }
}
/* c8 ignore stop */
