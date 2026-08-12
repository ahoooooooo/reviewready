# ReviewReady post-v1 trust roadmap

Status: **PL-0 complete on 2026-08-13; TA-1 is next and has not started.**

This is the forward execution plan after the verified v1.0.7 release. It does
not authorize product implementation, repository-setting changes, publication,
tag movement, or deployment by itself. The completed v1 plans and release
evidence remain historical records; this file is the source of truth for future
node order and promotion gates.

## Fixed node order

Work proceeds in this order and does not skip a promotion gate:

`PL-0 -> TA-1 -> TA-2 -> TA-3 -> AI-1 -> V2-1 -> AD-1`

Read-only research for a later node may clarify a dependency, but later-node
implementation or external mutation must not begin before the current node exits.
If a platform cannot provide evidence required by a gate, report the result as
blocked, failed, incomplete, or advisory. Never weaken the gate or improve the
wording to imply that the evidence exists.

## Frozen PL-0 baseline

The baseline was collected read-only before this plan was written:

- local HEAD was `e887220789a27a4a1e48e46096cbace2cd4399fe`;
- remote `main` was `46cad26b83158b221f69ea155a47f7a1a3961ec7`;
- both commits had tree `2fbda30f9d187d1d964e8c2343300770d2f9aff9`,
  so the reviewed repository contents were identical;
- npm latest was `@ahoooooo/reviewready@1.0.7` with integrity
  `sha512-jfdaNA2RltDjCbYKtuNusPOKterX8Kzd8VxmN5HGCCSQp6HF9pxIEqoM+T/AfqjK6h/Rso6C5J+p+opYkStR1Q==`;
- GitHub Release `v1.0.7`, semantic-version tag `v1.0.7`, and stable Action ref
  `v1` all targeted `f21ed2e94efedb01f73e518c39765cef72c58e1c`;
- GitHub release immutability was disabled. Existing semantic-version tags are
  treated as immutable by project policy, but GitHub was not enforcing that
  property and immutable releases apply only to future releases after enablement;
- repository ruleset `19504404` was active on the default branch with no bypass
  actors, blocked deletion/non-fast-forward updates, required pull requests,
  strict required checks `check` and `readiness`, and GitHub Actions App ID
  `15368` as their expected source;
- the ruleset required zero approving reviews, did not dismiss stale reviews,
  and could therefore not supply review freshness by itself;
- default workflow permissions were read-only and workflows could not approve
  pull requests;
- during PL-0 on 2026-08-13 (Asia/Taipei), GitHub CLI authentication was valid;
  `npm whoami --registry=https://registry.npmjs.org/` returned HTTP 401. npm
  login is not needed for PL-0 and must be re-established or replaced by
  verified Trusted Publishing only at an explicitly authorized release gate;
- 23 legacy issues were open before PL-0 reconciliation.

GitHub documents that required status checks do not distinguish a workflow,
matrix, or event trigger. Selecting an expected App prevents another App from
supplying the check, but selecting the GitHub Actions App does not bind one
immutable workflow definition. Consequently, the current metadata-only workflow
is safer than an ordinary pull-request workflow but must not yet be described as
a unique authoritative provider. See GitHub's documentation for
[ruleset status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-status-checks-to-pass-before-merging),
[required-check identity](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/troubleshooting-rules#troubleshooting-required-status-checks),
and [immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases).

## Evidence hierarchy

Every future claim identifies which evidence tier supports it:

1. **Local contract evidence**: source, fixtures, focused tests, full quality
   gate, generated artifact comparison, and `git diff --check`.
2. **Live read-only evidence**: bounded API results tied to an exact repository
   and revision, with completeness and freshness proved.
3. **External enforcement evidence**: settings that independently prevent or
   invalidate an untrusted change. A fixture field saying `trusted: true` is not
   this evidence.
4. **Public artifact evidence**: exact npm tarball, provenance, GitHub refs,
   Release, Action bundle, schemas, and documentation bound to one commit.
5. **Adoption evidence**: reproducible, consented external use. Stars, downloads,
   or unsupported testimonials are never substituted for technical evidence.

No lower tier may be presented as a higher tier. In particular, an offline audit
fixture cannot prove live governance, a successful named check cannot prove its
workflow implementation, and historical release evidence cannot prove current
settings.

## Invariants for every node

- Readiness remains deterministic; an LLM never decides pass or fail.
- Effective policy is loaded from the immutable base revision, never proposed
  head contents.
- ReviewReady never checks out, imports, builds, caches, shells, or executes
  pull-request code in a trusted context.
- PR metadata, Markdown, paths, labels, events, API fields, link headers,
  workflow YAML, and external settings are untrusted input.
- Unknown, timed-out, contradictory, malformed, stale, oversized, or incomplete
  evidence fails closed.
- Pagination, requests, retries, concurrency, response bytes, input bytes,
  matching work, output bytes, and deadlines are explicitly bounded.
- Readiness, repository audit, ingress, observability, AI analysis, and SARIF
  remain separate contracts.
- Public v1 JSON keys, fields, status meanings, and exit codes remain compatible.
- Each issue and pull request has one observable outcome. Bugs begin with a
  failing regression test.
- A node uses phased review: freeze a baseline, collect a batch of findings,
  triage the batch, fix disjoint slices, run the complete gate, then perform an
  independent second review. Do not alternate one discovery and one fix when a
  bounded review batch can be completed first.
- Publication, release creation, tag movement, Marketplace mutation, deployment,
  credentials, and secrets require explicit authorization at the time of action.

## Node contracts

### PL-0 — planning and governance freeze

Objective: establish one evidence-backed roadmap and reconcile historical work
without implementing a future feature.

Entry: read the repository rules, specifications, architecture, AI-development
policy, active/completed plans, ADRs, release evidence, source/test map, worktree,
authentication status, public release coordinates, live rulesets, and all open
issues.

Exit:

- [x] Baseline and authentication state recorded without exposing credentials.
- [x] All 23 legacy issues classified against source, tests, docs, and live
      evidence where required.
- [x] Node order, dependencies, non-goals, risks, and promotion gates fixed.
- [x] Successor issues #54 through #61 created with one outcome each.
- [x] Known documentation/version drift identified for correction in PL-0.
- [x] Core and package-focused validation completed before final full validation.
- [x] No TA-1 or later product implementation, publication, or settings mutation.

Highest risk: mistaking a clean fixture, a passing local test, or a GitHub Actions
App ID for externally enforced workflow provenance.

### TA-1 — prove the v1 trust boundary and repository governance

Objective: close the remaining v1 trust-contract gaps and harden/record every
repository control currently available without overstating workflow authority.

Entry: PL-0 is complete. Work is limited to #18, #25, #26, #27, and #54. #28 is
deliberately deferred to AD-1 because it concerns package footprint and exact
minimum-runtime delivery rather than readiness semantics.

Required work:

- complete each retained v1 issue from a failing regression or parity test;
- capture live governance bound to exact base, policy, workflow, and Action SHAs;
- verify rules, bypass, required checks/App IDs, review freshness, force push,
  deletion, tag controls, Actions permissions, and future release immutability;
- keep the current trusted workflow metadata-only, base-controlled, read-only,
  and commit-pinned;
- state the remaining GitHub Actions workflow-identity gap explicitly and assign
  the dedicated provider/App closure to TA-3.

Exit:

- #18, #25, #26, #27, and #54 are closed with acceptance evidence;
- all local v1 compatibility, input-boundary, staged-evidence, schema-parity, and
  governance tests pass;
- settings evidence is complete and revision-bound, or the node remains blocked;
- documentation says `authoritative` only where an independent authority exists;
- focused tests, `npm run check`, artifact inspection, and `git diff --check` pass;
- an independent review finds no unresolved P0/P1 defect in TA-1 scope.

Non-goals: no server, App deployment, database, AI expansion, v2 schema, external
pilot, or release. If unique workflow provenance is unavailable, TA-1 records the
check as advisory; it does not manufacture an authority claim.

### TA-2 — reproducible live audit and dogfood evidence

Objective: produce a deterministic, read-only, replayable audit of ReviewReady at
one exact revision. Tracked by #55.

Entry: every TA-1 exit gate passes. A least-privilege read token, explicit base
revision, policy path, and candidate workflow roots are supplied. Each root's
observed protection and provenance state is recorded. A root that cannot be
shown trusted remains an advisory input and an explicit finding; TA-2 is not
blocked merely because its purpose is to preserve that gap. Missing roots or
unbounded identity inputs make collection `incomplete`.

Exit:

- live collection and offline replay produce the same canonical result;
- every collection proves completeness within bounds or returns `incomplete`;
- workflow/check ambiguity, settings mismatch, and authority gaps remain findings;
- the bundle contains no credential or unnecessary personal/private content;
- audit status is not used as the readiness decision;
- adversarial focused tests, `npm run check`, and `git diff --check` pass;
- #55 closes with a reproducible evidence bundle.

Non-goals: no settings auto-fix, App deployment, database, model invocation, or
claim that self-use proves broad adoption.

### TA-3 — dedicated provider and trusted ingress

Objective: close the workflow-provider authority gap with a dedicated GitHub App
contract and a production-grade, fail-closed ingress. The design gate is #56;
implementation receives a new single-outcome issue only after that design passes.

Entry: TA-2 evidence is complete. Hosting, durable store, secret manager,
TLS/proxy, rate-limit, privacy, retention, and deletion providers are selected
before provider adapters are written.

Subgates:

- TA-3-D (#56) is design-only. It exits when the threat model, least-privilege
  permissions, provider choices, state machine, bounded ingress contract,
  retention/deletion rules, failure modes, rollout/rollback plan, and acceptance
  fixtures are approved. Closing #56 creates separate single-outcome TA-3-I
  implementation/evidence issues; it never completes TA-3 by itself.
- TA-3-I starts only after TA-3-D exits. Its successor issues implement and
  prove the approved contract without silently expanding it.

Node exit: both TA-3-D and every TA-3-I successor are complete, and:

- App permissions and installation/repository allowlists are least privilege;
- raw-body signature, hook identity, bounded freshness, two-namespace replay,
  idempotency, SHA/policy/workflow binding, atomic claims, crash recovery, and
  stale-result compare-and-swap are proven under races and outages;
- logs are bounded/redacted and retention/deletion behavior is testable;
- the required result is tied to the dedicated provider identity and current
  base/head rather than a GitHub Actions display name;
- no trusted path executes PR code;
- threat model, ADR, focused tests, full gate, and independent review pass.

Non-goals: no LLM verdict, AI analyzer expansion, v2 policy, or automatic merge.

### AI-1 — differentiated AI-workflow security analysis

Objective: expand the bounded static analyzer around ReviewReady's revision and
capability trust model. The design corpus/contract is #57; implementation is
created only after its expected results are accepted.

Entry: TA-3 exits with a stable identity/capability model.

Subgates:

- AI-1-D (#57) is design-only. It exits when the bounded corpus, source/prompt/
  sink vocabulary, expected findings, ambiguity behavior, false-positive
  budget, SARIF contract, and resource limits are approved. Closing #57 creates
  separate single-outcome AI-1-I implementation/evidence issues; it never
  completes AI-1 by itself.
- AI-1-I starts only after AI-1-D exits and implements the accepted corpus and
  contract without coupling analyzer findings to readiness.

Node exit: AI-1-D and every AI-1-I successor are complete, and:

- fixtures distinguish prompt injection, untrusted execution, capability/secret
  exposure, permission escalation, and action/provider provenance;
- source-to-prompt-to-sink relationships, indirection, reusable workflows,
  ambiguity, and false positives are tested within explicit bounds;
- ordering and SARIF are deterministic; malformed/oversized/unknown input fails
  closed or emits an explicit unknown finding;
- no workflow, script, expression, model, or PR code is executed;
- all design and implementation leaves close after full validation/review.

Non-goals: no general code review, no zizmor clone, no readiness coupling, and no
model-based pass/fail decision.

### V2-1 — explicit versioned semantics

Objective: introduce stronger semantics only through an opt-in versioned policy
and result migration. Unmatched behavior is #58; authenticated attestation is #59.

Entry: AI-1 is complete and TA-3 supplies trustworthy actor/revision identity for
any authenticated attestation design.

Subgates:

- V2-1-D consists of design-only issues #58 and #59. Each exits only when its
  versioning, compatibility, migration, downgrade, rollback, failure, and
  acceptance-fixture contract is approved. Closing either issue creates
  separate single-outcome V2-1-I implementation/migration issues and never
  completes V2-1 by itself.
- V2-1-I starts only after both design leaves exit. Its successor issues
  implement and prove the accepted contracts while preserving all v1 behavior.

Node exit: both V2-1-D leaves and every V2-1-I successor are complete, and:

- v1 golden fixtures and all public v1 JSON remain compatible;
- unmatched `ready`, `not_ready`, and `error` behavior has explicit defaults,
  reports, JSON, exit codes, upgrade, downgrade, and rollback rules;
- authenticated attestation binds actor, event, repository, base/head, policy,
  and freshness without claiming comprehension or legal signature;
- stale, dismissed, replayed, wrong-revision, and unsupported-version evidence
  fails closed;
- schema/runtime parity, migration fixtures, focused tests, full gate, and
  independent review pass.

Non-goals: no patch-level reinterpretation of v1, no automated policy rewrite,
and no bot-generated claim of human responsibility.

### AD-1 — public delivery and honest adoption evidence

Objective: make package/runtime delivery, all public release surfaces, and one
external pilot reproducible and mutually consistent. Tracked by:

- #28 for package/runtime delivery;
- #60 for public release consistency;
- #61 for the external pilot.

Entry: V2-1 exits. Any release has a separate explicit authorization and a clean,
verified release candidate. npm authentication or Trusted Publishing is verified
at execution time rather than assumed from PL-0.

Exit:

- #28 proves the intended package surface, dependency graph, map files, exact
  minimum Node runtime, and packed consumer behavior;
- npm tarball/integrity/provenance, semantic-version tag, GitHub Release, stable
  Action ref, source commit, Action bundle, schemas, Marketplace, and docs agree;
- GitHub release immutability protects future releases; historical limitations
  remain documented rather than rewritten;
- one consented external OSS pilot has reproducible sanitized evidence, including
  limitations and false positives/negatives;
- no in-scope P0, P1, or P2 issue remains open;
- full clean-room/package/platform validation and independent review pass.

Non-goals: no fabricated adoption metrics, no historical rewrite, no implicit
publication authority, and no claim that one pilot proves universal security.

## Legacy issue reconciliation

The dispositions below are based on observable behavior, not unchecked boxes or
issue age:

| Issue | PL-0 disposition    | Evidence or successor                                                                                                          |
| ----- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| #4    | completed           | Files/checks are bounded and fail closed; exact platform limits are intentionally rejected when completeness cannot be proved. |
| #12   | completed           | Visible Markdown state machine and adversarial parser tests.                                                                   |
| #13   | completed           | Old/new rename paths are normalized, deduplicated, bounded, and tested.                                                        |
| #14   | completed           | Legacy statuses paginate, reduce to latest state, combine conservatively, and fail closed at uncertainty.                      |
| #15   | superseded          | Self-policy/workflow exist; authoritative live dogfood is the single outcome in #55 after #54.                                 |
| #16   | completed           | Exact-artifact release workflow and v1.0.7 evidence exist; future public reconciliation is #60.                                |
| #17   | completed           | Action JSON/summary UTF-8 bounds and sink ordering are tested.                                                                 |
| #18   | retained for TA-1   | Add the remaining direct CLI raw-input/device/boundary regression evidence.                                                    |
| #19   | completed           | Pinned Windows packed-artifact workflow covers CRLF, ready/not-ready/invalid exits and passed on current remote main.          |
| #20   | superseded          | Mixed manual issue split into governance #54 and public delivery #60.                                                          |
| #25   | retained for TA-1   | Add all-five-requirement v1 golden JSON and CLI/Action compatibility proof.                                                    |
| #26   | retained for TA-1   | Finish latest-review permission planning and explicit call/resident-work evidence.                                             |
| #27   | retained for TA-1   | Add runtime-versus-Draft-2020-12 validator corpus parity.                                                                      |
| #28   | retained for AD-1   | Map files, Action-only dependencies, package surface, types, and exact Node minimum remain observable delivery work.           |
| #29   | completed           | Shared deterministic matching budget and compiled-glob cache are tested.                                                       |
| #32   | completed           | COMMENTED and dismissal no longer overwrite latest opinionated review state.                                                   |
| #33   | completed           | Non-collaborator 404 maps to none; forbidden/unknown errors fail closed.                                                       |
| #34   | completed           | Latest check/status reduction and same-name cross-provider ambiguity are conservative.                                         |
| #35   | design completed    | ADR 0001/reference workflow exist; operational governance is #54 and dedicated provider authority is TA-3.                     |
| #37   | completed           | Literal backslashes/traversal are rejected across direct and rename paths.                                                     |
| #38   | completed           | Base/head/updated-at snapshots are rechecked around double-collected evidence with bounded retry.                              |
| #41   | v1 design completed | ADR 0008 and current wording are complete; stronger versioned provenance is #59.                                               |
| #42   | v1 design completed | ADR 0007 and visible no-match reporting are complete; versioned strategy is #58.                                               |

## PL-0 stop point

After the PL-0 documentation, tracker reconciliation, focused validation,
`npm run check`, artifact inspection, and `git diff --check` pass, stop. Do not
start #18, #25, #26, #27, #54, or any later issue in the same work session.
