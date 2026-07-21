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

## Quick start

Use the Action in a GitHub workflow:

```yaml
- uses: ahooooooo/reviewready@v1
```

Or install the CLI from npm (Node.js 24 or newer):

```console
npm install --global @ahoooooo/reviewready
reviewready validate --policy .reviewready.yml
```

Version 1 has a stable policy contract, JSON result format, and CLI exit codes.

## How it works

The target repository owns a .reviewready.yml policy on its base branch:

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
      - type: maintainer_review
        minimum: 1
```

All matching rules apply. Equivalent requirements are checked once and attributed
to every rule that requested them.

On GitHub, the Action fetches the policy at the pull request's immutable base SHA,
then reads changed paths, completed checks, closing issue references, and reviews
through read-only APIs. It never trusts a policy modified by the pull request.

## GitHub Action

Pin the stable major tag in a workflow:

```yaml
name: review-ready

on:
  pull_request:
    types: [opened, synchronize, edited, reopened, labeled, unlabeled]
  pull_request_review:
    types: [submitted, dismissed]

permissions:
  contents: read
  pull-requests: read
  checks: read
  issues: read

jobs:
  test:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - run: npm ci
      - run: npm test

  reviewready:
    if: always()
    needs: [test]
    runs-on: ubuntu-latest
    steps:
      - uses: ahooooooo/reviewready@v1
```

When a policy requires another check, schedule ReviewReady after that job with
needs; otherwise the required check may still be pending and therefore cannot
count as evidence. A review-event run uses the completed checks already attached
to the current head SHA.

The Action writes a job summary and exports:

- status: ready or not_ready;
- report-json: the versioned deterministic result.

It fails the job when evidence is missing. Configure the job as a required status
check if it should block merging.

## CLI

Node.js 24 or newer is required. After installing `reviewready` globally, or as
a development dependency and invoking it with `npx`, run:

```console
reviewready validate --policy fixtures/basic/.reviewready.yml
reviewready explain --policy fixtures/basic/.reviewready.yml
reviewready check --policy fixtures/basic/.reviewready.yml --input fixtures/basic/ready.json
```

Stable exit codes:

- 0: policy valid or contribution ready;
- 1: contribution not ready;
- 2: invalid configuration, input, event, or runtime failure.

The local CLI consumes normalized JSON rather than contacting GitHub. This keeps
the engine reproducible and makes policies easy to test with fixtures.

## Policy reference

### Conditions

Each rule has paths, labels, or both. Each match set supports:

- any: at least one pattern or value must match;
- all: every pattern or value must match somewhere;
- none: no pattern or value may match.

Paths use repository-relative POSIX globs. Labels match case-insensitively.
Absolute paths, traversal, backslashes, empty path segments, and leading glob
negation are rejected.

### Requirements

- pr_body_section: a Markdown heading exists and has non-empty content.
- linked_issue: GitHub reports at least one closing issue reference.
- check: a completed check has the exact name, allowed conclusion, and optional
  GitHub App slug.
- maintainer_review: the latest review state from enough unique users with write,
  maintain, or admin permission is approved.
- human_attestation: the PR body contains the exact checked task-list text.

The full editor schema is [reviewready.schema.json](reviewready.schema.json).
The executable behavior is specified in
[docs/product-spec.md](docs/product-spec.md).

## Security model

- The effective policy comes from the base SHA, never the proposed head.
- The Action uses GitHub APIs and does not check out or execute PR code.
- User-controlled text is escaped in Markdown summaries.
- Public errors omit stack traces, tokens, API response bodies, and local paths.
- Invalid or unavailable authoritative input fails closed.
- The recommended workflow uses pull_request, not privileged pull_request_target.

See [SECURITY.md](SECURITY.md) and [docs/architecture.md](docs/architecture.md)
for the trust boundary and known limitations.

## Development

```console
npm ci
npm run check
```

npm run check enforces formatting, strict linting, TypeScript types, coverage
thresholds, production build, and the bundled JavaScript Action. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the red/green/regression workflow.

## License

MIT. See [LICENSE](LICENSE).
