#!/usr/bin/env node
// @ts-check

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRIVATE_TRACKED_PATH =
  /^(?:AGENTS\.md|HANDOFF\.md|\.agents(?:\/|$)|\.codex(?:\/|$)|\.reviewready-review(?:\/|$)|docs\/research(?:\/|$))/u;
const PROTOCOL_IDENTITY = "ReviewReady Evidence Protocol";
const PLAIN_SEMVER = /^\d+\.\d+\.\d+$/u;
const BACKTICK = String.fromCharCode(96);
const REFERENCE_POLICY = {
  "Full commit SHA": "Fixed source revision",
  "vX.Y.Z": "Immutable release tag",
  "Published npm version": "Immutable package",
  v1: "Mutable alias updated only after verification",
  "npm latest": "Mutable registry tag",
  "Release evidence": "Historical publication observation"
};
/** @type {Record<string, [string, string]>} */
const CAPABILITIES = {
  action: ["shipped", "advisory"],
  cli: ["shipped", "local and read-only"],
  library: ["shipped", "not a provider or merge authority"],
  githubApp: ["not-shipped", "no production hosted enforcement"],
  providerSdk: ["not-shipped", "no public provider conformance surface"]
};

/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/** @param {string} text @param {string} label */
function markdownField(text, label) {
  const lines = text.split(/\r?\n/u).filter((line) => line.startsWith(label + ": "));
  return lines.length === 1
    ? lines[0]
        ?.slice(label.length + 2)
        .replaceAll(BACKTICK, "")
        .replace(/\.$/u, "")
    : undefined;
}

/** @param {string} text @param {string} heading */
function markdownTable(text, heading) {
  const section =
    text
      .replaceAll("\r\n", "\n")
      .split("## " + heading + "\n")[1]
      ?.split("\n## ")[0] ?? "";
  /** @type {Map<string, string[]>} */
  const rows = new Map();
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim().replaceAll(BACKTICK, ""));
    const key = cells[0];
    if (!key) continue;
    // Duplicate assertions are ambiguous even if one row is correct.
    if (rows.has(key)) rows.set(key, []);
    else rows.set(key, cells.slice(1));
  }
  return rows;
}

/** @param {string} text @param {string} heading @param {string} language */
function markdownCodeBlock(text, heading, language) {
  const section =
    text
      .replaceAll("\r\n", "\n")
      .split("### " + heading + "\n")[1]
      ?.split("\n### ")[0]
      ?.split("\n## ")[0] ?? "";
  const fence = BACKTICK.repeat(3);
  const match = section.match(
    new RegExp("^" + fence + language + "\\n([\\s\\S]*?)^" + fence + "\\s*$", "mu")
  );
  return match?.[1];
}

/** @param {unknown} value @returns {string[]} */
function actionReferences(value) {
  if (Array.isArray(value)) return value.flatMap((entry) => actionReferences(entry));
  const object = record(value);
  return Object.entries(object).flatMap(([key, entry]) =>
    key === "uses" && typeof entry === "string" && /^[^/]+\/reviewready@/iu.test(entry)
      ? [entry]
      : actionReferences(entry)
  );
}

/** @param {string} text */
function yamlActionReferences(text) {
  const fence = BACKTICK.repeat(3);
  const pattern = new RegExp("^" + fence + "ya?ml[^\\n]*\\n([\\s\\S]*?)^" + fence + "\\s*$", "gmu");
  return [...text.matchAll(pattern)].flatMap((match) =>
    actionReferences(/** @type {unknown} */ (YAML.parse(match[1] ?? "")))
  );
}

/** @param {string} yaml @param {string} expectedTag */
function verifyActionAnnotations(yaml, expectedTag) {
  const document = YAML.parseDocument(yaml);
  const errors = document.errors.map((error) => "invalid YAML: " + error.message);
  YAML.visit(document, {
    Pair(_key, pair) {
      if (
        YAML.isScalar(pair.key) &&
        pair.key.value === "uses" &&
        YAML.isScalar(pair.value) &&
        typeof pair.value.value === "string" &&
        /^[^/]+\/reviewready@/iu.test(pair.value.value) &&
        pair.value.comment?.trim() !== expectedTag
      ) {
        errors.push("Action pin version annotation does not match the verified example version");
      }
    }
  });
  return errors;
}

/** @param {string} text */
function verifyReferenceLanguage(text) {
  const prose = text
    .replaceAll(BACKTICK, "")
    .replace(/\s+/gu, " ")
    .replace(/\b(?:must not|never|do not) (?:claim|assert) that\b[^.]*\./giu, "");
  const errors = [];
  if (
    /\bv1\b[^.]{0,90}\b(?:currently|now)\s+(?:points|refers|resolves)/iu.test(prose) ||
    /\b(?:currently|now)\b[^.]{0,40}\bv1\b[^.]{0,40}\b(?:points|refers|resolves)/iu.test(prose)
  ) {
    errors.push("v1 is a mutable alias; do not assert its live target in immutable documentation");
  }
  if (
    /\bv1(?:\s+(?:tag|ref|alias))?\s+is\s+(?:an?\s+)?immutable\b/iu.test(prose) ||
    /\bv1\b[^.]{0,100}\bare immutable release surfaces\b/iu.test(prose)
  ) {
    errors.push("v1 must not be classified as an immutable release surface");
  }
  return errors;
}

/**
 * Validate README bytes supplied by the existing package audit without I/O
 * or requiring a candidate document to name its own commit SHA.
 * @param {string} readme
 * @param {string} packageVersion
 * @param {string[]} packagedPaths
 * @returns {string[]}
 */
export function verifyPackagedReadme(readme, packageVersion, packagedPaths) {
  const errors = verifyReferenceLanguage(readme);
  const capabilities = markdownTable(readme, "Capability and authority boundaries");
  if (!capabilities.get("GitHub Action")?.[1]?.startsWith("Advisory, read-only GitHub access;")) {
    errors.push("README Action authority must be advisory and read-only");
  }
  if (!capabilities.get("CLI")?.[1]?.startsWith("Local and read-only;")) {
    errors.push("README CLI authority must be local and read-only");
  }
  if (
    capabilities.get("GitHub App/provider")?.[0] !== "Not shipped in this repository." ||
    !capabilities
      .get("npm/library")?.[1]
      ?.includes("not a hosted service or supported provider SDK")
  ) {
    errors.push("README must distinguish internal App/SDK modules from shipped capabilities");
  }
  if (markdownField(readme, "Package version") !== packageVersion) {
    errors.push("README package version does not match the packaged manifest");
  }
  const expectedTag = `v${packageVersion}`;
  if (markdownField(readme, "Verified Action examples") !== expectedTag) {
    errors.push("README Action example version does not match the packaged manifest");
  }
  for (const match of readme.matchAll(/\bThe v(\d+\.\d+\.\d+) package\b/gu)) {
    if (match[1] !== packageVersion) errors.push("README package capability version is stale");
  }
  const references = yamlActionReferences(readme);
  if (references.length === 0) {
    errors.push("README has no Action example");
  } else {
    const fence = BACKTICK.repeat(3);
    const pattern = new RegExp(
      "^" + fence + "ya?ml[^\\n]*\\n([\\s\\S]*?)^" + fence + "\\s*$",
      "gmu"
    );
    for (const match of readme.matchAll(pattern)) {
      errors.push(
        ...verifyActionAnnotations(
          match[1] ?? "",
          markdownField(readme, "Verified Action examples") ?? ""
        )
      );
    }
    if (
      new Set(references).size !== 1 ||
      references.some((ref) => ref !== `ahoooooooo/reviewready@${expectedTag}`)
    ) {
      errors.push("README Action examples must use the packaged semantic version");
    }
  }
  const schemaRefs = [
    ...readme.matchAll(
      /^# yaml-language-server: \$schema=(https:\/\/raw\.githubusercontent\.com\/\S+)\s*$/gmu
    )
  ].map((match) => match[1]);
  const expectedSchema = `https://raw.githubusercontent.com/ahoooooooo/reviewready/${expectedTag}/reviewready.schema.json`;
  if (schemaRefs.length === 0 || schemaRefs.some((reference) => reference !== expectedSchema)) {
    errors.push("README schema examples must use the packaged semantic version");
  }
  const versionedDocuments = [
    "docs/product-spec.md",
    "docs/architecture.md",
    "docs/adr/0001-trusted-workflow-root.md"
  ];
  for (const path of versionedDocuments) {
    const expectedUrl = `https://github.com/ahoooooooo/reviewready/blob/${expectedTag}/${path}`;
    if (!readme.includes(expectedUrl)) {
      errors.push("README version-bound document does not match the packaged version: " + path);
    }
    if (readme.includes(`https://github.com/ahoooooooo/reviewready/blob/main/${path}`)) {
      errors.push("README version-bound document points to mutable main: " + path);
    }
  }
  const links = [
    ...[...readme.matchAll(/\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/gu)].map((match) => match[1] ?? ""),
    ...[...readme.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gmu)].map((match) => match[1] ?? "")
  ];
  for (const link of links) {
    if (/^(?:[a-z][a-z\d+.-]*:|#)/iu.test(link)) continue;
    const path = link.split(/[?#]/u)[0]?.replace(/^\.\//u, "") ?? "";
    if (!packagedPaths.includes(path))
      errors.push("README links to a file absent from the package: " + path);
  }
  return errors;
}

/** @typedef {{ version: string, sourceCommit: string, immutableTag: string, stableActionTag: string, npmPackage: string, actionCommit: string, schemaRef: string, releaseEvidence: string, releaseNotes: string, releaseUrl: string, npmLatestVersion: string }} StableRelease */
/** @typedef {{ version: string, releaseEvidence: string, releaseNotes: string }} ReleaseCandidate */
/** @typedef {{ version: string, mainCommit: string, immutableTagCommit: string, stableTagCommit: string, releaseTarget: string, npmLatestVersion: string }} ReleaseEvidence */
/** @typedef {{ name: string, version: string, description: string, keywords: string[] }} PackageManifest */
/** @typedef {{ version?: string }} LockPackage */
/** @typedef {{ version?: string, packages?: Record<string, LockPackage> }} Lockfile */
/** @typedef {{ protocol: string }} ProductIdentity */
/** @typedef {{ mainStatus: string, mainMayDifferFromStableArtifact: boolean, publishedArtifactsImmutable: boolean, publishRequiresNewVersion: boolean }} SourcePolicy */
/** @typedef {{ authority: string }} ActionBoundary */
/** @typedef {{ status: string }} StatusBoundary */
/** @typedef {{ action: ActionBoundary & StatusBoundary, cli: ActionBoundary & StatusBoundary, library: ActionBoundary & StatusBoundary, githubApp: ActionBoundary & StatusBoundary, providerSdk: ActionBoundary & StatusBoundary }} CapabilityBoundary */
/** @typedef {{ revision: string, workflowRun: number, reviewJob: number, artifactName: string, artifactDigest: string, replayIntegrity: string, repositoryAuditStatus: string, missing: string[], totalFindings: number, findingCounts: Record<string, number> }} Ta2DogfoodObservation */
/** @typedef {{ schema: string, product: ProductIdentity, stableRelease: StableRelease, releaseCandidate?: ReleaseCandidate, sourcePolicy: SourcePolicy & { completedMilestone?: { status?: string } }, ta2DogfoodObservation: Ta2DogfoodObservation, capabilityBoundary: CapabilityBoundary, excludedFromPublicSurface: string[] }} PublicBaseline */

/**
 * @param {string} relativePath
 * @returns {string}
 */
function read(relativePath) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

/**
 * @param {(relativePath: string) => string} [readSource]
 * @returns {string[]}
 */
export function verifyPublicBaseline(readSource = read) {
  /** @param {string} relativePath */
  function readJson(relativePath) {
    return /** @type {unknown} */ (JSON.parse(readSource(relativePath)));
  }

  const baseline = /** @type {PublicBaseline} */ (readJson("docs/public-baseline.json"));
  const stable = baseline.stableRelease;
  const candidate = baseline.releaseCandidate;
  const sourceStatus = baseline.sourcePolicy.mainStatus;
  const packageManifest = /** @type {PackageManifest} */ (readJson("package.json"));
  const lockfile = /** @type {Lockfile} */ (readJson("package-lock.json"));
  const releaseEvidence = /** @type {ReleaseEvidence} */ (readJson(stable.releaseEvidence));
  const action = record(YAML.parse(readSource("action.yml")));
  const changelog = readSource("CHANGELOG.md");
  const readme = readSource("README.md");
  const architecture = readSource("docs/architecture.md");
  const baselineDoc = readSource("docs/public-baseline.md");
  const security = readSource("SECURITY.md");
  const releasing = readSource("docs/releasing.md");
  const productSpec = readSource("docs/product-spec.md");
  const ta2Adr = readSource("docs/adr/0009-replayable-audit-evidence-bundle.md");
  const ta2RulesetAdr = readSource("docs/adr/0010-ruleset-semantics-evidence-v2.md");
  const ta2ThreatModel = readSource("docs/threat-model-ta2-evidence-bundle.md");
  const workflow = record(YAML.parse(readSource(".github/workflows/reviewready-trusted.yml")));
  /** @type {string[]} */
  const errors = [];
  const expectedSourceVersion =
    sourceStatus === "release-candidate" && candidate ? candidate.version : stable.version;

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
  assert(
    baseline.sourcePolicy.completedMilestone?.status ===
      (sourceStatus === "release-candidate" ? "in-progress" : "complete"),
    "baseline milestone status contradicts source state"
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
      record(readJson(candidate.releaseEvidence)).version === candidate.version,
      "release candidate evidence does not declare its version"
    );
    assert(
      readSource(candidate.releaseNotes).includes(
        `ReviewReady v${candidate.version} release evidence`
      ),
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
    lockfile.version === expectedSourceVersion,
    "lockfile root version does not match source state"
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
  assert(
    readme.includes("A source checkout can be ahead of the latest published artifact"),
    "README does not label source/artifact separation"
  );
  assert(
    typeof action.description === "string" && action.description.includes(PROTOCOL_IDENTITY),
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

  assertPublicDocuments();
  return errors;

  function assertPublicDocuments() {
    const repository = "ahoooooooo/reviewready";
    const architectureProse = architecture.replace(/\s+/gu, " ");
    const securityProse = security.replace(/\s+/gu, " ");
    assert(
      architectureProse.includes(
        "does not ship a hosted GitHub App, durable external store, production enforcement service, or provider SDK"
      ),
      "architecture must distinguish internal modules from shipped App/SDK capabilities"
    );
    assert(
      securityProse.includes(
        "does not ship a hosted GitHub App, durable external store, production external enforcement service, or supported public provider SDK"
      ),
      "security policy must distinguish internal modules from shipped App/SDK capabilities"
    );
    assert(
      security.includes(
        "reference pinned to the exact stable release commit recorded in\n  `docs/public-baseline.json`"
      ),
      "security policy trusted-workflow pin wording is stale"
    );
    assert(/^[0-9a-f]{40}$/u.test(stable.sourceCommit), "stable source commit is invalid");
    assert(stable.immutableTag === `v${stable.version}`, "stable immutable tag is invalid");
    assert(stable.stableActionTag === "v1", "stable Action alias is invalid");
    assert(stable.npmPackage === packageManifest.name, "stable npm package identity is invalid");
    assert(stable.npmLatestVersion === stable.version, "recorded npm latest version is invalid");
    assert(
      stable.actionCommit === `${repository}@${stable.sourceCommit}`,
      "stable Action pin is invalid"
    );
    assert(
      stable.schemaRef ===
        `https://raw.githubusercontent.com/${repository}/${stable.immutableTag}/reviewready.schema.json`,
      "stable schema URL is invalid"
    );
    assert(
      stable.releaseUrl === `https://github.com/${repository}/releases/tag/${stable.immutableTag}`,
      "stable release URL is invalid"
    );
    assert(
      stable.releaseEvidence === `docs/release-evidence-v${stable.version}.json`,
      "stable evidence path is invalid"
    );
    assert(
      stable.releaseNotes === `docs/release-evidence-v${stable.version}.md`,
      "stable notes path is invalid"
    );

    const coordinates = markdownTable(baselineDoc, "Stable published coordinates");
    const expectedCoordinates = {
      "Source commit": stable.sourceCommit,
      "Immutable semantic tag": stable.immutableTag,
      "Stable Action tag": stable.stableActionTag,
      "npm latest": `${stable.npmPackage}@${stable.npmLatestVersion}`,
      "Immutable Action pin": stable.actionCommit,
      "Immutable schema URL": stable.schemaRef
    };
    for (const [surface, value] of Object.entries(expectedCoordinates)) {
      assert(
        coordinates.get(surface)?.[0] === value,
        `public-baseline.md coordinate mismatch: ${surface}`
      );
    }
    const evidenceCell = coordinates.get("Release evidence")?.[0] ?? "";
    assert(
      evidenceCell.includes(`](release-evidence-v${stable.version}.md)`) &&
        evidenceCell.includes(`](release-evidence-v${stable.version}.json)`),
      "public-baseline.md release evidence links mismatch"
    );
    const referencePolicy = markdownTable(baselineDoc, "Reference policy");
    for (const [surface, policy] of Object.entries(REFERENCE_POLICY)) {
      assert(
        referencePolicy.get(surface)?.[0] === policy,
        `public-baseline.md reference policy mismatch: ${surface}`
      );
    }
    const capabilityTable = markdownTable(baselineDoc, "Capability and authority");
    for (const [capability, [status, authority]] of Object.entries(CAPABILITIES)) {
      const boundary = record(record(baseline.capabilityBoundary)[capability]);
      assert(
        boundary.status === status && boundary.authority === authority,
        `capability boundary mismatch: ${capability}`
      );
      const row = capabilityTable.get(capability);
      assert(
        row?.[0] === status && row[1] === authority,
        `public-baseline.md capability mismatch: ${capability}`
      );
    }
    for (const [path, text] of Object.entries({
      "README.md": readme,
      "docs/public-baseline.md": baselineDoc,
      "docs/releasing.md": releasing,
      "SECURITY.md": security,
      "docs/architecture.md": architecture
    })) {
      errors.push(...verifyReferenceLanguage(text).map((error) => `${path}: ${error}`));
    }
    const packagePaths = [
      "README.md",
      "LICENSE",
      "reviewready.schema.json",
      "reviewready.audit.schema.json",
      "reviewready.audit-evidence.schema.json",
      "reviewready.result.schema.json"
    ];
    errors.push(...verifyPackagedReadme(readme, packageManifest.version, packagePaths));
    const exampleTag = `v${expectedSourceVersion}`;
    const exampleAction = `${repository}@${exampleTag}`;
    const examples = yamlActionReferences(readme);
    assert(
      examples.length > 0 && examples.every((ref) => ref === exampleAction),
      "README Action uses values do not match source package version"
    );
    assert(
      markdownField(readme, "Verified Action examples") === exampleTag,
      "README Action example version does not match source package version"
    );
    const schemaRefs = [
      ...readme.matchAll(
        /^# yaml-language-server: \$schema=(https:\/\/raw\.githubusercontent\.com\/\S+)\s*$/gmu
      )
    ].map((match) => match[1]);
    assert(
      schemaRefs.length > 0 &&
        schemaRefs.every(
          (ref) =>
            ref ===
            `https://raw.githubusercontent.com/${repository}/${exampleTag}/reviewready.schema.json`
        ),
      "README schema examples do not match source package version"
    );
    assertNormalizedInputExample();
    assertTa2DogfoodObservation();
    assert(
      typeof action.description === "string" && /\badvisory\b/u.test(action.description),
      "Action metadata must describe advisory authority"
    );
    assert(record(action.runs).main === "dist/action/index.js", "Action entry point mismatch");
    assert(
      workflow.name === "ReviewReady trusted evidence",
      "trusted workflow display name must describe evidence"
    );
    const jobs = record(workflow.jobs);
    assert(
      Object.keys(jobs).length === 1 &&
        "readiness" in jobs &&
        record(jobs.readiness).name === undefined,
      "trusted readiness check identity changed"
    );
    const refs = actionReferences(workflow);
    errors.push(
      ...verifyActionAnnotations(
        readSource(".github/workflows/reviewready-trusted.yml"),
        stable.immutableTag
      )
    );
    assert(
      refs.length === 1 && refs[0] === stable.actionCommit,
      "trusted workflow Action pin does not match stable release"
    );
    const permissions = record(workflow.permissions);
    assert(
      Object.keys(permissions).length === 5 &&
        ["contents", "pull-requests", "checks", "statuses", "issues"].every(
          (key) => permissions[key] === "read"
        ),
      "trusted workflow permissions must remain read-only"
    );
    const events = record(workflow.on);
    assert(
      Object.keys(events).length === 1 && "pull_request_target" in events,
      "trusted workflow event boundary changed"
    );
    const types = record(events.pull_request_target).types;
    const expectedTypes = [
      "opened",
      "synchronize",
      "reopened",
      "edited",
      "labeled",
      "unlabeled",
      "ready_for_review"
    ];
    assert(
      Array.isArray(types) &&
        types.length === expectedTypes.length &&
        expectedTypes.every((type) => types.includes(type)),
      "trusted workflow PR event types changed"
    );
  }

  function assertNormalizedInputExample() {
    const exampleText = markdownCodeBlock(productSpec, "Complete normalized input example", "json");
    assert(typeof exampleText === "string", "product spec normalized input example is missing");
    if (typeof exampleText !== "string") return;
    let example;
    try {
      example = record(JSON.parse(exampleText));
    } catch {
      errors.push("product spec normalized input example is invalid JSON");
      return;
    }
    const keys = Object.keys(example).sort();
    const expectedKeys = [
      "body",
      "changedFiles",
      "checks",
      "labels",
      "linkedIssues",
      "reviews",
      "version"
    ].sort();
    assert(
      JSON.stringify(keys) === JSON.stringify(expectedKeys),
      "product spec normalized input example does not match the readiness contract"
    );
    const checks = Array.isArray(example.checks) ? example.checks : [];
    assert(checks.length > 0, "product spec normalized input example has no check evidence");
    for (const value of checks) {
      const check = record(value);
      assert(
        !("appId" in check) &&
          typeof check.name === "string" &&
          (check.conclusion === null || typeof check.conclusion === "string") &&
          (check.app === undefined || typeof check.app === "string"),
        "product spec check example does not match the readiness parser"
      );
    }
  }

  function assertTa2DogfoodObservation() {
    const observation = baseline.ta2DogfoodObservation;
    assert(
      /^[0-9a-f]{40}$/u.test(observation.revision) &&
        observation.workflowRun === 34184361828 &&
        observation.reviewJob === 101929673227 &&
        observation.artifactName === `reviewready-ta2-evidence-${observation.revision}` &&
        observation.artifactDigest ===
          "sha256:4e334e73be48d0dd97a2075661cd82304d04d09ffa9d5ea380bb9d6de9621335",
      "TA-2 dogfood evidence coordinates are invalid"
    );
    assert(
      observation.replayIntegrity === "verified" &&
        observation.repositoryAuditStatus === "incomplete" &&
        observation.missing.length === 1 &&
        observation.missing[0] === "settings-authority-incomplete" &&
        observation.totalFindings === 19 &&
        JSON.stringify(observation.findingCounts) ===
          JSON.stringify({
            AUDIT_BRANCH_PROTECTION_UNKNOWN: 1,
            AUDIT_RULESET_BYPASS_UNKNOWN: 1,
            AUDIT_SNAPSHOT_INCOMPLETE: 1,
            AUDIT_TAG_PROTECTION_UNKNOWN: 1,
            AUDIT_TRUSTED_ROOT_MISSING: 6,
            AUDIT_WORKFLOW_NOT_PROTECTED: 6,
            DEPLOYMENT_SINK: 1,
            PULL_REQUEST_TARGET_WORKFLOW: 1,
            WORKFLOW_WRITE_PERMISSION: 1
          }),
      "TA-2 replay and repository-audit statuses are conflated"
    );
    for (const [path, text] of Object.entries({
      "docs/public-baseline.md": baselineDoc,
      "docs/adr/0009-replayable-audit-evidence-bundle.md": ta2Adr,
      "docs/adr/0010-ruleset-semantics-evidence-v2.md": ta2RulesetAdr,
      "docs/threat-model-ta2-evidence-bundle.md": ta2ThreatModel
    })) {
      assert(
        text.includes(String(observation.workflowRun)) &&
          text.includes(observation.revision) &&
          text.includes("incomplete") &&
          text.includes("settings-authority-incomplete") &&
          /not\s+(?:an?\s+)?(?:audit\s+)?`?pass`?|does not satisfy\s+(?:a\s+)?repository\s+audit-pass/iu.test(
            text
          ),
        `${path} does not preserve the incomplete TA-2 dogfood result`
      );
    }
  }
}

export function main() {
  let errors;
  try {
    errors = verifyPublicBaseline();
  } catch (error) {
    errors = [
      `cannot validate public documents: ${error instanceof Error ? error.message : String(error)}`
    ];
  }
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
    process.stdout.write(
      `PUBLIC_BASELINE_PASS: local documents and source coordinates agree; online publication not checked\n`
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
