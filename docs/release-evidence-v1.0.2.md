# ReviewReady v1.0.2 release recovery evidence

This file tracks the 2026-07-22 recovery release after npm v1.0.0 and v1.0.1
were fully unpublished to remove public personal email metadata. It is a live
checklist: unchecked items are not claims of completion.

## Scope and current public state

- The GitHub repository and Marketplace Action remain public.
- `@ahoooooo/reviewready@1.0.2` is public and the npm `latest` tag points to
  `1.0.2`.
- v1.0.2 is the next permitted npm version; removed versions will not be reused.
- A third-party npmmirror cache purge is tracked separately at
  <https://github.com/cnpm/cnpmcore/issues/1115>.

## Preventive release controls

- [x] Inspect the exact file list produced by `npm pack --dry-run --json`.
- [x] Allow only the documented runtime, schema, README, and license files.
- [x] Reject email addresses and Windows, Linux, or macOS user-directory paths.
- [x] Reject private-key headers and common GitHub, npm, OpenAI, Anthropic, and
      AWS credential formats.
- [x] Reject package manifest author, contributor, and maintainer identity fields.
- [x] Pin public publication to `https://registry.npmjs.org`.
- [x] Run the privacy audit in both `npm run check` and `prepublishOnly`.

## Local release-candidate verification

- [x] `npm run check` passes from the v1.0.2 source tree: 79 tests passed and all
      configured coverage thresholds were met (reverified 2026-08-10 after the
      lockfile security update).
- [x] `npm pack --dry-run --json --ignore-scripts` lists 28 approved files.
- [x] The planned v1.0.2 tarball contents pass the package privacy audit.
- [x] A clean temporary install can run policy validation and a ready fixture
      check without using the source tree.
- [x] `npm audit` reports no known vulnerabilities for the locked tree
      (reverified 2026-08-10).

## Public verification

- [x] Publish `@ahoooooo/reviewready@1.0.2` to the official npm registry.
- [x] Verify package metadata and tarball contents from the public registry.
- [x] Verify a clean install by exact version from the public registry; policy
      validation and the ready fixture check passed without the source tree.
- [x] Create or update GitHub release tags only after registry verification; both
      `v1.0.2` and `v1` point to commit `95bb3cc`.
- [x] Record the final package integrity and public URLs here: - Package: <https://www.npmjs.com/package/@ahoooooo/reviewready> - Tarball: <https://registry.npmjs.org/@ahoooooo/reviewready/-/reviewready-1.0.2.tgz> - Integrity: `sha512-C+yelTnjf9FkH9gv3YlFsDL9uj3J4t6/5fXOvovBX+efW/voLYVDqf9VdHNr99WukhmcM1YPqhcFMGuJeYlXiw==` - SHA-1: `d8b6633551f930339585ada67808234cfc89e8a9`
