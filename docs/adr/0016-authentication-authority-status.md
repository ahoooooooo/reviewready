# ADR 0016: Machine-readable authentication authority and fail-fast status

- Status: accepted
- Date: 2026-08-18
- Supersedes: ADR 0012 only for current local GitHub/npm channel selection and
  authentication preflight; ADR 0012 remains historical release evidence.

## Context

ReviewReady repeatedly needs GitHub and npm access, but prose-only instructions
caused agents to test the wrong channel. GitHub CLI failures were misread as
GitHub logout, and local npm logout was misread as a broken publish path. Sandbox
credential-store denial and provider/network failures then triggered repeated
commands, login suggestions, and unnecessary full audits.

The actual authorities are different:

- Git transport uses the HTTPS remote and browser-backed Windows Git Credential
  Manager;
- GitHub API work uses the explicitly approved connected provider/browser
  channel; and
- npm publication uses the protected GitHub Actions workflow and npm Trusted
  Publishing OIDC, not a local npm session.

## Decision

`scripts/auth-status.mjs` is the machine-readable local authentication contract.
Agents run `npm run auth:status` once before the first GitHub/npm provider
operation in a bounded external batch. The result is reused only while the
provider authority, resource scope, network context, and credential context
remain unchanged. The script validates repository wiring without network
access, hides account names, does not read or emit credentials, and never
retries.

GitHub rules:

1. Git fetch/push uses Windows GCM. GitHub CLI is not an authentication
   preflight, authority, or fallback.
2. API/PR/issue/release/settings operations use only the explicitly approved
   connected provider/browser channel.
3. A Codex sandbox does not probe the interactive Windows credential store. It
   returns `connected_context_required`, which is not logout evidence.
4. A connected-user GCM probe runs at most once. Failure returns
   `context_unavailable`; an empty account store returns `not_logged_in`.
   Neither state is retried. Only the latter may request a separate
   human-authorized GCM browser login.

npm rules:

1. Publish only through `.github/workflows/release-publish.yml` using OIDC
   Trusted Publishing and the protected `release` environment.
2. Local npm login/whoami is irrelevant and forbidden as a health check.
3. `NPM_TOKEN` and `NODE_AUTH_TOKEN` remain absent. Trusted Publisher
   reconfiguration is a separately authorized provider mutation, never an
   automatic repair.

The status command exits successfully for an intact repository contract even
when the current sandbox requires a connected credential context. Contract
drift exits with code 2. Actual provider reads and writes still require their
operation-specific approvals. Keep local work in the sandbox; on a context
result, use one approved connected/elevated lane for the exact operation and
return to the sandbox for local validation. A nested npm/package ETIMEDOUT may
use one retry with a process-local `REVIEWREADY_NPM_CACHE`; it does not
authorize a global sandbox bypass or credential change.

## Consequences

- A weak model receives one JSON authority map instead of inferring from prose
  or trying multiple login channels.
- Sandbox and network failures stop once without changing credentials.
- Historical release evidence remains historical; it cannot claim that a live
  provider is currently reachable.
- Authentication state never becomes readiness authority, merge authority, or
  release permission.

## Rejected alternatives

- Persisting a "logged in" flag in documentation: it becomes stale and cannot
  prove the active execution context.
- GitHub CLI as a universal preflight: it is not the project's Git transport or
  connected API authority and recreates the original retry loop.
- Local npm login as publish health: it contradicts OIDC Trusted Publishing and
  would reintroduce long-lived bearer credentials.
- Retrying another auth channel after a context failure: it broadens authority
  silently and hides the original failure.
