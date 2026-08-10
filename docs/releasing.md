# Release process

This checklist keeps npm packages, immutable Git tags, GitHub Release objects,
the stable Action tag, and Marketplace metadata aligned. These are separate
resources and completing one does not update the others automatically.

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
second build between tarball verification and publication.

```console
npm pack --json --ignore-scripts
```

The package-audit tooling should inspect the files and contents extracted from that
exact tarball. Until issue #16 supplies this exact-artifact path, do not describe a
source-tree dry run as proof that the final published bytes were audited.

## 3. Verify the local artifact

Before publication:

- inspect the tarball file list and package manifest;
- run the privacy and credential-pattern audit against extracted tarball bytes;
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

## 5. Publish GitHub resources

Only after npm verification succeeds:

1. Create immutable Git tag `vX.Y.Z` at the verified release commit.
2. Create a GitHub Release object from that exact tag.
3. Use the matching changelog entry as the release notes and mark the newest
   stable release as latest.
4. Move the mutable `v1` Action tag to the same verified commit.
5. For Marketplace publication, publish the Action from the newest stable GitHub
   Release and verify the listing shows the expected version.

Never move or replace an immutable `vX.Y.Z` tag. Only the major convenience tag
`v1` is expected to move.

## 6. Final consistency check

Verify that all of the following refer to the intended release:

- source commit;
- `package.json` and `package-lock.json`;
- exact local tarball checksum;
- npm `latest`, registry tarball, integrity, and provenance;
- immutable Git tag `vX.Y.Z`;
- GitHub Release object;
- stable Action tag `v1`;
- Marketplace listing;
- `CHANGELOG.md`;
- release evidence documentation.

If any step remains manual or incomplete, record it honestly instead of marking
the release evidence complete. A missing checkbox is cheaper than forensic
archaeology three weeks later.
