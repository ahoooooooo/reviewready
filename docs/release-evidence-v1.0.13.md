# ReviewReady v1.0.13 release evidence (pre-publication checklist)

This public checklist records the evidence that the protected release workflow
must produce for v1.0.13. It is not evidence that v1.0.13 has been published,
tagged, released, or assigned npm provenance. Complete it only from the exact
post-merge main revision and the exact protected workflow artifacts.

## Release scope

- [ ] package.json and package-lock.json are aligned at 1.0.13.
- [ ] CHANGELOG.md contains the dated v1.0.13 entry.
- [ ] The public documentation and release evidence changes are present in the
      exact release tree.
- [ ] No unintended source, generated, credential, or package-private material
      is included in the published package.
- [ ] The exact audited tarball is produced once from the verified main commit.

## Local and repository gates

- [ ] A clean checkout of the exact main commit passes npm ci.
- [ ] npm run check, dependency audit, package privacy, bundle parity, and
      Windows/Node package smoke pass.
- [ ] A fresh no-context reviewer validates the exact head and artifact digest.
- [ ] The protected workflow verifies the exact package bytes before publication.

## Protected publication coordinates

- Source commit: pending exact post-merge main revision.
- Immutable semantic tag: pending protected workflow.
- npm version, registry integrity, and provenance: pending protected workflow.
- GitHub Release: pending exact-tag verification.
- Stable v1 tag: pending post-npm verification.

## Final verification boundary

The published npm 1.0.12 package, its provenance, immutable release, stable ref,
and historical commits remain unchanged. This checklist must be finalized only
after the v1.0.13 registry artifact, provenance, immutable tag, GitHub Release,
and stable v1 ref have been independently verified.
