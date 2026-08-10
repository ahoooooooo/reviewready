# ReviewReady v1.0.3 release evidence

This file records the patch release containing evidence-boundary hardening that
landed after the v1.0.2 recovery release. It distinguishes Git tags from GitHub
Release objects because GitHub treats them as separate resources.

## Scope

- The release source is the public `main` branch after PR #6 and PR #7.
- v1.0.2 remains immutable; this patch release used the next unused version.
- The npm package and the GitHub Action were released from the same verified
  source revision.

## Local release-candidate verification

- [x] `npm run check` passed with the complete test, coverage, bundle, and
      package audit gates.
- [x] `npm pack --dry-run --json --ignore-scripts` listed only approved files.
- [x] The package privacy audit passed for the planned tarball.
- [x] `npm audit` reported no known vulnerabilities for the locked tree.

## Public verification

- [x] Published `@ahoooooo/reviewready@1.0.3` to the official npm registry.
- [x] Verified npm metadata, tarball contents, and a clean exact-version install.
- [x] Created immutable Git tag `v1.0.3` and moved the stable `v1` Action tag to
      the verified release commit.
- [x] Recorded the final release commit, package integrity, and public URLs.
- [ ] A GitHub Release object was not created at publication time and should be
      backfilled separately without changing the immutable tag.

## Post-release audit notes

A later source and platform-boundary audit found limitations that were not fully
covered by the release-candidate tests:

- GitHub's Check Runs endpoint can cap a ref at its 1,000 most recent suites, so
  requesting an empty page after 1,000 results does not prove completeness. Issue
  #4 was reopened.
- The collision-safe internal requirement key introduced in v1.0.3 also changed
  the public `report-json` key encoding without increasing `outputVersion`. This
  compatibility repair is tracked in issue #25.
- Additional visible-Markdown, rename-path, and legacy-status cases are tracked in
  issues #12, #13, and #14.

These findings do not change the historical package coordinates below. Existing
immutable tags must not be rewritten; corrections belong in a new patch release.

## Final public coordinates

- Release commit: `14147f5d2084999065145f657ca36ac743e6151f`
- Package: <https://www.npmjs.com/package/@ahoooooo/reviewready>
- Tarball: <https://registry.npmjs.org/@ahoooooo/reviewready/-/reviewready-1.0.3.tgz>
- Integrity: `sha512-DdNGVcObPX/BZDcvV7T1gUBMQDOCHx//iaWwS8fh2GIgscxZqU1oosL7+F1R1Bzj+OcHmd8vXiHk3I3u/mcHRQ==`
- Immutable Git tag: <https://github.com/ahoooooooo/reviewready/tree/v1.0.3>
- Stable Action tag: <https://github.com/ahoooooooo/reviewready/tree/v1>
- GitHub Release object: not published as of 2026-08-11
