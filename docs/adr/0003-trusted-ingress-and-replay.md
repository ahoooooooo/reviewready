# ADR 0003: Trusted ingress and replay primitives

- Status: accepted for a pure-library milestone
- Date: 2026-08-11

## Context

GitHub webhook delivery is an untrusted ingress boundary. Signature verification alone does not prevent replay, stale evaluation, or a result being applied to a different pull request revision.

## Decision

Add small pure primitives for exact-body HMAC verification, bounded delivery validation, atomic replay claims, and evaluation binding. These primitives never execute workflow code or inspect a pull request by running it.

The signature primitive accepts the exact raw request bytes and a bounded secret and requires a single `sha256=` followed by exactly 64 hexadecimal characters. Comparison uses a fixed-length byte comparison. Invalid size, encoding, prefix, or digest is rejection.

The webhook interface exposes an atomic `record` operation over a namespaced
delivery key and a body-derived replay key. The hook identifier is accepted only
when it matches an out-of-band configured value; it is never trusted merely
because it arrived in a header. A durable implementation must claim both keys
atomically: a new delivery ID cannot make the same signed body new again.
Duplicate, stale, future, malformed, or over-limit delivery identifiers are
rejected. Store errors and unavailable persistence fail closed; there is no
unsafe in-memory fallback hidden inside the primitive. The event header is
checked in both directions against the payload discriminator.

The receiver requires a verifier clock in addition to the receipt timestamp.
The bounded seven-day window is an explicit replay/tombstone retention
contract, not proof that a store may delete a replay key early. A production
store must retain the delivery and body-replay tombstones at least through the
record's retention timestamp and must document behavior after that finite
window; it must never silently turn an ambiguous storage result into `new`.

The binding record includes delivery id, repository id, pull number, base SHA,
head SHA, policy path and policy SHA, trusted workflow identity, optional
installation identity, action, and freshness. A consumer must compare the
record with the exact snapshot it is about to evaluate; outer repository/PR keys
must match the binding before a durable result CAS is called.

## Deferred work

The candidate adds bounded pure GitHub App JWT and installation-token helpers.
Installation tokens are accepted only under an explicit installation and
repository allowlist with required read-only permissions. This ADR still does
not add an HTTP server, durable-store implementation, deployment, settings
collector, or retention database. Those require separate permission, privacy,
availability, and operational decisions. Signature verification is necessary
but not sufficient for trust.

## Reference

GitHub's webhook validation guidance requires HMAC-SHA256 over the exact payload and a timing-safe comparison.
