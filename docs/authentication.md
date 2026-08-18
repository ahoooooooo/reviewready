# Authentication authority and status

This is the operational source of truth for ReviewReady authentication. Read it
before any GitHub or npm operation. The executable status is:

```console
npm run auth:status
```

The command is local-only: it contacts neither GitHub nor npm, prints no account
name or credential, and never retries. Its JSON output is authoritative for
selecting the authentication channel; it is not permission to perform an
external operation.

## Authority matrix

| Surface                                     | Authority                                                           | Normal status                                                                            | Never use as a fallback                                                     |
| ------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Git fetch/push                              | HTTPS plus browser-backed Windows Git Credential Manager            | `available` in the connected Windows user; `connected_context_required` in Codex sandbox | GitHub CLI auth commands, PATs, or environment tokens                       |
| GitHub API, PR, issue, release, or settings | The explicitly approved connected GitHub provider/browser channel   | Determined by that connected channel for the approved operation                          | GitHub CLI or Git credentials silently substituted for the provider channel |
| npm package publication                     | Protected GitHub Actions workflow using npm Trusted Publishing OIDC | Repository wiring configured; package-version-matched historical release evidence        | Any local npm session, `NPM_TOKEN`, or `NODE_AUTH_TOKEN`                    |

Local npm authentication is intentionally irrelevant. A local `ENEEDAUTH` is
not a failure and must not trigger login, logout, token repair, or another
attempt. npm publication health is proved only by the protected release
workflow, OIDC provenance, exact registry artifact, and release evidence.

GitHub credentials are context-bound. The Codex sandbox cannot access the
interactive Windows credential store. Therefore
`connected_context_required` and `context_unavailable` mean **stop and use the
connected Windows/provider context**; they do not mean logged out. Only
`not_logged_in`, observed by one GCM probe in the connected Windows user
context, permits a human-authorized GCM browser login.

## Status semantics

- `configured`: repository remote/helper and OIDC workflow/evidence agree with
  this contract.
- `available`: one connected-user GCM probe found at least one account. Account
  names are deliberately not returned.
- `configured_not_probed`: GCM is configured but no credential-store probe was
  requested.
- `connected_context_required`: the process is a Codex sandbox; no GCM probe was
  attempted.
- `context_unavailable`: the single allowed GCM probe failed. Do not retry in
  the same context and do not switch to GitHub CLI.
- `not_logged_in`: the connected Windows credential store was reached once and
  contained no GitHub account. Stop for a human GCM browser-login decision.
- `contract_invalid`: repository auth wiring drifted. Repair the local contract;
  do not change credentials or provider settings as an automatic workaround.

## Retry and approval rule

Authentication probing is bounded to one credential-store attempt and zero
same-context retries. An unavailable provider, sandbox credential store, proxy,
or network is an external/context result, not evidence that credentials are
invalid. Any actual provider read or write still requires the operation-specific
approval defined in `AGENTS.md`.

The one-time npm Trusted Publisher bootstrap documented in the historical ADR
is complete. Do not repeat local npm authentication, trust setup, or
package-access mutation unless a separately authorized trust-reconfiguration
task explicitly requires it.
