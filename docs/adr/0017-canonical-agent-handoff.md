# ADR-0017: Canonical agent handoff state

- Status: accepted locally, not yet promoted to the public PR
- Date: 2026-08-20 (Asia/Taipei)
- Decision owner: ReviewReady integrator
- Scope: agent process, context loading, cross-turn state, and validation

## Decision

ReviewReady has one live project-level handoff: the root `HANDOFF.md`.

Its first section is a marked strict JSON payload with the document marker
`REVIEWREADY_CANONICAL_AGENT_HANDOFF` and schema version `1`. The payload is
validated by `scripts/agent-handoff.mjs` against
`docs/agent-handoff.schema.json`. The file records one active slice, one next
action, current revision/branch/worktree metadata, blockers, evidence, external
write boundaries, and validation freshness.

The lifecycle is executable:

1. `npm run handoff:refresh` updates the current revision, branch, changed paths,
   worktree digest, timestamp, and document digest.
2. The agent edits only the state/body needed for the current slice.
3. `npm run handoff:validate` rejects malformed, stale, or unrefreshed state.
4. `npm run check` includes handoff validation, so a final gate cannot pass with
   a handoff that describes another worktree.
5. When the source batch is committed, refresh the handoff on the now-clean
   tree and commit that handoff update separately. A clean payload is accepted
   only for the same revision or a descendant whose only changed path is the
   handoff itself; source changes after the recorded revision still fail closed.

Validation entries also carry the worktree `change_digest`. The validator rejects
any `passed` entry whose revision or digest is older than the current handoff;
refreshing metadata therefore cannot accidentally preserve stale green proof.

`AGENTS.md` and both project skills require this read order and refresh step.
`docs/current-status.md` remains a dated public/mainline snapshot; the active
post-v1 plan remains the source of truth for node order; the per-review JSON
handoff remains the source of truth for one independent-review gate. None of
those documents is a substitute for `HANDOFF.md`.

## Problem

The repository already had several legitimate documents called a status,
execution plan, research handoff, and reviewer handoff. They served different
trust boundaries, but a new or weak model could not reliably tell which one was
the current cross-turn continuation point. Plain Markdown also supplied no
required fields, no freshness binding to the worktree, and no deterministic
failure when an agent forgot to update it.

The independent-review validator solved a narrower problem: proving a reviewer
packet and close evidence. It was not a project checkpoint. Reusing it as the
project handoff would mix review authority with integrator state and would make
ordinary work require an unnecessarily large reviewer schema.

## Research evidence

The decision follows these dated primary or governing sources, observed on
2026-08-20:

- OpenAI model guidance recommends one clear handoff between routes, exact
  output schemas, explicit stop conditions, structured failures, and comparing
  quality with resource use: <https://developers.openai.com/api/docs/guides/latest-model>.
- OpenAI Agents SDK documents handoff metadata as a small structured payload,
  input filtering as a separate history concern, and typed output as a way to
  validate agent results: <https://openai.github.io/openai-agents-python/handoffs/>
  and <https://openai.github.io/openai-agents-python/agents/>.
- JSON Schema makes required properties and additional-property policy
  machine-checkable; missing required fields are invalid:
  <https://json-schema.org/understanding-json-schema/reference/object>.
- The AGENTS.md open format provides a predictable instruction file but
  deliberately has no required fields, so it cannot by itself be the structured
  mutable handoff: <https://agents.md/>.
- The current Codex configuration reference separates the model context window,
  automatic compaction threshold, MCP per-tool timeout, and provider stream
  idle timeout. An unset compaction threshold uses model defaults; a 60-second
  MCP tool timeout and a 300-second stream idle timeout are not worker-completion
  deadlines: <https://learn.chatgpt.com/docs/config-file/config-reference>.
- The GPT-5.6 Luna model page lists a 1,050,000 context window but applies a
  higher multiplier to the full request above 272K input tokens (2x input and
  1.5x output), and bills cache writes at 1.25x uncached input:
  <https://developers.openai.com/api/docs/models/gpt-5.6-luna>.

The strongest counter-case is that a strict handoff adds ceremony and can slow a
small task. The decision limits that cost to a small root file, one refresh
command, and one validator. It does not require a reviewer panel, a full
repository scan, or a complete project report for ordinary work. The worktree
digest is the important guard: editing an already-dirty file after the last
refresh makes the check fail, even when the path list did not change.

## Timeout and context boundary

The project never treats an elapsed observation window as proof that a LUNA MAX
worker is finished. The 60/120/300-second values are scheduling observations;
only a host-confirmed terminal/error status may create a timeout and close proof.
This is intentionally separate from Codex MCP tool and provider stream timeout
settings. A control-plane canary that does not answer remains an external
`defer-external` blocker; it is not converted into a completed reviewer result.

The project also leaves `model_context_window` and
`model_auto_compact_token_limit` unset in the global configuration so model
defaults apply. Progressive disclosure, one-artifact reviewer packets, and a
single canonical handoff reduce repeated context. The large advertised window
is capacity, not a cost target; the documented >272K pricing boundary is why a
full-repository packet or a repeated transcript is treated as a cost defect.

## Rejected alternatives

### Keep `docs/current-status.md` as the handoff

Rejected. It is intentionally a dated public snapshot and contains historical
provider observations. Treating it as live state would make old facts look
current and would mix public mainline state with a feature-branch task.

### Use only a Markdown heading or filename convention

Rejected. Naming helps discovery but does not prove required fields, revision,
or freshness. `HANDOFF.md` therefore has both an unmistakable name and a strict
machine-readable contract.

### Use only the existing reviewer handoff JSON

Rejected. That schema is correctly strict for a final independent review, but
it requires reviewer readiness, packet artifacts, and close evidence. Making it
the project checkpoint would over-constrain ordinary agents and blur authority.

### Enable global hooks to force updates

Rejected for this change. Hooks are local-only and the project observer cannot
intercept arbitrary Codex calls. The durable guarantee belongs in a tracked
validator and the normal repository gate; global hooks remain a separate,
explicitly approved environment decision.

## Consequences and refresh triggers

The next agent can find the handoff at the repository root and can reject stale
state before taking action. A handoff is refreshed after every meaningful
discovery, repair, validation, provider attempt, reviewer lifecycle event, or
change of active slice. A new revision, branch, changed path, or changed content
also requires refresh. A stale handoff is evidence of incomplete work, not a
reason to guess.

This contract does not grant commit, push, merge, release, credential, or
provider authority. It records those boundaries explicitly and preserves
`defer-external` when host control or public authority is unavailable.
