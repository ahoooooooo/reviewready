# ReviewReady v1.0.17 release evidence

This document records the public coordinates verified after the protected
release workflow completed for the exact main revision below. The package was
published through npm Trusted Publishing, and the GitHub Release/tag refs were
verified against the same commit and exact artifact.

## Release scope

- [x] `package.json` and `package-lock.json` were aligned at 1.0.17.
- [x] `CHANGELOG.md` recorded the dated v1.0.17 release entry.
- [x] The exact release commit passed the required Node 22, Node 24 bundle, and
      CodeQL checks from GitHub Actions.
- [x] The protected workflow audited the exact 111-file package artifact.
- [x] The exact artifact was published through npm Trusted Publishing with a
      matching registry integrity and SHA-1 shasum.
- [x] npm provenance, clean-room installation, and registry smoke verification
      passed for the published package.
- [x] GitHub reported `immutable: true` for Release `v1.0.17`, whose tag targets
      the verified main commit.
- [x] Stable Action tag `v1` targets the same verified main commit.
- [x] Fresh anonymous and authenticated GitHub Marketplace page loads displayed
      v1.0.17 as the latest ReviewReady Action and rendered the v1.0.17 README.
- [x] A fresh anonymous npm package page displayed version 1.0.17, the current
      install command, and the v1.0.17 README examples and version-bound links.
- [x] The public Discussions page and API reported zero discussions, so there
      was no current announcement to reconcile.
- [x] The independently installed CLI completed the bounded regression input
      and failed closed on over-budget Markdown with the documented error code.
- [x] This machine-readable evidence file records every final coordinate.

## Local and repository gates

- [x] PR #137 and merge commit
      `2b7193f720c2a68e8ee410366e6de2b8d1922eff` passed `check`, Node 22,
      both CodeQL analyses, packaged CLI, preflight, trusted readiness, promotion,
      and replay review jobs.
- [x] The exact release candidate passed `npm run check` with 1,009 tests and 6
      skips, dependency audit with 0 vulnerabilities, package privacy, bundle
      parity, promotion with 37 tests, and Windows/Node package smoke.
- [x] The npm Trusted Publisher and protected GitHub `release` environment were
      independently confirmed before workflow dispatch.
- [x] Workflow artifact digest
      `sha256:cca41dc0c26eb3ef076ccdbd80e18abf59b9793c404da46efb610a0d5fa2d3a7`
      was observed before publication.
- [x] The downloaded workflow tarball and independently downloaded registry
      tarball were byte-identical and matched the recorded SHA-512 and SHA-1.
- [x] An isolated consumer verified provenance and completed the packaged
      Windows/Node smoke without lifecycle scripts.

## Protected publication coordinates

- Source commit: `2b7193f720c2a68e8ee410366e6de2b8d1922eff`
- Immutable semantic tag: `v1.0.17`
- Stable Action ref: `v1`
- npm package: `@ahoooooo/reviewready@1.0.17`
- npm tarball:
  https://registry.npmjs.org/@ahoooooo/reviewready/-/reviewready-1.0.17.tgz
- npm SHA-1 shasum: `285a49b09d11c95354b1e2d818cc190c46a5dbdb`
- npm SHA-512 hex:
  `a51b00005421fa477410b177139044c053be6617d1daf3d68bff95e4005a23f9d685e6217e4b6a03e11062cb0c13e574a7296862a68d23c2a1069532e23bb4a9`
- npm integrity:
  `sha512-pRsAAFQh+kd0ELF3E5BEwFO+ZhfR2vPWi/+V5ABaI/nWheYhfktqA+EQYssME+V0pyloYqaNI8KhBpUy4ju0qQ==`
- npm provenance predicate: `https://slsa.dev/provenance/v1`
- npm provenance source:
  `main@2b7193f720c2a68e8ee410366e6de2b8d1922eff`
- npm transparency-log index: `2757280762`
- npm provenance publication attempt:
  https://github.com/ahoooooooo/reviewready/actions/runs/34220587519/attempts/1
- post-propagation verification attempt:
  https://github.com/ahoooooooo/reviewready/actions/runs/34220587519/attempts/2
- protected workflow run:
  https://github.com/ahoooooooo/reviewready/actions/runs/34220587519
- publication audit job:
  https://github.com/ahoooooooo/reviewready/actions/runs/34220587519/job/102042520922
- verification audit job:
  https://github.com/ahoooooooo/reviewready/actions/runs/34220587519/job/102044701636
- publication job:
  https://github.com/ahoooooooo/reviewready/actions/runs/34220587519/job/102043138311
- verification publish job:
  https://github.com/ahoooooooo/reviewready/actions/runs/34220587519/job/102044700529
- verification registry smoke job:
  https://github.com/ahoooooooo/reviewready/actions/runs/34220587519/job/102044929341
- GitHub Release:
  https://github.com/ahoooooooo/reviewready/releases/tag/v1.0.17
- GitHub Release published at: `2026-09-08T11:33:40Z`

## Independent registry recheck

At `2026-09-08T11:41:43Z`, a separate read-only query of the official npm
registry observed `latest=1.0.17` and downloaded the published tarball. Its
111-file list, 191,531-byte archive, SHA-512 and SHA-1 values matched the
protected workflow artifact exactly. The manifest, CLI, README, and four
exported schemas were present.

The packaged README declared package 1.0.17 and used v1.0.17 for every Action
example, remote schema URL, and version-bound product-document link. It did not
retain v1.0.16 Action examples or mutable `main` links for version-specific
product documentation.

The installed CLI classified the 4,000-space incomplete-tag regression input as
`ready` within the hard process deadline. A one-million-character over-budget
input completed within the same deadline with exit code 2 and
`INPUT_MARKDOWN_SCAN_BUDGET_EXCEEDED`; it was not accepted as ready.

The isolated npm signature audit reported no invalid or missing signatures and
verified the SLSA v1 provenance subject against the tarball SHA-512. The
provenance bound repository `ahoooooooo/reviewready`, workflow
`.github/workflows/release-publish.yml`, `refs/heads/main`, source commit
`2b7193f720c2a68e8ee410366e6de2b8d1922eff`, and publication attempt 1.

## Public page recheck

At 2026-09-08T13:27:43Z, a fresh anonymous browser session displayed
v1.0.17 Latest on the GitHub Marketplace page. The visible README declared
package 1.0.17 and used v1.0.17 for Action examples, the remote schema, and
version-bound product documentation. A separate authenticated page load at
2026-09-08T13:27:51Z displayed the same version and examples. The earlier
stale page retrieval was therefore classified as a retrieval or cache
observation rather than a current Marketplace publication defect.

At 2026-09-08T13:27:58Z, the anonymous npm package page displayed version
1.0.17, install command npm i @ahoooooo/reviewready, and a README declaring
package 1.0.17 with v1.0.17 Action, schema, and version-bound product-document
references.

At 2026-09-08T13:28:28Z, the anonymous GitHub Discussions page displayed the
empty welcome state. A read-only public API query returned zero discussions,
so there was no current or pinned announcement to reconcile.

These are time-bound browser and public-API observations. They do not replace
the separate registry metadata, tarball-byte, signature, provenance, or
workflow verification recorded above.

## Verification boundary

The first workflow attempt published the exact audited artifact through npm
Trusted Publishing, then stopped when an immediate registry query returned 404
before npm propagation completed. A later independent registry query observed
the exact version and expected `latest` tag. The resumable second attempt
recognized the existing version, verified the same artifact bytes and
provenance, created the immutable GitHub Release/tag, moved stable `v1`, and
passed registry smoke. No second npm version was created and no immutable
historical ref was rewritten.

The replay review job on the release commit succeeded because the saved TA-2
evidence remained internally reproducible. The repository audit represented by
that evidence remains `incomplete`; a green replay job is not recorded as an
audit pass.

A fresh, authenticated GitHub Marketplace page load at
`2026-09-08T11:41:43Z` displayed `v1.0.17 Latest`, package version 1.0.17,
v1.0.17 Action examples, v1.0.17 schema URLs, and v1.0.17 version-bound
product-document links. The Marketplace pass is based on that live page, not
inferred from the tag or workflow result.

This evidence update is documentation and trusted-pin maintenance after
publication. The package and release refs above target the release source
commit; this later evidence commit does not move the immutable tag or stable
`v1`. Earlier published packages, immutable releases, and historical commits
remain unchanged.
