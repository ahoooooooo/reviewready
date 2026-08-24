# ReviewReady v1.0.12 release evidence (draft)

This is an unchecked release-candidate checklist. It is not evidence that
v1.0.12 has been released, published, tagged, or assigned npm provenance.
Complete it only from the exact authorized release commit and exact protected
workflow artifact.

## Release scope

- [ ] package.json and package-lock.json are aligned at 1.0.12.
- [ ] CHANGELOG.md contains the dated v1.0.12 entry.
- [ ] The public documentation changes are present in the exact release tree.
- [ ] No unintended source, generated, local-control, or credential material is
      included in the package.
- [ ] The exact audited tarball is produced once from the verified release
      commit.

## Local and repository gates

- [ ] A clean checkout of the exact release commit passes npm ci.
- [ ] npm run check, dependency audit, package privacy, bundle parity, and
      Windows/Node package smoke pass.
- [ ] A fresh no-context reviewer validates the exact artifact digest.
- [ ] PR #113 remains a separate dependency-maintenance decision and is not
      included in this release candidate.

## Protected publication coordinates

- Source commit: pending an authorized release commit.
- Immutable semantic tag: pending protected release workflow.
- npm version and registry integrity: pending protected OIDC publication.
- GitHub Release: pending exact-tag verification.
- Stable v1 tag: pending post-npm verification.

## Known boundaries

The published npm 1.0.11 package and immutable historical releases remain
unchanged until a separately authorized release or history decision. This draft
must not be marked complete from local preflight alone.
