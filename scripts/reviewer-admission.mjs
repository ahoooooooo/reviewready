#!/usr/bin/env node
// @ts-check

import { readFileSync } from "node:fs";
import process from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ADVISORY_WARNING_IDS = new Set(["git.worktree.dev_drive"]);
export const REQUIRED_DOCTOR_CHECKS = [
  "auth.credentials",
  "config.load",
  "installation",
  "mcp.config",
  "network.provider_reachability",
  "network.websocket_reachability",
  "runtime.provenance",
  "sandbox.helpers",
  "state.paths",
  "state.rollout_db_parity",
  "terminal.env"
];

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize only the non-interactive terminal variable needed by doctor.
 * The returned object is process-local; the caller must not persist it.
 *
 * @param {NodeJS.ProcessEnv} [environment]
 * @returns {NodeJS.ProcessEnv}
 */
export function normalizeDoctorEnvironment(environment = process.env) {
  const term = environment.TERM?.trim().toLowerCase();
  if (term === undefined || term.length === 0 || term === "dumb") {
    return { ...environment, TERM: "xterm-256color" };
  }
  return { ...environment };
}

/**
 * Accept doctor warnings only when every required check is healthy and the
 * warning is an explicitly non-functional advisory.
 *
 * @param {unknown} value
 * @returns {{ admitted: true, overallStatus: "ok" | "warning", warnings: string[] }}
 */
export function validateDoctorAdmission(value) {
  if (!isRecord(value)) throw new Error("doctor output must be an object");
  if (value.overallStatus !== "ok" && value.overallStatus !== "warning") {
    throw new Error("doctor overallStatus must be ok or warning");
  }
  if (!isRecord(value.checks)) throw new Error("doctor output is missing checks");
  const checks = value.checks;
  for (const id of REQUIRED_DOCTOR_CHECKS) {
    const check = checks[id];
    if (!isRecord(check) || check.status !== "ok") {
      throw new Error("required doctor check is not ok: " + id);
    }
  }
  const warnings = Object.entries(checks)
    .filter(([, check]) => isRecord(check) && check.status === "warning")
    .map(([id]) => id);
  const blockingWarnings = warnings.filter((id) => !ADVISORY_WARNING_IDS.has(id));
  if (blockingWarnings.length > 0) {
    throw new Error("doctor has non-advisory warnings: " + blockingWarnings.join(", "));
  }
  return { admitted: true, overallStatus: value.overallStatus, warnings };
}

/** @param {string[]} args @returns {string | undefined} */
function inputFile(args) {
  if (args.length === 0) return undefined;
  if (args.length === 2 && args[0] === "--file" && args[1] !== undefined) return args[1];
  throw new Error("usage: node scripts/reviewer-admission.mjs doctor [--file <json>]");
}

export function main() {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command !== "doctor") throw new Error("command must be doctor");
    const file = inputFile(args);
    const source =
      file === undefined ? readFileSync(0, "utf8") : readFileSync(resolve(file), "utf8");
    const result = validateDoctorAdmission(JSON.parse(source));
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (error) {
    process.stderr.write(
      (error instanceof Error ? error.message : "doctor admission failed") + "\n"
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
