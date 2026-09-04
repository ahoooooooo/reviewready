# ReviewReady v1.0.14 release evidence

This document records the public coordinates verified after the protected
release workflow completed for the exact main revision below. The package was
published through npm Trusted Publishing, and the GitHub Release/tag refs were
verified against the same commit and exact artifact.

## Release scope

- [x] `package.json` and `package-lock.json` were aligned at 1.0.14.
- [x] `CHANGELOG.md` recorded the dated v1.0.14 release entry.
- [x] The protected workflow audited the exact 111-file package artifact.
- [x] The exact artifact was published through npm Trusted Publishing with a
      matching registry integrity and SHA-1 shasum.
- [x] npm provenance, clean-room installation, and registry smoke verification
      passed for the published package.
- [x] Immutable semantic tag `v1.0.14` and GitHub Release target the verified
      main commit.
- [x] Stable Action tag `v1` targets the same verified main commit.
- [x] This machine-readable evidence file records the final coordinates.

## Local and repository gates

- [x] The exact release candidate passed `npm run check`, dependency audit,
      package privacy, bundle parity, and Windows/Node package smoke in the
      protected workflow.
- [x] The release candidate checks completed before the protected workflow was
      dispatched.
- [x] The workflow artifact digest was verified before publication:
      `sha256:216c5f4c884add9c3cfadc440fb593d33646eb0450e900a630cbe672f2abb086`.
- [x] The published registry tarball bytes independently matched the audited
      artifact SHA-512 and SHA-1 values below.

## Protected publication coordinates

- Source commit: `89714b55f0b1f03b949033c75f45a1d0358f00a2`
- Immutable semantic tag: `v1.0.14`
- Stable Action ref: `v1`
- npm package: `@ahoooooo/reviewready@1.0.14`
- npm tarball:
  https://registry.npmjs.org/@ahoooooo/reviewready/-/reviewready-1.0.14.tgz
- npm SHA-1 shasum: `4b87b8bd99bfd5932bce68a98aad71f0d5efa5f4`
- npm SHA-512 hex: `68cc6dc731ed51183a400a3c836416cbcee65bab6a064be8d759e1244eb885329bd48f90682467c386986ee9a44b25c5a9074ecd69a3850dc86b8546c8db9ae8`
- npm integrity:
  `sha512-aMxtxzHtURg6QAo8g2QWy87mW6tqBkvo11nhJE64hTKb1I+QaCRnw4aYbumkSyXFqQdOzWmjhQ3Ia4VGyNua6A==`
- npm provenance predicate: `https://slsa.dev/provenance/v1`
- npm provenance source: `main@89714b55f0b1f03b949033c75f45a1d0358f00a2`
- npm transparency-log index: `2708234493`
- npm provenance publication attempt:
  https://github.com/ahoooooooo/reviewready/actions/runs/33846336129/attempts/1
- post-publication verification attempt:
  https://github.com/ahoooooooo/reviewready/actions/runs/33846336129/attempts/2
- protected workflow run:
  https://github.com/ahoooooooo/reviewready/actions/runs/33846336129
- publication audit job:
  https://github.com/ahoooooooo/reviewready/actions/runs/33846336129/job/100938953493
- verification publish job:
  https://github.com/ahoooooooo/reviewready/actions/runs/33846336129/job/100940056395
- verification registry smoke job:
  https://github.com/ahoooooooo/reviewready/actions/runs/33846336129/job/100940466541
- GitHub Release:
  https://github.com/ahoooooooo/reviewready/releases/tag/v1.0.14

## Verification boundary

The first workflow attempt published the exact audited artifact through npm
Trusted Publishing, then stopped at the registry latest-dist-tag check while
the npm publication propagated. The resumable second attempt observed
`latest=1.0.14`, verified the same artifact bytes and provenance, created the
immutable GitHub release/tag, moved stable `v1`, and passed registry smoke. No
second npm version was created and no immutable historical ref was rewritten.

This evidence update is documentation-only after publication. The package and
release refs above target the release source commit; this later evidence and
public-baseline commit does not move the immutable tag or stable `v1`. Earlier
published packages, immutable releases, and historical commits remain
unchanged.
