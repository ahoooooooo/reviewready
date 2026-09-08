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

const baselinePath = "docs/public-baseline.json";
const documentPath = "docs/public-baseline.md";
const workflowPath = ".github/workflows/reviewready-trusted.yml";
const baseline = readJson(baselinePath) as Baseline;
const stable = baseline.stableRelease;
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

  it("keeps post-release source aligned with stable coordinates without embedding the SHA", () => {
    const evidence = readJson(stable.releaseEvidence) as {
      marketplaceObservation?: { status?: string };
    };
    expect(baseline.sourcePolicy.mainStatus).toBe("post-release-unreleased");
    expect(baseline.sourcePolicy.completedMilestone.status).toBe(
      evidence.marketplaceObservation?.status === "verified" ? "complete" : "in-progress"
    );
    expect(baseline.releaseCandidate).toBeUndefined();
    expect(sourceVersion).toBe(stable.version);
    expect(readSource("README.md")).toContain(exampleAction);
    expect(readSource("README.md")).not.toContain(stable.actionCommit);
  });

  it("rejects a milestone status that contradicts Marketplace verification", () => {
    const changed = structuredClone(baseline);
    changed.sourcePolicy.completedMilestone.status =
      baseline.sourcePolicy.completedMilestone.status === "complete" ? "in-progress" : "complete";
    expect(verifyOverlay({ [baselinePath]: JSON.stringify(changed) })).toContain(
      "baseline milestone status contradicts Marketplace verification"
    );
  });

  it("rejects a stale version labeled as a verified Marketplace observation", () => {
    const changedBaseline = structuredClone(baseline);
    changedBaseline.sourcePolicy.completedMilestone.status = "complete";
    const evidence = readJson(stable.releaseEvidence) as {
      marketplaceObservation?: { status?: string; observedVersion?: string };
    };
    evidence.marketplaceObservation = { status: "verified", observedVersion: "1.0.15" };
    expect(
      verifyOverlay({
        [baselinePath]: JSON.stringify(changedBaseline),
        [stable.releaseEvidence]: JSON.stringify(evidence)
      })
    ).toContain("verified Marketplace version does not match the stable release");
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

  it.each([
    ["inline", "[Repository guide](docs/releasing.md)", "docs/releasing.md"],
    [
      "reference",
      "[Repository example][example]\n\n[example]: fixtures/ready-pr.json",
      "fixtures/ready-pr.json"
    ]
  ])("rejects an unavailable %s link for package users", (_case, link, path) => {
    expect(
      verifyPackagedReadme(readme + "\n" + link + "\n", manifest.version, manifest.files)
    ).toContain("README links to a file absent from the package: " + path);
  });
});
