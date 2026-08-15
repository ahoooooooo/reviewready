# ReviewReady audit evidence bundle v1 contract

- Status: normative frozen contract; executable schema and implementation
  complete; v2 semantic extension is documented separately
- Publication: included in the published
  `@ahoooooo/reviewready@1.0.8` package
- Date: 2026-08-14
- Governing ADR: [ADR 0009](adr/0009-replayable-audit-evidence-bundle.md)

This contract is intentionally unchanged. Ruleset review/status semantics that
were not representable here are now covered by the versioned
[v2 extension](audit-evidence-bundle-v2.md); they must never be inserted into a
v1 bundle or silently discarded.

This document freezes the exact v1 field, state, canonicalization, hydration, and
resource contract before implementation. `reviewready.audit-evidence.schema.json`
must implement this document without widening it. Every object is closed:
unknown properties are invalid. Every property shown below is required unless a
conditional shape explicitly says otherwise.

## Top-level shape

```text
AuditEvidenceBundleV1 {
  bundleVersion: 1
  canonicalization: "RFC8785"
  subject: SubjectV1
  collection: CollectionV1
  assertions: AssertionsV1
  snapshot: AuditEvidenceSnapshotV1
  artifacts: ArtifactsV1
  report: AuditReportV1
  integrity: IntegrityV1
}
```

The canonical file is the RFC 8785 serialization of this entire object. It is
UTF-8 with no BOM, insignificant whitespace, or trailing newline. Replay rejects
an input whose raw bytes are not exactly that serialization.

## Primitive contracts

| Name             | Contract                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `Sha1`           | 40 lowercase hexadecimal characters                                                                                                     |
| `Sha256`         | 64 lowercase hexadecimal characters                                                                                                     |
| `SafeId`         | JSON integer from 1 through `Number.MAX_SAFE_INTEGER`                                                                                   |
| `Count`          | JSON integer from 0 through the field's documented maximum                                                                              |
| `BoundedText`    | 1-512 Unicode scalar values, valid UTF-8, no control, format, surrogate, U+2028, or U+2029 characters                                   |
| `RepositoryPath` | `BoundedText`, repository-relative POSIX path, no backslash, absolute prefix, drive prefix, empty segment, `.` segment, or `..` segment |
| `WorkflowPath`   | `RepositoryPath` under `.github/workflows/`, with no nested directory, ending in `.yml` or `.yaml` case-insensitively                   |
| `ObservedAt`     | exactly `YYYY-MM-DDTHH:mm:ss.sssZ`, a real UTC date/time                                                                                |
| `ApiVersion`     | the single supported value `2026-03-10` in bundle v1                                                                                    |
| `Base64url`      | canonical RFC 4648 base64url using `[A-Za-z0-9_-]`, without `=` padding                                                                 |
| `OwnerType`      | exactly `organization` or `user`                                                                                                        |

SHA ingress accepts exactly 40 ASCII hexadecimal characters in either case and
immediately normalizes them to lowercase. Branch names, tags, abbreviated SHAs,
whitespace, prefixes, and other revision spellings are rejected.

All numeric fields must be syntactic JSON integers, finite, safe, and not `-0`.
No schema field accepts a fraction or exponent notation even when it would
evaluate to an integer.

## SubjectV1

| Field                    | Type and invariant                                                 |
| ------------------------ | ------------------------------------------------------------------ |
| `repositoryId`           | `SafeId`; equal in both repository observations                    |
| `owner`                  | ASCII GitHub owner returned by the API, 1-100 characters           |
| `name`                   | ASCII GitHub repository name returned by the API, 1-100 characters |
| `ownerType`              | `OwnerType`                                                        |
| `visibility`             | exactly `public`, `private`, or `internal`                         |
| `defaultBranch`          | `BoundedText`                                                      |
| `requestedBaseSha`       | `Sha1`                                                             |
| `observedBaseShaAtStart` | `Sha1`; equal to `requestedBaseSha`                                |
| `observedBaseShaAtEnd`   | `Sha1`; equal to `requestedBaseSha`                                |

The two observed SHA fields mean only that the branch resolved to the requested
SHA at the two named observations. They do not claim that the branch continuously
pointed to that SHA between observations; branch-head ABA is an accepted residual.
Repository ID, canonical owner/name, owner type, visibility, and default branch
must also be identical in the start and end repository observations. Subject
equality is exact field-by-field equality across every field in this table.
The repository API's exact wire owner type `Organization` normalizes to
`organization`, and `User` normalizes to `user`; a missing or other owner type
prevents bundle output.
`SubjectV1` identifies only the repository and requested/observed revision. It is
not a key for the complete evidence bundle. Two bundles are equal only when their
validated canonical bytes are equal; consumers comparing collection targets must
also include `collection.apiVersion`, every assertion, and every verified
artifact path/revision/digest rather than keying by `SubjectV1` alone.

## CollectionV1

| Field             | Type and invariant                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `apiVersion`      | `ApiVersion`                                                                                                          |
| `consistency`     | exactly `stable-double-observation-v1`                                                                                |
| `observedAt`      | `ObservedAt`; exact UTC millisecond timestamp with a real calendar date; informational local wall-clock claim         |
| `durationMs`      | integer 0-120000 measured with the monotonic deadline clock                                                           |
| `status`          | `complete` or `incomplete`                                                                                            |
| `missing`         | sorted unique array of the closed codes below, maximum 1                                                              |
| `requestAttempts` | integer 0-768; every attempted GitHub request, including identity, settings, artifact, page-probe, and retry attempts |
| `retryAttempts`   | integer 0-`requestAttempts`; every attempt after the first for one request operation                                  |
| `bounds`          | `CollectionBoundsV1` containing exactly the fixed values below                                                        |

`missing` accepts only:

- `settings-authority-incomplete`: both rounds agree, but an explicitly modeled
  authoritative setting is unavailable or reported unknown;
- `settings-observation-mismatch`: both rounds are individually complete and
  strict, but their normalized mutable facts differ.

These two strings are the complete `CollectionMissingCode` enum for v1.

At most one missing code can be present in v1; the two codes are mutually
exclusive because they describe different conservative projections. `status:
complete` requires an empty `missing` array. `status: incomplete` requires
exactly one missing code. `snapshot.completeness` must have the same boolean and
exact same missing array.

When `status: complete`, the snapshot must contain an existing
`branchProtection` fact with known review-bypass authority, and the derived
report must be `pass` or `fail`. When `status: incomplete`, the derived report
must be `incomplete`; a complete collection never wraps an incomplete audit
classification.

`CollectionBoundsV1` contains these exact integer fields and values:

| Field                  |   Value |
| ---------------------- | ------: |
| `bundleBytes`          | 8388608 |
| `aggregateSourceBytes` | 4194304 |
| `sourceFileBytes`      |  262144 |
| `workflows`            |     100 |
| `rulesets`             |     100 |
| `findings`             |     500 |
| `requestAttempts`      |     768 |
| `pagesPerCollection`   |      10 |
| `itemsPerPage`         |     100 |
| `responseBytes`        | 2097152 |
| `retriesPerRequest`    |       1 |
| `deadlineMs`           |  120000 |
| `concurrency`          |       4 |
| `jsonDepth`            |      32 |
| `jsonObjectMembers`    |   20000 |
| `jsonArrayElements`    |   20000 |
| `jsonTokens`           |  100000 |
| `jsonStringBytes`      | 6291456 |
| `jsonNumberChars`      |      32 |

The current maximum shape needs approximately 315 first attempts: two 106-read
settings rounds plus 103 identity/artifact/list reads. Retrying every operation
needs approximately 630 attempts. The 768-attempt budget covers that case with
bounded headroom. Every attempt is charged before I/O. The overall deadline can
still end collection earlier and fail closed.

## AssertionsV1

| Field                    | Type and invariant                                 |
| ------------------------ | -------------------------------------------------- |
| `policyPath`             | `RepositoryPath`                                   |
| `protectedWorkflowPaths` | sorted unique array of 0-100 `WorkflowPath` values |
| `trustedWorkflowPaths`   | sorted unique array of 0-100 `WorkflowPath` values |

Every workflow assertion must name one saved workflow artifact. Assertions are
caller claims only. They are never copied into authoritative workflow booleans,
never remove a finding, and never change collection completeness.

## AuditEvidenceSnapshotV1

This is a distinct source-free evidence projection. It is not the existing
`AuditSnapshot` accepted by legacy `reviewready audit --input`.

```text
AuditEvidenceSnapshotV1 {
  snapshotVersion: 1
  repository: {
    owner: BoundedText
    name: BoundedText
    defaultBranch: BoundedText
  }
  baseRevision: {
    sha: Sha1
    policyPath: RepositoryPath
    policyRevisionSha: Sha1
    policySha256: Sha256
    policyLoadedFromBase: true
  }
  policy: {
    requiredChecks: CheckEvidenceV1[0..100]
    workflowPaths: WorkflowPath[0..100]
  }
  completeness: {
    complete: boolean
  missing: CollectionMissingCode[0..1]
  }
  branchProtection: BranchProtectionEvidenceV1 | null
  rulesets: RulesetEvidenceV1[0..100]
  tagProtection: {
    known: boolean
    allowsDeletion: boolean
    allowsUpdate: boolean
  }
  workflows: WorkflowEvidenceV1[0..100]
}
```

Repository and base-revision values must equal `subject` and `assertions`.
`policyRevisionSha` and every workflow revision equal `requestedBaseSha`.
`policyLoadedFromBase` is always true in an emitted bundle. `policySha256` equals
the saved policy artifact digest.

### CheckEvidenceV1

A check has exactly one of these closed shapes:

```text
{ name: BoundedText }
{ name: BoundedText, appId: integer 1-2147483647 }
{ name: BoundedText, appSlug: BoundedText }
```

`appId` and `appSlug` are mutually exclusive. App slugs are canonical lowercase.

### Bypass summaries

`BranchBypassSummaryV1` is:

```text
{ actorType: "app" | "team" | "user", count: integer 1-100 }
```

`RulesetBypassSummaryV1` is:

```text
{
  actorType: "deploy_key" | "integration" | "organization_admin" |
             "repository_role" | "team" | "user",
  bypassMode: "always" | "exempt" | "pull_request",
  count: integer 1-100
}
```

The total count in each summary array is at most 100. V1 freezes the following
wire-to-summary matrix for GitHub REST API version `2026-03-10`; no external or
newer API interpretation widens it:

| Wire `actor_type`   | Persisted `actorType` | Allowed subject owner | Required wire `actor_id`                     | `branch` modes                     | `tag`, `push`, `repository` modes | Normalized identity before redaction | Count in one summary |
| ------------------- | --------------------- | --------------------- | -------------------------------------------- | ---------------------------------- | --------------------------------- | ------------------------------------ | -------------------- |
| `Integration`       | `integration`         | either                | present positive `SafeId`                    | `always`, `exempt`, `pull_request` | `always`, `exempt`                | `(integration, actor_id)`            | 1-100                |
| `OrganizationAdmin` | `organization_admin`  | `organization` only   | present `null` or positive `SafeId`; ignored | `always`, `exempt`, `pull_request` | `always`, `exempt`                | singleton `organization_admin`       | exactly 1            |
| `RepositoryRole`    | `repository_role`     | either                | present positive `SafeId`                    | `always`, `exempt`, `pull_request` | `always`, `exempt`                | `(repository_role, actor_id)`        | 1-100                |
| `Team`              | `team`                | either                | present positive `SafeId`                    | `always`, `exempt`, `pull_request` | `always`, `exempt`                | `(team, actor_id)`                   | 1-100                |
| `DeployKey`         | `deploy_key`          | either                | present `null`                               | `always`, `exempt`                 | `always`, `exempt`                | singleton `deploy_key`               | exactly 1            |
| `User`              | `user`                | either                | present positive `SafeId`                    | `always`, `exempt`, `pull_request` | `always`, `exempt`                | `(user, actor_id)`                   | 1-100                |

`actor_type`, `actor_id`, and `bypass_mode` must all be present. Wire actor types
use the exact documented spelling above; aliases and case folding are invalid.
`bypass_mode` is part of the compared fact and uses the exact lowercase spelling
shown. `pull_request` is valid only for a branch target and never for
`DeployKey`. `OrganizationAdmin` on a user-owned repository is invalid. Its
documented ignored ID is discarded before comparison; `DeployKey` requires null.

Within one ruleset, each normalized identity may occur once total. Repeating it
with the same or a different mode is contradictory and prevents a bundle. The
two rounds compare the sorted set `(normalized identity, bypass_mode)` before
redaction. Summary counts group the remaining unique identities by persisted
`actorType` and `bypassMode`; singleton rows therefore always have count 1.

Branch-protection bypass entries are separate: exact wire users, teams, and Apps
each require a present positive `SafeId`, are unique by `(actorType, id)`, and
have no bypass mode. Missing, contradictory, duplicate, or unsupported actor
data prevents a bundle; actor type alone never substitutes for a required ID.

After both rounds compare equal, stable IDs are discarded and only the summaries
are persisted. Hydration expands summaries into deterministic redacted internal
placeholders because the v1 classifier uses presence only. Outside exact source
artifacts, no persisted string contains a GitHub actor ID, name, login, slug,
email, or URL.

The placeholder ID is exactly
`redacted:<actorType>:<mode-or-branch>:<one-based-index>`. Indices are assigned
after the summary array is canonically sorted and expanded. Branch summaries use
literal mode `branch`. Hydration maps `user` to internal `user`, `team` to
internal `team`, `integration` to internal `integration`, and every other actor
type to internal `app`.

### BranchProtectionEvidenceV1

```text
BranchProtectionEvidenceV1 {
  branch: BoundedText
  exists: boolean
  enforceAdmins: boolean
  allowForcePushes: boolean
  allowDeletions: boolean
  requiredStatusChecks: null | {
    strict: boolean
    checks: CheckEvidenceV1[0..100]
  }
  requiredPullRequestReviews: null | {
    requiredApprovingReviewCount: integer 0..100
    bypassActorsKnown: boolean
    bypassActorSummaries: BranchBypassSummaryV1[0..100]
  }
}
```

The branch equals `subject.defaultBranch`. When review bypass facts are hidden or
redacted, `bypassActorsKnown` is false and collection is incomplete. An absent
branch-protection object is represented by top-level null, not an object with
invented booleans.

### RulesetEvidenceV1

```text
RulesetEvidenceV1 {
  id: SafeId
  name: BoundedText
  target: "branch" | "tag" | "push" | "repository"
  refPatterns: BoundedText[0..100]
  repositoryPatterns?: BoundedText[1..100]
  enforcement: "active" | "disabled" | "evaluate"
  bypassActorsKnown: boolean
  bypassActorSummaries: RulesetBypassSummaryV1[0..100]
  allowForcePushes?: boolean
  allowDeletions?: boolean
  requiredChecks: CheckEvidenceV1[0..100]
}
```

Target-specific invariants remain those in ADR 0002 and the current strict audit
schema. Branch/tag targets require non-empty ref patterns and both branch-control
booleans. Push/repository targets require empty ref patterns and omit both branch
controls. Repository targets require `repositoryPatterns` and cannot use evaluate
enforcement. Other targets may carry `repositoryPatterns` only when the API
provides an explicitly modeled parent repository scope. `repositoryPatterns` is
otherwise absent, never an empty substitute. Unknown conditions, exclusions,
nested fields, or unsupported scopes prevent a bundle rather than being dropped.

`bypassActorsKnown: false` makes collection incomplete. The summary total is at
most 100.

### Policy, completeness, and tag facts

`policy.requiredChecks` contains 0-100 `CheckEvidenceV1` values derived only by
parsing the exact policy artifact. `policy.workflowPaths` is the sorted exact path
set of saved workflow artifacts; despite its legacy field name, it is not derived
from policy YAML. Replay verifies these two origins independently.

`completeness` contains required `complete: boolean` and `missing`, whose values
must exactly equal `collection.status`/`collection.missing` as defined above.

`tagProtection` always has exactly three booleans: `known`, `allowsDeletion`, and
`allowsUpdate`. `known: false` is an authority-incomplete fact and cannot coexist
with `collection.status: complete`. The synthetic `known: false` used only by the
conservative mismatch projection does not add
`settings-authority-incomplete`; the mismatch code already states why those
mutable facts were discarded.

### WorkflowEvidenceV1

```text
{
  path: WorkflowPath
  revisionSha: Sha1
  artifactSha256: Sha256
  protectedFromPullRequest: false
  trustedRoot: false
}
```

Both booleans are constant false in bundle v1 because TA-2 has no independent
authority that can prove either fact. Caller assertions remain separate. A
future authenticated authority requires a new evidence-bundle version or an
explicitly reviewed contract extension; it cannot change these constants.

### Conservative incomplete projection

An incomplete bundle is permitted only after the exact subject and every policy
and workflow artifact are successfully established.

- For `settings-authority-incomplete`, retain the two equal normalized setting
  facts, set snapshot completeness false, and preserve explicit known=false
  fields.
- For `settings-observation-mismatch`, use neither round's mutable facts:
  `branchProtection` is null, `rulesets` is empty, and tag protection is
  `{ known: false, allowsDeletion: true, allowsUpdate: true }`.
- Policy and workflow facts are reconstructed from exact artifacts in both
  incomplete states. Workflow authority booleans remain false.
- The derived report must be `incomplete`.

No bundle is emitted when repository identity, either branch-head observation,
policy/workflow artifact completeness, strict UTF-8, parser/schema validity,
transport bounds, pagination identity/completeness, deadline, or final 8 MiB
output bound fails. Zero SHAs, `unknown` subject placeholders, empty substitute
artifacts, and a saved-report fallback are forbidden.

## ArtifactsV1

```text
ArtifactsV1 {
  policy: SourceArtifactV1
  workflows: SourceArtifactV1[]
}

SourceArtifactV1 {
  path: RepositoryPath
  revisionSha: Sha1
  sha256: Sha256
  byteLength: integer 0-262144
  contentBase64url: Base64url
}
```

The policy artifact path equals `assertions.policyPath`, has byteLength at least
1, and parses as the supported policy. Workflow artifacts use `WorkflowPath` and
may be empty. Every artifact revision equals `subject.requestedBaseSha`.

Base64url decoding must consume the entire string, re-encode to the identical
string, match `byteLength`, match SHA-256 over decoded bytes, and decode with a
fatal UTF-8 decoder. Aggregate decoded bytes are at most 4 MiB. Artifact paths
are unique. Workflow artifacts and snapshot workflows form an exact one-to-one
path/digest mapping.

Exact source artifacts are an explicit exception to the non-source privacy
projection. They may contain arbitrary committed text, including names, emails,
URLs, or strings that resemble credentials. Collection and replay must not scan,
redact, or rewrite those bytes: doing so would break the revision/digest binding
and source-complete replay. The entire bundle is therefore sensitive output even
for a public repository. Project-owned publication requires a separate human
review of the exact decoded artifacts; that review is not a collector claim.

The policy is parsed again during replay. Its canonical derived required checks
must exactly equal `snapshot.policy.requiredChecks`. The exact workflow artifact
path set must equal `snapshot.policy.workflowPaths`.

## Report and hydration

`report` must conform exactly to `reviewready.audit.schema.json` and may contain
only `auditVersion: 1`. Replay never treats it as input to classification.
The collection/report state machine is strict: complete collections use only
`pass` or `fail`, while incomplete collections use `incomplete`.

Hydration is the only bridge from `AuditEvidenceSnapshotV1` to the existing
internal `AuditSnapshot`:

1. verify every field and digest described above;
2. replace `snapshotVersion` with internal `version: 1`;
3. attach each decoded workflow artifact as the matching workflow `source`;
4. expand bypass summaries to deterministic redacted placeholders;
5. keep workflow authority booleans false;
6. parse policy and require its derived checks to equal the snapshot, and require
   the workflow artifact path set to equal the saved workflow paths;
7. run `auditRepository` on the hydrated value;
8. require the canonical recomputed report to equal the saved report.

There is no precedence rule between duplicate saved source fields because source
exists only in artifacts. A missing, extra, or mismatched artifact exits 2.

## IntegrityV1

```text
IntegrityV1 {
  algorithm: "sha256"
  snapshotSha256: Sha256
  reportSha256: Sha256
  payloadSha256: Sha256
}
```

The exact domains and inputs are those in ADR 0009. `payloadSha256` covers the
entire top-level object except `integrity`, including every source artifact.
These hashes provide integrity only, not producer authentication.

## Array normalization table

RFC 8785 does not reorder arrays. Before JCS, v1 applies these exact rules:

| Array                                        | Rule                                                                                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collection.missing`                         | unique; raw UTF-16 ascending                                                                                                                         |
| assertion workflow paths                     | unique; normalized path, raw UTF-16 ascending                                                                                                        |
| every check array                            | unique; tuple `(name, providerKind, providerValue)` where providerKind is `0=none, 1=appId, 2=appSlug`; strings use raw UTF-16 and App ID is numeric |
| `policy.workflowPaths`                       | unique; normalized path, raw UTF-16 ascending                                                                                                        |
| every bypass summary array                   | unique actorType/mode tuple; actorType then mode raw UTF-16 ascending                                                                                |
| `rulesets`                                   | unique numeric ID; ascending ID                                                                                                                      |
| every `refPatterns` and `repositoryPatterns` | unique; raw UTF-16 ascending; no locale collation                                                                                                    |
| `snapshot.workflows`                         | unique normalized path; raw UTF-16 ascending                                                                                                         |
| `artifacts.workflows`                        | unique normalized path; raw UTF-16 ascending                                                                                                         |
| `report.findings`                            | `(code, path-or-empty, line-or-zero, severity, message, category)`, strings in raw UTF-16 ascending and line numeric                                 |
| `report.checked`                             | fixed exact order: `base-revision`, `branch-protection`, `rulesets`, `tag-protection`, `workflows`                                                   |

API-originated duplicate identities or paths are invalid and are not silently
deduplicated. Policy-derived equivalent requirements retain the existing
deterministic semantic deduplication before this table is applied.

## Strict parser and raw I/O

Replay uses a dedicated raw-byte regular-file reader with the 8 MiB bound. The
legacy 4 MiB decoded text reader and legacy CLI output behavior remain unchanged.
The bundle reader rejects symlinks, devices, directories, size races, BOM,
invalid UTF-8, and a changed file identity during the bounded read.
Embedded policy and workflow source artifacts preserve a valid UTF-8 BOM as
part of their exact bytes and decoded text; the BOM rejection above applies to
the outer bundle file.

Before allocating unbounded structures, the duplicate-aware JSON parser enforces
the `CollectionBoundsV1` depth, total object-member, total array-element, token,
and decoded-string-byte limits. It rejects duplicate decoded names at every
object level, lone surrogates, non-I-JSON values, overlong number tokens, and
unsafe/non-integer schema numbers. A depth-guarded or iterative implementation is
required; stack overflow is not a public error path.

The root object has depth 1 and each nested object or array adds 1. String bytes
mean decoded UTF-8 bytes. Number characters are counted from the first optional
minus through the last numeric grammar character before numeric conversion.

The lexical `jsonTokens` count assigns one token to each `{`, `}`, `[`, `]`, `:`,
and `,`; one token to each complete JSON string (including an object member
name), number, `true`, `false`, or `null`; and zero tokens to whitespace and EOF.
Quotes, escapes, Unicode escape components, signs, digits, decimal points, and
exponent characters are parts of their enclosing token and are not counted
separately. The parser charges a token when its complete lexical form is
recognized and rejects the input before accepting a token that would raise the
count above 100000. Malformed tokens are invalid regardless of the count.

Collection uses a dedicated raw stdout sink that performs one write of the fully
built canonical bytes and adds no newline. Existing text/report sinks continue
their historical newline behavior.

## Pagination identity

Every `Link` continuation is untrusted. A continuation URL must resolve against
the configured GitHub API base and retain the exact scheme, authority, path,
non-page query parameters, page size, and collection identity of the current
request. Userinfo, fragment, duplicate parameters, path changes, repository
changes, endpoint changes, non-HTTPS GitHub.com URLs, and non-contiguous page
numbers are invalid. Only the single `page` value may advance by exactly one.

An absent valid continuation still uses the existing bounded empty-page probe.
The probe is charged to the same collection budget. A continuation for another
endpoint can never be reduced to a page number and treated as evidence that the
current endpoint is complete.

## Output state machine

| State                                                                                            | Bundle stdout               |       Exit | Required behavior                                                                              |
| ------------------------------------------------------------------------------------------------ | --------------------------- | ---------: | ---------------------------------------------------------------------------------------------- |
| invalid caller identity/path/revision                                                            | none                        |          2 | stable redacted CLI error; no API request when validation can reject locally                   |
| identity, branch observation, artifact, transport, pagination, deadline, parser, or size failure | none                        |          2 | never manufacture a subject or artifact                                                        |
| two strict rounds disagree, subject/artifacts complete                                           | canonical incomplete bundle |          2 | conservative mismatch projection and recomputed incomplete report                              |
| equal rounds contain explicit known=false authority fact, subject/artifacts complete             | canonical incomplete bundle |          2 | retain equal facts and recomputed incomplete report                                            |
| complete equal rounds with audit findings                                                        | canonical complete bundle   |          1 | report status `fail`                                                                           |
| complete equal rounds with unsupported audit semantics                                           | no bundle stdout            |          2 | fail closed; no v1 bundle until the unsupported semantics have a reviewed versioned projection |
| complete equal rounds without findings                                                           | canonical complete bundle   |          0 | report status `pass`                                                                           |
| replay integrity/schema/reconstruction/report mismatch                                           | no report stdout            |          2 | stable redacted error; saved report is not rendered                                            |
| valid replay                                                                                     | recomputed report only      | 0, 1, or 2 | exact recomputed report exit class                                                             |

No state writes GitHub, repository settings, checks, releases, tags, issues,
telemetry, caches, or a ReviewReady-owned durable store.

## Compatibility and versioning

The executable JSON Schema must use Draft 2020-12, `additionalProperties: false`
at every object, and conditional schemas matching this document. It covers every
structural and cross-field invariant expressible in Draft 2020-12. The runtime
validator additionally enforces semantic array identity/order, aggregate bypass
counts, and numeric relationships that the standard has no general keyword for;
the schema `$comment` fields mark those boundaries. Schema-only validation is
therefore not a complete bundle-acceptance decision: callers must run the
canonical runtime validator before replay or trust.

A field addition, enum widening, optionality change, comparator change, digest
domain change, hydration change, or canonical byte change requires a new bundle
version. The legacy normalized audit input and both existing public report
schemas remain unchanged. Unknown bundle or audit versions exit 2.
