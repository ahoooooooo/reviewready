# ReviewReady v1.0.17 release evidence

Publication is pending. This candidate record keeps completed local and package
checks separate from online npm, GitHub, and Marketplace observations. Pending
items remain unchecked until the protected release workflow verifies the exact
release commit and tarball.

## Release scope

- [x] `package.json` and `package-lock.json` declare 1.0.17.
- [x] `CHANGELOG.md` contains the dated v1.0.17 release entry.
- [x] The stable public baseline remains on verified v1.0.16 coordinates while
      this candidate is prepared.
- [x] Local `check` passed 1,009 tests with 6 skips; dependency audit found
      0 vulnerabilities, package smoke passed, and promotion passed 37 tests.
- [x] Local preflight audited a 111-file 1.0.17 candidate tarball with SHA-512
      `a51b00005421fa477410b177139044c053be6617d1daf3d68bff95e4005a23f9d685e6217e4b6a03e11062cb0c13e574a7296862a68d23c2a1069532e23bb4a9`.
- [ ] The exact candidate commit has successful required checks.
- [ ] The protected workflow publishes and verifies the same artifact.
- [ ] GitHub reports an immutable v1.0.17 Release and updates `v1`.
- [ ] npm registry integrity, provenance, and clean-room installation pass.
- [ ] GitHub Marketplace shows v1.0.17 as the latest ReviewReady Action.
- [ ] The machine-readable evidence records every final coordinate.

## Candidate coordinates

- Candidate package: `@ahoooooo/reviewready@1.0.17`
- Candidate source commit: pending release PR merge
- Local candidate tarball SHA-512:
  `a51b00005421fa477410b177139044c053be6617d1daf3d68bff95e4005a23f9d685e6217e4b6a03e11062cb0c13e574a7296862a68d23c2a1069532e23bb4a9`
- Local candidate tarball SHA-1:
  `285a49b09d11c95354b1e2d818cc190c46a5dbdb`
- npm registry version and `latest`: pending publication
- npm provenance: pending publication
- Immutable semantic tag: `v1.0.17` (pending)
- Stable Action tag: `v1` (unchanged until verification)
- GitHub Release: pending
- GitHub Marketplace: pending observation

## Verification boundary

LOCAL and PACKAGED gates are reported independently in the release pull request
and protected workflow. ONLINE verification remains incomplete until registry
bytes, provenance, GitHub refs, Release immutability, and Marketplace metadata
are observed. No pending value is treated as a pass.
