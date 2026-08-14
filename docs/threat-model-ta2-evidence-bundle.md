# TA-2 replayable audit evidence: threat model

- Status: design approved; implementation complete; dogfood and promotion review
  pending
- Date: 2026-08-13
- Governing decision: [ADR 0009](adr/0009-replayable-audit-evidence-bundle.md)
- Delivery issue: [#55](https://github.com/ahoooooooo/reviewready/issues/55)

## Security objective

Given an explicit repository and exact current default-branch SHA, collect a
bounded, privacy-minimized historical evidence bundle whose offline replay
reconstructs the same normalized audit input and canonical report. Unknown,
incomplete, inconsistent, stale, malformed, unsupported, or over-limit evidence
must not become `pass`.

This objective does not establish that the bundle producer is authentic, that
mutable GitHub settings were observed atomically, that the repository is still
configured the same way, or that the audit result is a pull-request readiness
decision.

## Assets

- exact repository numeric identity, canonical name, and base revision;
- exact policy and workflow bytes evaluated by the audit engine;
- completeness and consistency classification of mutable GitHub settings;
- deterministic audit findings, status, and exit class;
- compatibility of the public readiness and audit-report JSON contracts;
- confidentiality of credentials, private API data, and unnecessary personal
  identifiers;
- availability under malicious API responses and bundle inputs;
- honest separation between caller assertions and observed authority.

## Actors and assumptions

- The collector process and trusted local ReviewReady checkout are in scope.
- GitHub REST responses, headers, pagination links, source bytes, repository
  settings, names, paths, and counts are untrusted.
- The caller may accidentally or deliberately provide the wrong repository,
  revision, policy path, or workflow-root assertions.
- A local bundle may be reformatted, truncated, replaced, or maliciously crafted.
- A network intermediary or compromised token may return authorized but
  surprising data. TLS and GitHub authentication are external dependencies, not
  evidence of semantic completeness.
- SHA-256 collision resistance and the correctness of the Node.js cryptographic
  implementation are assumed.
- The local wall clock is not assumed to be authoritative. Monotonic time is used
  for deadlines; recorded UTC timestamps are informational.
- GitHub provides immutable commit-addressed repository content, but no documented
  transaction spanning all repository-settings endpoints.
- Start/end branch-head equality cannot detect a branch change-and-revert between
  observations; the subject records two observations, not continuous currency.

## Trust boundaries and data flow

```text
caller arguments
      |
      v
strict identity/path/revision validation
      |
      v
bounded GitHub REST adapter -- untrusted network/API boundary
      |
      +--> settings round A ----+
      +--> exact-SHA artifacts  +--> normalize, compare, redact
      +--> settings round B ----+             |
                                               v
                                     source-complete snapshot
                                               |
                                               v
                                      pure audit classifier
                                               |
                                               v
                                      JCS + domain hashes
                                               |
                                               v
                                      canonical stdout bundle

local bundle file -- untrusted filesystem boundary
      |
      v
bounded strict parser -> digest/source verification -> reconstruction
      |
      v
pure audit classifier -> canonical saved-report comparison -> renderer
```

Neither path checks out, imports, builds, caches, shells, evaluates expressions
from, or executes repository or pull-request code.

## Threats, controls, and residual risk

| ID  | Threat                                                                                      | Required control                                                                                                                                   | Residual or disposition                                                                                        |
| --- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| T01 | Repository swap, transfer, rename, owner-type change, or casing confusion                   | Bind immutable numeric repository ID and GitHub-canonical owner/name/type in both rounds; compare caller names case-insensitively only at ingress  | A later transfer after collection makes the bundle historical, not invalid at its recorded observation         |
| T02 | Caller supplies a branch, tag, short SHA, or wrong SHA                                      | Require one full 40-hex SHA, normalize hex case, and require the default-branch head to equal it at the start and end observations                 | Historical non-head auditing is outside TA-2; branch-head ABA remains possible                                 |
| T03 | Policy or workflow is loaded from a mutable ref                                             | Fetch every artifact with the exact SHA; bind path, revision, raw-byte SHA-256, and strict UTF-8 bytes                                             | Git object/SHA-256 cryptographic assumptions remain                                                            |
| T04 | Mutable settings change during collection                                                   | Collect two complete normalized rounds around source reads and require byte-equivalent facts                                                       | Equal rounds cannot detect an ABA change; the bundle must say stable double observation, never atomic snapshot |
| T05 | Endpoint ETag is mistaken for global consistency                                            | Scope cached representation and ETag to the exact request; compare all normalized round facts; use full reread when absent                         | GitHub controls ETag semantics for each endpoint                                                               |
| T06 | Pagination truncation, looping or cross-endpoint links, duplicate pages, or reordered pages | Bind continuation origin/path/fixed query/repository to the current request, allow only the next page, bound pages/items, and reject duplicates    | Over-bound or malformed collections produce no bundle                                                          |
| T07 | Rate-limit, timeout, retry, or partial permission is treated as absence                     | One bounded retry, shared request/deadline budgets, explicit permission/unknown codes, fail closed                                                 | Availability failures may prevent a bundle, by design                                                          |
| T08 | Unsupported ruleset target, condition, exclusion, enforcement, or nested field is ignored   | Strict API mapping and schema; any unmodeled security-relevant API shape prevents bundle output                                                    | New GitHub features require an explicit contract update                                                        |
| T09 | Caller-provided trusted/protected path launders authority                                   | Persist it only under `assertions`; do not set authoritative snapshot facts from the assertion alone; preserve a finding                           | TA-3 is required for dedicated provider authority                                                              |
| T10 | Check display name spoofs a required provider                                               | Preserve App ID/slug distinctions and duplicate identities; no display-name-only authority                                                         | GitHub Actions App identity does not uniquely identify a workflow; remains a finding until TA-3                |
| T11 | Raw API payload leaks tokens, headers, PR text, or personal data                            | Persist only schema-whitelisted normalized facts and exact required source artifacts; prohibit raw responses/headers/URLs and caller environment   | Policy/workflow source may itself contain sensitive committed text and the bundle is marked sensitive          |
| T12 | Bypass actor identity is missing, substituted between rounds, or unnecessarily published    | Enforce the frozen target/owner/type/mode/ID matrix; compare unique identity/mode internally; persist deterministic type/mode/count summaries only | Actor count/type/mode remains visible because classification needs presence and consistency                    |
| T13 | Source bytes change through newline, Unicode, or JSON transformations                       | Persist canonical base64url of raw bytes plus SHA-256; strict UTF-8 decode; no normalization                                                       | Invalid UTF-8 source prevents bundle output                                                                    |
| T14 | Duplicate JSON names or unsafe numbers exploit parser differences                           | Bound bytes, reject duplicate names before ordinary object parsing, enforce I-JSON/safe integers and strict schemas                                | Parser implementation requires adversarial conformance tests                                                   |
| T15 | Property order, locale collation, or array order changes hashes                             | RFC 8785 for objects; explicit locale-independent pre-sort for set arrays; fixed order for semantic arrays                                         | A comparator change requires a bundle-version change                                                           |
| T16 | Pretty-printing or a trailing newline is silently accepted                                  | Require input bytes to equal canonical full-bundle JCS bytes exactly                                                                               | Manual formatting invalidates the artifact intentionally                                                       |
| T17 | Saved report is altered while snapshot remains valid                                        | Recompute report from reconstructed facts and require canonical equality plus domain-separated digest                                              | Report behavior changes require compatible audit semantics or a version advance                                |
| T18 | Artifact is changed and hashes are recomputed                                               | State that digests are integrity, not authentication; anchor public evidence in a separately trusted Git commit or release                         | TA-2 bundle alone cannot prove producer identity                                                               |
| T19 | Old bundle is presented as current repository state                                         | Record observation window and label replay historical; never contact GitHub or claim freshness during replay                                       | Consumers must choose an external age policy; clock claim is not authenticated                                 |
| T20 | Audit result is used as PR readiness or auto-merge authority                                | Keep schemas, commands, status vocabularies, and docs separate; no write API or merge action                                                       | External consumers can misuse output despite documentation                                                     |
| T21 | Resource exhaustion through source count, escape expansion, findings, or nested input       | Bound wire/source bytes, depth, members, elements, tokens, strings, findings, all 768 attempts, pages, retries, concurrency, and deadline          | Bound exhaustion yields exit 2 and no bundle                                                                   |
| T22 | Partial or newline-modified output is consumed after a crash                                | Build and verify the bundle before one dedicated raw stdout write with no newline; emit no separate success marker                                 | Shell redirection can still leave a partial file after process failure; replay rejects it                      |
| T23 | Different ReviewReady versions silently produce different findings                          | Bind bundle/audit versions and compare recomputed report; unknown or incompatible semantics exit 2                                                 | Exact producer binary is not authenticated by TA-2                                                             |
| T24 | Malicious source causes code execution during replay                                        | Decode and parse/analyze only as data; no checkout, import, cache restore, shell, workflow expression evaluation, or model call                    | Vulnerabilities in parsers remain dependency/supply-chain risk                                                 |

## Privacy and retention

The minimum replayable evidence includes repository identity, settings facts,
policy bytes, workflow bytes, caller assertions, collection counters/timestamps,
and the derived report. It excludes every other response field.

ReviewReady has no TA-2 server or durable store. The collector emits to stdout and
the user controls the destination, access policy, encryption, backup, publication,
retention, and deletion. The following rules apply to project-owned dogfood
evidence:

- a public committed bundle may contain only source already public at the exact
  bound commit;
- private or internal source bundles must not be committed, attached to public
  issues, printed in logs, or uploaded as an unprotected Actions artifact;
- outside exact source artifacts, no token, authorization header, cookie, raw API
  response, PR body, prompt, issue/review payload, actor name/login/email, or
  environment dump is retained;
- exact source artifacts may contain arbitrary committed text and are never
  scanned, redacted, or rewritten; project-owned publication requires separate
  human review of the decoded bytes;
- deleting the locally redirected file is sufficient for ReviewReady itself,
  because the tool keeps no second copy;
- copies created by shells, CI systems, artifact stores, backups, or Git history
  are external and require their own deletion policy;
- TA-3 service retention and deletion are a separate design gate and must not be
  inferred from this local artifact contract.

## Fail-closed outcomes

Collection emits an incomplete bundle only when exact subject and source
artifacts are complete and either two individually strict settings rounds differ
or equal rounds contain an explicit modeled unknown authority fact. A mismatch
uses neither round's mutable facts. It emits no bundle for identity, branch-head,
artifact, transport, pagination, deadline, unsupported-shape, encoding,
canonicalization, or output-size failure. Replay returns exit 2 for any
bundle-integrity or reconstruction failure and never renders the saved report as
trusted fallback. The normative state machine is in
[the bundle v1 contract](audit-evidence-bundle-v1.md).

The audit report can still be `fail` rather than `incomplete` when collection is
complete and the observed configuration has deterministic findings. This is an
honest dogfood outcome and does not block saving evidence. `pass` means only that
the bounded audit classifier found no finding in that historical observation.

## Explicitly accepted residuals

- Cross-endpoint GitHub settings are not transactionally observed; ABA is not
  detectable with documented REST guarantees.
- Start/end default-branch SHA observations cannot detect branch-head ABA and do
  not prove the SHA remained current throughout collection.
- SHA-256 digests do not authenticate the collector or bundle author.
- Observation timestamps do not prove freshness.
- Caller workflow-root claims remain non-authoritative.
- Workflow and policy source retained for replay may be sensitive for a private
  repository.
- Self-dogfood evidence does not prove external adoption or broad correctness.

No other residual may be silently accepted during implementation. New residuals
require an ADR update and independent review before code is promoted.
