# Agent failure batching

ReviewReady keeps recurring local/process/environment failures in a workspace-
local append-only log so an agent can repair a class of failures at a stage
boundary instead of retrying each occurrence.

The log is `.reviewready-agent-failures.ndjson`. It is ignored, contains
redacted bounded evidence, and is never a source of product or release
authority. The commands are:

```console
npm run agent:record -- --failure-class environment --impact P1 --stage proof --next repair-batch --command "npm run check" --symptom "Vitest cannot write its temporary config" --evidence "EPERM node_modules/.vite-temp"
npm run agent:triage
npm run agent:resolve -- --fingerprint <fingerprint> --resolution "Applied the bounded repair and verified it"
```

## Required lifecycle

1. A non-zero exit, timeout, `EPERM`, provider/context failure, or tool-wrapper
   error is classified before any retry.
2. Record the failure before repairing or retrying. Hook-observed failures use
   `unclassified` until the agent triages the evidence. Use `P0` for security,
   corruption, data loss, or required-gate failures; `P1` for blocking
   delivery/process failures; and `P2` for non-blocking defects.
3. Do not retry an open fingerprint in the same context. A provider or sandbox
   context failure is deferred, not converted into a login, ACL, or authority
   change.
4. At the end of a discovery/verification slice, run `agent:triage`. Repair
   independent open groups as one batch, ordered by impact and dependency.
5. Resolve a group only after focused proof for the exact repair. Resolution is
   appended to the log; original failure evidence is not deleted.

The log records the failure class, stage, impact, bounded command/evidence,
fingerprint, retry prohibition, and next action. It must never contain tokens,
private keys, raw provider responses, account names, or unredacted environment
output.

Child npm processes use `.reviewready-npm-cache` by default. This is a
process-local ignored cache chosen to avoid inherited user-profile/cache ACL
drift; it does not change npm user configuration. If offline mode reports
`ENOTCACHED`, record it as an external dependency and defer it rather than
retrying or changing credentials.

The project Codex observer writes `.reviewready-hook-observations.ndjson` with
only command/response hashes, byte count, project label, and signal state. An
absent observation means the hook did not dispatch; an `unknown` signal means
the hook dispatched but Codex did not expose an exit code. Neither state is a
failure guess.

This repository protocol cannot intercept arbitrary Codex shell calls. Automatic
capture of every tool failure would require an explicitly approved Codex hook or
global agent configuration; until then, the agent must run `agent:record` at the
failure boundary and must not hide the error by repeating the command.
