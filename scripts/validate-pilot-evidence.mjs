#!/usr/bin/env node
// @ts-check

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL, URL } from "node:url";

import Ajv2020Module from "ajv/dist/2020.js";

const MAX_EVIDENCE_BYTES = 64 * 1024;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isSafeInteger(value) {
  return Number.isSafeInteger(value);
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function timestampMilliseconds(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const timestamp = new Date(value);
  const milliseconds = timestamp.getTime();
  return Number.isFinite(milliseconds) && timestamp.toISOString() === value
    ? milliseconds
    : undefined;
}

/**
 * Check relationships that plain JSON Schema cannot express without nonstandard
 * extensions.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function semanticPilotEvidenceErrors(value) {
  if (
    !isRecord(value) ||
    !isRecord(value.run) ||
    !isRecord(value.outcomes) ||
    !isRecord(value.consent)
  ) {
    return ["evidence-shape-invalid"];
  }
  const startedAt = value.run.startedAt;
  const endedAt = value.run.endedAt;
  const evaluated = value.outcomes.evaluatedPullRequests;
  const ready = value.outcomes.readyReports;
  const notReady = value.outcomes.notReadyReports;
  const falsePositives = value.outcomes.confirmedFalsePositives;
  const falseNegatives = value.outcomes.confirmedFalseNegatives;
  const errors = [];
  const startMilliseconds = timestampMilliseconds(startedAt);
  const endMilliseconds = timestampMilliseconds(endedAt);

  if (
    startMilliseconds === undefined ||
    endMilliseconds === undefined ||
    endMilliseconds < startMilliseconds
  ) {
    errors.push("observation-window-invalid");
  }
  if (value.recordStatus === "observed" && value.classification === "external-pilot") {
    const consentMilliseconds = timestampMilliseconds(value.consent.recordedAt);
    if (
      consentMilliseconds === undefined ||
      startMilliseconds === undefined ||
      consentMilliseconds > startMilliseconds
    ) {
      errors.push("consent-timing-invalid");
    }
  }
  if (
    !isSafeInteger(evaluated) ||
    !isSafeInteger(ready) ||
    !isSafeInteger(notReady) ||
    ready + notReady !== evaluated
  ) {
    errors.push("outcome-total-invalid");
  }
  if (
    !isSafeInteger(falsePositives) ||
    !isSafeInteger(falseNegatives) ||
    !isSafeInteger(evaluated) ||
    falsePositives + falseNegatives > evaluated
  ) {
    errors.push("error-count-invalid");
  }
  return errors;
}

/**
 * @param {string[]} arguments_
 * @returns {Promise<number>}
 */
async function main(arguments_) {
  const requestedPath = arguments_[0];
  if (requestedPath === undefined || requestedPath.length === 0) {
    process.stderr.write(
      "Usage: node scripts/validate-pilot-evidence.mjs path/to/pilot-evidence.json\n"
    );
    return 2;
  }
  const path = resolve(requestedPath);
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_EVIDENCE_BYTES) {
    process.stderr.write("Pilot evidence exceeds the 64 KiB limit.\n");
    return 1;
  }

  /** @type {unknown} */
  let evidence;
  try {
    evidence = JSON.parse(bytes.toString("utf8"));
  } catch {
    process.stderr.write("Pilot evidence is not valid JSON.\n");
    return 1;
  }
  const schemaText = await readFile(
    new URL("../docs/pilot/evidence.schema.json", import.meta.url),
    "utf8"
  );
  /** @type {unknown} */
  let schema;
  try {
    schema = JSON.parse(schemaText);
  } catch {
    process.stderr.write("Pilot evidence schema is not valid JSON.\n");
    return 1;
  }
  if (!isRecord(schema)) {
    process.stderr.write("Pilot evidence schema must be an object.\n");
    return 1;
  }
  const Ajv2020 = /** @type {typeof import("ajv/dist/2020.js").default} */ (
    /** @type {unknown} */ (Ajv2020Module)
  );
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const schemaValid = validate(evidence);
  const semanticErrors = semanticPilotEvidenceErrors(evidence);
  if (!schemaValid || semanticErrors.length > 0) {
    const schemaErrors = (validate.errors ?? []).map(
      (error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`
    );
    for (const error of [...schemaErrors, ...semanticErrors].slice(0, 50)) {
      process.stderr.write(`${error}\n`);
    }
    return 1;
  }
  process.stdout.write(`Pilot evidence valid: ${path}\n`);
  return 0;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(resolve(entryPath)).href === import.meta.url) {
  process.exitCode = await main(process.argv.slice(2));
}
