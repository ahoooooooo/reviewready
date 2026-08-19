#!/usr/bin/env node
// @ts-check

import { readFileSync, statSync } from "node:fs";
import process from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateCloseEvidence, validateReviewerReport } from "./reviewer-watchdog.mjs";
import { validateResearchPass } from "./research-pass.mjs";

const SCHEMA_VERSION = 2;
const MAX_TEXT_LENGTH = 4_000;
const MAX_REPORT_LENGTH = 8_000;
const MAX_REVIEWERS = 5;
const ROUTE_CAPS = new Map([
  ["base", 3],
  ["deep-research", 5]
]);
const OUTCOMES = new Set(["promote", "reopen", "defer-external"]);
const REVIEWER_STATUSES = new Set(["complete", "timeout", "tool-failure", "deferred"]);
const REVIEWER_READINESS_STATUSES = new Set(["passed", "deferred"]);
const REVIEWER_CANARY_SENTINEL = "REVIEWER_CANARY_OK";
const REVIEWER_PACKET_MODES = new Set(["single-artifact", "paired-artifacts"]);
const SEVERITIES = new Map([
  ["P0", 3],
  ["P1", 2],
  ["P2", 1]
]);
const HANDOFF_FIELDS = new Set([
  "schemaVersion",
  "route",
  "reviewEpoch",
  "revision",
  "worktree",
  "scope",
  "artifacts",
  "evidence",
  "reviewerReadiness",
  "reviewers",
  "surfaceCoverage",
  "findings",
  "strongestFalsifier",
  "missedAttackSurface",
  "authorityEvidenceGap",
  "recommendation",
  "outcome"
]);
const REVIEWER_FIELDS = new Set([
  "id",
  "role",
  "dispatchContext",
  "ownedSurfaces",
  "excludedSurfaces",
  "artifactIds",
  "artifactBindings",
  "packetMode",
  "waitBudgetSeconds",
  "report",
  "closeEvidence",
  "status"
]);
const COVERAGE_FIELDS = new Set(["surface", "ownerId"]);
const FINDING_FIELDS = new Set(["id", "surface", "reviewerId", "severity", "summary"]);
const ARTIFACT_BINDING_FIELDS = new Set(["artifactId", "sourceLineage", "claimIds"]);
const REVIEWER_READINESS_FIELDS = new Set([
  "canaryId",
  "dispatchContext",
  "waitBudgetSeconds",
  "sentinel",
  "observedOutput",
  "status",
  "closed",
  "closeEvidence"
]);

/** @typedef {{ artifactId: string, sourceLineage: string[], claimIds: string[] }} ArtifactBinding */
/** @typedef {{ source: "host-close-agent", agentId: string, previousStatus: string, closed: boolean } | { source: "host-close-agent", agentId: string, error: string }} CloseEvidence */
/**
 * @typedef {{
 *   id: string,
 *   role: string,
 *   dispatchContext: string,
 *   ownedSurfaces: string[],
 *   excludedSurfaces: string[],
 *   artifactIds: string[],
 *   artifactBindings: ArtifactBinding[],
 *   report?: string,
 *   closeEvidence: CloseEvidence,
 *   status: string
 * }} ReviewerAssignment
 * @typedef {{ reviewers: ReviewerAssignment[], ownedSurfaces: Set<string> }} ReviewerData
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @param {string} name @param {number} [maxLength] */
function requiredText(value, name, maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(name + " must be non-empty bounded text");
  }
  return value;
}

/** @param {unknown} value @param {string} name @param {boolean} [allowEmpty] */
function requiredTextList(value, name, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(name + " must be a non-empty list");
  }
  return value.map((item, index) => requiredText(item, name + "[" + String(index) + "]"));
}

/** @param {string[]} values @param {string} name */
function requireUnique(values, name) {
  if (new Set(values).size !== values.length) throw new Error(name + " must be unique");
}

/** @param {ArtifactBinding} binding @returns {string} */
function canonicalArtifactBinding(binding) {
  return JSON.stringify({
    artifactId: binding.artifactId,
    sourceLineage: [...binding.sourceLineage].sort(),
    claimIds: [...binding.claimIds].sort()
  });
}

/** @param {unknown} value @param {string[]} artifactIds @param {string} route @param {number} index @returns {ArtifactBinding[]} */
function requiredArtifactBindings(value, artifactIds, route, index) {
  if (value === undefined) {
    if (route === "deep-research") {
      throw new Error("deep-research reviewers require artifact bindings");
    }
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("reviewers[" + String(index) + "].artifactBindings must be a list");
  }
  const bindings = value.map((item) => {
    if (!isRecord(item)) {
      throw new Error("artifact binding must be an object");
    }
    for (const key of Object.keys(item)) {
      if (!ARTIFACT_BINDING_FIELDS.has(key)) {
        throw new Error("unexpected artifact binding field: " + key);
      }
    }
    return {
      artifactId: requiredText(item.artifactId, "artifact binding artifactId"),
      sourceLineage: requiredTextList(item.sourceLineage, "artifact binding sourceLineage"),
      claimIds: requiredTextList(item.claimIds, "artifact binding claimIds")
    };
  });
  requireUnique(
    bindings.map((binding) => binding.artifactId),
    "artifact binding ids"
  );
  for (const binding of bindings) {
    if (!artifactIds.includes(binding.artifactId)) {
      throw new Error("artifact binding is not assigned: " + binding.artifactId);
    }
  }
  if (route === "deep-research" && bindings.length !== artifactIds.length) {
    throw new Error("deep-research artifact bindings are incomplete");
  }
  for (const artifactId of artifactIds) {
    if (!bindings.some((binding) => binding.artifactId === artifactId)) {
      throw new Error("artifact binding is missing: " + artifactId);
    }
  }
  return bindings;
}

/** @param {unknown} value */
function requiredReviewerReadiness(value) {
  if (!isRecord(value)) throw new Error("reviewerReadiness must be an object");
  for (const key of Object.keys(value)) {
    if (!REVIEWER_READINESS_FIELDS.has(key)) {
      throw new Error("unexpected reviewerReadiness field: " + key);
    }
  }
  const canaryId = requiredText(value.canaryId, "reviewerReadiness.canaryId");
  const dispatchContext = requiredText(value.dispatchContext, "reviewerReadiness.dispatchContext");
  if (dispatchContext !== "fork_context=false") {
    throw new Error("reviewerReadiness must use fork_context=false");
  }
  if (
    typeof value.waitBudgetSeconds !== "number" ||
    !Number.isInteger(value.waitBudgetSeconds) ||
    value.waitBudgetSeconds < 1 ||
    value.waitBudgetSeconds > 30
  ) {
    throw new Error("reviewerReadiness.waitBudgetSeconds must be an integer from 1 to 30");
  }
  const sentinel = requiredText(value.sentinel, "reviewerReadiness.sentinel");
  if (sentinel !== REVIEWER_CANARY_SENTINEL) {
    throw new Error("reviewerReadiness.sentinel is invalid");
  }
  const observedOutput = requiredText(value.observedOutput, "reviewerReadiness.observedOutput");
  const status = requiredText(value.status, "reviewerReadiness.status");
  if (!REVIEWER_READINESS_STATUSES.has(status)) {
    throw new Error("reviewerReadiness.status must be passed or deferred");
  }
  const closed = value.closed;
  if (typeof closed !== "boolean") {
    throw new Error("reviewerReadiness.closed must be boolean");
  }
  if (status === "passed" && observedOutput.trim() !== REVIEWER_CANARY_SENTINEL) {
    throw new Error("passed reviewerReadiness must observe the canary sentinel");
  }
  if (status === "passed" && !closed) {
    throw new Error("passed reviewerReadiness must confirm closed=true");
  }
  const closeEvidence = validateCloseEvidence(value.closeEvidence, canaryId, status === "passed");
  if ("closed" in closeEvidence && closeEvidence.closed !== closed) {
    throw new Error("reviewerReadiness closed flag does not match close evidence");
  }
  return {
    canaryId,
    dispatchContext,
    waitBudgetSeconds: value.waitBudgetSeconds,
    sentinel,
    observedOutput,
    status,
    closed,
    closeEvidence
  };
}

/**
 * @param {unknown} value
 * @param {string} route
 * @param {string} role
 * @param {string[]} ownedSurfaces
 * @param {string[]} artifactIds
 * @param {number} index
 */
function requiredSubstantiveReport(value, route, role, ownedSurfaces, artifactIds, index) {
  const report = requiredText(value, "reviewers[" + String(index) + "].report", MAX_REPORT_LENGTH);
  const validator =
    route === "deep-research" && role !== "final-review"
      ? validateResearchPass
      : validateReviewerReport;
  let lastError;
  for (const surface of ownedSurfaces) {
    try {
      for (const artifactId of artifactIds) {
        validator(report, { surface, artifactId });
      }
      return report;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    "reviewer report is invalid: " +
      (lastError instanceof Error ? lastError.message : "unknown validation error")
  );
}

/** @param {unknown} value @param {string} route @returns {ReviewerData} */
function requiredReviewers(value, route) {
  const maxReviewers = ROUTE_CAPS.get(route) ?? MAX_REVIEWERS;
  if (!Array.isArray(value) || value.length === 0 || value.length > maxReviewers) {
    throw new Error(route + " route allows at most " + String(maxReviewers) + " reviewers");
  }
  const ids = /** @type {string[]} */ ([]);
  const owned = /** @type {Set<string>} */ (new Set());
  const artifactOwners = /** @type {Map<string, Set<string>>} */ (new Map());
  const canonicalBindings = /** @type {Map<string, string>} */ (new Map());
  const reviewerRoles = /** @type {Map<string, string>} */ (new Map());
  const reviewers = /** @type {ReviewerAssignment[]} */ (
    value.map((item, index) => {
      if (!isRecord(item)) throw new Error("reviewers[" + String(index) + "] must be an object");
      for (const key of Object.keys(item)) {
        if (!REVIEWER_FIELDS.has(key)) {
          throw new Error("unexpected reviewer field: " + key);
        }
      }
      const id = requiredText(item.id, "reviewers[" + String(index) + "].id");
      const role = requiredText(item.role, "reviewers[" + String(index) + "].role");
      const dispatchContext = requiredText(
        item.dispatchContext,
        "reviewers[" + String(index) + "].dispatchContext"
      );
      if (dispatchContext !== "fork_context=false") {
        throw new Error("reviewers must use fork_context=false");
      }
      const ownedSurfaces = requiredTextList(
        item.ownedSurfaces,
        "reviewers[" + String(index) + "].ownedSurfaces"
      );
      const excludedSurfaces = requiredTextList(
        item.excludedSurfaces,
        "reviewers[" + String(index) + "].excludedSurfaces",
        true
      );
      const artifactIds = requiredTextList(
        item.artifactIds,
        "reviewers[" + String(index) + "].artifactIds"
      );
      const packetMode = requiredText(
        item.packetMode,
        "reviewers[" + String(index) + "].packetMode"
      );
      if (!REVIEWER_PACKET_MODES.has(packetMode)) {
        throw new Error("reviewers[" + String(index) + "].packetMode is invalid");
      }
      const waitBudgetSeconds = item.waitBudgetSeconds;
      if (
        typeof waitBudgetSeconds !== "number" ||
        !Number.isInteger(waitBudgetSeconds) ||
        waitBudgetSeconds < 1 ||
        waitBudgetSeconds > 120
      ) {
        throw new Error(
          "reviewers[" + String(index) + "].waitBudgetSeconds must be an integer from 1 to 120"
        );
      }
      if (packetMode === "single-artifact") {
        if (artifactIds.length !== 1) {
          throw new Error("single-artifact reviewer packets require exactly one artifact");
        }
        if (waitBudgetSeconds > 60) {
          throw new Error("single-artifact reviewer packets allow at most a 60-second budget");
        }
      }
      if (
        packetMode === "paired-artifacts" &&
        (artifactIds.length !== 2 || waitBudgetSeconds !== 120)
      ) {
        throw new Error("paired-artifacts packets require two artifacts and a 120-second budget");
      }
      if (
        route === "deep-research" &&
        artifactIds.some((artifactId) => !artifactId.startsWith("raw:"))
      ) {
        throw new Error("deep-research reviewer artifacts must be raw");
      }
      const artifactBindings = requiredArtifactBindings(
        item.artifactBindings,
        artifactIds,
        route,
        index
      );
      for (const binding of artifactBindings) {
        const canonical = canonicalArtifactBinding(binding);
        const previous = canonicalBindings.get(binding.artifactId);
        if (previous !== undefined && previous !== canonical) {
          throw new Error("conflicting artifact binding: " + binding.artifactId);
        }
        canonicalBindings.set(binding.artifactId, canonical);
      }
      const status = requiredText(item.status, "reviewers[" + String(index) + "].status");
      if (!REVIEWER_STATUSES.has(status)) {
        throw new Error(
          "reviewers[" +
            String(index) +
            "].status must be complete, timeout, tool-failure, or deferred"
        );
      }
      const closeEvidence = validateCloseEvidence(item.closeEvidence, id, status === "complete");
      const report =
        status === "complete" && (role === "final-review" || route === "deep-research")
          ? requiredSubstantiveReport(item.report, route, role, ownedSurfaces, artifactIds, index)
          : undefined;
      requireUnique(ownedSurfaces, "owned surfaces");
      requireUnique(excludedSurfaces, "excluded surfaces");
      requireUnique(artifactIds, "artifact ids");
      for (const surface of ownedSurfaces) {
        if (owned.has(surface)) throw new Error("owned surface overlap: " + surface);
        if (excludedSurfaces.includes(surface)) {
          throw new Error("surface cannot be both owned and excluded: " + surface);
        }
        owned.add(surface);
      }
      ids.push(id);
      reviewerRoles.set(id, role);
      for (const artifactId of artifactIds) {
        const owners = artifactOwners.get(artifactId) ?? new Set();
        owners.add(id);
        artifactOwners.set(artifactId, owners);
      }
      return {
        id,
        role,
        dispatchContext,
        ownedSurfaces,
        excludedSurfaces,
        artifactIds,
        artifactBindings,
        packetMode,
        waitBudgetSeconds,
        report,
        closeEvidence,
        status
      };
    })
  );
  requireUnique(ids, "reviewer ids");
  if (reviewers.filter((reviewer) => reviewer.role === "final-review").length !== 1) {
    throw new Error("handoff may contain only one final reviewer");
  }
  for (const [artifactId, owners] of artifactOwners) {
    const nonFinalOwners = [...owners].filter(
      (ownerId) => reviewerRoles.get(ownerId) !== "final-review"
    );
    if (nonFinalOwners.length > 1) {
      throw new Error("artifact id overlap: " + artifactId);
    }
  }
  return { reviewers, ownedSurfaces: owned };
}

/** @param {unknown} value @param {ReviewerData} reviewerData */
function requiredCoverage(value, reviewerData) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("surface coverage must be a non-empty list");
  }
  const coverage = value.map((item) => {
    if (!isRecord(item)) throw new Error("surface coverage item must be an object");
    for (const key of Object.keys(item)) {
      if (!COVERAGE_FIELDS.has(key)) throw new Error("unexpected coverage field: " + key);
    }
    return {
      surface: requiredText(item.surface, "surface coverage surface"),
      ownerId: requiredText(item.ownerId, "surface coverage ownerId")
    };
  });
  requireUnique(
    coverage.map((item) => item.surface),
    "surface coverage surfaces"
  );
  const reviewerOwned = /** @type {Map<string, Set<string>>} */ (
    new Map(
      reviewerData.reviewers.map((reviewer) => [
        reviewer.id,
        /** @type {Set<string>} */ (new Set(reviewer.ownedSurfaces))
      ])
    )
  );
  for (const item of coverage) {
    const ownedSurfaces = reviewerOwned.get(item.ownerId);
    if (ownedSurfaces === undefined) {
      throw new Error("surface coverage owner is unknown: " + item.ownerId);
    }
    if (!reviewerData.ownedSurfaces.has(item.surface)) {
      throw new Error("surface coverage is not owned: " + item.surface);
    }
    if (!ownedSurfaces.has(item.surface)) {
      throw new Error("surface coverage owner does not own surface: " + item.surface);
    }
  }
  if (coverage.length !== reviewerData.ownedSurfaces.size) {
    throw new Error("surface coverage is incomplete");
  }
  for (const surface of reviewerData.ownedSurfaces) {
    if (!coverage.some((item) => item.surface === surface)) {
      throw new Error("surface coverage is incomplete: " + surface);
    }
  }
  return coverage;
}

/** @param {unknown} value @param {ReviewerData} reviewerData */
function requiredFindings(value, reviewerData) {
  if (!Array.isArray(value)) throw new Error("findings must be a list");
  let previousSeverity = Number.POSITIVE_INFINITY;
  const ids = /** @type {string[]} */ ([]);
  const reviewerById = new Map(
    reviewerData.reviewers.map((reviewer) => [reviewer.id, new Set(reviewer.ownedSurfaces)])
  );
  const findings = value.map((item, index) => {
    if (!isRecord(item)) throw new Error("findings[" + String(index) + "] must be an object");
    for (const key of Object.keys(item)) {
      if (!FINDING_FIELDS.has(key)) {
        throw new Error("unexpected finding field: " + key);
      }
    }
    const id = requiredText(item.id, "findings[" + String(index) + "].id");
    const surface = requiredText(item.surface, "findings[" + String(index) + "].surface");
    const reviewerId = requiredText(item.reviewerId, "findings[" + String(index) + "].reviewerId");
    const severity = requiredText(item.severity, "findings[" + String(index) + "].severity");
    const rank = SEVERITIES.get(severity);
    if (rank === undefined) {
      throw new Error("findings[" + String(index) + "].severity is invalid");
    }
    if (rank > previousSeverity) throw new Error("findings must be severity ordered");
    previousSeverity = rank;
    const ownedSurfaces = reviewerById.get(reviewerId);
    if (ownedSurfaces === undefined) throw new Error("finding reviewer is unknown: " + reviewerId);
    if (!ownedSurfaces.has(surface)) {
      throw new Error("finding surface is not owned by reviewer: " + surface);
    }
    ids.push(id);
    return {
      id,
      surface,
      reviewerId,
      severity,
      summary: requiredText(item.summary, "findings[" + String(index) + "].summary")
    };
  });
  requireUnique(ids, "finding ids");
  return findings;
}

/** @param {unknown} value */
export function validateHandoff(value) {
  if (!isRecord(value)) throw new Error("handoff must be an object");
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw new Error("schemaVersion is invalid");
  }
  for (const key of Object.keys(value)) {
    if (!HANDOFF_FIELDS.has(key)) throw new Error("unexpected handoff field: " + key);
  }
  const route = requiredText(value.route, "route");
  if (!ROUTE_CAPS.has(route)) throw new Error("route is invalid");
  const artifacts = requiredTextList(value.artifacts, "artifacts");
  requireUnique(artifacts, "artifact ids");
  if (route === "deep-research" && artifacts.some((artifact) => !artifact.startsWith("raw:"))) {
    throw new Error("deep-research handoff artifacts must be raw");
  }
  const reviewerData = requiredReviewers(value.reviewers, route);
  const reviewerReadiness = requiredReviewerReadiness(value.reviewerReadiness);
  const artifactSet = new Set(artifacts);
  const assignedArtifacts = /** @type {Set<string>} */ (new Set());
  for (const reviewer of reviewerData.reviewers) {
    for (const artifactId of reviewer.artifactIds) {
      if (!artifactSet.has(artifactId)) {
        throw new Error("reviewer artifact is not listed: " + artifactId);
      }
      assignedArtifacts.add(artifactId);
    }
  }
  for (const artifact of artifacts) {
    if (!assignedArtifacts.has(artifact)) {
      throw new Error("artifact is not assigned: " + artifact);
    }
  }
  const surfaceCoverage = requiredCoverage(value.surfaceCoverage, reviewerData);
  const outcome = requiredText(value.outcome, "outcome");
  if (!OUTCOMES.has(outcome)) throw new Error("outcome is invalid");
  if (
    outcome !== "defer-external" &&
    (reviewerData.reviewers.some((reviewer) => reviewer.status !== "complete") ||
      reviewerReadiness.status !== "passed" ||
      !reviewerReadiness.closed)
  ) {
    throw new Error("incomplete reviewer requires defer-external");
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    route,
    reviewEpoch: requiredText(value.reviewEpoch, "reviewEpoch"),
    revision: requiredText(value.revision, "revision"),
    worktree: requiredText(value.worktree, "worktree"),
    scope: requiredTextList(value.scope, "scope"),
    artifacts,
    evidence: requiredTextList(value.evidence, "evidence"),
    reviewerReadiness,
    reviewers: reviewerData.reviewers,
    surfaceCoverage,
    findings: requiredFindings(value.findings, reviewerData),
    strongestFalsifier: requiredText(value.strongestFalsifier, "strongestFalsifier"),
    missedAttackSurface: requiredText(value.missedAttackSurface, "missedAttackSurface"),
    authorityEvidenceGap: requiredText(value.authorityEvidenceGap, "authorityEvidenceGap"),
    recommendation: requiredText(value.recommendation, "recommendation"),
    outcome
  };
}

/** @param {string[]} args */
function requiredFile(args) {
  if (args.length !== 2 || args[0] !== "--file" || args[1] === undefined) {
    throw new Error("usage: node scripts/independent-review-handoff.mjs validate --file <json>");
  }
  return args[1];
}

export function main() {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command !== "validate") throw new Error("command must be validate");
    const path = resolve(requiredFile(args));
    if (!statSync(path).isFile()) throw new Error("handoff path must be a regular file");
    const handoff = validateHandoff(JSON.parse(readFileSync(path, "utf8")));
    process.stdout.write(JSON.stringify({ valid: true, handoff }, null, 2) + "\n");
  } catch (error) {
    process.stderr.write(
      (error instanceof Error ? error.message : "handoff validation failed") + "\n"
    );
    process.exitCode = 2;
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
