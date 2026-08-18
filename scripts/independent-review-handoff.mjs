#!/usr/bin/env node
// @ts-check

import { readFileSync, statSync } from "node:fs";
import process from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = 1;
const MAX_TEXT_LENGTH = 4_000;
const OUTCOMES = new Set(["promote", "reopen", "defer-external"]);
const SEVERITIES = new Map([
  ["P0", 3],
  ["P1", 2],
  ["P2", 1]
]);
const HANDOFF_FIELDS = new Set([
  "schemaVersion",
  "revision",
  "worktree",
  "reviewerId",
  "reviewerRole",
  "dispatchContext",
  "scope",
  "artifacts",
  "evidence",
  "findings",
  "strongestFalsifier",
  "missedAttackSurface",
  "authorityEvidenceGap",
  "recommendation",
  "outcome"
]);
const FINDING_FIELDS = new Set(["severity", "summary"]);

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

/** @param {unknown} value */
function requiredFindings(value) {
  if (!Array.isArray(value)) throw new Error("findings must be a list");
  let previousSeverity = Number.POSITIVE_INFINITY;
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error("findings[" + String(index) + "] must be an object");
    for (const key of Object.keys(item)) {
      if (!FINDING_FIELDS.has(key)) {
        throw new Error("unexpected finding field: " + key);
      }
    }
    const severity = requiredText(item.severity, "findings[" + String(index) + "].severity");
    const rank = SEVERITIES.get(severity);
    if (rank === undefined) {
      throw new Error("findings[" + String(index) + "].severity is invalid");
    }
    if (rank > previousSeverity) throw new Error("findings must be severity ordered");
    previousSeverity = rank;
    return {
      severity,
      summary: requiredText(item.summary, "findings[" + String(index) + "].summary")
    };
  });
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
  const dispatchContext = requiredText(value.dispatchContext, "dispatchContext");
  if (dispatchContext !== "fork_context=false") {
    throw new Error("dispatchContext must be fork_context=false");
  }
  const outcome = requiredText(value.outcome, "outcome");
  if (!OUTCOMES.has(outcome)) throw new Error("outcome is invalid");
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: requiredText(value.revision, "revision"),
    worktree: requiredText(value.worktree, "worktree"),
    reviewerId: requiredText(value.reviewerId, "reviewerId"),
    reviewerRole: requiredText(value.reviewerRole, "reviewerRole"),
    dispatchContext,
    scope: requiredTextList(value.scope, "scope"),
    artifacts: requiredTextList(value.artifacts, "artifacts"),
    evidence: requiredTextList(value.evidence, "evidence"),
    findings: requiredFindings(value.findings),
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
