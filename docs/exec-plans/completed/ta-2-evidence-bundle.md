# TA-2 replayable audit evidence implementation plan

Status: **Complete.** The v1 contract, modeled ruleset-semantics v2 extension,
local gates, main-bound promotion, bounded durable artifact, and independent
credential-free replay are verified. The preserved audit result is
'incomplete', because unavailable governance and workflow authority are
findings that must not be upgraded to pass. TA-3 design is the next node.

This plan implements [ADR 0009](../../adr/0009-replayable-audit-evidence-bundle.md)
and the [TA-2 threat model](../../threat-model-ta2-evidence-bundle.md) for
[#55](https://github.com/ahoooooooo/reviewready/issues/55). It is subordinate to
the fixed node order in [post-v1.md](../active/post-v1.md). The implementation
phases
below are historical execution records. TA-3 design/implementation must not
start until its separate design gate is approved.

## Current execution evidence

- The evidence schema, canonicalizer, bundle projection/hydration, bounded
  base64 artifacts, exact-revision collector boundary, request metrics, CLI
  `audit collect`/`audit replay`, package exports, and tests are implemented.
- The final local gate passed on 2026-08-16: 30 test files, 817 passed and
  6 skipped (823 total), 92.63% statements, 88.13% branches, 98.53%
  functions, and 92.54% lines.
  bundle/package smoke, clean-room replay, and the Action ncc build also passed.
- Release preflight now reads external evidence and artifacts through bounded
  descriptor-backed snapshots, binds clean-room installation to the verified
  tarball digest, and reports incomplete TA-2 cleanup instead of hiding it.
  The complete and compatibility quality gates verify the existing generated
  tree before and after rebuilding it.
- `git diff --check` passed. The canonical local fixture at
  `fixtures/audit/evidence-bundle-v1.json` passes strict canonical parsing,
  hydration, replay, package smoke, and release-preflight clean-room checks.
  It is a replay fixture, not evidence of the live repository.
- An earlier authenticated dogfood run correctly emitted no bundle because the
  remote ruleset contains semantics outside bundle v1. The current-main
  acceptance artifact is recorded below; this historical failed-closed run is
  not substituted for it.
- The production TA-2 workflow remains Ubuntu-bound for its no-follow filesystem
  assumptions. Windows local verification still performs lstat/fstat and
  post-read identity checks, but Node does not expose O_NOFOLLOW there; this
  is a platform limitation, not an independent trusted-root claim.

- A base-owned promotion entrypoint now fixes the repository, exact main SHA,
  policy path, and workflow roots; it bounds child output and replay. After
  successful replay it exposes exactly the bundle, replay report, and manifest
  to a pinned 30-day Actions artifact, and a separate job downloads and checks
  the same bytes offline. The current-main acceptance artifact is recorded
  below.
  Current-main promotion run
  [31898181562](https://github.com/ahoooooooo/reviewready/actions/runs/31898181562)
  bound collection to 6ae4c96123aa5d377eb44fd2598fad052ea45cf8. The run-scoped
  artifact was independently checked as exactly three bounded files: bundle
  55136 bytes with SHA-256
  410c3f78ed48fd6848f01e19d7910ed357dbe06bcf0ba7902d1f09c7ed21a398, manifest
  503 bytes, and replay 5049 bytes with SHA-256
  b41264311d78fe04bb8b5bab369ffca09be212daffe9d582efb9897904fc4949. Live and
  offline replay agree on incomplete and exit class 2.

- The first authenticated dogfood attempt reached the real repository ruleset
  but correctly stopped without bundle output: its official detail includes a
  `pull_request` review rule and additional required-status enforcement fields
  that bundle v1 cannot preserve. Dedicated stable fail-closed diagnostics and
  regression tests now record this as unsupported semantics. Actions repository
  permission settings remain outside the v1 bundle projection; they must not be
  silently claimed as collected evidence.
- The modeled subset is now emitted as bundle/snapshot v2 under
  [ADR 0010](../../adr/0010-ruleset-semantics-evidence-v2.md). v1 fixtures and
  consumers remain unchanged; non-empty required reviewers and unmodeled
  parameters still stop collection closed.
- The official main-bound promotion run at
  [9f0ef9c](https://github.com/ahoooooooo/reviewready/commit/9f0ef9c45b214b82eaf052678b62f8441de1e5d9)
  stopped closed without an evidence bundle with the stable collection-failed
  diagnostic. This confirms no false pass under the workflow token, but it is
  not an acceptance artifact and does not close #55.
- The subsequent main-bound promotion run at
  [a4689c7](https://github.com/ahoooooooo/reviewready/commit/a4689c7f05c6bdc0870db91dbfe6d19c5ccb2e96)
  succeeded with the repository-scoped read-only App token and completed
  collection plus two offline replays. That historical run predates the
  durable-artifact follow-up; its runner-temporary output is not treated as the
  #55 acceptance artifact.
- The main-bound promotion workflow now mints a repository-only, read-only
  GitHub App installation token from the two repository secrets
  `REVIEWREADY_AUDIT_APP_ID` and `REVIEWREADY_AUDIT_PRIVATE_KEY`. It binds the
  token to `ahoooooooo/reviewready`, requests only the read permissions needed
  by the collector, and passes the short-lived token only to collection. There
  is no fallback to the built-in workflow token: missing or invalid App
  credentials fail closed. This credential path improves API reachability; it
  is not TA-2 acceptance evidence and does not widen the v1 bundle semantics.
- The authenticated dogfood also exposed that the GitHub Contents workflow
  directory is not a paginated endpoint in the supported request contract. The
  adapter now sends only `ref`, accepts one bounded directory response, rejects
  any `Link` header, and rejects more than the v1 workflow bound. It no longer
  probes a fabricated second page.

The exact executable target is the
[audit evidence bundle v1 contract](../../audit-evidence-bundle-v1.md). No
implementation may add optional fields, widen enums, choose different
comparators, or invent an incomplete state under `bundleVersion: 1`.

## Outcome

Produce one deterministic, read-only, source-complete ReviewReady audit bundle
for an explicit current default-branch commit. Offline replay must reconstruct
the audit input, rerun the classifier, emit the same canonical report, and return
the same exit class. The resulting dogfood artifact may honestly be `fail` or
`incomplete`; it must not be cosmetically upgraded.

## Frozen decisions

Implementation may not silently change these decisions:

- evidence bundle, audit report, and readiness result are three separate
  versioned contracts;
- collection requires a full exact SHA and binds immutable repository identity,
  including owner type;
- source uses exact-SHA raw bytes, canonical base64url, and SHA-256;
- SHA ingress accepts either ASCII hex case and persists lowercase only;
- mutable settings use two complete equal normalized observations, not an atomic
  or point-in-time claim;
- RFC 8785 JCS is applied after strict I-JSON parsing and semantic array sorting;
- hashes use the ADR's domain-separated byte prefixes;
- replay rejects noncanonical bytes and derives the report rather than trusting
  it;
- caller workflow-root assertions never become authority by themselves;
- bypass identities are not persisted;
- stable actor identity and bypass mode are required for round equality before
  type/mode/count redaction;
- a closed target/owner/type/mode/ID actor matrix defines every accepted ruleset
  bypass record and singleton constraint;
- pagination continuations are bound to the exact API origin, endpoint,
  repository, and fixed query identity;
- the 768-attempt budget covers every identity, setting, artifact, probe, and
  retry attempt in the entire collection;
- no source checkout or execution, GitHub write, service, store, upload, model
  call, release, or readiness-schema change is in scope;
- every new failure discovered during implementation begins with a focused test
  that fails for the intended reason.

Changing one of these items is a contract decision and requires an ADR update
before implementation continues. Ordinary code structure and test mechanics are
LUNA MAX implementation decisions.

## Planned public surface

The implementation adds:

- `reviewready.audit-evidence.schema.json` using JSON Schema Draft 2020-12;
- `reviewready audit collect --github OWNER/REPOSITORY --revision FULL_SHA ...`;
- `reviewready audit replay --bundle PATH [--json | --sarif]`;
- a canonical bundle fixture and a real ReviewReady dogfood artifact;
- package export/file-list entries for the new schema.

The existing audit forms, audit report schema, readiness schema, statuses, and
exit codes remain compatible. Collection emits canonical bundle bytes to stdout.
Replay output is the recomputed audit report in the requested renderer.
Collection uses a dedicated no-newline raw sink; replay uses a dedicated 8 MiB
raw-byte reader. Neither changes the legacy newline or 4 MiB text-reader contract.

## File ownership map

Expected files are listed to prevent unrelated refactors, not to force one large
patch:

- canonical I-JSON/JCS parsing and serialization: new narrow module under `src/`;
- bundle schema, projection, hashing, reconstruction, and replay: one new audit
  evidence module plus its focused test;
- exact-revision and double-observation collection: `src/github-audit.ts` and
  `src/github-audit-api.ts` with their existing focused tests;
- CLI grammar, bounded bundle file read, stdout behavior, and exit mapping:
  `src/cli.ts` and `test/cli.test.ts`;
- public schema parity and packaging: new schema, schema tests, `package.json`,
  package verification/smoke tests, and generated declarations;
- documentation and dogfood evidence: README, architecture, release/security
  boundaries, this plan, #55 evidence, and one bounded fixture/artifact.

Production modules should remain small and pure where possible. The canonicalizer
must not know GitHub, and the audit classifier must not know CLI or filesystem
state.

## Phase 1 — red contract corpus

This was the first implementation phase; its red corpus and implementation
exit are complete.

Before production code changes, add focused failing tests for:

1. RFC 8785 official property-order and number vectors;
2. duplicate decoded object names, lone surrogates, invalid UTF-8, BOM, unsafe
   integers, negative zero, NaN/Infinity construction, and unknown fields;
3. depth 32, 20,000 members, 20,000 elements, exactly 100,000 and 100,001
   lexically counted tokens, 6 MiB string, 32-character number token, and every
   over-bound parser case without recursion failure;
4. canonical bytes with no whitespace/newline and rejection of reordered or
   pretty-printed bundle input;
5. domain separation between snapshot, report, and payload digests;
6. canonical unpadded base64url, raw-byte hash mismatch, duplicate artifact
   paths, wrong artifact revision/path, and invalid UTF-8 source;
7. schema/runtime parity against every required/conditional field, enum,
   missing code, state, and additional-property rejection in the v1 contract;
8. preserved readiness and audit-report schemas with no added fields;
9. privacy projection that retains bypass type/mode/count but no provider
   identity;
10. source-free `AuditEvidenceSnapshotV1` hydration from exactly one matching
    artifact per workflow, with no duplicate source precedence;
11. caller root assertions plus otherwise clean settings cannot produce
    authoritative workflow booleans or remove findings;
12. total findings comparator tie cases including category as the final key.

Exit: the intended tests fail because the new contract is absent, not because a
fixture is malformed or a command is misspelled. A LUNA MAX reviewer confirms
the red corpus covers every frozen decision before green implementation begins.

## Phase 2 — canonical core and bundle reconstruction

Implement only enough to make the Phase 1 corpus pass:

- bounded duplicate-aware strict JSON parser;
- I-JSON validation and RFC 8785 serializer;
- semantic normalizers/comparators for every set-like array;
- strict bundle schema and version dispatch;
- base64url artifact verification and source hydration;
- domain-separated hashes;
- saved-snapshot reconstruction and saved-report comparison.

Additional focused tests cover permutation invariance: object input order, API
page order, ruleset/check/workflow order, and bypass actor order must produce the
same normalized payload and report. Semantically meaningful source byte changes
must change the relevant artifact and payload digests.
Nested `refPatterns`, `repositoryPatterns`, check arrays, bypass summaries, and
missing/path arrays are all included; no locale comparator or undocumented
deduplication is permitted.

Exit: focused canonical/bundle tests pass; no GitHub or CLI code has been changed
except type-only integration needed by the tests. A separate LUNA MAX review
must find no open P0/P1/P2 contract issue.

## Phase 3 — exact-revision stable collection

Add regression-first collector tests for:

- missing, short, uppercase-normalized-to-lowercase, branch-name, tag-name,
  wrong, and valid requested revisions;
- repository ID/name/owner-type/default-branch/head changes between rounds;
- every modeled branch-protection, ruleset, tag-protection, and repository fact
  changing between rounds;
- reordered but equivalent API collections remaining equal;
- change-and-revert documented as unobservable rather than claimed atomic;
- ETag 304 reuse scoped to the exact request, absent ETag full reread, malformed
  validators, and 304 without a cached bounded representation;
- cross-origin, cross-repository, cross-endpoint, changed-fixed-query, duplicate
  parameter, fragment/userinfo, skipped-page, and valid ruleset pagination
  links; workflow-directory Link headers are rejected as unsupported;
- shared 768-attempt collection/deadline/retry/page budgets, including the
  100-ruleset/100-workflow boundary with a retry for every operation;
- policy and workflow reads using only the full explicit SHA;
- per-source, aggregate-source, artifact-count, response, and bundle-size edges;
- caller trusted/protected roots retained as assertions and not authoritative
  snapshot facts;
- missing actor IDs, actor substitution between rounds, every target/owner/type/
  mode/ID matrix edge, OrganizationAdmin on a user owner, singleton count
  violations, bypass-mode changes, duplicate actor identities, round equality,
  and removal of identities before persistence;
- the exact no-bundle versus conservative incomplete-bundle state machine,
  including a policy-fetch failure and a strict settings-round mismatch.

Then implement two complete mutable rounds around immutable artifact collection.
All round comparisons operate on strict normalized facts. Do not compare raw JSON
formatting, locale-sorted names, request IDs, dates, or headers.

Exit: focused GitHub collector/API tests pass and demonstrate every collection is
complete within bounds or returns incomplete. LUNA MAX reviewers separately
attack consistency/TOCTOU and privacy/provenance. Any FAIL keeps work in Phase 3.

## Phase 4 — CLI and compatibility

Add failing CLI tests before changing the parser:

- exact collect/replay grammar and mutual exclusions;
- regular-file/device/symlink and raw-byte limits for bundle input;
- dedicated 8 MiB raw reader validation before decode, while legacy input stays
  at 4 MiB;
- one canonical raw stdout write with no newline only after complete
  construction, while legacy outputs retain their newline;
- no token, source, raw exception, or partial bundle on stderr;
- collect/replay exit parity for pass, fail, and incomplete reports;
- integrity, schema, version, reconstruction, and report mismatch exit 2;
- legacy `audit --github`, `audit --input`, readiness commands, output schemas,
  and error classes unchanged;
- `--json`/`--sarif` apply to replayed report, not bundle construction;
- Windows Node invocation and path behavior.

Implement the smallest CLI changes that satisfy those tests. Replay must never
contact GitHub. Collection must never write a file, GitHub check, issue, release,
or repository setting.

Exit: focused CLI and compatibility tests pass; a LUNA MAX reviewer confirms no
legacy ambiguity or public JSON drift.

## Phase 5 — schema, package, fixtures, and documentation

Add the Draft 2020-12 evidence schema and independently validate it with the same
positive/negative runtime corpus. Include it in npm `files` and `exports`, package
verification, clean-room smoke, and any generated declarations. Do not publish.

Required fixtures include:

- one minimal canonical complete/pass bundle;
- one complete/fail bundle with stable findings;
- one incomplete bundle caused by settings-round mismatch;
- one equal-round bundle with an explicit known=false authority fact;
- one artifact/identity/transport failure proving no bundle is emitted;
- one wrong-revision collection case;
- one tampered payload/report/artifact case;
- one noncanonical JSON case;
- one maximum-boundary case and one over-bound case;
- one privacy case proving actor/token/header/PR data absence;
- one assertion case proving a claimed trusted root remains non-authoritative.

Documentation must say that hashes are not signatures, settings are not atomic,
replay is historical, source may be sensitive, and audit is not readiness. README
examples are added only after commands exist and pass smoke tests.

Exit: schema/runtime/package/docs parity tests pass and generated/bundled artifacts
contain only intended changes. LUNA MAX review covers public compatibility and
claims accuracy.

## Phase 6 — ReviewReady dogfood evidence

From a trusted checkout and read-only authenticated API access:

1. identify the exact remote default-branch SHA to audit;
2. collect one canonical bundle without printing credentials;
3. validate the schema and canonical bytes;
4. replay it offline in a network-disabled process;
5. require byte-identical canonical report and identical exit class;
6. manually inspect the exact decoded artifacts before any project-owned
   publication, without treating this review as a collector guarantee;
7. record exact source commit, bundle SHA-256, command versions, and findings;
8. do not change settings to improve the result.

A fail or incomplete report is preserved and explained. Publicly committing the
bundle is permitted only if its retained source was public at the exact revision,
the non-source privacy projection contains no forbidden field, and a human has
reviewed the exact decoded artifacts. No self-use adoption claim is made.

Exit: #55 acceptance evidence is reproducible from the saved bundle. This phase
does not close #55 until final review and all gates pass.

## Phase 7 — final gates and promotion

Run, in order:

1. focused canonical, bundle, collector, API, CLI, schema, package, and dogfood
   tests;
2. `npm run check`;
3. `git diff --check`;
4. generated declaration, package tarball, and Action bundle diff inspection;
5. offline clean-room bundle replay;
6. two independent LUNA MAX adversarial reviews with explicit P0/P1/P2 verdicts.

Any valid P0/P1/P2 returns work to the owning phase, adds a regression first, and
repeats the focused/full/review gates. Reviewers must be given time to finish and
closed only after their reports are integrated.

Node exit required one reproducible bundle, matching live/offline results,
compatible public schemas, complete local gates, and no open valid P0/P1/P2 in
the TA-2 scope. Those gates are satisfied by the current-main run above. The
preserved incomplete audit result is part of the evidence, not a failed
acceptance gate. #55 may close as the completed evidence-mechanism node; TA-3-D
remains a separate design gate. No npm or GitHub release is part of TA-2.

## Stop condition for this implementation session

ADR 0009, the normative v1 contract, the threat model, this plan, and the
current-main evidence artifact are the complete decision record for TA-2. The
node is closed. Trusted-root/GitHub App/provider authority design in #56 is the
next absolute decision gate; implementation must stop there.
