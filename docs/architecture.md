# Architecture and trust boundaries

## Modules

1. `policy`: parses YAML and validates a closed, versioned schema.
2. `domain`: policy, pull-request, evidence, and result types.
3. `matcher`: selects every rule triggered by normalized PR data.
4. `engine`: evaluates requirements without I/O or platform knowledge.
5. `report`: renders versioned JSON, terminal text, and Markdown.
6. `github`: fetches base policy and normalizes GitHub event/API data.
   `github-api` is the isolated Octokit transport implementation;
   `github-api-boundaries` owns retry/header/error limits and
   `github-api-pagination` owns fail-closed Link traversal.
7. `cli` and `action`: thin entry points that translate errors to public outputs.
8. `audit`: pure, normalized repository-posture audit; it is separate from
   readiness and never contacts GitHub or executes workflow source.
9. `github-audit` and `github-audit-api`: a bounded live GitHub snapshot
   collector and its read-only Octokit transport. They bind policy/workflow
   bytes to one immutable base SHA but never infer a trusted workflow root.
10. `workflow-security`: bounded static source/prompt/sink analysis for audit
    findings only; it does not evaluate YAML expressions or invoke an LLM.
11. `trust`, `webhook`, and `github-app`: pure HMAC/replay/binding and App
    authentication primitives; they contain no HTTP server or persistence
    implementation.
12. `http-contract` and `observability`: framework-neutral raw-byte transport
    and bounded redacted event contracts; they contain no sockets, secrets,
    durable store, or deployment provider.
13. `ta3-ingress`: provider-neutral trusted-ingress state transitions,
    allowlisted webhook composition, replay aliases, leases, generation
    fencing, outbox, and provider-reconciliation contracts. Its in-memory
    store is a deterministic reference for tests, not production durability.

Dependencies point inward: entry points -> adapters/report -> engine -> domain.
The engine must never import GitHub, filesystem, process, or Actions modules.
The audit engine may consume only its versioned normalized snapshot contract;
the readiness engine and its public JSON schema remain unchanged. That audit
contract rejects non-positive App IDs and simultaneous App ID/App slug
provenance; invalid or contradictory provider identity is incomplete.

## Trust model

Trusted inputs and execution components:

- a verified Action bundle pinned by the adopter;
- the workflow definition that invokes the Action;
- the Action pin, `policy-path`, job graph, event selection, and permissions defined
  by that workflow;
- policy bytes fetched for the event's base SHA as the repository's authoritative
  policy, while their syntax and resource bounds remain validated;
- repository owner/name and API endpoint derived from the event environment.

Untrusted inputs:

- the entire event payload;
- changed paths, titles, bodies, labels, reviewers, and check names;
- API responses and local fixture files;
- pull-request code and workflow changes proposed by the pull request.

The system validates boundaries, never executes evidence input, and should render
untrusted strings as data. `ready` is informational unless the adopter separately
establishes a trusted enforcement root and configures the result as required.

## Workflow bootstrap boundary

Fetching policy bytes from the base SHA prevents a pull request from replacing the
policy **contents** used by the evaluator. It does not protect the workflow that
selects the policy path and invokes the Action.

GitHub loads ordinary `pull_request` and `pull_request_review` workflow versions
from the pull-request merge ref. A contribution can therefore propose changes to
the Action pin, input path, permissions, job dependencies, or even the job that
reports a required check. Required status checks match job/check names and may pin
the GitHub App, but that does not identify an immutable workflow definition.

ADR 0001 defines the supported trust boundary. Issue #54 tracks live repository
governance and issue #56 tracks the dedicated provider/App contract. Candidate
roots include an organization ruleset-required workflow selected by
repository/ref/SHA, independently protected workflow and policy files, or a
metadata-only `pull_request_target` workflow from the base branch. A trusted
`pull_request_target` design must not check out, download, import, cache, build, or
execute pull-request code. Untrusted build and test CI remains on `pull_request`
with fork-safe permissions.

Review-submitted events require a separate design decision because
`pull_request_review` also uses the pull-request merge ref, while
`pull_request_target` has no review-submitted activity type. Approval freshness
remains a GitHub branch-rule responsibility until another authenticated, trusted
reconciliation path is deployed. A review-event workflow loaded from an
untrusted pull-request revision must never be a required readiness check.

The checked-in trusted workflow also separates CI completion from readiness
evaluation. It cancels superseded runs for the same pull request, then performs
a bounded read-only wait for the latest `check` Check Run on the exact head SHA
from the expected GitHub Actions provider before invoking the pinned Action. A
missing, oversized, incomplete, or still-pending check response fails closed;
the workflow does not checkout, execute, or interpret pull-request source while
waiting. This ordering prevents a race-affected readiness result from becoming
the required status check and normally removes the need for a manual readiness
rerun; if the bounded wait is exhausted, the workflow fails closed instead of
accepting stale evidence.

## Evidence collection

The Action source supports `pull_request`, `pull_request_review`, and
`pull_request_target` events. The checked-in trusted reference uses
`pull_request_target` and is pinned to the published v1.0.11 release commit. That
protects the selected base workflow from the evaluated PR, but the current
GitHub Actions App requirement does not uniquely identify that workflow.
Review events may be submitted, edited, or dismissed. For GitHub review data,
`APPROVED`, `CHANGES_REQUESTED`, and `DISMISSED` states require a valid
`submittedAt`; `COMMENTED` may omit it. Missing or malformed timestamps on
those actionable states fail closed. Timestamp-free local fixtures retain their
array order and do not make a claim about GitHub ordering. A workflow that
requires other checks must schedule ReviewReady after those jobs; incomplete
checks do not count as evidence.

The GitHub adapter combines completed check runs with terminal commit statuses,
reducing each Check Run identity by name and App slug and each legacy status
context independently. For a name present across providers, it suppresses all
provider-specific records and emits only one conservative aggregate, so a
newer failure or pending result cannot be bypassed by an older provider success.
It fails closed when GitHub pagination reports evidence beyond the safe v1
limits, or when a Link header is malformed, non-string, duplicated under
case-insensitive header names, contains a non-contiguous next page, or claims
a different last page than the current response, instead of evaluating a
silently truncated list. Malformed retry/rate-limit headers do not trigger an
implicit retry; valid header names are matched case-insensitively.
`merge_group` is
intentionally unsupported because its payload does not contain enough
per-pull-request evidence to evaluate the v1 policy safely.

## Compatibility boundary

`outputVersion` identifies the public JSON result contract used by CLI `--json`
and the Action's `report-json` output. Internal map keys, parser
representations, or adapter implementation details must not change public fields
without an explicit compatibility decision. v1.0.4 restores the original v1
requirement-key encoding after the historical v1.0.3 drift; older release output
is not rewritten.

The adapter first loads the base policy and changed paths, then requests only
the evidence types required by the triggered rules. Reviewer permission lookups
use a maximum of 100 distinct actionable reviewer identities and 8 concurrent
requests. Identity keys are case-insensitive; the latest valid timestamped
opinionated review is retained for each login, while pending and commented
reviews do not trigger permission lookups. Missing or malformed timestamps on
actionable GitHub review states fail closed. Check Runs collected for an immutable commit ref
must echo that ref; GitHub's nullable timestamps for queued or in-progress runs
remain pending rather than becoming successful evidence. A current pull-request
snapshot is read before collection, between the two evidence reads, and after
the second read. Required evidence is read twice with a canonical fingerprint.
A changed pull-request identity, base/head SHA, freshness marker, body, label
set, or evidence fingerprint causes one bounded retry and then a stable
fail-closed error.

Changed Git paths use POSIX separators. A rename retains both the new filename
and previous filename for policy matching; a literal backslash is rejected
instead of being rewritten.

The CLI reads policy and normalized-input files as regular, non-symlink files
with a hard 4 MiB raw-byte limit before decoding. Policy text has a shared
500-Unicode-code-point visible-text contract in the runtime parser and the
published Draft 2020-12 schema.

Policy matching compiles each unique glob once per evaluation, deduplicates
paths and patterns, and shares a deterministic operation budget across all
rules. Exceeding that budget is a stable policy error rather than a partial
ready result.

The repository audit is deliberately a different trust product. Its offline
input binds the repository base SHA, policy path/revision, protected branch and
ruleset target/ref scope, required-check provenance, every workflow root that
could emit a required check, and bounded workflow source. Missing or
contradictory settings are `incomplete`, never `pass`.
Audit findings have their own `auditVersion` and optional SARIF rendering; they
must not be interpreted as a readiness result or as proof that code is correct.
Finding locations use bounded structural indices for untrusted collection
members; required-check names are never interpolated into public paths or SARIF
URIs.

The live collector reads repository metadata, branch protection, inherited
rulesets, tag protection, workflow listings, policy bytes, and workflow source
at the evaluated base SHA. It performs a bounded second repository/branch read;
any base revision change is incomplete. The two repository reads must also
retain the same GitHub immutable numeric repository ID. The optional live
`--ref` input can only assert the API-reported default branch; a non-default
branch is rejected rather than being presented as a default-branch audit. API
response bytes, pages, retries, concurrency, request count, and total deadline
are bounded, including a 768-attempt total request budget and a raw response
stream cap before JSON parsing. Every structured and raw read requires the
bounded transport, including its per-request fetch binding; the adapter uses
Octokit's configured fetch or the runtime global fetch and treats both missing
as incomplete rather than falling back unbounded. A missing or redacted bypass
list is unknown. Inherited branch/tag/push/repository rulesets are collected.
Branch-protection responses with unmodeled security semantics or contradictory
structured/legacy required-check fields fail closed rather than being silently
reduced.
Repository targets require an explicit modeled repository scope and canonical
enforcement. Repository-target ref/unknown conditions, nested unknown fields,
ruleset ref/repository exclusions and repository-id/property scopes that are not
represented by the normalized contract fail closed as incomplete. Active
tag-only rulesets are reported as unsupported by the branch audit rather than
being rendered as branch controls. Workflow protection and trusted-root facts are
explicit caller-supplied roots, not conclusions derived from API visibility.
Each supplied root is bounded and must be present in the observed workflow
listing, but the caller assertion is not independent provider authority.
Workflow and policy source are bounded to 256 KiB. The legacy live audit CLI
emits only an audit report for compatibility; the separate audit collect mode
emits a canonical evidence bundle and audit replay reconstructs its report
offline.

[ADR 0009](adr/0009-replayable-audit-evidence-bundle.md) and the
[normative audit-evidence-bundle v1 contract](audit-evidence-bundle-v1.md)
now have an executable schema, bounded exact-revision collector, canonical
projection/hydration, and offline replay implementation. The evidence
collector requires an explicit full default-branch SHA, reads policy/workflow
bytes at that immutable ref, and surrounds those reads with two complete
normalized observations of mutable settings plus a final repository identity
observation. Equal settings observations establish bounded stability, not a
GitHub transaction; a possible change-and-revert remains an explicit residual.
The bundle uses strict I-JSON, RFC 8785 canonical JSON, domain-separated
SHA-256 integrity digests, exact base64url source bytes, and report
reconstruction during offline replay. Caller workflow-root paths remain
assertions and cannot set authoritative provenance. The evidence-bundle,
audit-report, and readiness-result schemas remain separate.
Push rulesets are valid repository controls without a branch ref scope; they are
retained in the normalized audit snapshot but cannot satisfy branch checks or
produce branch force-push/deletion findings. Tag-only rulesets are not converted
into branch findings; an active tag ruleset remains an explicit incomplete
finding until tag-ruleset semantics are covered by the audit contract.

The trusted TA-2 promotion workflow keeps collection output in runner temporary
storage while the token is present, then persists exactly the bounded bundle,
replay report, and manifest as a 30-day, run-scoped Actions artifact. A separate
read-only job downloads that artifact and performs another offline replay with a
credential-free environment. This is durable workflow evidence, not a signature
or independent provider authority; artifact access, retention, and deletion are
still GitHub-hosted controls and must not be confused with TA-3 storage.

Webhook verification is limited to exact raw-body HMAC-SHA256 validation,
configured hook identity, a bounded verifier clock, an atomic replay namespace
supplied by an external durable store, and SHA/policy/workflow binding. Delivery
headers are not treated as signed payload identity; the store must claim both
the delivery key and body replay key and retain the tombstone through the
declared finite replay window. No PR workflow, expression, command, or model
output is executed by these primitives. The separate observability contract
accepts only UUID-form delivery/correlation identities and a bounded known
webhook action; it never carries body, prompt, workflow, secret, or token data.

TA-3 adds a separate provider-authority design in
[ADR 0011](adr/0011-github-app-trusted-ingress.md). A dedicated GitHub App,
installation/repository allowlist, required-check App ID, durable two-key
inbox, generation-fenced result store, and provider reconciliation are
required before any live result can be called authoritative. The design is
accepted, but no production ingress or durable deployment exists yet. Until
the live race, configuration, and external-governance evidence passes, the
provider remains advisory and cannot change the v1 readiness JSON contract.
The local TA-3-I core implementation exercises those state transitions and
allowlist boundaries without claiming that an HTTPS endpoint, transactional
store, secret manager, or live Check Run enforcement has been deployed.

## Error model

- `PolicyError`: invalid YAML, schema, semantics, or unsupported policy version.
- `InputError`: malformed normalized input or unsafe repository path.
- `PlatformError`: event or GitHub API failure.
- Unexpected defects are reported without tokens, response bodies, or stack traces
  in default user-facing output.

Every public error has a stable code and actionable, safely rendered message.
Control characters are escaped before an error reaches CLI stderr or an Action
failure annotation.

Action publication is bounded at the output boundary: report-json is limited
to 1,000,000 UTF-8 bytes and the Markdown summary to 1 MiB. Both strings are
fully rendered and checked before any sink is written; summary, report-json, and
status are published in that order, with status last. Sink failures become a
sanitized ACTION_PUBLICATION_FAILED error.
