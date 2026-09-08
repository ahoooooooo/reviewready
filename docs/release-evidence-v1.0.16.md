# ReviewReady v1.0.16 release evidence

Publication is pending. This candidate record keeps completed local and package
checks separate from online npm and GitHub observations. Pending items remain
unchecked until the protected release workflow verifies the exact release
commit and tarball.

## Release scope

- [x] `package.json` and `package-lock.json` declare 1.0.16.
- [x] `CHANGELOG.md` contains the dated v1.0.16 release entry.
- [x] The stable public baseline remains on verified v1.0.15 coordinates while
      this candidate is prepared.
- [x] Local `check` passed 999 tests with 6 skips; the dependency audit found
      0 vulnerabilities, package smoke passed, and promotion passed 37 tests.
- [x] Local preflight audited a 111-file 1.0.16 candidate tarball with SHA-512
      `19442736fe22912c2c502dc5fd8c346afdd94e0989104307fcbcd079cc006a5c38fc9d02eed9a100e9920b033dd3ef9ac3aca8feedd6f453e951229289225ba8`.
- [ ] The exact candidate commit has successful Node 22, Node 24 bundle, and
      CodeQL checks from GitHub Actions.
- [ ] The protected workflow audits one exact 1.0.16 package artifact.
- [ ] The exact artifact is published through npm Trusted Publishing.
- [ ] Registry integrity, SHA-1, provenance, and clean-room installation pass.
- [ ] GitHub reports `immutable: true` for Release `v1.0.16`, whose tag targets
      the verified commit.
- [ ] Mutable Action tag `v1` moves to the same verified commit.
- [ ] GitHub Marketplace shows v1.0.16 as the latest ReviewReady Action.
- [ ] The machine-readable evidence file records every final coordinate.

## Candidate coordinates

- Candidate package: `@ahoooooo/reviewready@1.0.16`
- Candidate source commit: pending release PR merge
- Local candidate tarball SHA-512:
  `19442736fe22912c2c502dc5fd8c346afdd94e0989104307fcbcd079cc006a5c38fc9d02eed9a100e9920b033dd3ef9ac3aca8feedd6f453e951229289225ba8`
- Local candidate tarball SHA-1:
  `bc6169eb0861d0c42074349dcfe93de515c03ccb`
- Protected-workflow tarball SHA-512: pending audit
- npm registry version and `latest`: pending publication
- npm provenance: pending publication
- Immutable semantic tag: `v1.0.16` (pending)
- Stable Action tag: `v1` (unchanged until verification)
- GitHub Release: pending
- GitHub Marketplace: pending publication observation

## Verification boundary

LOCAL and PACKAGED gates are reported independently in the release pull request
and protected workflow. ONLINE verification remains incomplete until registry
bytes, provenance, GitHub refs, Release immutability, and release metadata are
observed. No pending value is treated as a pass.
