#!/usr/bin/env node
// @ts-check

import { readFileSync, statSync } from "node:fs";
import process from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = 2;
const MAX_TEXT_LENGTH = 4_000;
const MAX_REVIEWERS = 5;
const ROUTE_CAPS = new Map([
  ["base", 3],
  ["deep-research", 5]
]);
const OUTCOMES = new Set(["promote", "reopen", "defer-external"]);
const REVIEWER_STATUSES = new Set(["complete", "timeout", "tool-failure", "deferred"]);
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
  "status"
]);
const COVERAGE_FIELDS = new Set(["surface", "ownerId"]);
const FINDING_FIELDS = new Set(["id", "surface", "reviewerId", "severity", "summary"]);
const ARTIFACT_BINDING_FIELDS = new Set(["artifactId", "sourceLineage", "claimIds"]);

/** @typedef {{ artifactId: string, sourceLineage: string[], claimIds: string[] }} ArtifactBinding */
/**
 * @typedef {{
 *   id: string,
 *   role: string,
 *   dispatchContext: string,
 *   ownedSurfaces: string[],
 *   excludedSurfaces: string[],
 *   artifactIds: string[],
 *   artifactBindings: ArtifactBinding[],
 *   status: string
 * }} ReviewerAssignment
 * @typedef {{ reviewers: ReviewerAssignment[], ownedSurfaces: Set<string> }} ReviewerData
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @param {string} name */
function requiredText(value, name) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_TEXT_LENGTH) {
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
    reviewerData.reviewers.some((reviewer) => reviewer.status !== "complete")
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
