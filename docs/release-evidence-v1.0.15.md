# ReviewReady v1.0.15 release evidence

Publication is pending. This candidate record keeps completed local and package
checks separate from online npm and GitHub observations. Pending items remain
unchecked until the protected release workflow verifies the exact release
commit and tarball.

## Release scope

- [x] `package.json` and `package-lock.json` declare 1.0.15.
- [x] `CHANGELOG.md` contains the dated v1.0.15 release entry.
- [x] The stable public baseline remains on verified v1.0.14 coordinates while
      this candidate is prepared.
- [x] Local `check`, dependency audit, package smoke, and promotion tests pass.
- [x] Local preflight audits a 111-file candidate with SHA-512
      `1fc59b9c44873381dc45647b66e4d660451bf00434e55bc983671f185601fa50af042819fc760d0fef2a43e8ea3b2a87436a1e44ee0eb40a037a048d02e67bed`.
- [ ] The protected workflow audits one exact 1.0.15 package artifact.
- [ ] The exact artifact is published through npm Trusted Publishing.
- [ ] Registry integrity, SHA-1, provenance, and clean-room installation pass.
- [ ] Immutable tag `v1.0.15` and the GitHub Release target the verified commit.
- [ ] Mutable Action tag `v1` moves to the same verified commit.
- [ ] The machine-readable evidence file records every final coordinate.

## Candidate coordinates

- Candidate package: `@ahoooooo/reviewready@1.0.15`
- Candidate source commit: pending release PR merge
- Local candidate tarball SHA-512:
  `1fc59b9c44873381dc45647b66e4d660451bf00434e55bc983671f185601fa50af042819fc760d0fef2a43e8ea3b2a87436a1e44ee0eb40a037a048d02e67bed`
- Protected-workflow tarball SHA-512: pending audit
- npm registry version and `latest`: pending publication
- npm provenance: pending publication
- Immutable semantic tag: `v1.0.15` (pending)
- Stable Action tag: `v1` (unchanged until verification)
- GitHub Release: pending

## Verification boundary

LOCAL and PACKAGED gates are reported independently in the release pull request
and protected workflow. ONLINE verification remains incomplete until registry
bytes, provenance, GitHub refs, and release metadata are observed. No pending
value is treated as a pass.
