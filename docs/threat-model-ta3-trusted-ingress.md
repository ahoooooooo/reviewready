# TA-3 trusted GitHub App ingress: threat model

- Status: accepted design for TA-3-D; provider-neutral TA-3-I local core implemented; production implementation deferred
- Governing decision: [ADR 0011](adr/0011-github-app-trusted-ingress.md)
- Scope: the direct GitHub App provider, its webhook ingress, durable
  evaluation state, and Check Run publication boundary

This model protects the meaning of a ReviewReady result. It does not claim that
GitHub settings, a hosting provider, a database, or a secret manager are
secure merely because this repository defines an interface for them.

## Security objectives

The implementation must preserve these invariants:

1. Only the configured App installation may create an accepted provider
   envelope for an allowlisted repository.
2. A changed, replayed, duplicated, conflicting, stale, incomplete, or
   ambiguous envelope cannot create a successful current result.
3. A result is bound to one repository, pull request, base/head pair, base
   policy bytes, provider identity, root generation, and evidence snapshot.
4. At most one worker owns a generation at a time, and a stale worker cannot
   overwrite a newer generation.
5. A remote Check Run is adopted only when its App, repository, head, fixed
   name, and external ID all match.
6. No trusted execution path checks out, imports, builds, caches, shells, or
   executes pull-request content.
7. Logs, storage, responses, and artifacts contain no secret, token, private
   key, raw PR body, review body, workflow source, prompt, or arbitrary payload
   metadata.
8. Unknown provider or storage behavior remains non-required and fail closed.

## Trust boundaries

| Boundary           | Trusted by the design                                                                              | Never trusted as authority                                          |
| ------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| App authentication | deployment-held App ID, private key, selected installation, token response checked against profile | payload installation ID, App slug, user token                       |
| Webhook            | exact raw body plus HMAC verified with configured secret                                           | parsed payload before verification, arbitrary headers, sender login |
| Repository         | immutable numeric ID and current API reread                                                        | owner/name casing, URL, PR-provided repository fields               |
| Revision           | current base/head snapshot and base-loaded policy digest                                           | head workflow or policy from the proposed revision                  |
| Provider result    | Check Run response with expected App ID and exact binding                                          | check display name, legacy status, workflow run name                |
| Persistence        | atomic durable store with explicit result                                                          | in-memory map, cache, timeout treated as success                    |
| Execution          | ReviewReady trusted build and pure engine                                                          | PR scripts, workflows, dependencies, artifacts, model output        |

## Attack and repair matrix

| ID  | Attack                                                       | Required deterministic repair                                                                                                | Residual or promotion blocker                                                             |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| T01 | Mutate the JSON body while keeping the headers               | Verify HMAC-SHA256 over the exact raw bytes before parsing; reject invalid encoding or size                                  | Secret custody and TLS remain external controls                                           |
| T02 | Supply duplicate or differently cased security headers       | Normalize names, require exactly one bounded value, and reject arrays or conflicting duplicates                              | Host framework must expose raw headers without lossy merging                              |
| T03 | Replace the configured hook ID with a payload/header value   | Compare the header to the out-of-band hook ID; never enroll a hook from a request                                            | Hook enrollment and profile storage require independent review                            |
| T04 | Re-send one delivery with the same GUID                      | Atomically retain delivery tombstone and return duplicate without a new evaluation                                           | Tombstone expiry is a bounded residual; no early deletion is allowed                      |
| T05 | Re-send the same body with a new GUID                        | Atomically claim a namespace-scoped body digest, bind the new GUID as a replay alias, and return duplicate                   | The chosen finite retention window must be live-configured and audited                    |
| T06 | Re-use a delivery GUID with a different body                 | Compare the stored digest and return conflict without changing state; resolve an unknown write by durable read before retry  | An ambiguous store response must be store_error, never conflict-as-new or accepted-as-new |
| T07 | Race two first deliveries or two workers                     | One transaction claims both namespaces; worker leases and generation fences are atomic                                       | Store isolation and transaction semantics need implementation evidence                    |
| T08 | Crash after acceptance, lease, or Check Run creation         | Persist receipt/outbox before acknowledgement; reclaim expired leases by receipt and external ID                             | Reaper availability and bounded attempts are deployment obligations                       |
| T09 | Return success after a timeout from a database or GitHub API | Preserve the prior state, reconcile exact identity, and classify unknown as non-success                                      | Remote writes lack a shared CAS; required mode needs live race evidence                   |
| T10 | Use an installation outside the approved repository set      | Require the App/installation/repository tuple in the profile and validate token response IDs                                 | Installation and repository transfer events need bounded re-enrollment                    |
| T11 | Return extra or write-capable permissions in a token         | Request exact repository IDs and permissions; reject any set outside the profile, except checks:write                        | GitHub enterprise installation semantics may limit down-scoping and must be tested        |
| T12 | Rename, transfer, or case-fold a repository into the target  | Bind immutable repository ID, owner ID/type, and current canonical name; reread before success                               | A repository ID transfer is a deliberate re-enrollment decision                           |
| T13 | Spoof a required check with the same display name            | Require the context plus expected App ID; verify App ID in every Check Run response                                          | Ruleset/branch protection semantics must be captured by live audit                        |
| T14 | Publish a check for another repository, PR, or head          | Verify repository ID, PR/base/head, fixed name, external ID, and current generation                                          | GitHub eventual consistency may leave an ambiguous remote state                           |
| T15 | Let an old evaluation win after a new head arrives           | Increment the PR slot generation and require binding/generation CAS before prepare and publish                               | GitHub has no cross-system transaction; old remote output may need invalidation           |
| T16 | Change the base or policy while the head SHA is unchanged    | Include base SHA, policy path/digest, root generation, and snapshot fingerprint in the binding; re-evaluate                  | Required mode is blocked until a live same-head policy-change fixture passes              |
| T17 | Create duplicate provider results or lose a create response  | Use deterministic external ID; query exact head/name/App/external ID; adopt exactly one, otherwise fail closed               | Check Run retention and list pagination are provider limits to prove                      |
| T18 | Treat neutral, skipped, or unknown as a successful gate      | Publish success only for a complete ready result; publish failure for not-ready, incomplete, stale, and error                | Branch rules may have additional semantics that the audit must model                      |
| T19 | Execute attacker-controlled PR code through a trusted event  | Never checkout, fetch, import, build, cache, shell, evaluate expressions, or run artifacts from the PR                       | Parser/dependency vulnerabilities remain supply-chain risks                               |
| T20 | Launder sender/reviewer identity into provider authority     | Keep sender and review author as bounded subject context; App identity is the only provider authority                        | Reviewer authorization remains the readiness policy's separate contract                   |
| T21 | Inject unknown event/action or oversized data                | Allow only the bounded event/action set and enforce body, header, JSON, API, output, deadline, and retry limits              | GitHub can add event actions; unknown additions must fail closed until reviewed           |
| T22 | Leak secrets or untrusted text through logs                  | Log only bounded IDs, hashes, action, outcome, attempt, and correlation; redact tokens and bodies                            | Host logs, traces, crash dumps, and metrics require independent configuration             |
| T23 | Delete replay protection or data before its declared expiry  | Make retention and deletion state explicit; fail cleanup when completion is unknown                                          | Legal/privacy policy and data location are external owner decisions                       |
| T24 | Rotate a secret while old/new verification is ambiguous      | Version active/previous secrets out of band; reject ambiguous matches and record only the version label                      | Secret-manager atomic rotation must be demonstrated before required mode                  |
| T25 | Broaden authority through configuration drift                | Hash the authority profile, verify it at startup and before publish, and return to advisory on mismatch                      | External ruleset and App installation changes need a new promotion                        |
| T26 | Use a successful Action workflow as the root                 | Treat workflow paths and names as advisory unless independently protected and bound; direct App mode has its own root digest | Workflow-root proof remains a separate governance gate                                    |
| T27 | Make a store or API rate-limit failure look complete         | Bound pages, attempts, bytes, concurrency, and deadline; classify late/missing data as retryable or incomplete               | Provider quotas and outages cannot be solved by increasing unbounded retries              |
| T28 | Feed model output into readiness or authority                | Keep LLMs outside acceptance, evaluation, provenance, and publication decisions                                              | Future AI analysis is a separate non-authoritative audit product                          |

## State-machine review invariants

The following sequences are mandatory acceptance fixtures, not prose-only
examples:

- same delivery/same body -> one receipt, duplicate response, no second lease;
- same delivery/different body -> conflict, no body-key mutation;
- different delivery/same body -> duplicate plus a replay alias, one evaluation generation;
- concurrent first acceptance -> exactly one accepted result and one duplicate;
- store timeout before commit -> no accepted claim can be inferred;
- worker crash with an expired lease -> one bounded reclaim, never a new receipt;
- newer generation before old prepare/commit -> old generation is stale;
- lost provider response -> non-passing until exact external-ID reconciliation;
- wrong App/repository/head/name or duplicate Check Runs -> provider conflict;
- base/policy change with equal head -> old result cannot satisfy required mode;
- profile drift, secret ambiguity, or incomplete audit -> no successful publication.

Every fixture must assert both the returned outcome and the durable state
transition. A fixture that only checks a reason string is insufficient.

## Residual risks and non-claims

- HMAC authenticates the sender of a configured webhook but does not prove
  that the sender's account is benevolent or that the payload is current.
- A finite replay tombstone is a bounded engineering control, not mathematical
  proof against a replay after expiry. Current snapshot and revision binding
  still apply, and required mode must choose the retention window explicitly.
- GitHub API reads and writes are not one transaction with the durable store.
  A deployment cannot claim atomic merge enforcement without observing the
  specified race fixtures against the selected provider behavior.
- App private-key custody, TLS termination, proxy buffering, database
  isolation, backups, operator access, and deletion compliance are not proven by
  TypeScript or offline fixtures.
- The design does not prove the repository's existing ruleset is configured
  with the required App ID or that an external workflow root is protected.
- Passing ReviewReady remains an evidence result. It is not a proof that the
  contribution is correct, safe, or free of malicious behavior.

## Promotion blockers

TA-3 implementation may not enter "required" mode when any of the following is
unknown: the App/installation/repository tuple, exact permission response,
required-check App ID, current base/head/policy binding, durable atomic claim,
lease recovery, provider reconciliation, configuration fingerprint, deletion
completion, or the no-PR-code-execution review. The correct state is
"disabled", "shadow", or "advisory", with a bounded finding and no successful
authority claim.
