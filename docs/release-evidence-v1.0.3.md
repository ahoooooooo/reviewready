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

- [ ] Publish `@ahoooooo/reviewready@1.0.3` to the official npm registry.
- [ ] Verify npm metadata, tarball contents, and a clean exact-version install.
- [ ] Create immutable `v1.0.3` and move the stable `v1` Action tag to the
      verified GitHub release commit.
- [ ] Record the final release commit, package integrity, and public URLs below.

## Final public coordinates

- Release commit: to be recorded after publication.
- Package: <https://www.npmjs.com/package/@ahoooooo/reviewready>
- Tarball: to be recorded after publication.
