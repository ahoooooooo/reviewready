#!/usr/bin/env node
// @ts-check

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRIVATE_TRACKED_PATH =
  /^(?:AGENTS\.md|HANDOFF\.md|\.agents(?:\/|$)|\.codex(?:\/|$)|\.reviewready-review(?:\/|$)|docs\/research(?:\/|$))/u;
const PROTOCOL_IDENTITY = "ReviewReady Evidence Protocol";
const PLAIN_SEMVER = /^\d+\.\d+\.\d+$/u;

/** @typedef {{ version: string, sourceCommit: string, schemaRef: string, releaseEvidence: string, npmLatestVersion: string }} StableRelease */
/** @typedef {{ version: string, releaseEvidence: string, releaseNotes: string }} ReleaseCandidate */
/** @typedef {{ version: string, mainCommit: string, immutableTagCommit: string, stableTagCommit: string, releaseTarget: string, npmLatestVersion: string }} ReleaseEvidence */
/** @typedef {{ version: string, description: string, keywords: string[] }} PackageManifest */
/** @typedef {{ version?: string }} LockPackage */
/** @typedef {{ packages?: Record<string, LockPackage> }} Lockfile */
/** @typedef {{ protocol: string }} ProductIdentity */
/** @typedef {{ mainStatus: string, mainMayDifferFromStableArtifact: boolean, publishedArtifactsImmutable: boolean, publishRequiresNewVersion: boolean }} SourcePolicy */
/** @typedef {{ authority: string }} ActionBoundary */
/** @typedef {{ status: string }} StatusBoundary */
/** @typedef {{ action: ActionBoundary, githubApp: StatusBoundary, providerSdk: StatusBoundary }} CapabilityBoundary */
/** @typedef {{ schema: string, product: ProductIdentity, stableRelease: StableRelease, releaseCandidate?: ReleaseCandidate, sourcePolicy: SourcePolicy, capabilityBoundary: CapabilityBoundary, excludedFromPublicSurface: string[] }} PublicBaseline */

/**
 * @param {string} relativePath
 * @returns {string}
 */
function read(relativePath) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

/**
 * @param {string} relativePath
 * @returns {unknown}
 */
function readJson(relativePath) {
  return /** @type {unknown} */ (JSON.parse(read(relativePath)));
}

const baseline = /** @type {PublicBaseline} */ (readJson("docs/public-baseline.json"));
const stable = baseline.stableRelease;
const candidate = baseline.releaseCandidate;
const sourceStatus = baseline.sourcePolicy.mainStatus;
const packageManifest = /** @type {PackageManifest} */ (readJson("package.json"));
const lockfile = /** @type {Lockfile} */ (readJson("package-lock.json"));
const releaseEvidence = /** @type {ReleaseEvidence} */ (readJson(stable.releaseEvidence));
const action = read("action.yml");
const changelog = read("CHANGELOG.md");
const readme = read("README.md");
const architecture = read("docs/architecture.md");
const errors = [];
const expectedSourceVersion =
  sourceStatus === "release-candidate" ? candidate?.version : stable.version;

/**
 * @param {boolean} condition
 * @param {string} message
 */
function assert(condition, message) {
  if (!condition) errors.push(message);
}

assert(baseline.schema === "reviewready.public-baseline.v1", "public baseline schema is invalid");
assert(baseline.product.protocol === PROTOCOL_IDENTITY, "public protocol identity is invalid");
assert(PLAIN_SEMVER.test(stable.version), "stable baseline version is invalid");
assert(
  sourceStatus === "post-release-unreleased" || sourceStatus === "release-candidate",
  "main source status is invalid"
);
assert(
  sourceStatus !== "release-candidate" || candidate !== undefined,
  "release-candidate status is missing candidate coordinates"
);
assert(
  sourceStatus !== "post-release-unreleased" || candidate === undefined,
  "post-release status still exposes stale candidate coordinates"
);
if (candidate) {
  assert(PLAIN_SEMVER.test(candidate.version), "release candidate version is invalid");
  assert(candidate.version !== stable.version, "release candidate reuses stable version");
  assert(
    candidate.releaseEvidence === `docs/release-evidence-v${candidate.version}.json`,
    "release candidate evidence path is invalid"
  );
  assert(
    candidate.releaseNotes === `docs/release-evidence-v${candidate.version}.md`,
    "release candidate notes path is invalid"
  );
  assert(
    read(candidate.releaseEvidence).includes(`"version": "${candidate.version}"`),
    "release candidate evidence does not declare its version"
  );
  assert(
    read(candidate.releaseNotes).includes(`ReviewReady v${candidate.version} release evidence`),
    "release candidate notes do not declare their version"
  );
}
assert(
  packageManifest.version === expectedSourceVersion,
  "package version does not match public baseline source state"
);
assert(
  lockfile.packages?.[""]?.version === expectedSourceVersion,
  "lockfile version does not match public baseline source state"
);
assert(
  releaseEvidence.version === stable.version,
  "release evidence version does not match stable baseline"
);
assert(
  releaseEvidence.mainCommit === stable.sourceCommit,
  "release evidence source commit does not match baseline"
);
assert(
  releaseEvidence.immutableTagCommit === stable.sourceCommit,
  "release evidence immutable tag does not match baseline"
);
assert(
  releaseEvidence.stableTagCommit === stable.sourceCommit,
  "release evidence stable tag does not match baseline"
);
assert(
  releaseEvidence.releaseTarget === stable.sourceCommit,
  "release evidence release target does not match baseline"
);
assert(
  releaseEvidence.npmLatestVersion === stable.npmLatestVersion,
  "release evidence npm latest does not match baseline"
);
assert(
  changelog.includes(`## [${stable.version}]`),
  "changelog does not contain the stable release"
);
assert(changelog.includes("## [Unreleased]"), "changelog does not label post-release work");
if (sourceStatus === "release-candidate" && candidate) {
  assert(
    changelog.includes(`## [${candidate.version}]`),
    "changelog does not contain the release candidate"
  );
}
assert(readme.includes(PROTOCOL_IDENTITY), "README does not declare the protocol identity");
assert(readme.includes(stable.sourceCommit), "README does not declare the stable source commit");
assert(readme.includes(stable.schemaRef), "README does not declare the stable schema URL");
assert(
  readme.includes("A source checkout can be ahead of the latest published artifact"),
  "README does not label source/artifact separation"
);
assert(
  action.includes(PROTOCOL_IDENTITY),
  "Action metadata does not declare the protocol identity"
);
assert(
  packageManifest.description.includes(PROTOCOL_IDENTITY),
  "npm description does not declare the protocol identity"
);
assert(
  packageManifest.keywords.includes("reviewready-evidence-protocol"),
  "npm keywords do not expose the protocol identity"
);
assert(
  architecture.includes("ReviewReady Evidence") && architecture.includes("Protocol"),
  "architecture does not declare the protocol identity"
);
assert(
  architecture.includes("does not ship a\nhosted GitHub App"),
  "architecture does not state the App boundary"
);
assert(
  baseline.sourcePolicy.mainMayDifferFromStableArtifact,
  "source/artifact difference policy is missing"
);
assert(
  baseline.sourcePolicy.publishedArtifactsImmutable,
  "artifact immutability policy is missing"
);
assert(
  baseline.sourcePolicy.publishRequiresNewVersion,
  "new-version publication policy is missing"
);
assert(
  baseline.capabilityBoundary.action.authority === "advisory",
  "Action authority boundary is invalid"
);
assert(
  baseline.capabilityBoundary.githubApp.status === "not-shipped",
  "GitHub App status is not explicit"
);
assert(
  baseline.capabilityBoundary.providerSdk.status === "not-shipped",
  "provider SDK status is not explicit"
);
assert(
  baseline.excludedFromPublicSurface.includes("parent-agent control files") &&
    baseline.excludedFromPublicSurface.includes("private research documents"),
  "private public-surface exclusions are incomplete"
);

let tracked = /** @type {string[]} */ ([]);
try {
  tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split(/\r?\n/u)
    .filter(Boolean);
} catch (error) {
  errors.push(
    `cannot inspect tracked public surface: ${error instanceof Error ? error.message : String(error)}`
  );
}
for (const path of tracked) {
  if (PRIVATE_TRACKED_PATH.test(path)) {
    errors.push(`private control or research path is tracked: ${path}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`PUBLIC_BASELINE_FAIL: ${error}\n`);
  process.exitCode = 1;
} else {
  const candidateSuffix = candidate ? `; candidate ${candidate.version}` : "";
  process.stdout.write(
    `PUBLIC_BASELINE_PASS: ${PROTOCOL_IDENTITY} stable ${stable.version}${candidateSuffix}\n`
  );
}
