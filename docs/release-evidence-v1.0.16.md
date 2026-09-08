# ReviewReady v1.0.16 release evidence

This document records the public coordinates verified after the protected
release workflow completed for the exact main revision below. The package was
published through npm Trusted Publishing, and the GitHub Release/tag refs were
verified against the same commit and exact artifact.

## Release scope

- [x] `package.json` and `package-lock.json` were aligned at 1.0.16.
- [x] `CHANGELOG.md` recorded the dated v1.0.16 release entry.
- [x] The exact release commit passed the required Node 22, Node 24 bundle, and
      CodeQL checks from GitHub Actions.
- [x] The protected workflow audited the exact 111-file package artifact.
- [x] The exact artifact was published through npm Trusted Publishing with a
      matching registry integrity and SHA-1 shasum.
- [x] npm provenance, clean-room installation, and registry smoke verification
      passed for the published package.
- [x] GitHub reported `immutable: true` for Release `v1.0.16`, whose tag targets
      the verified main commit.
- [x] Stable Action tag `v1` targets the same verified main commit.
- [x] A fresh GitHub Marketplace page load displayed v1.0.16 as the latest
      ReviewReady Action and rendered the v1.0.16 package README.
- [x] This machine-readable evidence file records every final coordinate.

## Local and repository gates

- [x] PR #135 and merge commit
      `754bc035821b2ca89fe61c7db690e63a332c9526` passed `check`, Node 22,
      both CodeQL analyses, packaged CLI, promotion, and replay review jobs.
- [x] The exact release candidate passed `npm run check`, dependency audit,
      package privacy, bundle parity, promotion, and Windows/Node package smoke.
- [x] The npm Trusted Publisher and protected GitHub `release` environment were
      independently confirmed before workflow dispatch.
- [x] Workflow artifact digest
      `sha256:d741a6700873907526a7c52be6ba61277df8c56d311fbf3e211f9261082f500b`
      was observed before publication.
- [x] The downloaded workflow tarball and independently downloaded registry
      tarball were byte-identical and matched the recorded SHA-512 and SHA-1.
- [x] An isolated consumer with an empty npm user config verified provenance and
      completed the packaged Windows/Node smoke.

## Protected publication coordinates

- Source commit: `754bc035821b2ca89fe61c7db690e63a332c9526`
- Immutable semantic tag: `v1.0.16`
- Stable Action ref: `v1`
- npm package: `@ahoooooo/reviewready@1.0.16`
- npm tarball:
  https://registry.npmjs.org/@ahoooooo/reviewready/-/reviewready-1.0.16.tgz
- npm SHA-1 shasum: `e54b9503093f5777b93772b33899abad146599b6`
- npm SHA-512 hex:
  `5c1bd5900a599105629e5be8fc9e6542911144ed2c963e7b1be2a75bce04a6704530306b91ada457e85b150b78a144296c101cbbe7c1cffdf91d71429d538f43`
- npm integrity:
  `sha512-XBvVkApZkQVinlvo/J5lQpERRO0slj57G+KnW84EpnBFMDBrka2kV+hbFQt4oUQpbBAcu+fBz/35HXFCnVOPQw==`
- npm provenance predicate: `https://slsa.dev/provenance/v1`
- npm provenance source:
  `main@754bc035821b2ca89fe61c7db690e63a332c9526`
- npm transparency-log index: `2755248384`
- npm provenance publication attempt:
  https://github.com/ahoooooooo/reviewready/actions/runs/34190563700/attempts/1
- post-propagation verification attempt:
  https://github.com/ahoooooooo/reviewready/actions/runs/34190563700/attempts/2
- protected workflow run:
  https://github.com/ahoooooooo/reviewready/actions/runs/34190563700
- publication audit job:
  https://github.com/ahoooooooo/reviewready/actions/runs/34190563700/job/101947590635
- verification audit job:
  https://github.com/ahoooooooo/reviewready/actions/runs/34190563700/job/101950957734
- publication job:
  https://github.com/ahoooooooo/reviewready/actions/runs/34190563700/job/101947996774
- verification publish job:
  https://github.com/ahoooooooo/reviewready/actions/runs/34190563700/job/101950957266
- verification registry smoke job:
  https://github.com/ahoooooooo/reviewready/actions/runs/34190563700/job/101951108665
- GitHub Release:
  https://github.com/ahoooooooo/reviewready/releases/tag/v1.0.16
- GitHub Release published at: `2026-09-08T05:44:05Z`

## Independent registry recheck

At `2026-09-08T05:52:59Z`, a separate read-only query of the official npm
registry observed `latest=1.0.16` and downloaded the published tarball. Its
111-file list, 190,485-byte archive, SHA-512 and SHA-1 values matched the
protected workflow artifact exactly. The manifest, CLI, README, and four
exported schemas were present.

The packaged README declared package 1.0.16 and used v1.0.16 for every Action
example, remote schema URL, and version-bound product-document link. It did not
retain v1.0.15 Action examples or mutable `main` links for version-specific
product documentation.

The isolated npm signature audit reported no invalid or missing signatures and
verified the SLSA v1 provenance subject against the tarball SHA-512. The
provenance bound repository `ahoooooooo/reviewready`, workflow
`.github/workflows/release-publish.yml`, `refs/heads/main`, source commit
`754bc035821b2ca89fe61c7db690e63a332c9526`, and publication attempt 1.

## Verification boundary

The first workflow attempt published the exact audited artifact through npm
Trusted Publishing, then stopped at the registry latest-dist-tag check while
the npm publication propagated. The resumable second attempt observed the
existing exact version, verified the same artifact bytes and provenance,
created the immutable GitHub Release/tag, moved stable `v1`, and passed registry
smoke. No second npm version was created and no immutable historical ref was
rewritten.

The replay review job on the release commit succeeded because the saved TA-2
evidence remained internally reproducible. The repository audit represented by
that evidence remains `incomplete`; a green replay job is not recorded as an
audit pass.

The first search-cache observation still displayed v1.0.15. A fresh,
authenticated GitHub Marketplace page load at `2026-09-08T06:00:44Z` then
displayed `v1.0.16 Latest`, package version 1.0.16, v1.0.16 Action examples,
v1.0.16 schema URLs, and v1.0.16 version-bound product-document links. The
Marketplace pass is based on that live page, not inferred from the tag or
workflow result.

This evidence update is documentation and trusted-pin maintenance after
publication. The package and release refs above target the release source
commit; this later evidence commit does not move the immutable tag or stable
`v1`. Earlier published packages, immutable releases, and historical commits
remain unchanged.
