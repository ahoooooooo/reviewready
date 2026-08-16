# Operational lessons and guardrails

This document records recurring development and integration failures that can
be prevented by a durable operating rule. It is an engineering aid, not a
readiness authority, a release permission, or a substitute for GitHub's
external controls. It must never contain credentials, tokens, or private
account data.

## GitHub command targeting

Every GitHub command that needs a repository must derive the owner from a
successful authenticated lookup. The lookup's exit code and its non-empty
result are prerequisites; a failed lookup must stop before constructing a
repository argument. Never type the owner into a command or silently fall back
to a remembered account name.

The safe PowerShell sequence is:

```powershell
$owner = gh api user --jq .login
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($owner)) {
  throw "Cannot determine the authenticated GitHub owner; stop before targeting a repository."
}
$repo = "$owner/reviewready"
```

If the lookup fails, classify the failure as authentication, network/proxy,
rate limit, or provider availability before retrying. Do not execute a command
with an empty or manually substituted owner, and do not expose environment
variables or credential material while diagnosing it. The same guard applies
to PR, issue, release, ruleset, Actions, and repository API commands.

## Authentication status is channel- and context-bound

The browser session, GitHub CLI keyring, Git HTTPS helper, and npm registry
session are separate. A successful browser login does not prove that `gh` can
call the API, and a public Git read does not prove authenticated write access.
The status is valid only for the channel and network context that was tested;
future operations must repeat the bounded preflight instead of trusting this
file as a permanent login flag.

On 2026-08-17, the sandbox first reported a misleading CLI failure because its
proxy could not reach GitHub. A bounded check in the approved connected context
then confirmed `gh auth status` and `gh api user --jq .login` succeeded. The
lesson is to separate network context from credential validity before asking
the owner to log in again.

npm is intentionally different: local `npm whoami` may return `ENEEDAUTH` after
logout while the protected GitHub Actions OIDC Trusted Publishing path remains
the release authority. Do not store a token or turn a local npm session into a
release prerequisite.

## 2026-08-17: malformed repository target during PR monitoring

While monitoring PR #84, a manually written repository owner was mistyped in a
`gh` command. The follow-up attempted to derive the owner dynamically, but the
GitHub API was unavailable through the active proxy. Because the failed lookup
was not treated as a hard precondition, the empty value produced an invalid
`/reviewready` repository target. No repository mutation occurred, but the
operator received a misleading secondary error and lost time.

The durable correction is the guard above: resolve identity once, validate it,
derive the repository target, and only then run external commands. A network or
authentication failure is reported as the primary blocker rather than being
converted into a malformed-target error. Future sessions should read this
lesson before any GitHub operation.

## How lessons become fixes

When the same class of failure recurs, first add a focused regression or
replayable check when the behavior can be tested locally. Then repair the
smallest safe boundary, validate the exact attempt, and keep the lesson linked
from the active process. Do not turn a one-off workaround into a permanent
credential, global configuration, or bypass of an external safety control.
