# ReviewReady v1 release evidence

This file records the local release-candidate verification performed on
2026-07-22. It does not claim that a GitHub repository, npm package, tag, or
GitHub Release has been published.

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

The npm registry returned 404 for the unscoped name reviewready at verification
time, meaning no public package was found. This is not a reservation and must be
checked again immediately before publication.

npm pack --dry-run produced reviewready-1.0.0.tgz with:

- 28 package entries;
- packed size 14,593 bytes;
- unpacked size 51,371 bytes;
- CLI JavaScript and declarations;
- README, MIT license, and the v1 policy JSON Schema.

An actual tarball was then installed into an isolated Windows temp directory.
The installed node_modules/.bin/reviewready.cmd shim successfully validated the
basic policy fixture. The clean install added 31 runtime packages.

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
metadata in action.yml. A live GitHub-hosted run remains an external publication
step because this workspace has no Git repository or remote.

## Dependency and security evidence

npm audit reported zero known vulnerabilities for the locked dependency tree at
verification time. Security regressions cover unsafe paths, invalid YAML and JSON,
oversized policies, raw HTML escaping, base-policy authority, incomplete checks,
and untrusted exception redaction.

Known limitations and the threat model are documented in SECURITY.md and
docs/architecture.md.

## External publication checklist

These steps require the owner's explicit account choices and authorization:

- confirm the final project and GitHub repository name;
- initialize Git and review the complete first commit;
- create the public repository and push;
- observe CI on GitHub-hosted runners;
- recheck npm name availability;
- publish reviewready@1.0.0 with the owner's npm credentials;
- create immutable v1.0.0 and moving v1 Action tags;
- create a GitHub Release and enable private vulnerability reporting.
