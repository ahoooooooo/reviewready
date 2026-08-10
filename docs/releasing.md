# Release process

This checklist keeps npm packages, immutable Git tags, GitHub Release objects,
the stable Action tag, and Marketplace metadata aligned. These are separate
resources and completing one does not update the others automatically.

## 1. Prepare the release pull request

- Choose the next unused semantic version. Never reuse an unpublished version.
- Update `package.json` and `package-lock.json` together.
- Move user-visible changes from `Unreleased` into a dated `CHANGELOG.md` entry.
- Add or update `docs/release-evidence-vX.Y.Z.md` with unchecked public steps.
- Confirm the release contains only intended source, dependency, and documentation
  changes.

## 2. Verify the release candidate

From a clean checkout, run:

```console
npm ci
npm run check
npm audit --audit-level=high
npm pack --dry-run --json --ignore-scripts
```

The release pull request must pass Node.js 22 and Node.js 24 CI, package privacy
verification, the committed Action bundle check, and CodeQL before merge.

## 3. Publish and verify npm

- Publish the exact merged release commit to the official npm registry.
- Verify registry metadata, package integrity, and tarball contents.
- Install the exact version in a clean temporary directory.
- Run policy validation and a ready fixture check from the installed package.
- Record the package URL, tarball URL, integrity, and release commit in the release
  evidence file.

Prefer npm Trusted Publishing with short-lived OIDC credentials. Do not store a
long-lived npm token in repository secrets when trusted publishing is available.

## 4. Publish GitHub resources

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

## 5. Final consistency check

Verify that all of the following refer to the intended release:

- `package.json` and `package-lock.json`;
- npm `latest`;
- immutable Git tag `vX.Y.Z`;
- GitHub Release object;
- stable Action tag `v1`;
- Marketplace listing;
- `CHANGELOG.md`;
- release evidence documentation.

If any step remains manual or incomplete, record it honestly instead of marking
the release evidence complete. A missing checkbox is cheaper than forensic
archaeology three weeks later.
