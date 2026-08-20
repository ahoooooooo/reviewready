#!/usr/bin/env node
// @ts-check

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { createWorkerWatchdog } from "./reviewer-watchdog.mjs";

const HEADER = "RESEARCH_PASS_V1";
const MAX_PASS_OUTPUT_LENGTH = 8_000;
const MAX_PASS_FIELD_LENGTH = 2_000;
const FIELDS = new Set([
  "surface",
  "sources",
  "claim_ids",
  "evidence",
  "counter_case",
  "freshness",
  "outcome"
]);
const OUTCOMES = new Set(["continue", "reopen", "defer-external"]);

/** @param {unknown} value @param {string} name */
function requiredText(value, name) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > MAX_PASS_FIELD_LENGTH
  ) {
    throw new Error(name + " must be non-empty bounded text");
  }
  return value.trim();
}

/**
 * @param {unknown} output
 * @param {{ surface: string, artifactId: string }} expected
 */
export function validateResearchPass(output, expected) {
  if (typeof output !== "string") throw new Error("research pass must be text");
  if (output.length > MAX_PASS_OUTPUT_LENGTH) {
    throw new Error("research pass exceeds the bounded output limit");
  }
  if (!expected.artifactId.startsWith("raw:")) {
    throw new Error("research pass artifact must use raw: prefix");
  }
  const lines = output.trim().split(/\r?\n/gu);
  if (lines[0] !== HEADER) throw new Error("research pass header is invalid");
  const fields = /** @type {Record<string, string>} */ ({});
  for (const line of lines.slice(1)) {
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error("research pass line is invalid");
    const key = line.slice(0, separator);
    if (!FIELDS.has(key)) throw new Error("research pass field is unexpected: " + key);
    if (fields[key] !== undefined) throw new Error("research pass field is duplicated: " + key);
    fields[key] = requiredText(line.slice(separator + 1), "research pass " + key);
  }
  for (const field of FIELDS) {
    if (fields[field] === undefined) throw new Error("research pass field is missing: " + field);
  }
  const parsed = {
    surface: requiredText(fields.surface, "research pass surface"),
    sources: requiredText(fields.sources, "research pass sources"),
    claim_ids: requiredText(fields.claim_ids, "research pass claim_ids"),
    evidence: requiredText(fields.evidence, "research pass evidence"),
    counter_case: requiredText(fields.counter_case, "research pass counter_case"),
    freshness: requiredText(fields.freshness, "research pass freshness"),
    outcome: requiredText(fields.outcome, "research pass outcome")
  };
  if (parsed.surface !== expected.surface) throw new Error("research pass surface is off-scope");
  const evidenceTokens = parsed.evidence.split(/[;,]/u).map((token) => token.trim());
  if (
    !evidenceTokens.some(
      (token) => token === expected.artifactId || token.startsWith(expected.artifactId + ":")
    )
  ) {
    throw new Error("research pass evidence is outside the raw packet");
  }
  if (!OUTCOMES.has(parsed.outcome)) throw new Error("research pass outcome is invalid");
  return parsed;
}

/** @param {{ agentId: string, waitBudgetSeconds?: number, surface: string, artifactId: string, closeAgent: (agentId: string) => Promise<unknown> | unknown }} input */
export function createResearchPassWatchdog(input) {
  return createWorkerWatchdog({
    ...input,
    validateOutput: (output) =>
      validateResearchPass(output, {
        surface: input.surface,
        artifactId: input.artifactId
      })
  });
}

/** @param {string[]} args @param {string} name */
function requiredArg(args, name) {
  const index = args.indexOf("--" + name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (value === undefined || value.length === 0) throw new Error("missing --" + name);
  return value;
}

export function main() {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command !== "validate") {
      throw new Error(
        "usage: research-pass.mjs validate --file <file> --surface <surface> --artifact <raw-id>"
      );
    }
    const file = resolve(requiredArg(args, "file"));
    if (!statSync(file).isFile()) throw new Error("research pass path must be a regular file");
    const result = validateResearchPass(readFileSync(file, "utf8"), {
      surface: requiredArg(args, "surface"),
      artifactId: requiredArg(args, "artifact")
    });
    process.stdout.write(JSON.stringify({ valid: true, pass: result }, null, 2) + "\n");
  } catch (error) {
    process.stderr.write(
      (error instanceof Error ? error.message : "research pass validation failed") + "\n"
    );
    process.exitCode = 2;
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("research-pass.mjs")) main();

export { HEADER };
