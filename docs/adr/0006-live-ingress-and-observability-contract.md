# ADR 0006: Live ingress and observability contract

- Status: accepted for a framework-neutral pure-library milestone
- Date: 2026-08-12

## Context

The pure webhook verifier is reusable by an HTTP service, but ReviewReady does
not yet have a selected hosting runtime, durable database, secret manager, or
network perimeter. Adding one implicitly would make transport, retention, and
privacy decisions that cannot be verified from this repository alone.

## Decision

The http-contract module defines the transport boundary without opening sockets
or choosing a framework. The host must preserve exact raw request bytes and
enforce streaming limits before buffering. The adapter accepts only POST with
one application/json content type, validates an optional exact content-length,
rejects bodies above the bounded webhook limit, and delegates all signature,
hook, freshness, payload, and replay checks to the webhook module. It never
parses or queues a body before those checks complete.

HTTP status mapping is deterministic: accepted is 202, duplicate is 200,
same-delivery body conflict is 409, malformed input is 400, method mismatch is
405, an oversized body is 413, and unavailable or ambiguous persistence is 503.
Responses contain only the boolean outcome and stable reason; they do not echo
body text, workflow source, tokens, or exception details.

The observability module defines versioned trust events containing UUID-form
correlation and delivery identities, repository/installation/PR identifiers,
base/head/policy hashes, a bounded known webhook action, timestamp, and outcome.
It intentionally has no request body, PR text, workflow source, prompt, secret,
token, or arbitrary metadata field. Event construction is fail closed, and a
sink that is unavailable or returns an unknown result is store_error; it must
not be reported as recorded.

## Deployment gate

Production ingress remains disabled until an external deployment design
specifies and verifies:

- a GitHub App installation and repository allowlist with read-only permissions;
- a secret manager and active/previous secret rotation policy;
- a durable store with atomic delivery/body replay claims, finite tombstone
  retention, compare-and-set result commits, crash recovery, and tenant
  isolation;
- TLS/proxy, request streaming limits, timeout, rate limiting, and idempotency;
- event redaction, encryption, retention/deletion, access audit, and data
  location;
- an immutable trusted workflow root and base-SHA binding policy.

No in-memory replay fallback, automatic provider selection, or fake deployment
configuration is permitted.

## Consequences

The HTTP and observability contracts can be tested and reviewed locally without
pretending that a live service exists. A hosting adapter may be added later only
when it implements these contracts and supplies independent operational
evidence. None of these events or HTTP results changes the deterministic v1
readiness JSON schema.
