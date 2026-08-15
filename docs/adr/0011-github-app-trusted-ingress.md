# ADR 0011: Dedicated GitHub App authority and durable ingress

- Status: accepted design for TA-3-D; production implementation deferred
- Date: 2026-08-16
- Extends: [ADR 0003](0003-trusted-ingress-and-replay.md) and
  [ADR 0006](0006-live-ingress-and-observability-contract.md)

## Decision in one sentence

ReviewReady may become an authoritative provider only through an explicitly
configured GitHub App installation and repository allowlist, an exact-body
signed webhook, a durable two-namespace inbox, a revision-bound result CAS, and
an independently verified Check Run whose required-check identity includes the
same App ID; a display name, payload field, workflow success, or model output
can never substitute for that chain.

This is a design contract. It does not add an HTTP server, database, secret
manager, deployment, or production check publisher.

## Why the earlier primitives are not the trust root

The existing HMAC, replay, App-token, binding, HTTP, and observability modules
are deliberately pure boundaries. They prove that an adapter can reject
malformed input and express a durable-store contract, but they do not choose
which App, installation, repository, Check Run, or deployment is authoritative.
In particular:

- a valid HMAC proves possession of the configured webhook secret, not that a
  payload-selected installation or repository is allowed;
- an installation token is not an allowlist by itself unless its requested and
  returned repositories and permissions are checked;
- a delivery ID prevents duplicate processing only while its durable tombstone
  exists; a body replay namespace is also required;
- a result CAS cannot make the remote GitHub Checks API transactional;
- a trusted workflow path is not established by the fact that a file is visible
  on the default branch.

TA-3 implementation must preserve these limitations instead of promoting a
pure-library primitive to an authority claim.

## Authority profile

Every deployment has one immutable, versioned authority profile supplied
outside the webhook payload:

- the positive numeric App ID;
- the exact webhook hook ID and accepted secret versions;
- the allowed installation IDs and the exact repository IDs for each
  installation;
- the canonical default branch and repository owner identity observed during
  enrollment;
- the fixed Check Run name, expected App ID, and provider result contract;
- the effective policy path and a digest of this profile;
- the execution-root mode: TA-3 direct App service, or a separately proven
  protected workflow root.

The profile is configuration, not evidence. A request cannot create, broaden,
or replace it. A profile change creates a new configuration generation and
invalidates the required-mode promotion until the external governance checks
are repeated. App slug, login, repository full name, event sender, check name,
and workflow path are labels or context unless independently bound to this
profile.

### Installation and permission boundary

The App is installed only on explicitly selected repositories. The token
request supplies the bounded repository ID list and the exact permission set;
omitting either is a configuration error because GitHub would otherwise use the
installation's broader grant. The response is accepted only if:

- the installation ID is allowlisted for this App;
- every returned repository ID is allowlisted and there are no duplicates;
- the returned permissions equal the approved set; and
- no write permission exists except the one required to publish a Check Run.

The approved minimum for the direct provider is:

- "metadata: read";
- "contents: read" for policy and bounded source reads at an exact base SHA;
- "pull_requests: read" for the PR and review evidence;
- "checks: write" for the provider's own result.

No contents, pull-request, workflow, Actions, issues, deployments, releases,
administration, or branch-protection write capability is granted. The App does
not accept a user token or impersonate a reviewer. Event sender and review
author identities are recorded as untrusted subject context only; they never
authorize the provider or alter policy.

## Ingress and evaluation binding

The host preserves the exact raw bytes and verifies X-Hub-Signature-256 before
parsing. It requires one bounded value for each required header, matches the
configured hook ID, and requires the event header to agree with the payload
event/action. Unknown event types or actions are rejected. Active and previous
secrets are versioned out of band; an ambiguous match or unknown rotation state
is a failure, never a best-effort acceptance.

The normalized envelope is the only input to the durable state machine. It
contains these identity domains:

1. **Provider authority**: App ID, hook ID, installation ID, and configuration
   generation.
2. **Repository subject**: numeric repository ID, canonical owner ID/type/name,
   and the allowlist entry. Numeric identity is authoritative; rename or
   transfer mismatches are stale or unauthorized.
3. **Pull request revision**: repository ID, PR number, base repository ID,
   head repository ID, base SHA, head SHA, event, action, and bounded subject
   actor identity.
4. **Policy and root**: policy path, base revision, policy bytes digest, and
   an immutable trusted-root identity. For direct App mode the root is the
   versioned App configuration digest; a workflow path alone is never a root.
5. **Freshness and evidence**: delivery GUID, raw-body digest, received time,
   event freshness marker, snapshot version/fingerprint, and result digest.

The provider fetches policy bytes from the bound base SHA and performs a
current PR/repository reread before any success publication. A changed base,
head, repository identity, policy digest, root generation, or required
freshness marker is stale. An unavailable, incomplete, contradictory, or
over-limit read is not success. No payload field can override the current
snapshot.

## Durable state machine

The durable store has separate namespaces and one atomic acceptance operation.
The namespace is tenant-scoped by App ID, hook ID, installation ID, and
repository ID:

- deliveryKey = namespace + delivery GUID;
- bodyKey = namespace + raw-body SHA-256;
- evaluationKey = SHA-256(canonical binding envelope);
- the current PR slot is keyed by repository ID, PR number, and fixed check
  identity, with a monotonically increasing generation. Accepting a new
  binding for an existing slot advances that generation atomically; accepting
  the same binding is a duplicate.

The store must implement the following behavior:

1. **Accept.** After signature and envelope validation, atomically claim both
   keys and persist only the bounded normalized envelope and digest. A new pair
   returns accepted. The same delivery and same body returns duplicate. The
   same delivery with another body returns conflict. A new delivery with an
   already claimed body returns duplicate and atomically records that delivery
   GUID as a replay alias of the existing receipt; it does not create an
   evaluation. A later different body under that aliased GUID is conflict. A
   failed transaction returns store_error without a new claim. An ambiguous
   transaction also returns store_error, but the caller must not infer whether
   the store wrote; a bounded authoritative read must resolve the receipt
   before any retry or evaluation. No unresolved transaction may be treated as
   accepted, duplicate, or success.
2. **Lease.** A worker atomically changes accepted or retryable to processing
   with a bounded lease and attempt number. A second worker cannot process the
   same generation. An expired lease may be reclaimed for the same receipt, but
   reclaim is never a new delivery.
3. **Prepare.** The worker rechecks the current snapshot, evaluates the pure
   engine, and stores a canonical result under the current generation. It may
   produce success only for a complete deterministic ready result. Not-ready,
   incomplete, stale, or error outcomes are non-success.
4. **Publish.** The provider outbox uses a deterministic external ID derived
   from the full binding. Before each remote write it verifies the generation
   and binding. A newer generation makes the old one stale; it cannot
   overwrite the current slot or mark it published.
5. **Reconcile.** A timeout after a remote write is ambiguous. The worker
   queries a bounded set of Check Runs for the exact head SHA, fixed name,
   expected App ID, and external ID. Exactly one exact match may be adopted;
   zero or multiple matches, wrong identity, wrong repository, wrong head, or
   an unavailable query is provider_ambiguous and cannot become success.
6. **Recover.** A crash after durable acceptance or an in-progress Check Run
   leaves a resumable receipt. A bounded reaper reclaims expired leases and
   resumes by receipt/external ID. Attempts beyond the configured maximum
   become a terminal non-success failure. There is no in-memory replay or
   implicit retry after an unknown store result.

The public HTTP response is only an acknowledgement of ingress. Accepted does
not mean ready, and duplicate does not mean the prior evaluation passed. The
durable state and provider result are the only sources for later
reconciliation.

## Check Run provider contract

The required result uses the Checks API, not a legacy commit status. The fixed
check name is configured out of band. Repository governance must require the
pair (context, app_id), not only the display name. The provider validates every
response for:

- the expected App ID;
- the allowlisted repository ID;
- the exact bound head SHA;
- the fixed check name;
- the deterministic external ID;
- the expected status/conclusion and bounded output.

Creation starts non-passing and is resumable. A completed success is emitted
only after the durable generation and binding checks pass. Failure is used for
not-ready, incomplete, stale, provider, and evaluation errors; neutral is not
used for uncertainty because GitHub treats neutral as a passing required
status. A result from another App, a same-name legacy status, or an unbound
workflow is never adopted.

GitHub's remote write has no compare-and-set with the ReviewReady store. The
outbox, generation fence, exact response reread, and stale invalidation reduce
the race but cannot prove atomicity by design alone. Required-mode promotion
therefore has a live acceptance fixture for:

- a new head arriving while an old result is publishing;
- the base or policy revision changing while the head SHA stays equal;
- a lost create/update response and exact external-ID reconciliation; and
- duplicate or conflicting Check Runs for the same identity.

If the live provider cannot prove that the required result is the current
(repository, base, head, policy, App) binding, the integration remains
advisory. The design never upgrades an ambiguous remote state to pass.

## Privacy, retention, and deletion

The raw request body is transient input. The production store keeps its digest
and normalized bounded envelope, not PR text, review bodies, workflow source,
tokens, private keys, or arbitrary payload metadata. If a deployment needs raw
body retention for incident response, that is a separate encrypted, access
audited decision and is outside required-mode approval.

The store records an explicit retention configuration in the profile:

- replay tombstones are retained for at least the seven-day primitive window,
  with a recommended 30-day default and a hard 90-day maximum;
- receipt, attempt, and result metadata are retained for at most 30 days;
- operational trust events are retained for at most 14 days;
- deletion runs are bounded, auditable, and fail closed if the store cannot
  prove completion.

No cleanup may delete a replay tombstone before its declared expiry. Removing
an installation or repository stops new acceptance immediately; it does not
silently erase the remaining replay protection. Expired data is deleted by a
bounded job, and deletion failure is an operational failure, not a successful
cleanup claim.

## Rollout and rollback

The deployment has four explicit modes:

1. disabled: verify configuration only; publish nothing.
2. shadow: accept and evaluate into the durable store; publish no Check Run.
3. advisory: publish a non-required provider check and collect live evidence.
4. required: publish only under the approved profile after external governance
   and race fixtures prove App-bound enforcement.

Startup or configuration drift sends the service back to non-required mode and
blocks successful publication. Rollback first disables success publication,
then requires an explicit repository-owner change if a required rule must be
removed. The service never edits rulesets, branch protection, installations,
secrets, or releases to recover itself. Revoking the App and rotating the
webhook secret are operator actions; existing tombstones are retained through
their expiry.

## Acceptance and implementation boundary

TA-3-D is complete only with:

- this ADR;
- [the TA-3 threat model](../threat-model-ta3-trusted-ingress.md);
- [the deterministic state-machine fixtures](../../fixtures/trust/ta3-ingress-state-machine-v1.json);
- an implementation successor issue that names the selected store, host,
  secret manager, provider adapter, and live promotion evidence; and
- re-review showing that each attack case has one fail-closed outcome.

The successor must add failing regression tests before each behavior change,
implement the smallest adapters that satisfy this contract, and stop if a
platform fact cannot be proved. It must not change the v1 readiness JSON
schema, add an LLM verdict, execute pull-request code, or treat this ADR as
evidence that production infrastructure already exists.

## References

- [Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [Best practices for using webhooks](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)
- [Authenticating as a GitHub App installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)
- [REST API endpoints for check runs](https://docs.github.com/en/rest/checks/runs)
- [REST API endpoints for protected branches](https://docs.github.com/en/rest/branches/branch-protection)
- [Securely using pull_request_target](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)
