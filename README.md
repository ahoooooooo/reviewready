# ReviewReady

[![CI](https://github.com/ahoooooooo/reviewready/actions/workflows/ci.yml/badge.svg)](https://github.com/ahoooooooo/reviewready/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40ahoooooo%2Freviewready.svg)](https://www.npmjs.com/package/@ahoooooo/reviewready)
[![npm downloads](https://img.shields.io/npm/dm/%40ahoooooo%2Freviewready.svg)](https://www.npmjs.com/package/@ahoooooo/reviewready)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

ReviewReady is a deterministic evidence gate for pull requests. A repository
declares what must be present before a particular kind of change consumes human
review time; ReviewReady reports what is verified and what is still missing.

It answers one narrow question:

> Does this pull request contain the evidence required to begin human review?

It does **not** review code, establish correctness, detect AI authorship, approve,
or merge. There are no model calls, hosted service, database, or execution of
pull-request code.

## Current status

The latest published CLI and Action are v1.0.7. Its exact audited tarball, npm
provenance, semantic-version tag target, GitHub Release target, and stable Action
ref have all been verified against one commit. The v1.0.6 trust-core and
live-ingress contracts are released, but a normal `pull_request` workflow is
still not a trusted enforcement root: it is loaded from the pull-request merge
ref and can be modified by the contribution it evaluates. Loading policy
contents from the base SHA does not by itself protect the caller workflow,
Action pin, or `policy-path`.

The `audit collect` and `audit replay` evidence-bundle commands described below
are on the current development branch. The published 1.0.7 package does not
contain these commands or the TA-2 bundle surface; they must not be treated as
available from npm until a separately authorized release updates the package,
dist, Action, schemas, and release evidence together.

The checked-in TA-2 promotion workflow runs only on the exact main revision,
fixes the repository, policy, and workflow roots in a trusted script, and
replays the bundle without a token. It keeps raw evidence in runner temporary
storage only; it is not live promotion evidence until a real run passes and is
independently reviewed.

Issue [#54](https://github.com/ahoooooooo/reviewready/issues/54) tracks live
repository governance. The current required check selects the GitHub Actions
App, which does not uniquely bind one workflow definition or event; the
dedicated-provider contract is tracked in
[#56](https://github.com/ahoooooooo/reviewready/issues/56).
[docs/governance-evidence-ta1.md](docs/governance-evidence-ta1.md) records the
current exact revisions, observed controls, unavailable settings, and remaining
advisory boundary.
[SECURITY.md](SECURITY.md) lists the other current evidence boundaries.
Semantic-version release tags will not be rewritten under project policy, but
GitHub release immutability was not enabled for the historical v1.0.7 release;
[#60](https://github.com/ahoooooooo/reviewready/issues/60) tracks protection for
future releases.

## Quick start

Install the CLI from npm. Node.js 22 or newer is required:

```console
npm install --global @ahoooooo/reviewready
reviewready validate --policy .reviewready.yml
```

The Action can also be used in an advisory workflow:

```yaml
- uses: ahoooooooo/reviewready@9cb239e3b81e00b0f82239eaf43843863ab51e2d # v1.0.6
```

Both advisory examples intentionally retain the audited v1.0.6 commit shipped
in the published v1.0.7 package README, because published npm package bytes
cannot be rewritten. The repository's checked-in trusted reference uses the
verified v1.0.7 release commit; #60 tracks reconciliation of every public
example in a future, separately authorized release.

The mutable `v1` tag is convenient, but an immutable verified commit is safer.
The advisory workflow below must not be configured as the repository's only
trusted merge authority unless its workflow and policy selection are protected by
an independent repository or organization rule.

Version 1 keeps the policy, result, and exit-code contracts stable. v1.0.4
restores the original v1 public requirement-key encoding after the historical
v1.0.3 regression, v1.0.5 adds bounded webhook, App, audit, and release
contracts, and v1.0.6 hardens the deterministic trust core. v1.0.7 synchronizes
the published documentation. Older release output is not rewritten.

## How it works

The target repository owns a `.reviewready.yml` policy on its base branch:

```yaml
# yaml-language-server: $schema=./reviewready.schema.json
version: 1
rules:
  - id: source-change
    when:
      paths:
        any: ["src/**"]
    require:
      - type: pr_body_section
        heading: Testing
      - type: linked_issue
      - type: check
        name: test
        app: github-actions
        conclusions: [success]
      - type: human_attestation
        text: I understand and take responsibility for this change.

  - id: workflow-change
    when:
      paths:
        any: [".github/workflows/**"]
    require:
      - type: pr_body_section
        heading: Risk
```

All matching rules apply. Equivalent requirements are checked once and attributed
to every rule that requested them.

On GitHub, the Action fetches policy bytes from the pull request's immutable base
SHA, then reads changed paths, completed checks, closing issue references, and
reviews through read-only APIs. Check Runs collected for an immutable head SHA
must echo that SHA; nullable queued or in-progress timestamps remain pending.
The policy content proposed by the pull request is not used. The workflow that
invokes the Action is a separate trust boundary and must also be protected for
authoritative enforcement.

### Editor schema

The npm package includes `reviewready.schema.json`. A repository that installs the
package as a development dependency can reference it directly:

```yaml
# yaml-language-server: $schema=./node_modules/@ahoooooo/reviewready/reviewready.schema.json
```

Action-only repositories can copy the schema into the repository or reference an
immutable release URL:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/ahoooooooo/reviewready/v1.0.7/reviewready.schema.json
```

Keep the schema version aligned with the Action or CLI version being used. A local
relative schema is preferable when editor access to remote URLs is restricted.

## GitHub Action

### Advisory integration

The following workflow is useful for evaluation. It runs tests on the pull-request
merge ref and evaluates metadata with least-privilege job permissions. Because a
`pull_request` workflow version comes from that merge ref, a pull request can also
propose changes to this workflow. Protect the workflow and policy selection
independently before relying on its result for enforcement.

```yaml
name: review-ready-advisory

on:
  pull_request:
    types: [opened, synchronize, edited, reopened, labeled, unlabeled, ready_for_review]

jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - run: npm ci
      - run: npm test

  reviewready:
    if: always()
    needs: [test]
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
      checks: read
      statuses: read
      issues: read
    steps:
      - uses: ahoooooooo/reviewready@9cb239e3b81e00b0f82239eaf43843863ab51e2d # v1.0.6
```

Replace the example test commands with the target repository's own verification.
When a policy requires another check, schedule ReviewReady after that job with
`needs`; otherwise the required check may still be pending and cannot count as
evidence. Specify the expected GitHub App in the policy where provider identity
matters.

### Authoritative enforcement

A trusted deployment needs an enforcement workflow that the evaluated pull request
cannot rewrite. Depending on repository ownership and available GitHub features,
that may involve:

- an organization ruleset that requires a selected workflow by source repository
  and immutable ref;
- repository rules that independently protect the ReviewReady workflow, policy,
  Action pin, and policy path;
- a metadata-only `pull_request_target` workflow from the trusted base branch with
  explicit read-only permissions and **no checkout, download, cache restore,
  build, import, or execution of pull-request code**;
- delegating approval freshness and required human review to GitHub branch rules
  when review events cannot be reconciled through a trusted workflow.

The checked-in reference is pinned in a protected change to an immutable
verified ReviewReady release commit. It is still not an authoritative merge
gate until the workflow and policy path are independently protected, its unique
job/check identity is required in GitHub rules, and branch freshness and review
reconciliation are verified in repository settings. The trusted workflow uses
pull_request_target, read-only permissions, and no checkout, download, cache
restore, build, import, or command execution.

The Action writes a job summary and exports:

- `status`: `ready` or `not_ready`;
- `report-json`: the versioned deterministic result.

Before publication, the Action bounds report-json to 1,000,000 UTF-8 bytes and
the Markdown summary to 1 MiB. Oversized or partially publishable results fail
closed; the status output is written last. The publication order is summary,
report-json, then status. Status is the commit marker: consumers must not treat
an earlier summary or report-json as valid readiness evidence when the status
output is absent.

The report-json output and CLI check --json use the same v1 shape:
outputVersion, status, policyVersion, triggeredRules, and requirements.
Requirement key values retain the v1 public format; internal deduplication uses
a separate structured identity so delimiter characters cannot merge unrelated
requirements. When no rule matches, v1 keeps status ready and an empty
requirement list, while text, Markdown, and explain output explicitly identify
that no policy rules were evaluated. Add a final paths.any: ["**"] rule when a
repository requires every ordinary changed path to enter a policy rule. A
future policy/output version may define an explicit unmatched strategy without
changing this v1 behavior.

It fails the job when evidence is missing or cannot be loaded safely. Configure
the job as a required status check if it should block merging.

## CLI

After installing `reviewready` globally, or as a development dependency and
invoking it with `npx`, run:

```console
reviewready validate --policy fixtures/basic/.reviewready.yml
reviewready explain --policy fixtures/basic/.reviewready.yml
reviewready check --policy fixtures/basic/.reviewready.yml --input fixtures/basic/ready.json
```

Readiness CLI exit codes:

- `0`: policy valid or contribution ready;
- `1`: contribution not ready;
- `2`: invalid configuration, input, event, or runtime failure.

The local CLI consumes normalized JSON rather than contacting GitHub. This keeps
the engine reproducible and makes policies easy to test with fixtures.
Policy and normalized-input files are read only when they are regular files and
are bounded at 4 MiB (4,194,304 raw bytes) before UTF-8 decoding. Missing,
unreadable, non-regular, oversized, or otherwise incomplete reads fail with
exit code 2. Policy text fields are limited to 500 Unicode code points; the
same visible-text and control/format-character contract is enforced by the
runtime parser and reviewready.schema.json.

### Repository audit

The separate audit command checks a bounded normalized repository snapshot. It
is read-only, deterministic, and fail-closed; it does not check out or execute
workflow source and it does not change the readiness JSON contract:

```console
reviewready audit --input fixtures/audit/reviewready.json
reviewready audit --input fixtures/audit/reviewready.json --json
reviewready audit --input fixtures/audit/reviewready.json --sarif
```

The checked-in `fixtures/audit/reviewready.json` is a synthetic, offline-only
normalized snapshot for deterministic dogfooding; it is not a live GitHub
capture or replayable evidence bundle. Audit exit codes are 0 for `pass`, 1 for
findings, and 2 for incomplete or invalid input. The audit report has its own contract, described by
[reviewready.audit.schema.json](reviewready.audit.schema.json); it is not the
readiness result. The readiness JSON contract is separately documented by
[reviewready.result.schema.json](reviewready.result.schema.json).

The CLI can also collect a live, read-only snapshot from GitHub:

```console
reviewready audit --github owner/repository --token-env GITHUB_TOKEN \
  --protected-workflow .github/workflows/reviewready-trusted.yml \
  --trusted-workflow .github/workflows/reviewready-trusted.yml --json
```

The token is read only from the named environment variable. Live collection
loads policy and workflow bytes at one immutable base SHA, uses bounded REST
pagination/retries/response size/deadline, and returns `incomplete` when
settings or the base revision are not authoritative. Protected and trusted
workflow roots are explicit out-of-band inputs; a check name or ordinary API
success never establishes a trust root. Each root option is bounded and must
name an observed workflow, but it remains a caller assertion rather than
independent GitHub authority. Workflow and policy source are bounded to 256 KiB.
The live adapter also enforces a 768-attempt total request budget and requires
the bounded transport for every structured and raw API read. It installs that
boundary from Octokit's configured fetch or the runtime global fetch, and fails
closed if neither is available. It collects inherited branch/tag/push/repository
rulesets. Repository targets require an explicit modeled repository scope;
unsupported conditions, enforcement states, ruleset exclusions, or
repository-id/property scopes fail closed; active
tag-only rulesets are reported as incomplete rather than as branch force-push
or deletion findings.
The optional `--ref` value is only a default-branch assertion: it must equal the
repository API's reported default branch. A non-default branch is rejected as
incomplete rather than silently audited under default-branch semantics. The
collector also binds its two repository reads to GitHub's immutable numeric
repository ID internally; that identity is not added to the public snapshot.
For an exact-revision, replayable audit, use the separate evidence modes:

```console
reviewready audit collect --github owner/repository --revision FULL_COMMIT_SHA \
  --token-env GITHUB_TOKEN \
  --protected-workflow .github/workflows/reviewready-trusted.yml \
  --trusted-workflow .github/workflows/reviewready-trusted.yml > audit.bundle.json
reviewready audit replay --bundle audit.bundle.json --json
```

`audit collect` requires the full default-branch commit SHA, reads the token only
from the named environment variable, and writes one canonical bundle to a raw
stdout sink without a trailing newline. It never writes a repository file,
contacts GitHub with the bundle, checks out code, or executes workflow source.
The bundle retains exact policy/workflow bytes, so review private or internal
repository bundles as sensitive artifacts. `audit replay` is offline, bounded
to an 8 MiB regular file, re-derives the report, and returns the same 0/1/2
status class without contacting GitHub. The evidence contract is described by
[reviewready.audit-evidence.schema.json](reviewready.audit-evidence.schema.json)
and is separate from both the audit report and readiness result.

The live adapter reads the `.github/workflows` directory with only the requested
immutable `ref`. It accepts one bounded Contents response, rejects any response
that advertises a `Link` header, and fails closed when the directory exceeds the
workflow bound; it does not fabricate pagination for that endpoint.

The legacy live command above remains report-only and is retained for
compatibility; it does not produce a replayable bundle. The collector
never checks out or executes repository code.

The GitHub App JWT/token and webhook HMAC/replay modules are library contracts
for an external service. ReviewReady does not include an HTTP server, secret
manager, durable database, or in-memory replay fallback.

## Policy reference

### Conditions

Each rule has paths, labels, or both. Each match set supports:

- `any`: at least one pattern or value must match;
- `all`: every pattern or value must match somewhere;
- `none`: no pattern or value may match.

Paths use repository-relative POSIX globs. Labels match case-insensitively.
Absolute paths, traversal, literal backslashes, empty path segments, and leading
glob negation are rejected. For renamed files, both the new path and the
previous path are evaluated; the Git separator is never rewritten.

### Requirements

- `pr_body_section`: a Markdown heading exists and has non-empty content.
- `linked_issue`: GitHub reports at least one closing issue reference.
- `check`: the latest logical Check Run (name plus App slug), or latest legacy
  commit status context, has the exact name and allowed conclusion. A newer
  failure or pending result cannot fall back to an older success.
- `maintainer_review`: the latest review state from enough unique users with write,
  maintain, or admin permission is approved. GitHub APPROVED,
  CHANGES_REQUESTED, and DISMISSED reviews require valid timestamps;
  COMMENTED may omit one. Timestamp-free local fixtures use their array order.
  Permission association retains at most 100 distinct actionable reviewers and
  performs at most 8 permission requests concurrently. It keeps the latest
  timestamped opinionated state per case-insensitive login and omits pending or
  commented reviews; unsupported or incomplete states fail closed.
- `human_attestation`: the PR body contains the exact checked task-list text. This
  verifies visible text only; it does not verify identity, understanding,
  authorship, or legal responsibility.

The full editor schema is [reviewready.schema.json](reviewready.schema.json). The
executable behavior is specified in [docs/product-spec.md](docs/product-spec.md).

ReviewReady v1 intentionally does not evaluate `merge_group`: GitHub's synthetic
merge commit does not carry a complete per-PR body, review, and closing-issue
context. Do not make the current check a merge-queue requirement without a
separate trustworthy aggregation design.

The ordinary pull_request caller workflow is an advisory integration unless the
repository separately protects the workflow root and required result. See
[the trusted workflow design](docs/adr/0001-trusted-workflow-root.md) for the
security boundary and the settings that must be verified in GitHub.

## Security model

- Policy bytes are fetched from the base SHA, never from the proposed head.
- The Action itself does not check out or execute pull-request code.
- A caller workflow is authoritative only when its definition, Action pin, inputs,
  and policy path are protected independently from the pull request.
- User-controlled text is escaped in Markdown summaries.
- Public error control characters are escaped before CLI or Action output.
- Public errors omit stack traces, tokens, API response bodies, and local paths.
- Invalid or unavailable authoritative input fails closed.
- Bounded GitHub pagination rejects malformed or non-contiguous next links
  instead of treating a truncated response as complete.
- Required GitHub evidence is read twice with a bounded fingerprint so a stable
  PR metadata snapshot cannot silently pair with changing checks or reviews;
  the snapshot is also verified after the second evidence read.
- The sample workflow is a normal pull_request integration and must not be
  treated as the sole authoritative merge gate until the trusted workflow root
  design is implemented and repository rules are verified.
- `pull_request` is fork-safe for running untrusted CI with a read-only token,
  but its workflow definition is not a trusted enforcement root.
- `pull_request_target` uses a trusted base workflow, but becomes dangerous if
  it checks out, downloads, imports, caches, or executes untrusted pull-request
  code.

See [SECURITY.md](SECURITY.md) and [docs/architecture.md](docs/architecture.md) for
the trust model and current known limitations.

## Development

```console
npm ci
npm run check
```

`npm run check` enforces formatting, strict linting, TypeScript types, coverage
thresholds, production build, generated dist parity, package privacy checks, and
the bundled JavaScript Action. See [CONTRIBUTING.md](CONTRIBUTING.md) for the
red/green/regression workflow.

## License

MIT. See [LICENSE](LICENSE).
