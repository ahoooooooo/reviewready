# Security policy

## Supported versions

ReviewReady provides security fixes for the latest published v1.x release and for
the current `main` branch. Fixes are not backported to every earlier patch release;
users may be required to upgrade.

| Version            | Supported               |
| ------------------ | ----------------------- |
| Latest v1.x        | Yes                     |
| Earlier v1.x       | Upgrade may be required |
| Earlier than 1.0.0 | No                      |

The mutable `v1` Action tag is a convenience pointer, not an immutable security
boundary. High-assurance users should pin a verified release commit and use update
automation.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository's
private vulnerability reporting form. If private reporting is unavailable, contact
the repository owner through the maintainer contact shown on the GitHub profile.

Include the affected version, a minimal reproduction, impact, and any suggested
mitigation. Do not include real tokens, private repository content, or third-party
personal data.

## Threat model

The main assets are repository policy integrity, caller-workflow integrity, GitHub
tokens, private pull-request metadata, and the credibility of the readiness result.

ReviewReady assumes its released Action bundle is pinned by an adopter and that the
workflow invoking it, the Action pin, the selected policy path, and the target
repository's base revision are trusted. It treats event payloads, PR bodies,
labels, paths, reviewers, check names, local JSON fixtures, and API responses as
untrusted.

Security invariants intended by the design:

- policy bytes are fetched by immutable base SHA;
- the caller workflow, Action pin, inputs, and policy path are protected from the
  contribution being evaluated;
- no PR code, commands, expressions, modules, or configuration are executed by the
  metadata-only readiness evaluator;
- only read-only GitHub permissions are requested;
- path traversal and absolute paths are rejected;
- policy and input sizes are bounded;
- malformed or missing authoritative evidence fails closed;
- user-facing failures redact unexpected exception details;
- Markdown output escapes policy-derived text.

## Caller workflow root

Base-SHA policy loading protects policy **contents**, not the workflow that selects
the path and invokes the Action. GitHub loads ordinary `pull_request` and
`pull_request_review` workflow versions from the pull-request merge ref. A proposed
change can therefore attempt to replace the Action, change `policy-path`, or emit a
same-name successful job unless an independent rule protects the enforcement
workflow.

Do not use the v1.0.3 advisory `pull_request` example as the sole authoritative
merge gate. Issue #35 tracks supported trusted topologies, including organization
ruleset workflows, independently protected enforcement files, and carefully
limited metadata-only `pull_request_target` evaluation. A
`pull_request_target` workflow must never check out, download, import, cache, build,
or execute pull-request code.

## Known limitations

- A mutable major Action tag is convenient but weaker than a full commit SHA.
  High-assurance adopters should pin the release commit and use update automation.
- The current published guidance does not yet provide a complete trusted caller
  workflow for all personal and organization repository configurations. This is a
  release blocker tracked in issue #35.
- A successful named check proves only that GitHub recorded that conclusion; it
  does not prove the check itself is trustworthy. Restrict app identity where it
  matters and protect workflow changes separately.
- `linked_issue` currently uses GitHub closing issue references, not every possible
  textual or sidebar relationship.
- Repository permissions are evaluated at Action run time. Organization role
  changes can therefore change later evaluations.
- `maintainer_review` does not bind an approval to the current head commit.
  Repositories that require fresh review after every push should enable GitHub's
  stale-approval dismissal or an equivalent branch-protection rule.
- Comment-only reviews currently can replace the latest opinionated review state;
  this is tracked in issue #32.
- A non-collaborator review can currently make the permission lookup fail instead
  of counting as a non-maintainer; this is tracked in issue #33.
- GitHub caps pull-request file responses at 3,000 files and the Check Runs endpoint
  at the 1,000 most recent check suites for a ref. Completeness at the exact Check
  Runs boundary cannot currently be proven by requesting another page; this is
  tracked in issue #4.
- Multiple historical Check Runs with the same name and app can be returned for one
  head SHA, while the current evaluator accepts any matching success. Latest-result
  reduction is tracked in issue #34.
- Legacy commit statuses are not yet explicitly paginated, so repositories with
  many status contexts can receive incomplete evidence. This is tracked in issue
  #14.
- The current PR-body parser does not yet model every invisible Markdown region or
  nested section boundary. HTML comments and related cases are tracked in issue
  #12.
- Renamed files currently contribute only their new path to matching. Policies that
  must protect the old path of a rename should track issue #13 before relying on
  this behavior as a security boundary.
- `merge_group` is not supported by the v1 Action. Its synthetic commit does not
  carry a complete per-PR body, review, and issue context, so enabling it without
  an explicit aggregator would weaken the readiness guarantee.
- Readiness is evidence presence, never correctness, safety, or approval.
