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

/** @typedef {{ version: string, sourceCommit: string, schemaRef: string, releaseEvidence: string, npmLatestVersion: string }} StableRelease */
/** @typedef {{ version: string, mainCommit: string, immutableTagCommit: string, stableTagCommit: string, releaseTarget: string, npmLatestVersion: string }} ReleaseEvidence */
/** @typedef {{ version: string, description: string, keywords: string[] }} PackageManifest */
/** @typedef {{ version?: string }} LockPackage */
/** @typedef {{ packages?: Record<string, LockPackage> }} Lockfile */
/** @typedef {{ protocol: string }} ProductIdentity */
/** @typedef {{ mainStatus: string, mainMayDifferFromStableArtifact: boolean, publishedArtifactsImmutable: boolean, publishRequiresNewVersion: boolean }} SourcePolicy */
/** @typedef {{ authority: string }} ActionBoundary */
/** @typedef {{ status: string }} StatusBoundary */
/** @typedef {{ action: ActionBoundary, githubApp: StatusBoundary, providerSdk: StatusBoundary }} CapabilityBoundary */
/** @typedef {{ schema: string, product: ProductIdentity, stableRelease: StableRelease, sourcePolicy: SourcePolicy, capabilityBoundary: CapabilityBoundary, excludedFromPublicSurface: string[] }} PublicBaseline */

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
const packageManifest = /** @type {PackageManifest} */ (readJson("package.json"));
const lockfile = /** @type {Lockfile} */ (readJson("package-lock.json"));
const releaseEvidence = /** @type {ReleaseEvidence} */ (readJson(stable.releaseEvidence));
const action = read("action.yml");
const changelog = read("CHANGELOG.md");
const readme = read("README.md");
const architecture = read("docs/architecture.md");
const errors = [];

/**
 * @param {boolean} condition
 * @param {string} message
 */
function assert(condition, message) {
  if (!condition) errors.push(message);
}

assert(baseline.schema === "reviewready.public-baseline.v1", "public baseline schema is invalid");
assert(baseline.product.protocol === PROTOCOL_IDENTITY, "public protocol identity is invalid");
assert(stable.version === "1.0.13", "stable baseline version is invalid");
assert(
  packageManifest.version === stable.version,
  "package version does not match stable baseline"
);
assert(
  lockfile.packages?.[""]?.version === stable.version,
  "lockfile version does not match stable baseline"
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
assert(readme.includes(PROTOCOL_IDENTITY), "README does not declare the protocol identity");
assert(readme.includes(stable.sourceCommit), "README does not declare the stable source commit");
assert(readme.includes(stable.schemaRef), "README does not declare the stable schema URL");
assert(
  readme.includes("post-release development baseline"),
  "README does not label main as post-release"
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
  baseline.sourcePolicy.mainStatus === "post-release-unreleased",
  "main source status is not explicit"
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
  process.stdout.write(`PUBLIC_BASELINE_PASS: ${PROTOCOL_IDENTITY} stable ${stable.version}\n`);
}
