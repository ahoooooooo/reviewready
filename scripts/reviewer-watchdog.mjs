#!/usr/bin/env node
// @ts-check

const CANARY_SENTINEL = "REVIEWER_CANARY_OK";
const REPORT_HEADER = "REVIEWER_REPORT_V1";
const MAX_WORKER_OUTPUT_LENGTH = 8_000;
const MAX_WORKER_FIELD_LENGTH = 2_000;
const REPORT_FIELDS = new Set([
  "surface",
  "falsifier",
  "evidence",
  "missed_surface",
  "authority_gap",
  "recommendation"
]);
const RECOMMENDATIONS = new Set(["promote", "reopen", "defer-external"]);
const TERMINAL_STATES = new Set(["complete", "timeout", "tool-failure"]);
const CLOSE_PREVIOUS_STATUSES = new Set([
  "completed",
  "running",
  "interrupted",
  "shutdown",
  "not_found"
]);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @param {string} name */
function requiredText(value, name) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > MAX_WORKER_FIELD_LENGTH
  ) {
    throw new Error(name + " must be non-empty bounded text");
  }
  return value.trim();
}

/** @param {unknown} output */
export function validateWorkerCanary(output) {
  if (typeof output !== "string" || output.trim() !== CANARY_SENTINEL) {
    throw new Error("worker canary must return the exact sentinel");
  }
  return { sentinel: CANARY_SENTINEL, observedOutput: CANARY_SENTINEL, status: "passed" };
}

/** @param {unknown} proof @param {string} expectedAgentId */
export function validateCloseProof(proof, expectedAgentId) {
  if (!isRecord(proof) || proof.source !== "host-close-agent") {
    throw new Error("close proof must come from host-close-agent");
  }
  for (const key of Object.keys(proof)) {
    if (!["source", "agentId", "previousStatus", "closed"].includes(key)) {
      throw new Error("close proof field is unexpected: " + key);
    }
  }
  if (proof.agentId !== expectedAgentId) {
    throw new Error("close proof agent id does not match the watchdog");
  }
  const previousStatus = requiredText(proof.previousStatus, "close proof previousStatus");
  if (!CLOSE_PREVIOUS_STATUSES.has(previousStatus)) {
    throw new Error("close proof previousStatus is not a known host status");
  }
  if (typeof proof.closed !== "boolean") {
    throw new Error("close proof closed must be boolean");
  }
  return { previousStatus, closed: proof.closed };
}

/** @param {unknown} evidence @param {string} expectedAgentId @param {boolean} requireClosed */
export function validateCloseEvidence(evidence, expectedAgentId, requireClosed = false) {
  if (!isRecord(evidence) || evidence.source !== "host-close-agent") {
    throw new Error("close evidence must come from host-close-agent");
  }
  if (evidence.agentId !== expectedAgentId) {
    throw new Error("close evidence agent id does not match the reviewer");
  }
  if (evidence.error !== undefined) {
    if (requireClosed) {
      throw new Error("complete close evidence cannot be an error");
    }
    for (const key of Object.keys(evidence)) {
      if (!["source", "agentId", "error"].includes(key)) {
        throw new Error("close evidence field is unexpected: " + key);
      }
    }
    return {
      source: "host-close-agent",
      agentId: expectedAgentId,
      error: requiredText(evidence.error, "close evidence error")
    };
  }
  const proof = validateCloseProof(evidence, expectedAgentId);
  if (requireClosed && !proof.closed) {
    throw new Error("complete close evidence must confirm closed=true");
  }
  return {
    source: "host-close-agent",
    agentId: expectedAgentId,
    previousStatus: proof.previousStatus,
    closed: proof.closed
  };
}

/**
 * @param {unknown} output
 * @param {{ surface: string, artifactId: string }} expected
 */
export function validateReviewerReport(output, expected) {
  if (typeof output !== "string") throw new Error("reviewer report must be text");
  if (output.length > MAX_WORKER_OUTPUT_LENGTH) {
    throw new Error("reviewer report exceeds the bounded output limit");
  }
  const lines = output.trim().split(/\r?\n/gu);
  if (lines[0] !== REPORT_HEADER) throw new Error("reviewer report header is invalid");
  const fields = /** @type {Record<string, string>} */ ({});
  for (const line of lines.slice(1)) {
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error("reviewer report line is invalid");
    const key = line.slice(0, separator);
    if (!REPORT_FIELDS.has(key)) throw new Error("reviewer report field is unexpected: " + key);
    if (fields[key] !== undefined) throw new Error("reviewer report field is duplicated: " + key);
    fields[key] = requiredText(line.slice(separator + 1), "reviewer report " + key);
  }
  for (const field of REPORT_FIELDS) {
    if (fields[field] === undefined) throw new Error("reviewer report field is missing: " + field);
  }
  const parsed = {
    surface: requiredText(fields.surface, "reviewer report surface"),
    falsifier: requiredText(fields.falsifier, "reviewer report falsifier"),
    evidence: requiredText(fields.evidence, "reviewer report evidence"),
    missed_surface: requiredText(fields.missed_surface, "reviewer report missed_surface"),
    authority_gap: requiredText(fields.authority_gap, "reviewer report authority_gap"),
    recommendation: requiredText(fields.recommendation, "reviewer report recommendation")
  };
  if (parsed.surface !== expected.surface) throw new Error("reviewer report surface is off-scope");
  const evidenceTokens = parsed.evidence.split(/[;,]/u).map((token) => token.trim());
  if (
    !evidenceTokens.some(
      (token) => token === expected.artifactId || token.startsWith(expected.artifactId + ":")
    )
  ) {
    throw new Error("reviewer report evidence is outside the packet");
  }
  if (!RECOMMENDATIONS.has(parsed.recommendation)) {
    throw new Error("reviewer report recommendation is invalid");
  }
  return parsed;
}

/**
 * @param {{ agentId: string, waitBudgetSeconds?: number, surface: string, artifactId: string, closeAgent: (agentId: string) => Promise<unknown> | unknown, validateOutput: (output: string) => unknown }} input
 */
export function createWorkerWatchdog(input) {
  const agentId = requiredText(input.agentId, "agentId");
  const surface = requiredText(input.surface, "surface");
  const artifactId = requiredText(input.artifactId, "artifactId");
  if (typeof input.closeAgent !== "function") {
    throw new Error("closeAgent must be a host adapter function");
  }
  const waitBudgetSeconds = input.waitBudgetSeconds ?? 60;
  if (!Number.isInteger(waitBudgetSeconds) || waitBudgetSeconds < 1 || waitBudgetSeconds > 300) {
    throw new Error("waitBudgetSeconds must be an integer from 1 to 300");
  }
  let state = "waiting";
  let closeCalls = 0;
  let closeConfirmed = false;
  /** @type {Record<string, unknown> | undefined} */
  let closeEvidence;
  let dispatchAllowed = false;
  /** @type {unknown} */
  let report;

  function terminal() {
    if (state !== "waiting") throw new Error("worker round is terminal");
  }

  return {
    get agentId() {
      return agentId;
    },
    get state() {
      return state;
    },
    get closeCalls() {
      return closeCalls;
    },
    get closeConfirmed() {
      return closeConfirmed;
    },
    get report() {
      return report;
    },
    /** @param {string} output */
    accept(output) {
      terminal();
      try {
        report = input.validateOutput(output);
      } catch (error) {
        state = "tool-failure";
        throw error;
      }
      state = "complete";
      return { status: state, replacementAllowed: false };
    },
    timeout() {
      terminal();
      state = "timeout";
      return { status: state, outcome: "defer-external", replacementAllowed: false };
    },
    toolFailure() {
      terminal();
      state = "tool-failure";
      return { status: state, outcome: "defer-external", replacementAllowed: false };
    },
    async close() {
      if (closeCalls !== 0) throw new Error("close-agent must be called exactly once");
      if (!TERMINAL_STATES.has(state)) {
        throw new Error("worker must be terminal before close-agent");
      }
      const previousState = state;
      closeCalls = 1;
      let proof;
      try {
        proof = await input.closeAgent(agentId);
        const closeProof = validateCloseProof(proof, agentId);
        closeConfirmed = closeProof.closed;
        closeEvidence = {
          source: "host-close-agent",
          agentId,
          previousStatus: closeProof.previousStatus,
          closed: closeProof.closed
        };
      } catch (error) {
        state = "close-unconfirmed";
        closeEvidence = {
          source: "host-close-agent",
          agentId,
          error: "close-agent-failed"
        };
        throw error;
      }
      state = closeConfirmed ? "closed" : "close-unconfirmed";
      dispatchAllowed = previousState === "complete" && closeConfirmed;
      return {
        status: state,
        dispatchAllowed,
        closeEvidence
      };
    },
    assertDispatchAllowed() {
      if (!dispatchAllowed) {
        throw new Error("dispatch is forbidden for this worker round");
      }
      return { agentId, surface };
    },
    snapshot() {
      return {
        agentId,
        surface,
        artifactId,
        waitBudgetSeconds,
        state,
        closeCalls,
        closeConfirmed,
        closeEvidence,
        dispatchAllowed,
        replacementAllowed: false,
        report
      };
    }
  };
}

/** @param {{ agentId: string, waitBudgetSeconds?: number, surface: string, artifactId: string, closeAgent: (agentId: string) => Promise<unknown> | unknown }} input */
export function createReviewerWatchdog(input) {
  return createWorkerWatchdog({
    ...input,
    validateOutput: (output) =>
      validateReviewerReport(output, {
        surface: input.surface,
        artifactId: input.artifactId
      })
  });
}

export { CANARY_SENTINEL, REPORT_HEADER };
