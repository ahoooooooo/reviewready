import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { verifyPackagedReadme, verifyPublicBaseline } from "../scripts/verify-public-baseline.mjs";
import { normalizeInput } from "../src/input.js";

interface Baseline {
  stableRelease: {
    version: string;
    sourceCommit: string;
    actionCommit: string;
    releaseEvidence: string;
  };
  sourcePolicy: { mainStatus: string; completedMilestone: { status: string } };
  releaseCandidate?: { version: string; releaseEvidence: string; releaseNotes: string };
  ta2DogfoodObservation: {
    repositoryAuditStatus: string;
    replayIntegrity: string;
    missing: string[];
  };
  capabilityBoundary: Record<string, { status: string; authority: string }>;
}

interface PackageManifest {
  version: string;
  files: string[];
}

interface Lockfile {
  version: string;
  packages: Record<string, { version: string }>;
}

function readSource(path: string): string {
  return readFileSync(new URL("../" + path, import.meta.url), "utf8").replaceAll("\r\n", "\n");
}

function readJson(path: string): unknown {
  return JSON.parse(readSource(path)) as unknown;
}

function verifyOverlay(overrides: Record<string, string>): string[] {
  return verifyPublicBaseline((path: string) => overrides[path] ?? readSource(path));
}

function replaceIn(path: string, search: string | RegExp, replacement: string): string {
  const original = readSource(path);
  const changed = original.replace(search, replacement);
  expect(changed).not.toBe(original);
  return changed;
}

function nextPatchVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (match === null) throw new Error("stable test version is not plain semantic version text");
  const major = match[1];
  const minor = match[2];
  const patch = match[3];
  if (major === undefined || minor === undefined || patch === undefined) {
    throw new Error("stable test version components are unavailable");
  }
  return `${major}.${minor}.${String(Number(patch) + 1)}`;
}

function releaseCandidateOverlay(
  candidateVersion = nextPatchVersion(stable.version)
): Record<string, string> {
  const candidateBaseline = structuredClone(baseline);
  candidateBaseline.sourcePolicy.mainStatus = "release-candidate";
  candidateBaseline.sourcePolicy.completedMilestone.status = "in-progress";
  candidateBaseline.releaseCandidate = {
    version: candidateVersion,
    releaseEvidence: `docs/release-evidence-v${candidateVersion}.json`,
    releaseNotes: `docs/release-evidence-v${candidateVersion}.md`
  };
  const candidateManifest = structuredClone(manifest);
  candidateManifest.version = candidateVersion;
  const candidateLock = readJson("package-lock.json") as Lockfile;
  candidateLock.version = candidateVersion;
  candidateLock.packages[""] = {
    ...candidateLock.packages[""],
    version: candidateVersion
  };
  return {
    [baselinePath]: JSON.stringify(candidateBaseline),
    "package.json": JSON.stringify(candidateManifest),
    "package-lock.json": JSON.stringify(candidateLock),
    "README.md": readSource("README.md").replaceAll(stable.version, candidateVersion),
    "CHANGELOG.md": readSource("CHANGELOG.md").replace(
      "## [Unreleased]\n",
      "## [Unreleased]\n\n## [" + candidateVersion + "] - 2026-09-08\n"
    ),
    [candidateBaseline.releaseCandidate.releaseEvidence]: JSON.stringify({
      version: candidateVersion
    }),
    [candidateBaseline.releaseCandidate.releaseNotes]:
      "# ReviewReady v" + candidateVersion + " release evidence\n"
  };
}

function postReleaseOverlay(): Record<string, string> {
  const stableBaseline = structuredClone(baseline);
  stableBaseline.sourcePolicy.mainStatus = "post-release-unreleased";
  delete stableBaseline.releaseCandidate;
  const evidence = readJson(stable.releaseEvidence) as {
    marketplaceObservation?: { status?: string };
  };
  stableBaseline.sourcePolicy.completedMilestone.status =
    evidence.marketplaceObservation?.status === "verified" ? "complete" : "in-progress";
  const stableManifest = structuredClone(manifest);
  stableManifest.version = stable.version;
  const stableLock = readJson("package-lock.json") as Lockfile;
  stableLock.version = stable.version;
  stableLock.packages[""] = { ...stableLock.packages[""], version: stable.version };
  return {
    [baselinePath]: JSON.stringify(stableBaseline),
    "package.json": JSON.stringify(stableManifest),
    "package-lock.json": JSON.stringify(stableLock),
    "README.md": readSource("README.md").replaceAll(sourceVersion, stable.version)
  };
}

const baselinePath = "docs/public-baseline.json";
const documentPath = "docs/public-baseline.md";
const workflowPath = ".github/workflows/reviewready-trusted.yml";
const baseline = readJson(baselinePath) as Baseline;
const stable = baseline.stableRelease;
const nextCandidateVersion = nextPatchVersion(stable.version);
const manifest = readJson("package.json") as PackageManifest;
const sourceVersion = manifest.version;
const exampleAction = `ahoooooooo/reviewready@v${sourceVersion}`;
const wrongVersion = "999.999.999";
const wrongCommit = "0".repeat(40);
const wrongAction = stable.actionCommit.replace(stable.sourceCommit, wrongCommit);
const wrongExampleAction = "ahoooooooo/reviewready@v" + wrongVersion;

describe("public baseline consistency", () => {
  it("accepts the real public documents and structured source coordinates", () => {
    expect(verifyOverlay({})).toEqual([]);
  });

  it("rejects a package version mismatch", () => {
    const manifest = readJson("package.json") as PackageManifest;
    manifest.version = wrongVersion;
    expect(verifyOverlay({ "package.json": JSON.stringify(manifest) })).toContain(
      "package version does not match public baseline source state"
    );
  });

  it.each(["root", "package"] as const)("rejects a %s lockfile version mismatch", (target) => {
    const lock = readJson("package-lock.json") as Lockfile;
    if (target === "root") lock.version = wrongVersion;
    else lock.packages[""] = { ...lock.packages[""], version: wrongVersion };
    expect(verifyOverlay({ "package-lock.json": JSON.stringify(lock) })).toContain(
      target === "root"
        ? "lockfile root version does not match source state"
        : "lockfile version does not match public baseline source state"
    );
  });

  it("rejects a wrong coordinate row even while the correct SHA remains elsewhere", () => {
    const document = replaceIn(
      documentPath,
      /^(\| Source commit\s*\| )[^|]+/mu,
      "$1`" + wrongCommit + "` "
    );
    expect(document).toContain(stable.sourceCommit);
    expect(verifyOverlay({ [documentPath]: document })).toContain(
      "public-baseline.md coordinate mismatch: Source commit"
    );
  });

  it("rejects a trusted workflow uses value despite a correct pin in a comment", () => {
    const workflow = replaceIn(workflowPath, stable.actionCommit, wrongAction);
    expect(verifyOverlay({ [workflowPath]: workflow + "\n# " + stable.actionCommit })).toContain(
      "trusted workflow Action pin does not match stable release"
    );
  });

  it("rejects one incorrect README YAML example despite another correct example", () => {
    const readme = replaceIn("README.md", "uses: " + exampleAction, "uses: " + wrongExampleAction);
    expect(readme).toContain("uses: " + exampleAction);
    expect(verifyOverlay({ "README.md": readme })).toContain(
      "README Action uses values do not match source package version"
    );
  });

  it.each(["README.md", workflowPath])(
    "rejects a stale version annotation on a correct Action pin in %s",
    (path) => {
      const action = path === "README.md" ? exampleAction : stable.actionCommit;
      const version = path === "README.md" ? sourceVersion : stable.version;
      const document = replaceIn(path, action + " # v" + version, action + " # v" + wrongVersion);
      expect(document).toContain("uses: " + action);
      expect(verifyOverlay({ [path]: document })).toContain(
        "Action pin version annotation does not match the verified example version"
      );
    }
  );

  it("rejects a README capability row that contradicts the remaining App denial", () => {
    const readme = replaceIn(
      "README.md",
      /^(\| GitHub App\/provider\s*\| )Not shipped/mu,
      "$1Shipped"
    );
    expect(readme).toContain("does not provide a production GitHub App");
    expect(verifyOverlay({ "README.md": readme })).toContain(
      "README must distinguish internal App/SDK modules from shipped capabilities"
    );
  });

  it("rejects Action metadata that claims authoritative evaluation", () => {
    const action = replaceIn("action.yml", "Protocol: advisory,", "Protocol: authoritative,");
    expect(verifyOverlay({ "action.yml": action })).toContain(
      "Action metadata must describe advisory authority"
    );
  });

  it("rejects a security policy that promotes the internal App/SDK to shipped", () => {
    const security = replaceIn("SECURITY.md", "does not ship a hosted", "ships a hosted");
    expect(verifyOverlay({ "SECURITY.md": security })).toContain(
      "security policy must distinguish internal modules from shipped App/SDK capabilities"
    );
  });

  it("rejects a stale trusted-workflow release number in the security policy", () => {
    const security = replaceIn(
      "SECURITY.md",
      "reference pinned to the exact stable release commit recorded in\n  `docs/public-baseline.json`",
      "reference pinned to the exact v1.0.14 release commit"
    );
    expect(verifyOverlay({ "SECURITY.md": security })).toContain(
      "security policy trusted-workflow pin wording is stale"
    );
  });

  it("rejects a baseline that promotes an internal provider SDK to shipped", () => {
    const baseline = readJson(baselinePath) as Baseline;
    baseline.capabilityBoundary.providerSdk = {
      ...baseline.capabilityBoundary.providerSdk,
      status: "shipped",
      authority: "no public provider conformance surface"
    };
    expect(verifyOverlay({ [baselinePath]: JSON.stringify(baseline) })).toContain(
      "capability boundary mismatch: providerSdk"
    );
  });

  it("rejects a documentation table that promotes the GitHub App to shipped", () => {
    const document = replaceIn(documentPath, /^(\| githubApp\s*\| )not-shipped/mu, "$1shipped");
    expect(verifyOverlay({ [documentPath]: document })).toContain(
      "public-baseline.md capability mismatch: githubApp"
    );
  });

  it.each([
    [
      "enforcement display name",
      "name: ReviewReady trusted evidence",
      "name: ReviewReady trusted enforcement",
      "trusted workflow display name must describe evidence"
    ],
    [
      "renamed readiness check",
      "  readiness:",
      "  evidence:",
      "trusted readiness check identity changed"
    ],
    [
      "write permissions",
      "  contents: read",
      "  contents: write",
      "trusted workflow permissions must remain read-only"
    ]
  ])("rejects %s", (_case, search, replacement, error) => {
    expect(
      verifyOverlay({ [workflowPath]: replaceIn(workflowPath, search, replacement) })
    ).toContain(error);
  });

  it.each([
    ["`v1` is immutable.", "v1 must not be classified as an immutable release surface"],
    [
      "`v1` currently points to v1.0.13.",
      "v1 is a mutable alias; do not assert its live target in immutable documentation"
    ]
  ])("rejects reintroduced alias claim: %s", (claim, error) => {
    const readme = readSource("README.md") + "\n" + claim + "\n";
    expect(verifyOverlay({ "README.md": readme })).toContain("README.md: " + error);
  });

  it("accepts the explicit post-release stable state without embedding the SHA", () => {
    const overrides = postReleaseOverlay();
    const stableBaseline = JSON.parse(overrides[baselinePath] ?? "{}") as Baseline;
    expect(stableBaseline.sourcePolicy.mainStatus).toBe("post-release-unreleased");
    expect(stableBaseline.releaseCandidate).toBeUndefined();
    expect(overrides["README.md"]).toContain(`ahoooooooo/reviewready@v${stable.version}`);
    expect(overrides["README.md"]).not.toContain(stable.actionCommit);
    expect(verifyOverlay(overrides)).toEqual([]);
  });

  it("accepts a legal release candidate while stable coordinates remain published", () => {
    const overrides = releaseCandidateOverlay();
    const candidateBaseline = JSON.parse(overrides[baselinePath] ?? "{}") as Baseline;
    expect(candidateBaseline.stableRelease).toEqual(stable);
    expect(candidateBaseline.releaseCandidate?.version).toBe(nextCandidateVersion);
    expect(verifyOverlay(overrides)).toEqual([]);
  });

  it("rejects a release candidate that is prematurely marked complete", () => {
    const overrides = releaseCandidateOverlay();
    const candidateBaseline = JSON.parse(overrides[baselinePath] ?? "{}") as Baseline;
    candidateBaseline.sourcePolicy.completedMilestone.status = "complete";
    overrides[baselinePath] = JSON.stringify(candidateBaseline);
    expect(verifyOverlay(overrides)).toContain("release candidate is prematurely marked complete");
  });

  it("rejects mixed stable and candidate source versions", () => {
    const overrides = releaseCandidateOverlay();
    const mixedManifest = structuredClone(manifest);
    mixedManifest.version = stable.version;
    overrides["package.json"] = JSON.stringify(mixedManifest);
    expect(verifyOverlay(overrides)).toContain(
      "package version does not match public baseline source state"
    );
  });

  it("rejects a candidate that reuses the published version", () => {
    const overrides = releaseCandidateOverlay(stable.version);
    expect(verifyOverlay(overrides)).toContain("release candidate reuses stable version");
  });

  it("rejects a milestone status that contradicts Marketplace verification", () => {
    const overrides = postReleaseOverlay();
    const changed = JSON.parse(overrides[baselinePath] ?? "{}") as Baseline;
    changed.sourcePolicy.completedMilestone.status =
      changed.sourcePolicy.completedMilestone.status === "complete" ? "in-progress" : "complete";
    overrides[baselinePath] = JSON.stringify(changed);
    expect(verifyOverlay(overrides)).toContain(
      "baseline milestone status contradicts Marketplace verification"
    );
  });

  it("rejects a stale version labeled as a verified Marketplace observation", () => {
    const overrides = postReleaseOverlay();
    const changedBaseline = JSON.parse(overrides[baselinePath] ?? "{}") as Baseline;
    changedBaseline.sourcePolicy.completedMilestone.status = "complete";
    const evidence = readJson(stable.releaseEvidence) as {
      marketplaceObservation?: { status?: string; observedVersion?: string };
    };
    evidence.marketplaceObservation = { status: "verified", observedVersion: "1.0.15" };
    overrides[baselinePath] = JSON.stringify(changedBaseline);
    overrides[stable.releaseEvidence] = JSON.stringify(evidence);
    expect(verifyOverlay(overrides)).toContain(
      "verified Marketplace version does not match the stable release"
    );
  });

  it("rejects readiness documentation that uses the audit-only appId field", () => {
    const productSpec = replaceIn(
      "docs/product-spec.md",
      '"app": "github-actions"',
      '"appId": 15368'
    );
    expect(verifyOverlay({ "docs/product-spec.md": productSpec })).toContain(
      "product spec check example does not match the readiness parser"
    );
  });

  it("keeps the documented normalized input executable by the strict parser", () => {
    const section = readSource("docs/product-spec.md").split(
      "### Complete normalized input example\n"
    )[1];
    const json = section?.match(/```json\n([\s\S]*?)\n```/u)?.[1];
    expect(json).toBeTypeOf("string");
    expect(() => normalizeInput(JSON.parse(json ?? "null") as unknown)).not.toThrow();
  });

  it("rejects a TA-2 replay result relabeled as an audit pass", () => {
    const changed = structuredClone(baseline);
    changed.ta2DogfoodObservation.repositoryAuditStatus = "pass";
    expect(verifyOverlay({ [baselinePath]: JSON.stringify(changed) })).toContain(
      "TA-2 replay and repository-audit statuses are conflated"
    );
  });
});

describe("packaged README consistency", () => {
  const readme = readSource("README.md");

  it("accepts the shipped README using the package allowlist", () => {
    expect(verifyPackagedReadme(readme, manifest.version, manifest.files)).toEqual([]);
  });

  it("rejects stale documentation inside an otherwise newer package", () => {
    expect(verifyPackagedReadme(readme, wrongVersion, manifest.files)).toContain(
      "README package version does not match the packaged manifest"
    );
  });

  it("rejects previous-version Action and schema examples in a newer package", () => {
    const staleVersion = "1.0.15";
    const staleReadme = readme
      .replaceAll(
        "ahoooooooo/reviewready@v" + sourceVersion,
        "ahoooooooo/reviewready@v" + staleVersion
      )
      .replaceAll("/v" + sourceVersion + "/", "/v" + staleVersion + "/");
    const errors = verifyPackagedReadme(staleReadme, sourceVersion, manifest.files);
    expect(errors).toContain("README Action examples must use the packaged semantic version");
    expect(errors).toContain("README schema examples must use the packaged semantic version");
  });

  it("rejects mutable main links for version-bound product documents", () => {
    const versioned =
      "https://github.com/ahoooooooo/reviewready/blob/v" + sourceVersion + "/docs/product-spec.md";
    const mutable = "https://github.com/ahoooooooo/reviewready/blob/main/docs/product-spec.md";
    const changed = readme.replaceAll(versioned, mutable);
    expect(verifyPackagedReadme(changed, sourceVersion, manifest.files)).toContain(
      "README version-bound document points to mutable main: docs/product-spec.md"
    );
  });

  it("rejects a stale clickable document even when the correct URL appears in a comment", () => {
    const expected =
      "https://github.com/ahoooooooo/reviewready/blob/v" + sourceVersion + "/docs/product-spec.md";
    const stale = expected.replace("/v" + sourceVersion + "/", "/v1.0.15/");
    const changed = readme.replaceAll(expected, stale) + "\n<!-- " + expected + " -->\n";
    const errors = verifyPackagedReadme(changed, sourceVersion, manifest.files);
    expect(errors).toContain(
      "README version-bound document does not match the packaged version: docs/product-spec.md"
    );
    expect(errors).toContain(
      "README version-bound document has a stale clickable target: docs/product-spec.md"
    );
  });

  it("rejects mixed inline and reference links to different document versions", () => {
    const stale = "https://github.com/ahoooooooo/reviewready/blob/v1.0.15/docs/architecture.md";
    const changed =
      readme +
      "\n[Stale architecture][stale-architecture]\n\n" +
      "[stale-architecture]: " +
      stale +
      "\n";
    expect(verifyPackagedReadme(changed, sourceVersion, manifest.files)).toContain(
      "README version-bound document has a stale clickable target: docs/architecture.md"
    );
  });

  it("rejects a stale shortcut reference even when a correct inline link exists", () => {
    const stale = "https://github.com/ahoooooooo/reviewready/blob/v1.0.15/docs/product-spec.md";
    const changed =
      readme +
      "\n[Stale product specification]\n\n" +
      "[Stale product specification]: " +
      stale +
      "\n";
    expect(verifyPackagedReadme(changed, sourceVersion, manifest.files)).toContain(
      "README version-bound document has a stale clickable target: docs/product-spec.md"
    );
  });

  it.each([
    ["inline", "[Repository guide](docs/releasing.md)", "docs/releasing.md"],
    [
      "full reference",
      "[Repository example][example]\n\n[example]: fixtures/ready-pr.json",
      "fixtures/ready-pr.json"
    ],
    [
      "collapsed reference",
      "[Repository example][]\n\n[Repository example]: fixtures/ready-pr.json",
      "fixtures/ready-pr.json"
    ],
    [
      "shortcut reference",
      "[Repository guide]\n\n[Repository guide]: docs/releasing.md",
      "docs/releasing.md"
    ]
  ])("rejects an unavailable %s link for package users", (_case, link, path) => {
    expect(
      verifyPackagedReadme(readme + "\n" + link + "\n", manifest.version, manifest.files)
    ).toContain("README links to a file absent from the package: " + path);
  });

  it("ignores shortcut reference text inside code and HTML comments", () => {
    const tick = String.fromCharCode(96);
    const changed =
      readme +
      "\n" +
      tick +
      "[Repository guide]" +
      tick +
      "\n<!-- [Repository guide] -->\n\n" +
      "[Repository guide]: docs/releasing.md\n";
    expect(verifyPackagedReadme(changed, manifest.version, manifest.files)).toEqual([]);
  });
});
