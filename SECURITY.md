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
- a current pull-request snapshot must remain stable while evidence is
  collected;
- a newer failed or pending check/status cannot be masked by an older success;
- user-facing failures redact unexpected exception details;
- Markdown output escapes policy-derived text.

## Caller workflow root

Base-SHA policy loading protects policy **contents**, not the workflow that selects
the path and invokes the Action. GitHub loads ordinary `pull_request` and
`pull_request_review` workflow versions from the pull-request merge ref. A proposed
change can therefore attempt to replace the Action, change `policy-path`, or emit a
same-name successful job unless an independent rule protects the enforcement
workflow.

Do not use the v1.0.5 advisory `pull_request` example as the sole authoritative
merge gate. Issue #35 tracks supported trusted topologies, including organization
ruleset workflows, independently protected enforcement files, and carefully
limited metadata-only `pull_request_target` evaluation. A
`pull_request_target` workflow must never check out, download, import, cache, build,
or execute pull-request code.

## Known limitations

- A mutable major Action tag is convenient but weaker than a full commit SHA.
  High-assurance adopters should pin the release commit and use update automation.
- The checked-in trusted workflow is a staged v1.0.6 reference and is not an
  authority until its Action pin is updated to the verified v1.0.6 commit and the
  repository settings protect both the workflow root and its required check. The
  remaining deployment limitation is tracked in issue #35.
- A successful named check proves only that GitHub recorded that conclusion; it
  does not prove the check itself is trustworthy. Restrict app identity where it
  matters and protect workflow changes separately. The ordinary `pull_request`
  sample workflow is advisory until a trusted workflow root is protected and
  required in repository settings.
- `linked_issue` currently uses GitHub closing issue references, not every possible
  textual or sidebar relationship.
- Repository permissions are evaluated at Action run time. Organization role
  changes can therefore change later evaluations.
- `maintainer_review` does not bind an approval to the current head commit.
  Repositories that require fresh review after every push should enable GitHub's
  stale-approval dismissal or an equivalent branch-protection rule.
- GitHub caps pull-request file responses at 3,000 files and the Check Runs endpoint
  at the 1,000 most recent check suites for a ref. ReviewReady bounds pagination
  and fails closed when the safe completeness boundary or response shape cannot
  be proven.
- Latest Check Runs and legacy commit statuses are reduced conservatively. A
  newer failure or pending result cannot fall back to an older success, and
  same-name cross-provider ambiguity is not treated as passing evidence.
- The Markdown parser intentionally implements a bounded evidence subset rather
  than all of CommonMark. Fences, headings, task lists, HTML comments, and
  invisible evidence are handled conservatively; unsupported or ambiguous input
  fails closed.
- Renamed files contribute both the new and previous repository-relative paths.
  A malformed rename or unsafe path is rejected rather than normalized.
- `merge_group` is not supported by the v1 Action. Its synthetic commit does not
  carry a complete per-PR body, review, and issue context, so enabling it without
  an explicit aggregator would weaken the readiness guarantee.
- Readiness is evidence presence, never correctness, safety, or approval.
- The v1 human_attestation requirement verifies only visible checked text in the
  selected body snapshot. It does not verify who edited or checked the body,
  human comprehension, authorship, legal responsibility, or freshness after a
  later edit; use a separately authenticated future mechanism for those claims.

The repository audit is read-only and separate from readiness. Its normalized
snapshot, finding count, workflow source, paths, and provider identities are
bounded; rulesets are evaluated only when their target/ref scope covers the
evaluated default branch and repository; malformed, missing, contradictory,
stale, redacted, or over-limit settings are reported as incomplete or failed.
The live collector reads policy and workflow source at one immutable base SHA,
rechecks the branch revision, and requires explicit protected/trusted workflow
roots supplied out of band. Audit output is not an approval and does not claim
that repository code is safe.

The static AI-workflow analyzer treats workflow source as data. It never runs a
workflow, evaluates expressions, invokes an LLM, resolves secrets, or executes
a shell command. Prompt injection, code execution, capability exposure, and
provenance findings remain distinct. SARIF is an additional report format, not
a replacement for the stable readiness JSON contract.

Webhook HMAC verification is only a pure ingress primitive: callers must pass
the exact raw request bytes, configure the expected hook ID, provide a verifier
clock, use an external durable store that atomically claims both delivery and
body-replay namespaces, retain finite-window tombstones, and bind delivery,
repository/installation/PR identity, base/head SHA, policy revision, and
trusted workflow identity. The App JWT/token helpers validate bounded
credentials and explicit read-only installation/repository policy, but no
hosting service, secret manager, durable store, or deployment is included.
