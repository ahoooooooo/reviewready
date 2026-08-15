# ADR 0009: Replayable repository-audit evidence bundle

- Status: accepted; v1 frozen, v2 semantic extension governed by ADR 0010, final dogfood/review gate pending
- Date: 2026-08-13

## Context

Before TA-2, the live repository-audit collector built a bounded normalized
snapshot and the offline audit engine evaluated a supplied snapshot, but the
two paths did not produce or consume one public, replayable evidence artifact.
The existing audit-report schema remains separate from source evidence, and the
checked-in audit fixture remains synthetic.

TA-2 requires an exact-revision dogfood artifact whose saved bytes can be
replayed offline. That artifact must not change the v1 readiness result, turn an
audit result into a merge decision, infer a trusted root from caller input, or
claim that several GitHub REST reads form a transaction.

GitHub exposes repository metadata, branch protection, rulesets, tag protection,
and repository contents through separate endpoints. Conditional requests can
show that one endpoint representation did not change, but GitHub documents no
cross-endpoint atomic snapshot. Repository content can be requested with a
commit SHA through the `ref` parameter. The design therefore separates exact
revision binding for source from a bounded stability observation for mutable
settings.

## Decision

### 1. Keep three public contracts separate

TA-2 adds `AuditEvidenceBundleV1` as a new public contract and schema. It does
not add fields to either existing public contract:

- `reviewready.result.schema.json` remains the v1 pull-request readiness result;
- `reviewready.audit.schema.json` remains the version 1 audit report;
- `reviewready.audit-evidence.schema.json` describes the new evidence bundle.

The exact required fields, conditional shapes, enums, missing-code vocabulary,
comparators, parser bounds, hydration rules, and output states are frozen in the
[bundle v1 contract](../audit-evidence-bundle-v1.md). The executable Draft
2020-12 schema must match that contract exactly; this ADR is not permission to
invent a second v1 shape during implementation.

An evidence bundle is historical audit evidence. It is not a readiness input,
approval, signature, current-state guarantee, or trusted-provider credential.

The implementation adds explicit collection and replay modes while keeping
the existing `reviewready audit --github ...` and `reviewready audit --input ...`
forms compatible:

```text
reviewready audit collect --github OWNER/REPOSITORY --revision FULL_SHA ...
reviewready audit replay --bundle PATH [--json | --sarif]
```

Collection uses a dedicated raw stdout sink to write one canonical bundle with
no trailing newline and performs no repository or GitHub mutation. Replay uses a
dedicated bounded raw-byte regular-file reader rather than the legacy 4 MiB text
reader. Existing CLI text/report sinks and file limits remain compatible. A
caller may redirect standard output to a file; ReviewReady does not upload or
retain it.

### 2. Bind one explicit subject

Live evidence collection requires a caller-supplied, full 40-hex commit SHA.
ASCII uppercase hex is accepted at ingress and immediately normalized to
lowercase. Branch names, tags, abbreviated SHAs, prefixes, whitespace, and an
omitted revision are rejected before API collection. Every persisted SHA is
lowercase.

The bundle-level integrity binding covers all of the following:

- immutable numeric repository ID;
- canonical owner and repository name returned by GitHub;
- repository owner type, visibility, and default branch;
- caller-requested base SHA and separate start/end observed base SHAs;
- normalized policy path;
- every policy and workflow artifact revision and SHA-256 digest;
- the GitHub REST API version used by the collector.

`SubjectV1` itself contains only the repository/revision fields in the first four
bullets. Policy path, artifact identities, and API version remain in their
normative top-level sections. Subject equality is exact field-by-field equality;
it must not be used as a complete bundle key. Complete bundle equality means
equality of validated canonical bytes, while collection-target comparisons also
include the API version, assertions, and verified artifact identities.

The default branch must resolve to the requested SHA at the beginning and end of
collection. These are two observations, not a claim that the branch continuously
held that value; branch-head ABA is an explicit residual. Policy and workflow
bytes are fetched with that exact SHA as `ref`. Any repository-ID,
canonical-name, owner-type, visibility, default-branch, or branch-head mismatch
prevents bundle output. A historical commit that is not the default-branch head
at both observations is not accepted by this TA-2 mode.

### 3. Use stable double observation, not an atomicity claim

Mutable repository settings are collected in two complete rounds around the
immutable source reads:

1. resolve repository identity and the default-branch head;
2. collect and normalize branch protection, every bounded ruleset page and
   detail, tag protection, and other modeled mutable settings (round A);
3. read policy and workflow artifacts at the explicit immutable SHA;
4. repeat the complete mutable-settings collection (round B);
5. resolve repository identity and the default-branch head again;
6. require the normalized round-A and round-B settings to be identical.

The entire collection shares one 768-attempt request budget covering identity
anchors, both settings rounds, artifact reads, empty-page probes, and retries,
plus the fixed page, response-size, concurrency, source-size, count, and deadline
bounds. A strict round mismatch may produce the conservative incomplete bundle
defined by the v1 contract. Identity, revision, artifact, transport, unsupported
shape, pagination, over-limit, or deadline failures produce no bundle and exit 2.

Endpoint ETags may optimize round B. A `304 Not Modified` reuses only the exact
bounded representation cached for that same request. Missing ETags fall back to
a full second read. ETags are never treated as a cross-endpoint transaction or
as provenance. Every pagination continuation must retain the configured API
origin, endpoint/repository path, and non-page query identity; only a contiguous
page number may change.

The v1 normalized ruleset projection is intentionally closed. A GitHub ruleset
`pull_request` rule, or additional `required_status_checks` parameters such as
`strict_required_status_checks_policy` and `do_not_enforce_on_create`, carries
review or enforcement semantics that this snapshot and bundle do not preserve.
The collector rejects those shapes with a stable unsupported-semantics failure;
it must not accept them and discard the fields, and it must not emit a complete
bundle. Modeling the currently supported subset is governed by the separately
reviewed [ADR 0010](0010-ruleset-semantics-evidence-v2.md) and
[v2 extension](../audit-evidence-bundle-v2.md). Repository Actions permission
settings are likewise outside the v1
bundle projection; TA-2 must not describe `allowed_actions`, SHA pinning, or
workflow token permissions as evidence in this bundle.

The bundle records `stable-double-observation-v1` as the consistency method. It
must never use the words atomic, transactional, or point-in-time for GitHub
settings. Equal rounds cannot exclude a change-and-revert (ABA) between reads;
that residual limitation is documented and does not affect the exact immutable
source binding.

### 4. Define a source-complete, privacy-minimized bundle

The strict top-level bundle contains:

- `bundleVersion` and canonicalization identifier;
- `subject` with repository and exact-revision identity;
- `collection` with API version, observation window, consistency method, actual
  request counters, configured bounds, completeness, and stable missing codes;
- `assertions` with the caller-supplied policy path and candidate protected or
  trusted workflow paths;
- `snapshot` as the distinct `AuditEvidenceSnapshotV1` source-free projection;
- `artifacts` with the policy and workflow bytes needed to reconstruct and
  independently evaluate the snapshot;
- `report` conforming exactly to `reviewready.audit.schema.json`;
- `integrity` with domain-separated snapshot, report, and payload digests.

Policy and workflow bytes are stored as canonical unpadded base64url with a
SHA-256 digest over the original bytes. Decoding must be canonical and strict
UTF-8; bytes are never newline- or Unicode-normalized. Artifacts are restricted
to the normalized policy path and observed `.github/workflows/*.yml` or
`.github/workflows/*.yaml` files at the subject SHA. Policy source is retained
because replay must prove that derived policy facts came from the saved bytes.
Workflow source is retained because the deterministic analyzer must be rerun,
not trusted as a saved conclusion.

Replay hydrates the existing internal `AuditSnapshot` only after artifact
verification: it attaches each exact workflow source once, expands redacted
bypass summaries into deterministic placeholders, reparses policy facts, and
keeps workflow protection/trust booleans false. Source never appears in both the
snapshot and artifacts, so there is no precedence ambiguity.

Outside exact source artifacts, raw GitHub responses, response headers, request
IDs, URLs, tokens, secrets from the caller environment, PR bodies, issue or
review payloads, actor names, logins, emails, and arbitrary metadata are
forbidden. Bypass identities and bypass modes are compared internally between
rounds, then projected to deterministic type/mode/count summaries because the v1
audit classification uses presence, not identity. User, team, integration,
repository-role, and branch-bypass records require stable positive IDs; only
GitHub-documented singleton actor types may use a null ID. Actor type alone never
substitutes for a required identity.

Exact policy and workflow artifacts may contain arbitrary committed text,
including names, emails, URLs, or credential-like strings. ReviewReady must not
scan, redact, or rewrite those bytes because that would invalidate source
binding and replay. A bundle is consequently sensitive output; a separate human
review of decoded source is required before project-owned publication.

Candidate protected and trusted workflow paths remain explicitly labeled caller
assertions. A caller assertion alone must not set an authoritative trust or
protection fact in the replay snapshot. Until an independent authority is
available, the report preserves the corresponding gap as a finding. The bundle
cannot launder `--trusted-workflow` into provider provenance.

Bundles containing private or internal repository source are sensitive local
artifacts. ReviewReady does not publish, log, cache, transmit, or retain a second
copy beyond caller-directed stdout. The collection timestamp is an informational
clock claim and does not establish freshness or authenticity. Public dogfood
evidence may be committed only after confirming that all retained source was
public at the bound revision and manually reviewing the exact decoded artifacts.

### 5. Canonicalize before hashing

Canonical JSON uses RFC 8785 JSON Canonicalization Scheme (JCS) after strict
schema validation and semantic normalization:

- duplicate object names, lone surrogates, non-I-JSON numbers, unknown fields,
  and unsafe integers are rejected before evaluation;
- object properties use RFC 8785 recursive UTF-16 code-unit ordering;
- JCS never reorders arrays, so every set-like array is sorted first by a
  contract-specific, locale-independent comparator;
- semantically ordered arrays retain their specified order;
- no Unicode normalization is performed;
- output is UTF-8 without BOM, insignificant whitespace, or trailing newline.

The v1 contract enumerates every array, including nested ruleset ref/repository
patterns and check/bypass arrays. API duplicates are rejected rather than
silently deduplicated. Rulesets use numeric ID order and paths use raw UTF-16
code-unit order. Findings use the total tuple
code/path/line/severity/message/category, adding category only as the final
tie-break to the existing order. `report.checked` retains its fixed semantic
order.

The integrity values are lowercase SHA-256 hex over these exact byte sequences:

```text
snapshotSha256 = SHA256("reviewready:audit-snapshot:v1\0" || JCS(snapshot))
reportSha256   = SHA256("reviewready:audit-report:v1\0"   || JCS(report))
payloadSha256  = SHA256("reviewready:audit-bundle:v1\0"  || JCS(bundle_without_integrity))
```

The NUL is one byte. Digests detect accidental or unanchored byte changes; they
do not authenticate the producer because an attacker can rewrite a bundle and
recompute its hashes. Authenticity belongs to a separately trusted Git commit,
release artifact, or future TA-3 signing identity.

### 6. Replay derives; it does not trust saved conclusions

Replay performs these steps in order:

1. use the dedicated reader to bound raw file bytes before decoding;
2. reject BOM, invalid UTF-8, duplicate names, invalid I-JSON, noncanonical input
   bytes, unsupported versions, and schema or semantic violations;
3. verify the payload and per-artifact digests;
4. decode policy/workflow artifacts and verify paths, revisions, and hashes;
5. parse the policy and reconstruct the normalized audit input;
6. require reconstructed facts to match the saved snapshot;
7. rerun the pure audit engine;
8. require canonical recomputed report bytes to equal the saved report;
9. render only the recomputed report and return its existing exit class.

Any failure before step 9 is invalid or incomplete evidence and exits 2 with a
stable redacted error. It never falls back to the saved report, contacts GitHub,
or upgrades an incomplete bundle. A valid replay returns 0, 1, or 2 exactly as
the recomputed report would, but remains historical evidence rather than a claim
about current repository state.

### 7. Version and resource rules are part of the contract

`bundleVersion: 1` is independent from `auditVersion: 1` and readiness
`outputVersion: 1`. Unknown versions fail closed. A change to canonical bytes,
digest domains, required fields, source projection, or replay semantics requires
a new bundle version. An output-affecting audit classification change requires
the audit contract to remain compatible or advance its own version.

Initial implementation bounds are fixed before coding:

- 8 MiB maximum canonical bundle bytes;
- 4 MiB maximum aggregate decoded policy and workflow source bytes;
- 256 KiB maximum per policy or workflow source;
- 100 workflow artifacts and 100 rulesets;
- 500 findings;
- 768 total GitHub request attempts across the entire collection;
- 10 pages per paginated collection, 100 items per page;
- 2 MiB maximum wire response per request;
- one retry per request and a 120-second total deadline;
- mutable-read concurrency no greater than 4;
- JSON depth 32, 20,000 total object members, 20,000 total array elements,
  100,000 tokens, 6 MiB decoded bytes for any one JSON string, and 32 characters
  per JSON number token.

The implementation may tighten a bound without changing classification only if
compatibility tests prove existing valid fixtures remain valid. Raising a bound
or changing completeness semantics requires explicit review.

## Consequences

TA-2 can produce an honest, replayable dogfood artifact without pretending that
GitHub settings were atomic or that a caller-supplied workflow root was trusted.
The bundle will be larger than the current report because policy and workflow
bytes are necessary for independent offline derivation. Strict canonical input
means pretty-printing, adding a newline, or reordering arrays invalidates the
saved artifact by design.

This ADR does not authorize a release, tag movement, GitHub artifact, or
trusted-provider deployment. The executable schema, parser, canonicalizer,
CLI modes, bounded live collector, replay path, focused tests, and local gates
are implemented under the TA-2 plan. A real dogfood bundle and the final
adversarial review remain promotion evidence, not assumptions in this ADR.

## References

- [RFC 8785: JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785)
- [GitHub REST conditional-request guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
- [GitHub repository contents API](https://docs.github.com/en/rest/repos/contents)
- [Repository audit contract](0002-repository-audit-contract.md)
- [Live repository audit collector](0005-live-repository-audit-collector.md)
- [TA-2 issue #55](https://github.com/ahoooooooo/reviewready/issues/55)
