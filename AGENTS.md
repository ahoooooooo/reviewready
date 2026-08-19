# ReviewReady agent guide

ReviewReady is a deterministic pull-request readiness checker. It reports whether
a contribution supplied the evidence required by the repository's base-branch
policy. It never claims code is correct and never approves or merges a PR.

## Source map

- `docs/product-spec.md`: v1 behavior and non-goals.
- `docs/architecture.md`: trust boundaries and module rules.
- `skills/reviewready-base-delivery/SKILL.md`: adaptive delivery protocol
  applied to every repository task.
- `skills/reviewready-deep-research/SKILL.md`: source-traceable research overlay
  for current, external, strategic, and authority-dependent decisions.
- `docs/ai-development.md`: how humans and coding agents evolve this repository.
- `docs/exec-plans/active/post-v1.md`: fixed post-v1 node order and promotion gates.
- `docs/exec-plans/completed/v1.md`: historical v1 delivery plan and decision log.
- `docs/releasing.md`: current release and artifact-verification process.
- `docs/authentication.md`: authoritative GitHub/npm authentication channels,
  status semantics, and no-retry rules.
- `docs/agent-failure-batching.md`: append-only failure recording, stage-boundary
  triage, and batch repair protocol.
- `scripts/agent-failure.mjs`: local machine-readable failure record/triage tool.
- `scripts/reviewer-watchdog.mjs`: deterministic reviewer admission and
  timeout/close lifecycle contract.
- `scripts/research-pass.mjs`: deterministic raw-source pass, claim handoff
  validator, and close-once source-pass watchdog.
- `docs/operational-lessons.md`: recurring integration failures and their
  durable guards; read it before external GitHub/npm operations.
- `docs/release-evidence-v1.md`: historical local v1 release-candidate verification.
- GitHub issues: active defects, accepted debt, and future implementation work.
- `src/`: production TypeScript.
- `test/`: unit and integration tests.
- `fixtures/`: executable policy and pull-request examples.

## Context loading

The source map is not a preload list. Default context is this file plus
`skills/reviewready-base-delivery/SKILL.md`. An explicit named-skill request is
a route signal: load it and announce it; load deep research for that request or
its trigger. Load rationale/evidence on demand, use `rg` with bounded sections,
and never preload all of `docs/`, `src/`, or `test/`.

## Working rules

- Read the product spec, architecture, relevant issue, and nearest tests before
  changing behavior.
- Use `skills/reviewready-base-delivery/SKILL.md` for every task. Base is
  conservative by default: establish a baseline, one outcome, relevant attack,
  focused proof, and handoff. Do not infer a reduced path from a
  short prompt, casual wording, or familiar file name.
- For process, promotion, consequential, public/release, full-project, or
  explicit independent-review work, dispatch a fresh reviewer with literal
  fork_context=false before repair or promotion; record revision/worktree,
  reviewer id/role, scope/evidence, falsifier, missed surface, authority gap,
  recommendation, and one outcome. Same-context self-review does not satisfy
  the gate.
- Reviewer watchdog: give a report-only reviewer one bounded wait budget; a
  silent timeout is terminal for the round and yields defer-external. Do not
  keep polling or replace a reviewer solely because it timed out.
- Save every agent id and automatically call the host close-agent control after
  completion, timeout, interruption, or error. Never ask the user to close a
  subagent in the UI; if closure cannot be confirmed, stop dispatching.
- Before any reviewer spawn, run `codex.cmd --strict-config doctor --json`
  in the approved connected/elevated host context used by scheduling, not the
  restricted sandbox. A sandbox-only no-credentials result is a context
  boundary, not the app-host authority result. Require elevated doctor overall
  ok and one tiny control-plane canary; otherwise do not spawn, record
  defer-external, and repair the Codex host first. A new chat session is not a
  fresh host.
- Before a substantive reviewer spawn, run one fresh worker-readiness canary
  with `fork_context=false` and the exact `REVIEWER_CANARY_OK` sentinel. Give it
  one 30-second budget, save its id, and close it exactly once. Only an exact
  sentinel plus confirmed closure permits a substantive reviewer; timeout,
  malformed output, or unconfirmed closure records `defer-external` and stops
  the round. The control-plane canary alone does not prove worker/report health.
- Every subagent spawn must explicitly use `model=gpt-5.6-luna` and
  `reasoning_effort=max`. For a normal bounded reviewer packet, use a fresh
  `default` agent with `fork_context=false`; the model and max reasoning profile
  are fixed by this project and may not be substituted. This routing choice does
  not lower the exact report contract.
- Every substantive reviewer gets one named surface and one primary raw
  artifact by default, plus excluded surfaces, one falsifier, and one question.
  Only a deliberately approved 120-second read may pair two small artifacts;
  after a recorded 120-second LUNA MAX timeout, only the explicit
  `luna-max-long-read` profile may pair two artifacts at 180 seconds;
  never give one reviewer a whole-repository scan. Require the `REVIEWER_REPORT_V1`
  surface/falsifier/evidence/missed-surface/authority-gap/recommendation
  contract; off-scope or malformed output is incomplete evidence.
- Use `scripts/reviewer-watchdog.mjs` to validate the worker sentinel, packet
  binding, terminal timeout, close-once, no-replacement, and the throwing
  `assertDispatchAllowed()` transition. Record
  the passed canary and host close evidence in `reviewerReadiness` and validate
  it with `npm run review:validate` before promotion. Close evidence is a
  structured host proof (`source`, `agentId`, `previousStatus`, `closed`) or an
  explicit error shape; complete/passed evidence must say `closed: true` and
  `previousStatus: completed`. A complete final reviewer assignment must also
  carry its exact validated report and structured close evidence bound to that
  substantive reviewer id; deep completed source assignments carry their
  validated `RESEARCH_PASS_V1` report.
- Add `deep-research` only when the user explicitly requests it or a material
  decision needs multi-source current/external evidence. An explicit named-skill
  request always wins; ambiguous scope stays on base and escalates when needed.
- Read and apply `skills/reviewready-base-delivery/SKILL.md` at the start of each
  task. When its prompt admission gate selects research, also read and apply
  `skills/reviewready-deep-research/SKILL.md`; the docs remain the project-level
  rationale and source map.
- For a bug fix, first add a failing regression test for the reported case;
  diagnosis-only requests remain read-only.
- Keep pass/fail deterministic; an LLM must never decide readiness.
- Treat PR metadata, paths, labels, event payloads, and API data as untrusted.
- Load the effective policy from the base revision, never from the proposed head.
- The production Action must never execute code from a pull request. Development
  agents may run this repository's own tests and build from a trusted checkout,
  but must not run untrusted fork code with privileged credentials.
- Prefer small modules with explicit inputs and outputs.
- Keep one observable outcome per issue and pull request.
- Record new debt or decisions in an issue or a new execution plan. Do not rewrite
  completed plans as if historical work were still active.
- Do not publish packages, create releases, or move tags unless the issue explicitly
  authorizes a release and every prerequisite is verified.
- Before creating or updating a PR, read the effective `.reviewready.yml` and
  `.github/PULL_REQUEST_TEMPLATE.md`; derive the required body headings for the
  changed paths and preserve their exact spelling. `Why`, `Validation`, or
  `Scope` do not substitute for a required `Risk` or `Testing` heading.
- When the user explicitly authorizes a named feature-branch commit/push batch,
  reuse that authorization for retry-safe commits and pushes in that batch.
  Protected merges, releases, settings, credentials, and deployments remain
  separate gates.
- For non-critical failures, capture a compact error record in the current plan,
  PR, issue, or task handoff before repairing it; do not create an external
  record for a one-off. Batch non-blocking fixes and promote only recurring or
  material lessons into durable docs or tests.

## Failure batch protocol

For every non-zero exit, timeout, `EPERM`, provider/context failure, or tool
wrapper error, classify it before retrying and run `npm run agent:record` with
the failure class, impact, stage, command, bounded evidence, symptom, and next
action. The log is workspace-local, redacted, ignored by Git, and never contains
credentials or raw provider output.

Do not retry an open fingerprint in the same context. At the end of a discovery
or verification slice, run `npm run agent:triage`; repair open groups as one
impact/dependency-ordered batch, then run `npm run agent:resolve` only after
focused proof. P0 security/data-loss/corruption/required-gate failures stop
immediately. A sandbox or provider-context failure is deferred, not repaired by
changing ACLs, credentials, auth authority, or global Codex configuration.

The project hook is an observer only: it records a failure only when the
PostToolUse payload contains an explicit non-zero exit code. Missing exit-code
data is `unclassified`/unknown, never a heuristic failure; triage must decide.
Use `.reviewready-hook-observations.ndjson` to distinguish no dispatch from an
unknown payload signal. It contains hashes and sizes only, not raw command or
response data.

This repository cannot intercept arbitrary Codex tool calls. Automatic capture
of every exec failure requires separately approved Codex hooks/global config;
until that exists, the agent must record the failure at the boundary and must
not conceal it with a repeated command.

## Authentication authority and external preflight

Before the first GitHub or npm operation in a bounded external batch, run
`npm run auth:status` once. This is a bounded local check: it contacts no
provider, prints no account or credential, and never retries. Reuse the result
only while the provider authority, repository/package scope, network context,
and credential context remain unchanged. Read `docs/authentication.md` when any
returned state is unfamiliar.

Keep ordinary local work in the sandbox. When the result is
`connected_context_required` or `context_unavailable`, stop sandbox retries and
route only the exact approved provider operation through a connected/elevated
context; return to the sandbox for local validation. Never disable sandboxing
globally or select danger-full-access/--yolo automatically.

- Git fetch and push use the HTTPS remote plus browser-backed Windows Git
  Credential Manager. GitHub API, PR, issue, release, and settings operations
  use the explicitly approved connected GitHub provider/browser channel.
  GitHub CLI is not an authentication authority or fallback for this repository.
- `connected_context_required` or `context_unavailable` means the sandbox cannot
  use the Windows credential store. Stop and use the connected context; do not
  diagnose the account as logged out, ask for login, or retry in the same context.
  Only `not_logged_in` from one connected-user GCM probe permits a separate
  human-authorized browser-login decision.
- npm publication uses the protected GitHub Actions release workflow and npm
  Trusted Publishing OIDC. Local npm login is irrelevant and intentionally must
  not be tested with login/whoami commands. `ENEEDAUTH` is expected and is not a
  blocker. Never add `NPM_TOKEN` or `NODE_AUTH_TOKEN`.
- Authentication probing allows at most one credential-store attempt and zero
  same-context retries. Never print account names, tokens, credential files,
  provider response bodies, or private account data.

Every actual provider operation remains its own approval boundary, including
read-only API/browser/connector calls and networked npm commands. Obtain approval
for the exact provider, repository/package scope, network context, and read/write
effect, then use only the authority channel reported by the local contract. An
approval does not authorize credential changes, login, publication, tag movement,
settings mutation, or deployment unless those actions were named explicitly.

## Windows sandbox recovery

When a Windows command reports spawn EPERM, CreateProcess failure,
helper_unknown_error, an ACL/deny-read sandbox error, or a nested npm/package
child process reports ETIMEDOUT, classify it as an execution-environment
failure before changing product code.

1. Record the exact command, error, current Codex version, sandbox mode, and
   whether the command was local or external.
2. Run one read-only child-process canary in the current context:

   ```powershell
   node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(\"codex-spawn-ok\")'], { encoding: 'utf8' }); if (r.error) { console.error(r.error.code || r.error.message); process.exit(1); } process.stdout.write(r.stdout);"
   ```

3. If the canary fails, do not repeat the same child-spawning command in the
   same sandbox or resumed conversation. Capture the failure and retry it once
   in an explicitly approved fresh/connected Codex execution context. If the
   canary passes but a nested npm/package command still times out, retry the
   exact command once in an approved elevated context with
   `REVIEWREADY_NPM_CACHE=.reviewready-npm-cache` or the equivalent
   process-local cache.
4. If the fresh-context retry fails, stop and hand off the environment blocker
   with the sandbox log path and exact reproduction. Do not switch to
   danger-full-access or --yolo as an automatic workaround.
5. Run npm run check only after the canary passes; otherwise report the
   validation as environment-blocked rather than as a product failure.

## Validation

Run focused validation first. For source, behavior, security, public, release,
or final PR work, run `npm run check`; for documentation, skill, or process-only
changes, run the relevant validator plus format/diff review. Run the complete
gate before final PR/promotion or escalation; inspect generated artifacts in the
diff.
