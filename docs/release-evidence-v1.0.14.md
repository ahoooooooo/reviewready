# ReviewReady v1.0.14 release evidence

This document is the public release-candidate checklist for v1.0.14. The
protected workflow must fill the final source, artifact, registry, provenance,
immutable-tag, stable-Action, and GitHub Release coordinates after publication.

## Candidate scope

- [x] `package.json` and `package-lock.json` are aligned at 1.0.14.
- [x] `CHANGELOG.md` records the dated v1.0.14 candidate release.
- [x] The public baseline distinguishes stable v1.0.13 from this candidate.
- [ ] The protected workflow audits and publishes one exact tarball.
- [ ] npm registry integrity, provenance, clean-room install, and smoke pass.
- [ ] Immutable semantic tag `v1.0.14` and GitHub Release target the release
      commit.
- [ ] Stable Action tag `v1` targets the same release commit.
- [ ] Final machine-readable coordinates replace the candidate record in
      `docs/release-evidence-v1.0.14.json`.

## Final evidence

The final evidence update is documentation-only after protected publication.
It must record the actual release commit, exact tarball checksums, npm
coordinates, provenance, immutable release tag, stable `v1` ref, workflow
attempts, and registry smoke result. The candidate record contains no invented
external coordinates.
