import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import YAML from "yaml";

import {
  assertActionBundleClean,
  assertActionBundleSynchronized,
  assertReleaseMetadata,
  assertReleaseProvenance,
  main as runReleasePreflightCli,
  normalizePackagedPath,
  runReleasePreflight,
  sha1Hex,
  sha512Hex,
  verifyReleaseProvenance
} from "../scripts/release-preflight.mjs";

describe("release readiness metadata", () => {
  it("keeps the publish workflow OIDC-only and exact-artifact based", async () => {
    const workflow = await readFile(".github/workflows/release-publish.yml", "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("npm run release:preflight");
    expect(workflow).toContain("npm publish");
    expect(workflow).not.toContain("NPM_TOKEN");
    expect(workflow).toContain("--provenance");
    expect(workflow).toContain("permissions: {}");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("contents: write");
    expect(workflow).not.toContain("actions: write");
    expect(workflow).toContain("actions: read");
    expect(workflow).not.toMatch(/\n {6}GH_TOKEN: \$\{\{ github\.token \}\}/u);
  });

  it("does not give audited tooling Actions mutation permission", async () => {
    const workflow = await readFile(".github/workflows/release-publish.yml", "utf8");
    const auditStart = workflow.indexOf("  audit:");
    const publishStart = workflow.indexOf("  publish:");
    const auditJob = workflow.slice(auditStart, publishStart);

    expect(auditJob).toContain("actions/upload-artifact@");
    expect(auditJob).not.toContain("actions: write");
  });

  it("fails closed while checking the unused immutable tag", async () => {
    const workflow = await readFile(".github/workflows/release-publish.yml", "utf8");

    expect(workflow).toContain('if [[ ! "$RELEASE_VERSION" =~ ^[0-9]+\\.[0-9]+\\.[0-9]+$ ]]; then');
    expect(workflow).toContain("gh api --include");
    expect(workflow).toContain("status_code_from_response");
    expect(workflow).not.toContain('if [[ "$tag_response" != *" 404 "* ]]; then');
    expect(workflow).not.toContain('if [[ "$release_response" != *" 404 "* ]]; then');
    expect(workflow).not.toContain(
      'gh api "repos/$GITHUB_REPOSITORY/git/ref/tags/v$RELEASE_VERSION" >/dev/null 2>&1'
    );
  });

  it("verifies the immutable release refs after creating them", async () => {
    const workflow = await readFile(".github/workflows/release-publish.yml", "utf8");

    expect(workflow).toContain('gh release view "v$RELEASE_VERSION"');
    expect(workflow).toContain("--json tagName,targetCommitish,isDraft,isPrerelease,name,body");
    expect(workflow).toContain("releases/latest");
    expect(workflow).toContain("git/ref/tags/v$RELEASE_VERSION");
    expect(workflow).toContain("git/ref/tags/v1");
    const registryVerification = workflow.indexOf(
      "- name: Verify exact registry artifact, provenance, and clean-room behavior"
    );
    const tagCreation = workflow.indexOf(
      'gh api --method POST "repos/$GITHUB_REPOSITORY/git/refs"'
    );
    expect(registryVerification).toBeGreaterThan(-1);
    expect(tagCreation).toBeGreaterThan(registryVerification);
  });

  it("passes the repository explicitly to release CLI calls in the checkout-free publish job", async () => {
    const workflow = await readFile(".github/workflows/release-publish.yml", "utf8");
    const releaseStart = workflow.indexOf("- name: Create and verify the immutable GitHub release");
    const stableTagStart = workflow.indexOf("- name: Move and verify the stable v1 Action tag");
    const releaseStep = workflow.slice(releaseStart, stableTagStart);
    const releaseCommands = [...releaseStep.matchAll(/gh release (?:create|view)[^\r\n]+/gu)].map(
      ([command]) => command
    );

    expect(releaseCommands).toHaveLength(3);
    expect(
      releaseCommands.every((command) => command.includes('--repo "$GITHUB_REPOSITORY"'))
    ).toBe(true);
  });

  it("resolves an existing annotated release tag before a resumable publish", async () => {
    const workflow = await readFile(".github/workflows/release-publish.yml", "utf8");
    const start = workflow.indexOf("- name: Bind the immutable release candidate");
    const end = workflow.indexOf("- name: Install locked dependencies without lifecycle scripts");
    const validationStep = workflow.slice(start, end);

    expect(validationStep).toContain('if [[ "$tag_type" == "tag" ]]; then');
    expect(validationStep).toContain("git/tags/$tag_sha");
    expect(validationStep).toContain('[[ ! "$tag_sha" =~ ^[0-9a-f]{40}$ ]]');
    expect(validationStep).toContain('if [[ "$tag_sha" != "$GITHUB_SHA" ]]; then');
    expect(validationStep).not.toContain(
      'gh api --method POST "repos/$GITHUB_REPOSITORY/git/refs"'
    );
  });

  it("keeps the bound release commit available within the binding step", async () => {
    const workflow = await readFile(".github/workflows/release-publish.yml", "utf8");
    const start = workflow.indexOf("- name: Bind the immutable release candidate");
    const end = workflow.indexOf("- name: Install locked dependencies without lifecycle scripts");
    const validationStep = workflow.slice(start, end);

    expect(validationStep).toContain('RELEASE_COMMIT="$GITHUB_SHA"');
    expect(validationStep).toContain('echo "RELEASE_COMMIT=$RELEASE_COMMIT" >> "$GITHUB_ENV"');
  });

  it("binds every resumable release stage to one immutable candidate commit", async () => {
    const workflow = await readFile(".github/workflows/release-publish.yml", "utf8");
    const tagStep = workflow.indexOf("- name: Bind the immutable release candidate");
    const publishStep = workflow.indexOf(
      "- name: Publish the audited tarball through npm Trusted Publishing"
    );

    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain('git checkout --detach "$RELEASE_COMMIT"');
    expect(workflow).toContain('gh release create "v$RELEASE_VERSION" --target "$RELEASE_COMMIT"');
    expect(workflow).toContain('sha="$RELEASE_COMMIT"');
    expect(workflow).toContain("needs: audit");
    expect(workflow).toContain("name: Upload the exact release candidate");
    expect(workflow).toContain("name: Download the audited release candidate");
    expect(tagStep).toBeGreaterThan(-1);
    expect(publishStep).toBeGreaterThan(tagStep);
  });

  it("makes registry verification resumable and checks provenance plus clean-room bytes", async () => {
    const workflow = await readFile(".github/workflows/release-publish.yml", "utf8");
    const packageManifest = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts?: { check?: unknown };
    };

    expect(workflow).toContain('npm view "@ahoooooo/reviewready@$RELEASE_VERSION" version');
    expect(workflow).toContain("dist-tags.latest");
    expect(workflow).toContain("npm latest dist-tag does not point to the requested release.");
    expect(workflow).toContain("E404");
    expect(workflow).toContain('npm pack "@ahoooooo/reviewready@$RELEASE_VERSION"');
    expect(workflow).toContain('"audit", "signatures", "--prefix"');
    expect(workflow).toContain('CONSUMER_DIR="$consumer_dir"');
    expect(workflow).toContain("package.json");
    expect(workflow).toContain('"--json", "--include-attestations"');
    expect(workflow).toContain("LOCAL_SHA512");
    expect(workflow).toContain("attestationBundles");
    expect(workflow).toContain("gitCommit");
    expect(workflow).toContain("grep -Eq");
    expect(workflow).not.toContain('if [[ "$existing_version" != *"E404"* ]]; then');
    expect(workflow).toContain("node scripts/package-smoke.mjs --artifact-dir");
    expect(workflow).toContain("registry shasum does not match");
    expect(packageManifest.scripts?.check).toContain("npm run package:smoke");
  });

  it("keeps registry clean-room execution outside the privileged publish job", async () => {
    const workflow = await readFile(".github/workflows/release-publish.yml", "utf8");
    const publishStart = workflow.indexOf("  publish:\n");
    const smokeStart = workflow.indexOf("  registry-smoke:\n");

    expect(publishStart).toBeGreaterThan(-1);
    expect(smokeStart).toBeGreaterThan(publishStart);

    const publishJob = workflow.slice(publishStart, smokeStart);
    const smokeJob = workflow.slice(smokeStart);
    expect(publishJob).not.toContain(
      'node "$consumer_dir/node_modules/@ahoooooo/reviewready/dist/cli.js"'
    );
    expect(smokeJob).toContain("needs: publish");
    expect(smokeJob).toContain("permissions: {}");
    expect(smokeJob).toContain(
      'node "$consumer_dir/node_modules/@ahoooooo/reviewready/dist/cli.js" validate'
    );
    expect(smokeJob).toContain(
      'node "$consumer_dir/node_modules/@ahoooooo/reviewready/dist/cli.js" check'
    );
  });

  it("keeps the registry smoke version bound to the dispatch input", async () => {
    const workflow = await readFile(".github/workflows/release-publish.yml", "utf8");
    const document = YAML.parse(workflow) as {
      jobs?: {
        "registry-smoke"?: {
          env?: { RELEASE_VERSION?: unknown };
        };
      };
    };
    const expectedExpression = "$" + "{{ inputs.version }}";

    expect(document.jobs?.["registry-smoke"]?.env?.RELEASE_VERSION).toBe(expectedExpression);
    expect(workflow).toContain("RELEASE_VERSION: " + expectedExpression);
    expect(workflow).not.toContain("RELEASE_VERSION: \\" + expectedExpression);
  });

  it("documents the package candidate version in the changelog", async () => {
    const packageManifest = JSON.parse(await readFile("package.json", "utf8")) as {
      version?: unknown;
    };
    const version = packageManifest.version;
    const changelog = await readFile("CHANGELOG.md", "utf8");

    expect(typeof version).toBe("string");
    expect(changelog).toContain(`## [${String(version)}]`);
  });

  it("requires release protection configuration evidence before publication is complete", async () => {
    const evidence = await readFile("docs/release-evidence-v1.0.6.md", "utf8");
    const process = await readFile("docs/releasing.md", "utf8");

    expect(evidence).toContain("release environment");
    expect(evidence).toContain("required reviewers");
    expect(evidence).toContain("npm Trusted Publisher");
    expect(process).toContain("release environment");
    expect(process).toContain("npm Trusted Publisher");
  });

  it("keeps release artifact hashing deterministic and rejects unsafe tar paths", () => {
    expect(sha1Hex("ReviewReady")).toHaveLength(40);
    expect(sha512Hex("ReviewReady")).toHaveLength(128);
    expect(normalizePackagedPath("package/dist/cli.js")).toBe("package/dist/cli.js");
    expect(() => normalizePackagedPath("package/../outside.js")).toThrow("unsafe package path");
  });

  it("rejects a bundle mutation during release preflight", () => {
    expect(() => {
      assertActionBundleSynchronized("", " M dist/action/index.js");
    }).toThrow("Action bundle changed during release preflight");
  });

  it("rejects an already dirty Action bundle before rebuilding", () => {
    expect(() => {
      assertActionBundleClean(" M dist/action/index.js");
    }).toThrow("Action bundle must be clean before release preflight");
    expect(() => {
      assertActionBundleClean("");
    }).not.toThrow();
  });

  it("requires package, lockfile, and changelog release metadata to agree", () => {
    expect(() => {
      assertReleaseMetadata({
        packageVersion: "1.0.5",
        lockVersion: "1.0.4",
        changelog: "## [1.0.5] - 2026-08-12"
      });
    }).toThrow("package and lockfile versions must match");
  });

  it("rejects a release whose stable Action tag drifts from the verified commit", () => {
    const commit = "a".repeat(40);
    const localSha512 = "b".repeat(128);
    const integrity = "sha512-" + Buffer.from(localSha512, "hex").toString("base64");

    expect(() => {
      assertReleaseProvenance({
        packageName: "@ahoooooo/reviewready",
        version: "1.0.5",
        packageVersion: "1.0.5",
        lockVersion: "1.0.5",
        mainCommit: commit,
        immutableTagCommit: commit,
        stableTagCommit: "c".repeat(40),
        npmVersion: "1.0.5",
        npmLatestVersion: "1.0.5",
        previousVersion: "1.0.4",
        previousNpmVersion: "1.0.4",
        localSha512,
        localShasum: "d".repeat(40),
        registryIntegrity: integrity,
        registryShasum: "d".repeat(40),
        provenancePredicateType: "https://slsa.dev/provenance/v1",
        provenanceRepository: "https://github.com/ahoooooooo/reviewready",
        provenanceWorkflow: ".github/workflows/release-publish.yml",
        provenanceRef: "refs/heads/main",
        provenanceCommit: commit,
        tarballUrl: "https://registry.npmjs.org/@ahoooooo/reviewready/-/reviewready-1.0.5.tgz",
        releaseUrl: "https://github.com/ahoooooooo/reviewready/releases/tag/v1.0.5",
        releaseTarget: commit
      });
    }).toThrow("stable Action tag");
  });

  it("rejects provenance when registry shasum differs from the local tarball", () => {
    const commit = "a".repeat(40);
    const localSha512 = "b".repeat(128);
    const integrity = "sha512-" + Buffer.from(localSha512, "hex").toString("base64");

    expect(() => {
      assertReleaseProvenance({
        packageName: "@ahoooooo/reviewready",
        version: "1.0.5",
        packageVersion: "1.0.5",
        lockVersion: "1.0.5",
        mainCommit: commit,
        immutableTagCommit: commit,
        stableTagCommit: commit,
        npmVersion: "1.0.5",
        npmLatestVersion: "1.0.5",
        previousVersion: "1.0.4",
        previousNpmVersion: "1.0.4",
        localSha512,
        localShasum: "c".repeat(40),
        registryIntegrity: integrity,
        registryShasum: "d".repeat(40),
        provenancePredicateType: "https://slsa.dev/provenance/v1",
        provenanceRepository: "https://github.com/ahoooooooo/reviewready",
        provenanceWorkflow: ".github/workflows/release-publish.yml",
        provenanceRef: "refs/heads/main",
        provenanceCommit: commit,
        tarballUrl: "https://registry.npmjs.org/@ahoooooo/reviewready/-/reviewready-1.0.5.tgz",
        releaseUrl: "https://github.com/ahoooooooo/reviewready/releases/tag/v1.0.5",
        releaseTarget: commit
      });
    }).toThrow("registry shasum does not match the local tarball");
  });

  it("rejects provenance when the claimed local hashes do not match the artifact bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "reviewready-provenance-test-"));
    const artifactPath = join(directory, "reviewready.tgz");
    const commit = "a".repeat(40);
    const claimedSha512 = sha512Hex("claimed bytes");
    const claimedShasum = sha1Hex("claimed bytes");
    const integrity = "sha512-" + Buffer.from(claimedSha512, "hex").toString("base64");
    try {
      await writeFile(artifactPath, "actual bytes", "utf8");
      await expect(
        verifyReleaseProvenance(
          {
            packageName: "@ahoooooo/reviewready",
            version: "1.0.6",
            packageVersion: "1.0.6",
            lockVersion: "1.0.6",
            mainCommit: commit,
            immutableTagCommit: commit,
            stableTagCommit: commit,
            npmVersion: "1.0.6",
            npmLatestVersion: "1.0.6",
            previousVersion: "1.0.5",
            previousNpmVersion: "1.0.5",
            localSha512: claimedSha512,
            localShasum: claimedShasum,
            registryIntegrity: integrity,
            registryShasum: claimedShasum,
            provenancePredicateType: "https://slsa.dev/provenance/v1",
            provenanceRepository: "https://github.com/ahoooooooo/reviewready",
            provenanceWorkflow: ".github/workflows/release-publish.yml",
            provenanceRef: "refs/heads/main",
            provenanceCommit: commit,
            tarballUrl: "https://registry.npmjs.org/@ahoooooo/reviewready/-/reviewready-1.0.6.tgz",
            releaseUrl: "https://github.com/ahoooooooo/reviewready/releases/tag/v1.0.6",
            releaseTarget: commit
          },
          artifactPath
        )
      ).rejects.toThrow("local tarball SHA-512 does not match");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires an exact artifact when verifying public release provenance", async () => {
    const previousArguments = process.argv;
    process.argv = [...previousArguments, "--provenance", "missing-evidence.json"];
    try {
      await expect(runReleasePreflightCli()).rejects.toThrow(
        "--provenance requires an evidence JSON path and --artifact tarball path"
      );
    } finally {
      process.argv = previousArguments;
    }
  });

  it("rejects a missing release artifact directory", async () => {
    const previousArguments = process.argv;
    process.argv = [...previousArguments, "--artifact-dir"];
    try {
      await expect(runReleasePreflightCli()).rejects.toThrow("--artifact-dir requires a directory");
    } finally {
      process.argv = previousArguments;
    }
  });

  it("verifies public coordinates and the npm SLSA source binding", async () => {
    const directory = await mkdtemp(join(tmpdir(), "reviewready-public-provenance-test-"));
    const artifactPath = join(directory, "reviewready.tgz");
    const artifact = Buffer.from("verified release artifact");
    const version = "1.0.6";
    const commit = "a".repeat(40);
    const annotatedTagObject = "b".repeat(40);
    const localSha512 = sha512Hex(artifact);
    const localShasum = sha1Hex(artifact);
    const registryIntegrity = "sha512-" + Buffer.from(localSha512, "hex").toString("base64");
    const tarballUrl =
      "https://registry.npmjs.org/@ahoooooo/reviewready/-/reviewready-" + version + ".tgz";
    const releaseApi =
      "https://api.github.com/repos/ahoooooooo/reviewready/releases/tags/v" + version;
    const previousReleaseApi =
      "https://api.github.com/repos/ahoooooooo/reviewready/releases/tags/v1.0.5";
    const latestApi = "https://api.github.com/repos/ahoooooooo/reviewready/releases/latest";
    const refBase = "https://api.github.com/repos/ahoooooooo/reviewready/git/ref/tags/";
    const tagBase = "https://api.github.com/repos/ahoooooooo/reviewready/git/tags/";
    const provenancePayload = {
      predicateType: "https://slsa.dev/provenance/v1",
      subject: [{ name: "reviewready.tgz", digest: { sha512: localSha512 } }],
      predicate: {
        buildDefinition: {
          externalParameters: {
            workflow: {
              repository: "https://github.com/ahoooooooo/reviewready",
              path: ".github/workflows/release-publish.yml",
              ref: "refs/heads/main"
            }
          },
          resolvedDependencies: [{ digest: { gitCommit: commit } }]
        }
      }
    };
    const signatureReport = {
      verified: [
        {
          name: "@ahoooooo/reviewready",
          version,
          attestations: { provenance: { predicateType: "https://slsa.dev/provenance/v1" } },
          attestationBundles: [
            {
              predicateType: "https://slsa.dev/provenance/v1",
              bundle: {
                dsseEnvelope: {
                  payload: Buffer.from(JSON.stringify(provenancePayload)).toString("base64")
                }
              }
            }
          ]
        }
      ]
    };
    const evidence = {
      packageName: "@ahoooooo/reviewready",
      version,
      packageVersion: version,
      lockVersion: version,
      mainCommit: commit,
      immutableTagCommit: commit,
      stableTagCommit: commit,
      npmVersion: version,
      npmLatestVersion: version,
      previousVersion: "1.0.5",
      previousNpmVersion: "1.0.5",
      localSha512,
      localShasum,
      registryIntegrity,
      registryShasum: localShasum,
      provenancePredicateType: "https://slsa.dev/provenance/v1",
      provenanceRepository: "https://github.com/ahoooooooo/reviewready",
      provenanceWorkflow: ".github/workflows/release-publish.yml",
      provenanceRef: "refs/heads/main",
      provenanceCommit: commit,
      tarballUrl,
      releaseUrl: "https://github.com/ahoooooooo/reviewready/releases/tag/v" + version,
      releaseTarget: commit
    };
    const calls: string[] = [];
    let releaseBody = "## [1.0.6] - 2026-08-12\n\nVerified release.";
    const fetchImpl = (input: string) => {
      calls.push(input);
      if (input === tarballUrl) {
        return Promise.resolve(
          new Response(artifact, {
            headers: { "content-length": String(artifact.byteLength) }
          })
        );
      }
      let body: unknown;
      if (input === "https://registry.npmjs.org/@ahoooooo/reviewready") {
        body = {
          name: "@ahoooooo/reviewready",
          "dist-tags": { latest: version },
          versions: {
            [version]: {
              dist: { integrity: registryIntegrity, shasum: localShasum, tarball: tarballUrl }
            },
            "1.0.5": { dist: {} }
          }
        };
      } else if (input === releaseApi) {
        body = {
          tag_name: "v" + version,
          target_commitish: commit,
          draft: false,
          prerelease: false,
          name: "ReviewReady " + version,
          body: releaseBody
        };
      } else if (input === previousReleaseApi) {
        body = { tag_name: "v1.0.5", draft: false, prerelease: false };
      } else if (input === latestApi) {
        body = { tag_name: "v" + version };
      } else if (input === refBase + "v" + version) {
        body = { object: { type: "tag", sha: annotatedTagObject } };
      } else if (input === tagBase + annotatedTagObject) {
        body = { object: { type: "commit", sha: commit } };
      } else if (input === refBase + "v1") {
        body = { object: { type: "commit", sha: commit } };
      } else {
        throw new Error("unexpected verifier request: " + input);
      }
      const text = JSON.stringify(body);
      return Promise.resolve(
        new Response(text, {
          headers: { "content-length": String(Buffer.byteLength(text, "utf8")) }
        })
      );
    };
    const npmRunner = (args: string[]) =>
      args[0] === "audit" ? JSON.stringify(signatureReport) : "";
    try {
      await writeFile(artifactPath, artifact);
      await writeFile(join(directory, "CHANGELOG.md"), releaseBody + "\n");
      await expect(
        verifyReleaseProvenance(evidence, artifactPath, {
          cwd: directory,
          fetchImpl,
          npmRunner
        })
      ).resolves.toBeUndefined();
      expect(calls).toContain(tarballUrl);
      expect(calls).toContain(previousReleaseApi);
      expect(calls).toContain(refBase + "v" + version);
      expect(calls).toContain(tagBase + annotatedTagObject);
      releaseBody = "tampered release notes";
      await expect(
        verifyReleaseProvenance(evidence, artifactPath, {
          cwd: directory,
          fetchImpl,
          npmRunner
        })
      ).rejects.toThrow("GitHub release metadata");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("runs the exact artifact and clean-room preflight against a requested artifact directory", async () => {
    const artifactDirectory = await mkdtemp(join(tmpdir(), "reviewready-preflight-test-"));
    const projectRoot = process.cwd();
    const alternateIndex = join(artifactDirectory, "index");
    const git = process.platform === "win32" ? "git.exe" : "git";
    const gitEnvironment = { ...process.env, GIT_INDEX_FILE: alternateIndex };
    const gitArguments = ["-c", "safe.directory=" + projectRoot];
    execFileSync(git, [...gitArguments, "read-tree", "HEAD"], {
      cwd: projectRoot,
      env: gitEnvironment,
      stdio: "ignore"
    });
    const trackedBundlePaths = execFileSync(
      git,
      [...gitArguments, "ls-files", "--", "dist/action"],
      {
        cwd: projectRoot,
        env: gitEnvironment,
        encoding: "utf8"
      }
    )
      .split(/\r?\n/u)
      .filter((path) => path.length > 0);
    for (const path of trackedBundlePaths) {
      execFileSync(git, [...gitArguments, "update-index", "--skip-worktree", "--", path], {
        cwd: projectRoot,
        env: gitEnvironment,
        stdio: "ignore"
      });
    }
    const previousIndex = process.env.GIT_INDEX_FILE;
    process.env.GIT_INDEX_FILE = alternateIndex;
    try {
      const result = runReleasePreflight(projectRoot, artifactDirectory);

      expect(result.fileCount).toBeGreaterThan(0);
      expect(result.sha512).toMatch(/^[0-9a-f]{128}$/u);
      expect(result.shasum).toMatch(/^[0-9a-f]{40}$/u);
      const previousArguments = process.argv;
      process.argv = [
        ...previousArguments,
        "scripts/release-preflight.mjs",
        "--artifact-dir",
        artifactDirectory
      ];
      try {
        await runReleasePreflightCli();
      } finally {
        process.argv = previousArguments;
      }
    } finally {
      if (previousIndex === undefined) {
        delete process.env.GIT_INDEX_FILE;
      } else {
        process.env.GIT_INDEX_FILE = previousIndex;
      }
      await rm(artifactDirectory, { recursive: true, force: true });
    }
  }, 120_000);
});
