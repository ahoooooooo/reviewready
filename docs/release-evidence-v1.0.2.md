# ReviewReady v1.0.2 release recovery evidence

This file tracks the 2026-07-22 recovery release after npm v1.0.0 and v1.0.1
were fully unpublished to remove public personal email metadata. It is a live
checklist: unchecked items are not claims of completion.

## Scope and current public state

- The GitHub repository and Marketplace Action remain public.
- The npm package is temporarily unavailable during npm's unpublish cooldown.
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
      configured coverage thresholds were met.
- [x] `npm pack --dry-run --json --ignore-scripts` lists 28 approved files.
- [x] The planned v1.0.2 tarball contents pass the package privacy audit.
- [x] A clean temporary install can run policy validation and a ready fixture
      check without using the source tree.
- [x] `npm audit` reports no known vulnerabilities for the locked tree.

## Public verification (only after cooldown)

- [ ] Publish `@ahoooooo/reviewready@1.0.2` to the official npm registry.
- [ ] Verify package metadata and tarball contents from the public registry.
- [ ] Verify a clean install by exact version from the public registry.
- [ ] Create or update GitHub release tags only after registry verification.
- [ ] Record the final package integrity and public URLs here.
