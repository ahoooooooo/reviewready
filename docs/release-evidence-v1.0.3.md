# ReviewReady v1.0.3 release evidence

This file records the patch release containing the hardened evidence boundary
that landed after the v1.0.2 recovery release. Unchecked items are not claims
of completion.

## Scope

- The release source is the public `main` branch after PR #6 and PR #7.
- v1.0.2 remains immutable; this patch release uses the next unused version.
- The npm package and the GitHub Action are released from the same verified
  source revision.

## Local release-candidate verification

- [x] `npm run check` passes with the complete test, coverage, bundle, and
      package audit gates.
- [x] `npm pack --dry-run --json --ignore-scripts` lists only approved files.
- [x] The package privacy audit passes for the planned tarball.
- [x] `npm audit` reports no known vulnerabilities for the locked tree.

## Public verification

- [x] Publish `@ahoooooo/reviewready@1.0.3` to the official npm registry.
- [x] Verify npm metadata, tarball contents, and a clean exact-version install.
- [x] Create immutable `v1.0.3` and move the stable `v1` Action tag to the
      verified GitHub release commit.
- [x] Record the final release commit, package integrity, and public URLs below.

## Final public coordinates

- Release commit: `14147f5d2084999065145f657ca36ac743e6151f`
- Package: <https://www.npmjs.com/package/@ahoooooo/reviewready>
- Tarball: <https://registry.npmjs.org/@ahoooooo/reviewready/-/reviewready-1.0.3.tgz>
- Integrity: `sha512-DdNGVcObPX/BZDcvV7T1gUBMQDOCHx//iaWwS8fh2GIgscxZqU1oosL7+F1R1Bzj+OcHmd8vXiHk3I3u/mcHRQ==`
- GitHub release tag: <https://github.com/ahoooooooo/reviewready/releases/tag/v1.0.3>
- Stable Action tag: <https://github.com/ahoooooooo/reviewready/tree/v1>
