# Release process

This checklist keeps npm packages, semantic-version Git tags treated as
immutable by project policy, GitHub Release objects, the stable Action tag, and
Marketplace metadata aligned. These are separate resources and completing one
does not update the others automatically. GitHub's release-immutability setting
is a distinct external control and protects only releases created after it is
enabled.

A release is verified only when the exact tarball submitted to npm is the same
artifact that was audited, installed, and recorded. Verifying source files and
then allowing a later lifecycle hook to rebuild them is not equivalent.

## 1. Prepare the release pull request

- Choose the next unused semantic version. Never reuse an unpublished version.
- Update `package.json` and `package-lock.json` together.
- Move user-visible changes from `Unreleased` into a dated `CHANGELOG.md` entry.
- Add or update `docs/release-evidence-vX.Y.Z.md` with unchecked public steps.
- Confirm the release contains only intended source, dependency, and documentation
  changes.
- Confirm every release blocker identified in the tracking issue is closed.

## 2. Verify the release candidate

From a clean checkout, run:

```console
npm ci
npm run check
npm audit --audit-level=high
```

The release pull request must pass Node.js 22 and Node.js 24 CI, package privacy
verification, the committed Action bundle check, and CodeQL before merge.

After merge, build once and create one local tarball from the verified commit. The
release tooling must record the exact tarball path and checksum. Do not perform a
second build between tarball verification and publication. `dist/action` must be
clean before `npm run release:preflight`; the preflight records the committed
bundle state, rebuilds once, and fails if the build changes it. The
.github/workflows/release-publish.yml workflow is a manual, protected
environment implementation of this sequence; it requires npm Trusted Publishing
to be configured for that exact workflow filename and does not accept an npm
token secret.

Before dispatching the workflow, independently verify that the GitHub release
environment requires the intended reviewers. Also verify the npm Trusted Publisher
configuration is bound to this repository, `.github/workflows/release-publish.yml`,
the `main` branch, and the release environment. The YAML `environment` field
alone is not evidence that either external protection is configured.

```console
npm pack --json --ignore-scripts
```

The package-audit and release-preflight tooling inspect the files and contents
from the exact tarball. A source-tree dry run alone is never proof that the final
published bytes were audited.

npm run release:preflight also records the committed Action bundle state before
the build and fails if the build changes it. This prevents a stale checked-in
dist/action tree from being silently replaced during release verification. The
workflow then verifies npm integrity, SHA-1 shasum, registry tarball bytes, npm
signatures/provenance, and a clean-room install before creating GitHub refs.

## 3. Verify the local artifact

The package:smoke check intentionally installs and invokes the CLI from the
candidate package. It is a trusted-release-artifact check with lifecycle scripts
disabled, not a sandbox for hostile npm packages; do not point it at an
unreviewed third-party tarball.

Before publication:

- inspect the tarball file list and package manifest;
- run the privacy and credential-pattern audit against bounded tarball-member
  bytes without extracting untrusted archive entries to disk;
- verify package name, version, registry, integrity, and expected entry points;
- install the tarball into a clean temporary consumer directory;
- run policy validation plus ready and not-ready CLI fixtures;
- record the tarball checksum, source commit, and verification commands in the
  release-evidence file.

If an npm lifecycle script would rebuild package files during `npm publish`, change
the workflow so the already-verified `.tgz` is published directly. Publication
must not mutate the audited artifact.

## 4. Publish and verify npm

- Publish the exact verified tarball to the official npm registry.
- Prefer npm Trusted Publishing with short-lived OIDC credentials. Do not store a
  long-lived npm token in repository secrets when trusted publishing is available.
- Verify registry metadata, provenance where enabled, and tarball contents.
- Compare the registry integrity with the checksum/integrity recorded before
  publication.
- Install the exact registry version in another clean temporary directory.
- Run policy validation plus ready and not-ready fixture checks from the installed
  package.
- Record the package URL, tarball URL, integrity, provenance, and release commit in
  the release evidence.
- Store the machine-readable release coordinates in the evidence JSON and run
  npm run release:verify -- docs/release-evidence-vX.Y.Z.json --artifact
  <exact-tarball>. The verifier hashes that exact regular file, then performs
  bounded fail-closed checks against the public npm registry, npm Trusted
  Publishing provenance, GitHub release metadata, and both tag refs. It
  requires package/lock/npm versions, local and registry SHA-512, the previous
  release, the final main commit, project-policy immutable semantic-version tag,
  stable v1 tag, and GitHub release target to agree.

## 5. Publish GitHub resources

Only after npm verification succeeds:

1. Verify GitHub release immutability is enabled for the repository. If it is
   unavailable or disabled, record the release gate as incomplete and obtain an
   explicit decision rather than claiming platform-enforced immutability.
2. Create semantic-version Git tag `vX.Y.Z` at the verified release commit.
3. Create a GitHub Release object from that exact tag.
4. Use the matching changelog entry as the release notes and mark the newest
   stable release as latest.
5. Move the mutable `v1` Action tag to the same verified commit.
6. For Marketplace publication, publish the Action from the newest stable GitHub
   Release and verify the listing shows the expected version.

Never move or replace a semantic-version `vX.Y.Z` tag. Project policy treats it
as immutable even for historical releases that predate GitHub's platform
enforcement. Only the major convenience tag `v1` is expected to move.

## 6. Final consistency check

Verify that all of the following refer to the intended release:

- source commit;
- `package.json` and `package-lock.json`;
- exact local tarball checksum;
- npm `latest`, registry tarball, integrity, and provenance;
- semantic-version Git tag `vX.Y.Z` and its platform immutability state;
- GitHub Release object;
- stable Action tag `v1`;
- Marketplace listing;
- `CHANGELOG.md`;
- release evidence documentation.

If any step remains manual or incomplete, record it honestly instead of marking
the release evidence complete. A missing checkbox is cheaper than forensic
archaeology three weeks later.
