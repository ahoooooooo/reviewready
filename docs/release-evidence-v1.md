# ReviewReady v1 release evidence

This file records the local and public release verification performed on
2026-07-22 for ReviewReady v1.0.0.

## Complete local gate

Command:

```console
npm run check
```

Observed result:

- formatting passed;
- strict ESLint passed;
- TypeScript type checking passed;
- 8 test files and 55 tests passed;
- statements 96.02 percent;
- branches 90.87 percent;
- functions 94.11 percent;
- lines 96.10 percent;
- TypeScript production build passed;
- Node 24 Action bundle completed at approximately 920 KB.

## Package verification

The npm registry returned 404 for the unscoped name reviewready, but publication
was rejected because npm considered it too similar to the existing `review-ready`
package. The owner approved `@ahoooooo/reviewready`; the scoped coordinate returned
404 at verification time and must be checked again immediately before publication.

npm pack --dry-run produced ahoooooo-reviewready-1.0.0.tgz with:

- 28 package entries;
- packed size 14,833 bytes;
- unpacked size 52,307 bytes;
- CLI JavaScript and declarations;
- README, MIT license, and the v1 policy JSON Schema.

An actual tarball was then installed into an isolated Windows temp directory.
The installed node_modules/.bin/reviewready.cmd shim successfully validated the
basic policy fixture. The clean install added 31 runtime packages.

After publication, a fresh unaffiliated cache resolved the public registry
tarball with SHA-1 `c388546602ae9b789ad43423b875cbe02d7d8a2f`. A clean registry
install again added 31 runtime packages, and its `reviewready.cmd` shim validated
the basic policy fixture successfully.

## CLI smoke tests

Using Node.js v24.18.0:

- validate returned exit 0 and Policy is valid (version 1);
- the ready fixture returned exit 0 and listed every verified obligation;
- the not-ready fixture returned the contractually required exit 1.

## Action and GitHub adapter evidence

Automated tests cover:

- pull_request and pull_request_review events;
- policy retrieval from the immutable base SHA, never the proposed head;
- changed-file, check-run, review, permission, and closing-issue mapping;
- check-run pagination through the documented 1,000-run boundary;
- only write, maintain, and admin reviewers counting as maintainers;
- redacted API and unexpected errors;
- ready and not-ready Action outputs and job summaries.

The production entry point bundles into dist/action/index.js with Node 24 action
metadata in action.yml. GitHub-hosted CI passed against commit 8390cd7 after the
public repository was created and main was pushed.

## Dependency and security evidence

npm audit reported zero known vulnerabilities for the locked dependency tree at
verification time. Security regressions cover unsafe paths, invalid YAML and JSON,
oversized policies, raw HTML escaping, base-policy authority, incomplete checks,
and untrusted exception redaction.

Known limitations and the threat model are documented in SECURITY.md and
docs/architecture.md.

## External publication checklist

- [x] confirm the final project and GitHub repository name;
- [x] initialize Git and review the complete first commit;
- [x] create the public repository and push;
- [x] observe CI on GitHub-hosted runners;
- [x] recheck npm name availability;
- [x] publish @ahoooooo/reviewready@1.0.0 with the owner's npm credentials;
- [x] create immutable v1.0.0 and moving v1 Action tags;
- [x] create a GitHub Release and enable private vulnerability reporting.

Public coordinates:

- GitHub: https://github.com/ahoooooooo/reviewready
- npm: https://www.npmjs.com/package/@ahoooooo/reviewready
- Release: https://github.com/ahoooooooo/reviewready/releases/tag/v1.0.0
